import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApiKey } from "@/lib/api-auth";

/**
 * 발행 결과 검증. DB 상태와 실제 네이버 글 URL 응답을 함께 확인해
 * "발행됐다고 기록됐지만 글이 없는" 경우를 ChatGPT가 알 수 있게 한다.
 */

const FETCH_TIMEOUT_MS = 12_000;
const MISSING_POST_PATTERNS = [/삭제되었거나\s*존재하지\s*않/u, /존재하지\s*않는\s*(게시|포스트|글)/u, /비공개\s*(게시|포스트|글)/u];

function toPostViewUrl(postUrl: string): string | null {
  try {
    const url = new URL(postUrl);
    if (!/(^|\.)blog\.naver\.com$/i.test(url.hostname)) return null;
    const match = url.pathname.match(/^\/([A-Za-z0-9_-]+)\/(\d+)\/?$/);
    if (match) return `https://blog.naver.com/PostView.naver?blogId=${encodeURIComponent(match[1])}&logNo=${match[2]}`;
    const blogId = url.searchParams.get("blogId");
    const logNo = url.searchParams.get("logNo");
    if (blogId && /^\d+$/.test(logNo || "")) return `https://blog.naver.com/PostView.naver?blogId=${encodeURIComponent(blogId)}&logNo=${logNo}`;
    return url.toString();
  } catch {
    return null;
  }
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
    const tokens = (productName || "").split(/\s+/).filter((token) => token.length >= 2).slice(0, 3);
    const titleMatched = html && tokens.length > 0 ? tokens.some((token) => html.includes(token)) : null;
    return {
      reachable: response.ok && !missing,
      httpStatus: response.status,
      titleMatched,
      note: !response.ok ? `HTTP ${response.status}` : missing ? "글이 삭제되었거나 비공개 상태로 보입니다." : null,
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
  const published = link.status === "PUBLISHED" && Boolean(link.postUrl) && probe?.reachable === true;
  const scheduled = link.status === "SCHEDULED" || (link.status === "PUBLISHED" && !link.postUrl && Boolean(link.scheduledPublishAt));
  return NextResponse.json({
    success: true,
    data: {
      id: link.id,
      connectKind: link.connectKind,
      productName: link.productName,
      status: link.status,
      published,
      scheduled,
      postUrl: link.postUrl,
      publishedAt: link.publishedAt ? link.publishedAt.toISOString() : null,
      scheduledPublishAt: link.scheduledPublishAt ? link.scheduledPublishAt.toISOString() : null,
      errorMessage: link.errorMessage,
      probe,
      checkedAt: new Date().toISOString(),
    },
  });
}
