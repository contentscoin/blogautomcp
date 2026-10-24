import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseNaverPublishedUrl } from "@/lib/naver-published-url";
import { readPublishAttempt, publisherHasExited, publicationMaterialHash } from "@/lib/publish-attempt";
import { requireAdminApiKey } from "@/lib/api-auth";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import type { BrandPostPackageManifestV2 } from "@/lib/brand-post-package";
import { publishedImageOriginalCandidate, publishedPostIdentityMatches, readPublishedNaverHtml, reservationVerification, verifyPublishedPostContent,
  type PublishedPostSnapshot } from "@/lib/published-post-verification";
import { resolvePublishedConnectCardAliases } from "@/lib/published-connect-card-verification";

/**
 * 발행 결과 검증. DB 상태와 실제 네이버 글 URL 응답을 함께 확인해
 * "발행됐다고 기록됐지만 글이 없는" 경우를 ChatGPT가 알 수 있게 한다.
 */

const FETCH_TIMEOUT_MS = 12_000;
const MISSING_POST_PATTERNS = [/삭제되었거나\s*존재하지\s*않/u, /존재하지\s*않는\s*(게시|포스트|글)/u, /비공개\s*(게시|포스트|글)/u];
const MAX_HTML_BYTES = 800_000;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

async function readBoundedResponse(response: Response, limit: number): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("본문 응답을 읽을 수 없습니다.");
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) throw new Error("검증 응답 크기 상한을 넘었습니다.");
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } finally { await reader.cancel().catch(() => {}); }
}

function readExpectedSubmission(id: string, attempt: ReturnType<typeof readPublishAttempt>) {
  if (!attempt?.snapshotManifestPath || !attempt.snapshotHash) return { manifest: null, revisionMatched: null, expectedImageHashes: undefined, error: "PUBLISH_SNAPSHOT_REQUIRED" };
  try {
    if (publicationMaterialHash(attempt.snapshotManifestPath) !== attempt.snapshotHash) throw new Error("PUBLISH_SNAPSHOT_CHANGED");
    const manifest = JSON.parse(fs.readFileSync(attempt.snapshotManifestPath, "utf8")) as BrandPostPackageManifestV2;
    if (manifest.brandLinkId !== id || manifest.version !== "brand-post-package/v2" || manifest.composition?.version !== "resolved-post-document/v1" ||
        manifest.composition.title !== manifest.title || !Array.isArray(manifest.composition.renderNodes)) throw new Error("PUBLISH_SNAPSHOT_INVALID");
    let revisionMatched: boolean | null = null;
    if (attempt.sourceManifestPath && attempt.manifestHash) {
      try { revisionMatched = publicationMaterialHash(attempt.sourceManifestPath) === attempt.manifestHash; } catch { revisionMatched = false; }
    }
    const expectedImageHashes = manifest.composition.renderNodes.flatMap(node => node.kind === "image" ? [crypto.createHash("sha256")
      .update(fs.readFileSync(path.isAbsolute(node.assetPath) ? node.assetPath : path.resolve(path.dirname(attempt.snapshotManifestPath!), node.assetPath))).digest("hex")] : []);
    return { manifest, revisionMatched, expectedImageHashes, error: null };
  } catch (error) { return { manifest: null, revisionMatched: false, expectedImageHashes: undefined, error: error instanceof Error ? error.message : "PUBLISH_SNAPSHOT_INVALID" }; }
}

async function publishedImageHashes(snapshot: PublishedPostSnapshot): Promise<Array<string | null>> {
  if (snapshot.scope !== "confirmed" || snapshot.images.length > 16) return snapshot.images.map(() => null);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6_000);
  try {
    return await Promise.all(snapshot.images.map(async image => {
      const candidate = image.urls.map(publishedImageOriginalCandidate).find(Boolean);
      if (!candidate || !image.supported) return null;
      try {
        const response = await fetch(candidate, { cache: "no-store", redirect: "error", signal: controller.signal });
        if (!response.ok || !/^image\/(?:png|jpeg|webp)(?:;|$)/iu.test(response.headers.get("content-type") || "")) return null;
        const bytes = await readBoundedResponse(response, MAX_IMAGE_BYTES);
        return crypto.createHash("sha256").update(bytes).digest("hex");
      } catch { return null; }
    }));
  } finally { clearTimeout(timeout); }
}

function toPostViewUrl(postUrl: string): string | null {
  const parsed = parseNaverPublishedUrl(postUrl);
  return parsed ? `https://blog.naver.com/PostView.naver?blogId=${encodeURIComponent(parsed.blogId)}&logNo=${parsed.logNo}` : null;
}

