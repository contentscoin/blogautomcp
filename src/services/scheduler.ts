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
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "알 수 없는 오류";
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
export async function executeScheduledPost(postId: string): Promise<boolean> {
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

        const seed: TopicSeed = JSON.parse(post.topicSeed);

        // 명령어 구성
        const args = [`--type=${seed.type}`, `--topic=${seed.topic}`, "--publish"];

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
