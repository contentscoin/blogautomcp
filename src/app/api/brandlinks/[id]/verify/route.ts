import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseNaverPublishedUrl } from "@/lib/naver-published-url";
import { readPublishAttempt, publisherHasExited } from "@/lib/publish-attempt";
import { requireAdminApiKey } from "@/lib/api-auth";

/**
 * 발행 결과 검증. DB 상태와 실제 네이버 글 URL 응답을 함께 확인해
 * "발행됐다고 기록됐지만 글이 없는" 경우를 ChatGPT가 알 수 있게 한다.
 */

const FETCH_TIMEOUT_MS = 12_000;
const MISSING_POST_PATTERNS = [/삭제되었거나\s*존재하지\s*않/u, /존재하지\s*않는\s*(게시|포스트|글)/u, /비공개\s*(게시|포스트|글)/u];
const POST_BODY_PATTERN = /(?:class=["'][^"']*\bse-main-container\b|id=["']postViewArea["'])/iu;

function toPostViewUrl(postUrl: string): string | null {
  const parsed = parseNaverPublishedUrl(postUrl);
  return parsed ? `https://blog.naver.com/PostView.naver?blogId=${encodeURIComponent(parsed.blogId)}&logNo=${parsed.logNo}` : null;
}

async function probePost(postUrl: string, productName: string | null) {
  const target = toPostViewUrl(postUrl);
  if (!target) return { reachable: false, httpStatus: null, titleMatched: null, note: "네이버 블로그 주소 형식이 아닙니다." };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(target, {
      signal: controller.signal,
      cache: "no-store",
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) BlogAutoMCP-verify" },
    });
    const html = response.ok ? (await response.text()).slice(0, 400_000) : "";
    const missing = html ? MISSING_POST_PATTERNS.some((pattern) => pattern.test(html)) : true;
    const expected = parseNaverPublishedUrl(postUrl);
    const destination = parseNaverPublishedUrl(response.url);
    const samePost = Boolean(expected && destination && expected.url === destination.url);
    const hasPostBody = POST_BODY_PATTERN.test(html);
    const tokens = (productName || "").split(/\s+/).filter((token) => token.length >= 2).slice(0, 3);
    const titleMatched = html && tokens.length > 0 ? tokens.some((token) => html.includes(token)) : null;
    return {
      reachable: response.ok && !missing && samePost && hasPostBody,
      httpStatus: response.status,
      titleMatched,
      note: !response.ok ? `HTTP ${response.status}` : missing ? "글이 삭제되었거나 비공개 상태로 보입니다." : !samePost || !hasPostBody ? "요청한 글의 본문을 확인하지 못했습니다. 로그인·접근 제한 여부를 확인하세요." : null,
    };
  } catch (error) {
    return { reachable: false, httpStatus: null, titleMatched: null, note: error instanceof Error ? error.message : "요청 실패" };
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireAdminApiKey(request);
  if (unauthorized) return unauthorized;
  const { id } = await params;
  const link = await prisma.brandLink.findUnique({
    where: { id },
    select: { id: true, connectKind: true, productName: true, status: true, postUrl: true, publishedAt: true, scheduledPublishAt: true, errorMessage: true, updatedAt: true },
  });
  if (!link) return NextResponse.json({ success: false, code: "PRODUCT_NOT_FOUND", error: "상품을 찾을 수 없습니다." }, { status: 404 });

  const probe = link.postUrl ? await probePost(link.postUrl, link.productName) : null;
  const attempt = readPublishAttempt(id);
  const recordedPost = attempt?.evidence?.postUrl ? parseNaverPublishedUrl(attempt.evidence.postUrl) : null;
  const savedPost = link.postUrl ? parseNaverPublishedUrl(link.postUrl) : null;
  const published = link.status === "PUBLISHED" && attempt?.stage === "CONFIRMED" && attempt.mode === "now" &&
    Boolean(recordedPost && savedPost && recordedPost.url === savedPost.url) && probe?.reachable === true && probe.titleMatched === true;
  const scheduled = link.status === "SCHEDULED" && attempt?.stage === "CONFIRMED" && attempt.mode === "schedule" &&
    Boolean(attempt.evidence?.reservationId && attempt.evidence.scheduledDate && link.scheduledPublishAt &&
      Date.parse(attempt.evidence.scheduledDate) === link.scheduledPublishAt.getTime());
  return NextResponse.json({
    success: true,
    data: {
      id: link.id,
      connectKind: link.connectKind,
      productName: link.productName,
      status: link.status,
      published,
      scheduled,
      outcomeUnknown: link.status === "OUTCOME_UNKNOWN",
      verificationBasis: scheduled ? "submission-receipt" : published ? "live-post-probe" : "unverified",
      attemptId: attempt?.id ?? null,
      attemptStage: attempt?.stage ?? null,
      attemptStartedAt: attempt?.startedAt ?? null,
      submittedAt: attempt?.submittedAt ?? null,
      confirmedAt: attempt?.confirmedAt ?? null,
      publisherProcessState: !attempt?.publisherPid ? "unknown" : publisherHasExited(attempt) ? "exited" : "running-or-unavailable",
      reservationId: attempt?.evidence?.reservationId ?? null,
      postUrl: link.postUrl,
      publishedAt: link.publishedAt ? link.publishedAt.toISOString() : null,
      scheduledPublishAt: scheduled && link.scheduledPublishAt ? link.scheduledPublishAt.toISOString() : null,
      plannedPublishAt: link.scheduledPublishAt ? link.scheduledPublishAt.toISOString() : null,
      confirmedScheduledDate: scheduled ? attempt.evidence?.scheduledDate ?? null : null,
      errorMessage: link.errorMessage,
      probe,
      checkedAt: new Date().toISOString(),
    },
  });
}