async function probePost(postUrl: string) {
  const target = toPostViewUrl(postUrl);
  if (!target) return { reachable: false, httpStatus: null, titleMatched: null, note: "네이버 블로그 주소 형식이 아닙니다." };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let response = await fetch(target, {
      signal: controller.signal,
      cache: "no-store",
      redirect: "manual",
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) BlogAutoMCP-verify" },
    });
    // Follow only a bounded redirect to the SAME Naver post identity.
    for (let hop = 0; response.status >= 300 && response.status < 400 && hop < 2; hop += 1) {
      const location = response.headers.get("location");
      const destination = location ? new URL(location, response.url || target).href : "";
      if (!publishedPostIdentityMatches(postUrl, destination)) break;
      response = await fetch(destination, { signal: controller.signal, cache: "no-store", redirect: "manual" });
    }
    const html = response.ok ? (await readBoundedResponse(response, MAX_HTML_BYTES)).toString("utf8") : "";
    const samePost = publishedPostIdentityMatches(postUrl, response.url || target);
    const snapshot = readPublishedNaverHtml(html, response.url || target);
    const hasPostBody = snapshot.scope === "confirmed";
    const missing = !html || !hasPostBody && MISSING_POST_PATTERNS.some((pattern) => pattern.test(html));
    return {
      reachable: response.ok && !missing && samePost && hasPostBody,
      postIdentityMatched: samePost,
      httpStatus: response.status,
      snapshot,
      note: !response.ok ? `HTTP ${response.status}` : missing ? "글이 삭제되었거나 비공개 상태로 보입니다." : !samePost || !hasPostBody ? "요청한 글의 본문을 확인하지 못했습니다. 로그인·접근 제한 여부를 확인하세요." : null,
    };
  } catch (error) {
    return { reachable: false, httpStatus: null, snapshot: null, note: error instanceof Error ? error.message : "요청 실패" };
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

  let attempt: ReturnType<typeof readPublishAttempt> = null;
  let receiptError: string | null = null;
  try { attempt = readPublishAttempt(id); } catch { receiptError = "PUBLISH_RECEIPT_INVALID: 발행 시도 기록을 읽지 못했습니다. 실제 게시 여부부터 확인하세요."; }
  const submitted = readExpectedSubmission(id, attempt);
  const probeResult = link.postUrl ? await probePost(link.postUrl) : null;
  const rawSnapshot = probeResult && "snapshot" in probeResult ? probeResult.snapshot : null;
  const snapshot = rawSnapshot ? await resolvePublishedConnectCardAliases(rawSnapshot, submitted.manifest?.composition || null, fetch) : null;
  const recordedPost = attempt?.evidence?.postUrl ? parseNaverPublishedUrl(attempt.evidence.postUrl) : null;
  const savedPost = link.postUrl ? parseNaverPublishedUrl(link.postUrl) : null;
  const receiptPostMatched = Boolean(recordedPost && savedPost && recordedPost.url === savedPost.url);
  const contentVerification = verifyPublishedPostContent({ snapshot: snapshot || { scope: "missing", reason: "post-unreachable", title: null,
    bodyText: "", leadingContent: "none", images: [], links: [], connectCards: [] }, expected: submitted.manifest?.composition || null,
    postIdentityMatched: probeResult && "postIdentityMatched" in probeResult ? Boolean(probeResult.postIdentityMatched && receiptPostMatched) : null,
    revisionMatched: submitted.revisionMatched, expectedImageHashes: submitted.expectedImageHashes,
    imageHashes: snapshot ? await publishedImageHashes(snapshot) : undefined });
  if (submitted.error) contentVerification.reasons.push(submitted.error);
  const probe = probeResult ? { reachable: probeResult.reachable, httpStatus: probeResult.httpStatus,
    titleMatched: contentVerification.checks.title === "unverified" ? null : contentVerification.checks.title === "pass", note: probeResult.note,
    bodyScope: snapshot?.scope ?? "missing", bodyScopeReason: snapshot?.reason ?? "post-unreachable" } : null;
  const published = link.status === "PUBLISHED" && attempt?.stage === "CONFIRMED" && attempt.mode === "now" &&
    Boolean(recordedPost && savedPost && recordedPost.url === savedPost.url) && probe?.reachable === true && probe.titleMatched === true;
  const reservation = reservationVerification({ status: link.status, attempt, scheduledAt: link.scheduledPublishAt, now: new Date() });
  const scheduled = reservation.receiptAccepted;
  return NextResponse.json({
    success: true,
    data: {
      id: link.id,
      connectKind: link.connectKind,
      productName: link.productName,
      status: link.status,
      published,
      contentVerified: published && contentVerification.contentVerified,
      verificationStatus: contentVerification.status,
      contentVerification,
      scheduled,
      reservationVerification: reservation,
      outcomeUnknown: link.status === "OUTCOME_UNKNOWN" || Boolean(receiptError) || attempt?.stage === "OUTCOME_UNKNOWN" || attempt?.stage === "SUBMITTING",
      automaticReplayAllowed: false,
      receiptError,
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
      confirmedScheduledDate: scheduled ? attempt?.evidence?.scheduledDate ?? null : null,
      errorMessage: link.errorMessage,
      probe,
      checkedAt: new Date().toISOString(),
    },
  });
}
