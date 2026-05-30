/**
 * 스케줄러 서비스
 * V4 Phase 10: 예약된 작업 실행
 */

import { prisma } from "@/lib/db";
import { createTaskLogger } from "../../scripts/lib/logger";
import { runTsNodeScript } from "@/lib/run-script";
import { kstWallClockToInstant, formatKstYmd } from "@/lib/kst";

const log = createTaskLogger("Scheduler");

// RUNNING 상태로 이 시간(분)을 초과해 멈춰 있으면 죽은 프로세스로 간주해 회수한다.
// 스크립트 자체 타임아웃(5분)보다 충분히 길게 둔다.
const STUCK_RUNNING_MINUTES = 20;

interface TopicSeed {
  type: "travel" | "golf" | "knowledge";
  topic: string;
  keywords: string[];
  style?: string;
  images?: string;
  publishMode?: "now" | "schedule";
  scheduledDate?: string;
}

function safeParseSeed(raw: string | null): TopicSeed | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as TopicSeed;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function normalizeScheduledDate(raw: string | undefined | null): Date | null {
  if (!raw) return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  const dateMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateMatch) {
    const year = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    const day = Number(dateMatch[3]);
    // 날짜만 주어지면 KST 09:00로 해석 (서버 로컬 타임존 의존 제거).
    const parsed = kstWallClockToInstant(year, month, day, 9, 0, 0);

    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return parsed;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  parsed.setSeconds(0, 0);
  return parsed;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "알 수 없는 오류";
}

function formatDateYmd(date: Date): string {
  // 발행 단계(simple/topic-agent)가 KST를 전제하므로 날짜 문자열도 KST 기준으로 산출.
  return formatKstYmd(date);
}

/**
 * 실행 대기 중인 예약 조회
 */
export async function getPendingPosts(limit = 10) {
    const now = new Date();

    return prisma.post.findMany({
        where: {
            status: "PENDING",
            scheduledAt: { lte: now },
        },
        orderBy: { scheduledAt: "asc" },
        take: limit,
    });
}

/**
 * 예약된 글 발행 실행
 */
export async function executeScheduledPost(
  postId: string,
  options: { forceRun?: boolean } = {},
): Promise<boolean> {
  const { forceRun = false } = options;

  log.info(`예약 발행 시작: ${postId}`);

    try {
        // 원자적 클레임: PENDING(또는 forceRun 시 RUNNING 외 상태)만 RUNNING으로 선점.
        // updateMany는 조건에 맞는 행만 갱신하므로, 동시에 두 워커가 같은 글을
        // 집어 중복 발행하는 경합을 막는다 (count===1일 때만 우리가 소유).
        const claim = await prisma.post.updateMany({
            where: forceRun
                ? { id: postId, status: { not: "RUNNING" } }
                : { id: postId, status: "PENDING" },
            data: { status: "RUNNING" },
        });

        if (claim.count !== 1) {
            log.info(`이미 다른 워커가 처리 중이거나 처리됨, 건너뜀: ${postId}`);
            return false;
        }

        // 게시물 정보 조회
        const post = await prisma.post.findUnique({ where: { id: postId } });
        if (!post || !post.topicSeed || !post.contentHtml) {
            throw new Error("게시물을 찾을 수 없습니다");
        }

        const seed = safeParseSeed(post.topicSeed);
        if (!seed) {
            throw new Error("발행 정보(topicSeed) 형식이 올바르지 않습니다.");
        }
        const now = new Date();
        const scheduledDate = normalizeScheduledDate(seed.scheduledDate) ?? post.scheduledAt ?? null;

        if (seed.publishMode === "schedule" && !scheduledDate) {
            throw new Error("예약 발행일 형식이 올바르지 않습니다.");
        }

        if (!forceRun && scheduledDate && scheduledDate.getTime() > now.getTime()) {
            log.info(`예약발행일이 미래여서 건너뜁니다. postId=${postId}, scheduledAt=${seed.scheduledDate}`);
            await prisma.post.update({
                where: { id: postId },
                data: {
                    status: "PENDING",
                    errorMessage: null,
                },
            });
            return false;
        }

        // 명령어 구성: 저장된 Post/Draft 콘텐츠를 그대로 사용
        const args = [`--post-id=${postId}`];

        if (seed.publishMode === "schedule") {
            args.push("--publish-mode=schedule");
            args.push(`--scheduled-date=${scheduledDate ? formatDateYmd(scheduledDate) : formatDateYmd(now)}`);
        } else {
            args.push("--publish-mode=now");
        }

        log.info(`실행 명령`, { script: "scripts/topic-agent.ts", args });

        // 실행 (5분 타임아웃)
        const { stdout, stderr } = await runTsNodeScript("scripts/topic-agent.ts", args, {
            timeoutMs: 300000,
        });

        log.info(`실행 완료`, {
            stdout: stdout.slice(-500),
            stderr: stderr.slice(-300),
        });

        const refreshedPost = await prisma.post.findUnique({
            where: { id: postId },
            select: { status: true, title: true, finalUrl: true, publishedAt: true },
        });

        // 스크립트가 exit 0으로 끝났는데도 status가 RUNNING이면(자체 writeback 누락)
        // 성공으로 마감하되, 발행 시각을 기록해 후속 멱등성/리포팅에 사용한다.
        if (refreshedPost?.status === "RUNNING") {
            await prisma.post.update({
                where: { id: postId },
                data: {
                    status: "SUCCESS",
                    publishedAt: refreshedPost.publishedAt ?? new Date(),
                },
            });
        }

        log.info(`발행 성공: ${refreshedPost?.title || post.title || seed.topic}`, {
            finalUrl: refreshedPost?.finalUrl,
        });
        return true;

    } catch (error: unknown) {
        log.error(`발행 실패: ${postId}`, error instanceof Error ? error : undefined);

        // 재시도 횟수 확인
        const post = await prisma.post.findUnique({ where: { id: postId } });
        const retryCount = (post?.retryCount || 0) + 1;

        if (retryCount >= 3) {
            // 최대 재시도 초과
            await prisma.post.update({
                where: { id: postId },
                data: {
                    status: "FAIL",
                    errorMessage: getErrorMessage(error),
                    retryCount,
                },
            });
        } else {
            // 재시도 대기
            await prisma.post.update({
                where: { id: postId },
                data: {
                    status: "PENDING",
                    errorMessage: getErrorMessage(error),
                    retryCount,
                },
            });
        }

        return false;
    }
}

