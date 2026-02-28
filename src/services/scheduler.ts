/**
 * 스케줄러 서비스
 * V4 Phase 10: 예약된 작업 실행
 */

import { prisma } from "@/lib/db";
import { createTaskLogger } from "../../scripts/lib/logger";
import { runTsNodeScript } from "@/lib/run-script";

const log = createTaskLogger("Scheduler");

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
    const parsed = new Date(year, month - 1, day, 9, 0, 0, 0);

    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.getFullYear() !== year ||
      parsed.getMonth() !== month - 1 ||
      parsed.getDate() !== day
    ) {
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
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
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
        // 상태를 RUNNING으로 변경
        await prisma.post.update({
            where: { id: postId },
            data: { status: "RUNNING" },
        });

        // 게시물 정보 조회
        const post = await prisma.post.findUnique({ where: { id: postId } });
        if (!post || !post.topicSeed) {
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

        // 명령어 구성
        const args = [`--type=${seed.type}`, `--topic=${seed.topic}`];

        if (seed.publishMode === "schedule") {
            args.push("--publish-mode=schedule");
            args.push(`--scheduled-date=${scheduledDate ? formatDateYmd(scheduledDate) : formatDateYmd(now)}`);
        } else {
            args.push("--publish-mode=now");
        }

        if (seed.keywords.length > 0) {
            args.push(`--keywords=${seed.keywords.join(",")}`);
        }
        if (seed.style) {
            args.push(`--style=${seed.style}`);
        }
        if (seed.images) {
            args.push(`--images=${seed.images}`);
        }
        if (post.category) {
            args.push(`--category=${post.category}`);
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

        // 결과에서 제목 파싱
        const titleMatch = stdout.match(/제목: (.+)/);
        const title = titleMatch?.[1] || seed.topic;

        // 성공 처리
        await prisma.post.update({
            where: { id: postId },
            data: {
                status: "SUCCESS",
                title,
                publishedAt: new Date(),
            },
        });

        log.info(`발행 성공: ${title}`);
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
 * 스케줄러 메인 루프 (크론 잡용)
 */
export async function runScheduler() {
    log.info("스케줄러 실행 시작");

    const pendingPosts = await getPendingPosts(5);
    log.info(`대기 중인 예약: ${pendingPosts.length}개`);

    for (const post of pendingPosts) {
        await executeScheduledPost(post.id);

        // 연속 실행 방지 (30초 대기)
        await new Promise(resolve => setTimeout(resolve, 30000));
    }

    log.info("스케줄러 실행 완료");
}
