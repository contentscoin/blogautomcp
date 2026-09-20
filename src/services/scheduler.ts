/**
 * 스케줄러 서비스
 * V4 Phase 10: 예약된 작업 실행
 */

import { prisma } from "@/lib/db";
import { createTaskLogger } from "../../scripts/lib/logger";
import { runTsNodeScript } from "@/lib/run-script";
import { beginDesktopActivity } from "@/lib/desktop-activity";

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
  if (process.env.DESKTOP_UPDATE_INSTALL_PENDING === "1") return false;
  const finish = beginDesktopActivity("legacy-post-scheduler");

  log.info(`예약 발행 시작: ${postId}`);
  let ownsClaim = false;

    try {
        // 상태를 RUNNING으로 변경
        const claimed = await prisma.post.updateMany({
            where: { id: postId, status: "PENDING", ...(forceRun ? {} : { scheduledAt: { lte: new Date() } }) },
            data: { status: "RUNNING" },
        });
        if (claimed.count !== 1) return false;
        ownsClaim = true;

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
            await prisma.post.updateMany({
                where: { id: postId, status: "RUNNING" },
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
            select: { status: true, title: true, finalUrl: true },
        });

        if (refreshedPost?.status !== "SUCCESS") throw new Error("발행 프로세스가 성공 결과를 저장하지 않았습니다. 자동 재시도 없이 실제 발행 여부를 확인하세요.");

        log.info(`발행 성공: ${refreshedPost?.title || post.title || seed.topic}`, {
            finalUrl: refreshedPost?.finalUrl,
        });
        return true;

    } catch (error: unknown) {
        log.error(`발행 실패: ${postId}`, error instanceof Error ? error : undefined);
        if (!ownsClaim) return false;

        // A timeout may follow an external publish. Never replay or overwrite a
        // terminal result written by the publishing process or a cancellation.
        await prisma.post.updateMany({
            where: { id: postId, status: "RUNNING" },
            data: { status: "FAIL", errorMessage: `${getErrorMessage(error)} 실제 발행 여부를 확인한 뒤 수동으로 재개하세요.`, retryCount: { increment: 1 } },
        });

        return false;
    } finally { finish(); }
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