/**
 * 죽은 RUNNING 글 회수(reaper).
 * 프로세스가 강제 종료/서버 재시작으로 RUNNING에 영구 고착된 글을 정리한다.
 * 멱등성 보장: finalUrl이 있으면 이미 발행된 것이므로 SUCCESS로, 없으면 재시도(PENDING)
 * 또는 한도 초과 시 FAIL로 되돌린다 — finalUrl 존재 시 절대 재발행하지 않는다.
 */
export async function reapStuckRunningPosts(maxAgeMinutes = STUCK_RUNNING_MINUTES): Promise<number> {
    const threshold = new Date(Date.now() - maxAgeMinutes * 60_000);
    const stuck = await prisma.post.findMany({
        where: { status: "RUNNING", updatedAt: { lt: threshold } },
        select: { id: true, finalUrl: true, retryCount: true, publishedAt: true },
    });

    for (const post of stuck) {
        if (post.finalUrl) {
            // 이미 발행됨 → 성공 마감(재발행 금지)
            await prisma.post.updateMany({
                where: { id: post.id, status: "RUNNING" },
                data: { status: "SUCCESS", publishedAt: post.publishedAt ?? new Date() },
            });
            log.info(`고착 RUNNING 회수: 이미 발행 확인 → SUCCESS (${post.id})`);
        } else {
            const retryCount = (post.retryCount || 0) + 1;
            const giveUp = retryCount >= 3;
            await prisma.post.updateMany({
                where: { id: post.id, status: "RUNNING" },
                data: {
                    status: giveUp ? "FAIL" : "PENDING",
                    retryCount,
                    errorMessage: "실행 중 프로세스가 비정상 종료되어 회수됨",
                },
            });
            log.warn(`고착 RUNNING 회수: ${giveUp ? "FAIL" : "재시도 PENDING"} (${post.id})`);
        }
    }

    return stuck.length;
}

// 동일 프로세스 내 크론 중복 실행 가드(외부 크론 재시도/중복 호출 완화).
let schedulerRunning = false;

/**
 * 스케줄러 메인 루프 (크론 잡용)
 */
export async function runScheduler() {
    if (schedulerRunning) {
        log.info("스케줄러가 이미 실행 중이어서 이번 트리거는 건너뜁니다.");
        return;
    }
    schedulerRunning = true;
    log.info("스케줄러 실행 시작");

    try {
        const reaped = await reapStuckRunningPosts();
        if (reaped > 0) log.info(`고착 RUNNING ${reaped}건 회수`);

        const pendingPosts = await getPendingPosts(5);
        log.info(`대기 중인 예약: ${pendingPosts.length}개`);

        for (const post of pendingPosts) {
            await executeScheduledPost(post.id);

            // 연속 실행 방지 (30초 대기)
            await new Promise(resolve => setTimeout(resolve, 30000));
        }

        log.info("스케줄러 실행 완료");
    } finally {
        schedulerRunning = false;
    }
}
