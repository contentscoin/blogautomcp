import assert from "node:assert/strict";
import { readPublishedNaverHtml, publishedImageOriginalCandidate, publishedPostIdentityMatches, verifyPublishedPostContent, reservationVerification } from "../src/lib/published-post-verification";
import type { ResolvedPostDocumentV1 } from "../src/lib/post-composition-contract";
import { resolvePublishedConnectCardAliases } from "../src/lib/published-connect-card-verification";

const pageUrl = "https://blog.naver.com/fixture/123";
const title = "쿠쿠 2L 음식물처리기, 작은 주방에서 고를 기준";
const disclosure = "이 포스팅은 구매 발생 시 수수료를 제공받습니다.";
const connectUrl = "https://naver.me/fixture";
const image = (name: string) => `<div class="se-component se-image"><div class="se-module se-module-image"><img class="se-image-resource" data-lazy-src="https://postfiles.pstatic.net/source/${name}.png?type=w966" src="https://postfiles.pstatic.net/source/${name}.png?type=w80"></div></div>`;
const titleHtml = `<div class="se-documentTitle"><div class="se-title-text"><p>${title}</p></div></div>`;
const card = `<div class="se-component se-oglink"><a href="${connectUrl}"><img src="https://unknown.invalid/card.jpg">상품 옵션 확인</a></div>`;
const html = `<html><script>const sharedError = "존재하지 않는 글";</script><div class="se-main-container">${titleHtml}<div class="se-component se-text"><p>${disclosure}</p></div>${image("hero")}<div class="se-component se-text"><p>용량과 설치 공간</p><p>2L 용량과 주방 공간을 함께 확인하세요.</p></div>${card}${image("body")}<div class="se-component se-text"><p>관리 방식</p><p>청소 방법은 판매 페이지의 안내를 확인하세요.</p><p>#쿠쿠 #음식물처리기</p></div>${card}</div></html>`;
const expected = { version: "resolved-post-document/v1", title, sections: [], renderNodes: [
  { kind: "disclosure", placement: "top", text: disclosure },
  { kind: "image", assetPath: "hero.png", sectionId: null },
  { kind: "heading", sectionId: "a", text: "용량과 설치 공간" },
  { kind: "paragraph", sectionId: "a", text: "2L 용량과 주방 공간을 함께 확인하세요." },
  { kind: "connectCard", url: connectUrl },
  { kind: "image", assetPath: "body.png", sectionId: "b" },
  { kind: "heading", sectionId: "b", text: "관리 방식" },
  { kind: "paragraph", sectionId: "b", text: "청소 방법은 판매 페이지의 안내를 확인하세요." },
  { kind: "hashtags", values: ["쿠쿠", "음식물처리기"] },
  { kind: "connectCard", url: connectUrl },
] } as unknown as ResolvedPostDocumentV1;
const verify = (source = html, overrides: Partial<Parameters<typeof verifyPublishedPostContent>[0]> = {}) => verifyPublishedPostContent({
  snapshot: readPublishedNaverHtml(source, pageUrl), expected, revisionMatched: true, postIdentityMatched: true,
  expectedImageHashes: ["hero-hash", "body-hash"], imageHashes: ["hero-hash", "body-hash"], ...overrides,
});
const snapshot = readPublishedNaverHtml(html, pageUrl);
assert.equal(snapshot.scope, "confirmed");
assert.equal(snapshot.title, title);
assert.equal(snapshot.images.length, 2, "Connect card preview pictures must not inflate body image coverage");
assert.equal(snapshot.links.length, 2);
assert.equal(snapshot.connectCards.length, 2);
assert.equal(verify().status, "verified");
assert.equal(verify().contentVerified, true);
assert.equal(verify(html.replace(title, "쿠쿠 다른 옵션 3L")).checks.title, "fail");
assert.equal(verify(html.replace(titleHtml, "").replace('<div class="se-main-container">', `${titleHtml}<div class="se-main-container">`)).checks.title, "unverified", "A title outside the established article body cannot prove the post title");
const viewerHtml = html.replace(titleHtml, "").replace('<div class="se-main-container">', `<div class="se-viewer">${titleHtml}<div class="se-main-container">`).replace("</div></html>", "</div></div></html>");
assert.equal(verify(viewerHtml).contentVerified, true, "Real Naver viewer header is a title sibling of the main body");
assert.equal(verify(viewerHtml.replace(titleHtml, "").replace('<div class="se-viewer">', `${titleHtml}<div class="se-viewer">`)).checks.title, "unverified", "A fake title outside the known viewer cannot prove the article title");
assert.equal(verify(viewerHtml.replace(titleHtml, titleHtml + titleHtml)).contentVerified, false, "Multiple document titles inside one viewer are ambiguous");
assert.equal(verify(viewerHtml.replace('<div class="se-viewer">', '<input onclick="one" onclick="two"><div class="se-viewer">')).contentVerified, true, "Unrelated page chrome duplicate attributes must not invalidate the reviewed article");
assert.equal(verify(viewerHtml.replace('class="se-main-container"', 'class="se-main-container" class="alternate"')).contentVerified, false, "Ambiguous body attributes must remain unverified");
assert.equal(verify(html.replace("관리 방식</p>", "관리 방식</p><p>이 제품은 암을 완치합니다.</p>")).checks.bodyOrder, "fail", "Unapproved extra prose must not be accepted by substring-only checks");
for (const zeroStyle of ["opacity:0.0", "opacity:0%", "opacity:.0 !important", "opacity:-0.000", "opacity:0e2", "display:none!important", "visibility:hidden !important"]) {
  assert.equal(verify(html.replace('class="se-main-container"', `class="se-main-container" style="${zeroStyle}"`)).contentVerified, false, `Hidden article cannot be verified (${zeroStyle})`);
}
assert.equal(verify(html.replace("2L 용량과 주방 공간을 함께 확인하세요.", "다른 상품 사용 후기")).checks.bodyOrder, "fail");
assert.equal(verify(html.replace("관리 방식", "임의의 섹션")).status, "mismatch");
assert.equal(verify(html.replace(disclosure, "").replace("#쿠쿠", `${disclosure} #쿠쿠`)).checks.disclosure, "fail", "Bottom disclosure cannot count as top disclosure");
assert.equal(verify(html.replace(disclosure, `${disclosure}${disclosure}`)).checks.disclosure, "fail");
assert.equal(verify(html.replace(`<p>${disclosure}</p>`, `${image("before-notice")}<p>${disclosure}</p>`)).checks.disclosure, "fail");
assert.equal(verify(html.replace(image("body"), "")).checks.imageCount, "fail");
assert.equal(verify(html.replace(image("hero"), "").replace("관리 방식</p>", `${image("hero")}관리 방식</p>`)).checks.bodyOrder, "fail", "Expected image order must be checked against text positions");
assert.equal(verify(html.replace(`href="${connectUrl}"`, 'href="https://unknown.invalid/redirect?url=https://naver.me/fixture"')).checks.connectLinks, "unverified");
assert.equal(verify(html.replace(card, "")).checks.connectLinks, "unverified");
assert.equal(verify(html.replace("</div></html>", `${card}</div></html>`)).checks.connectLinks, "unverified", "Extra card chrome must not evade the approved composition contract");
assert.equal(verify(html.replace(card, card.replace("상품 옵션 확인", "판매 페이지의 상품 카드 제목과 미리보기 설명"))).contentVerified, true, "Known card chrome can change independently of approved body prose");
assert.equal(verify(html, { imageHashes: [null, "body-hash"] }).status, "partial");
assert.equal(verify(html, { imageHashes: ["resized-sha", "body-hash"] }).checks.imageIdentity, "unverified", "Resize byte differences must not be called a photo mismatch or an identity pass");
assert.equal(verify(html, { imageHashes: ["body-hash", "hero-hash"] }).contentVerified, false, "Wrong image order cannot receive complete verification");
assert.equal(verify(html, { revisionMatched: false }).checks.revision, "fail");
assert.equal(verify(html, { postIdentityMatched: false }).contentVerified, false, "Even a perfect copied body at a different URL cannot be fully verified");
assert.equal(verify(html, { expected: null, expectedImageHashes: undefined }).contentVerified, false);
assert.equal(verify(html, { revisionMatched: null }).status, "partial");
assert.equal(verify(html.replace('class="se-component se-image"', 'class="unknown-image-wrapper"')).status, "partial");
assert.equal(verify(html.replace('class="se-main-container"', 'id="postViewArea"')).contentVerified, false, "Unknown legacy DOM needs explicit verification");
assert.equal(verify(html + html).contentVerified, false, "Multiple visible bodies are ambiguous");
assert.equal(readPublishedNaverHtml('<script>const fake=\'<div class="se-main-container">fake</div>\';</script>', pageUrl).scope, "missing", "Scripts cannot forge post content");
assert.equal(readPublishedNaverHtml(html + '<div hidden class="se-main-container">different product</div>', pageUrl).scope, "confirmed");
assert.equal(readPublishedNaverHtml(html.slice(0, html.lastIndexOf("</div>")), pageUrl).scope, "ambiguous");
assert.equal(readPublishedNaverHtml("x".repeat(800_001), pageUrl).reason, "html-read-limit");
assert.equal(readPublishedNaverHtml(html.replace("2L 용량", "2L&nbsp;용량"), pageUrl).bodyText.includes("2L 용량"), true);
assert.equal(publishedPostIdentityMatches(pageUrl, "https://m.blog.naver.com/fixture/123"), true);
assert.equal(publishedPostIdentityMatches(pageUrl, "https://blog.naver.com/fixture/999"), false);
assert.equal(publishedPostIdentityMatches(pageUrl, "https://nid.naver.com/login"), false);
assert.equal(publishedImageOriginalCandidate("https://postfiles.pstatic.net/a/file.png?type=w966"), "https://blogfiles.pstatic.net/a/file.png", "Postfiles defaults to a small thumbnail; use the verified native upload host with the same canonical path");
assert.equal(publishedImageOriginalCandidate("https://blogfiles.pstatic.net/a/file.png?type=w966"), "https://blogfiles.pstatic.net/a/file.png");
for (const candidate of ["https://postfiles.pstatic.net.attacker.test/file.png", "http://postfiles.pstatic.net/file.png", "https://postfiles.pstatic.net:443/file.png?redirect=http://127.0.0.1", "https://127.0.0.1/file.png", "https://user:password@postfiles.pstatic.net/file.png", "https://postfiles.pstatic.net/file.png?secret=foo"]) assert.equal(publishedImageOriginalCandidate(candidate), null);

const scheduledAt = new Date("2026-10-15T00:00:00Z");
const scheduleInput = { status: "SCHEDULED", attempt: { stage: "CONFIRMED", mode: "schedule", evidence: { reservationId: "reserved-123", scheduledDate: "2026-10-15" } }, scheduledAt, now: new Date("2026-10-13T00:00:00Z") };
assert.equal(reservationVerification(scheduleInput).receiptAccepted, true);
assert.equal(reservationVerification(scheduleInput).liveListChecked, false);
assert.equal(reservationVerification(scheduleInput).publicationConfirmed, false);
assert.equal(reservationVerification({ ...scheduleInput, now: new Date("2026-10-14T15:01:00Z") }).status, "due-publication-unverified", "Due day must follow Korea time");
assert.equal(reservationVerification({ ...scheduleInput, status: "READY" }).receiptAccepted, false);
assert.equal(reservationVerification({ ...scheduleInput, attempt: { ...scheduleInput.attempt, stage: "SUBMITTING" } }).receiptAccepted, false);
assert.equal(reservationVerification({ ...scheduleInput, attempt: { ...scheduleInput.attempt, evidence: { scheduledDate: "2026-10-15" } } }).receiptAccepted, false);
assert.equal(reservationVerification({ ...scheduleInput, attempt: { ...scheduleInput.attempt, evidence: { reservationId: "reserved-123", scheduledDate: "2026-10-16" } } }).receiptAccepted, false);
assert.equal(reservationVerification({ ...scheduleInput, scheduledAt: new Date("2026-03-02T00:00:00Z"), attempt: { ...scheduleInput.attempt, evidence: { reservationId: "reserved-123", scheduledDate: "2026-02-30" } } }).receiptAccepted, false);
console.log("PASS: public title, top disclosure, ordered body/photos, bounded supported DOM, connect URLs, immutable revision, resize uncertainty and reservation acceptance/current-state separation");

async function verifyNativeShoppingCards() {
  const affiliate = "https://brandconnect.naver.com/affiliates/22222?channelProductNo=12345";
  const nativeCard = (index: number) => {
    const id = `SE-00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    const data = JSON.stringify({ id, affiliateUrl: affiliate, creatorSpaceId: "67890", channelProductNo: "12345", affiliateProductId: "54321" }).replace(/"/gu, "&quot;");
    return `<div class="se-component se-shopping-connect se-l-default" id="${id}"><div class="se-component-content se-component-content-normal"><div class="se-section se-section-shopping-connect se-section-align- se-l-default"><a class="__se_link" data-linktype="shoppingConnect" data-linkdata="${data}" href="${affiliate}&amp;ac=b_ed"><div class="se-shopping-connect-content"><div class="se-shopping-connect-thumbnail"><img class="se-shopping-connect-thumbnail-resource" src="https://shop-phinf.pstatic.net/fixture/preview.jpg" alt=""></div><div class="se-shopping-connect-detail"><div class="se-shopping-connect-detail-inner"><div class="se-shopping-connect-info"><h2 class="se-shopping-connect-title">판매자 상품 제목</h2><p class="se-shopping-connect-subtitle">미리보기 정보</p><p class="se-shopping-connect-link">상품 확인</p></div></div></div></div></a></div></div></div>`;
  };
  const nativeHtml = html.replace(card, nativeCard(1)).replace(card, nativeCard(2));
  const nativeExpected = { ...expected, connectKind: "SHOPPING" as const };
  const read = (source = nativeHtml) => readPublishedNaverHtml(source, pageUrl);
  const check = (value: ReturnType<typeof read>) => verifyPublishedPostContent({ snapshot: value, expected: nativeExpected, revisionMatched: true, postIdentityMatched: true,
    expectedImageHashes: ["hero-hash", "body-hash"], imageHashes: ["hero-hash", "body-hash"] });
  const native = read();
  assert.equal(native.scope, "confirmed"); assert.equal(native.images.length, 2); assert.equal(native.connectCards.length, 2);
  assert.equal(check(native).checks.bodyOrder, "pass"); assert.equal(check(native).checks.connectLinks, "unverified");
  let calls = 0;
  const fetcher: typeof fetch = async (input, options) => {
    calls++; assert.equal(input, connectUrl); assert.equal(options?.method, "GET"); assert.equal(options?.redirect, "manual");
    return new Response(null, { status: 307, headers: { location: affiliate } });
  };
  const resolved = await resolvePublishedConnectCardAliases(native, nativeExpected, fetcher);
  assert.equal(calls, 1, "The exact approved short URL is deduplicated; the affiliate destination is never fetched");
  assert.equal(check(resolved).contentVerified, true); assert.equal(native.connectCards.some(value => value.urls.includes(connectUrl)), false, "Alias resolution does not mutate source evidence");
  let cases = 3;
  const invalidCards: Array<[string, string]> = [
    ["class on ordinary prose", nativeHtml.replace(nativeCard(1), '<div class="se-component se-shopping-connect se-l-default"><p>임의의 추가 본문</p></div>')],
    ["body image hidden in card", nativeHtml.replace('<div class="se-shopping-connect-thumbnail">', `<div class="se-shopping-connect-thumbnail">${image("unapproved")}`)],
    ["native thumbnail outside a card", nativeHtml.replace(nativeCard(1), '<img class="se-shopping-connect-thumbnail-resource" src="https://shop-phinf.pstatic.net/fixture/preview.jpg">')],
    ["nested card", nativeHtml.replace('<div class="se-shopping-connect-thumbnail">', `<div class="se-shopping-connect-thumbnail">${nativeCard(3)}`)],
    ["extra anchor", nativeHtml.replace('<div class="se-shopping-connect-content">', '<a href="https://naver.me/other">추가 링크</a><div class="se-shopping-connect-content">')],
    ["foreign href", nativeHtml.replace(`href="${affiliate}&amp;ac=b_ed"`, 'href="https://attacker.invalid/affiliate"')],
    ["another product href", nativeHtml.replace(`href="${affiliate}&amp;ac=b_ed"`, `href="${affiliate.replace("12345", "99999")}&amp;ac=b_ed"`)],
    ["duplicate query", nativeHtml.replace(`href="${affiliate}&amp;ac=b_ed"`, `href="${affiliate}&amp;channelProductNo=12345&amp;ac=b_ed"`)],
    ["unknown tracking", nativeHtml.replace("&amp;ac=b_ed", "&amp;ac=other")],
    ["duplicate metadata attribute", nativeHtml.replace('data-linktype="shoppingConnect"', 'data-linktype="shoppingConnect" data-linktype="other"')],
    ["truncated card", nativeHtml.replace(nativeCard(1), nativeCard(1).slice(0, -6))],
    ["body photo disguised as preview", nativeHtml.replace('class="se-shopping-connect-thumbnail-resource"', 'class="se-shopping-connect-thumbnail-resource se-image-resource"')],
    ["duplicate native ID", nativeHtml.replace(nativeCard(2), nativeCard(1))],
    ["unexpected card paragraph", nativeHtml.replace('<h2 class="se-shopping-connect-title">', '<p>암을 완치합니다.</p><h2 class="se-shopping-connect-title">')],
  ];
  for (const [label, source] of invalidCards) {
    const invalid = read(source); assert.notEqual(invalid.scope, "confirmed", label);
    assert.equal(check(invalid).contentVerified, false, label);
    await resolvePublishedConnectCardAliases(invalid, nativeExpected, async () => { throw new Error("Ambiguous HTML must not trigger alias requests"); }); cases++;
  }
  const responseCases: Array<[string, () => Response]> = [
    ["redirect not manual 307", () => new Response(null, { status: 302, headers: { location: affiliate } })],
    ["success body is not a redirect", () => new Response(null, { status: 200, headers: { location: affiliate } })],
    ["foreign redirect", () => new Response(null, { status: 307, headers: { location: "https://attacker.invalid/affiliate" } })],
    ["relative redirect", () => new Response(null, { status: 307, headers: { location: "/affiliates/22222?channelProductNo=12345" } })],
    ["different product redirect", () => new Response(null, { status: 307, headers: { location: affiliate.replace("12345", "99999") } })],
    ["different affiliate redirect", () => new Response(null, { status: 307, headers: { location: affiliate.replace("22222", "99999") } })],
    ["duplicate destination query", () => new Response(null, { status: 307, headers: { location: affiliate + "&channelProductNo=12345" } })],
    ["unexpected destination query", () => new Response(null, { status: 307, headers: { location: affiliate + "&ac=b_ed" } })],
    ["credentials", () => new Response(null, { status: 307, headers: { location: affiliate.replace("https://", "https://user@") } })],
    ["fragment", () => new Response(null, { status: 307, headers: { location: affiliate + "#fragment" } })],
    ["oversized redirect", () => new Response(null, { status: 307, headers: { location: affiliate, "content-length": "16385" } })],
  ];
  for (const [label, response] of responseCases) {
    const value = await resolvePublishedConnectCardAliases(native, nativeExpected, async () => response());
    assert.equal(check(value).checks.connectLinks, "unverified", label); cases++;
  }
  for (const short of ["http://naver.me/fixture", "https://naver.me/fixture?query=1", "https://naver.me/fixture#hash", "https://naver.me:443/fixture", "https://user@naver.me/fixture", "https://naver.me.attacker.test/fixture", "https://naver.me/a/b", "https://naver.me/%66ixture"]) {
    const invalidExpected = { ...nativeExpected, renderNodes: nativeExpected.renderNodes.map(node => node.kind === "connectCard" ? { ...node, url: short } : node) };
    let requested = false;
    await resolvePublishedConnectCardAliases(native, invalidExpected, async () => { requested = true; return new Response(null, { status: 307, headers: { location: affiliate } }); });
    assert.equal(requested, false, "Only the exact approved unadorned HTTPS short URL can be requested"); cases++;
  }
  const legacyAffiliate = readPublishedNaverHtml(html.replaceAll(connectUrl, affiliate), pageUrl);
  const noLegacyAlias = await resolvePublishedConnectCardAliases(legacyAffiliate, nativeExpected, async () => { throw new Error("Legacy card cannot inherit native metadata authority"); });
  assert.equal(check(noLegacyAlias).checks.connectLinks, "unverified"); cases++;
  const outsideCard = read(nativeHtml.replace('</div></html>', `</div>${nativeCard(3)}</html>`));
  assert.equal(outsideCard.connectCards.length, 2); assert.equal(outsideCard.images.length, 2); cases++;
  const hiddenRequired = read(nativeHtml.replace('class="se-component se-shopping-connect se-l-default"', 'class="se-component se-shopping-connect se-l-default" hidden'));
  assert.equal(hiddenRequired.scope, "confirmed"); assert.equal(hiddenRequired.connectCards.length, 1);
  assert.equal(check(await resolvePublishedConnectCardAliases(hiddenRequired, nativeExpected, fetcher)).contentVerified, false, "A hidden required card cannot count as visible approval evidence"); cases++;
  const hiddenFragment = read(nativeHtml.replace('</div></html>', `<div hidden>${nativeCard(3)}</div><template>${nativeCard(4)}</template></div></html>`));
  assert.equal(hiddenFragment.scope, "confirmed"); assert.equal(hiddenFragment.connectCards.length, 2);
  assert.equal(hiddenFragment.bodyText, native.bodyText, "Invisible templates cannot add card or article content"); cases++;
  let cancelled = 0;
  await resolvePublishedConnectCardAliases(native, nativeExpected, async () => new Response(new ReadableStream({ cancel() { cancelled++; } }), { status: 307, headers: { location: affiliate } }));
  assert.equal(cancelled, 1, "Redirect bodies are cancelled without buffering or following their destination"); cases++;
  const deadlineExpected = { ...nativeExpected, renderNodes: Array.from({ length: 8 }, (_, index) => ({ kind: "connectCard" as const, connectKind: "SHOPPING" as const, placement: "early" as const, url: `https://naver.me/deadline${index}` })) };
  let deadlineCalls = 0;
  const began = Date.now();
  await resolvePublishedConnectCardAliases(native, deadlineExpected, async (_url, options) => {
    deadlineCalls++; return new Promise((_resolve, reject) => options!.signal!.addEventListener("abort", () => reject(new Error("deadline")), { once: true }));
  });
  assert.equal(deadlineCalls, 1); assert(Date.now() - began < 5_500, "All short-link requests share one total four-second deadline"); cases++;
  assert.equal(check(await resolvePublishedConnectCardAliases(native, nativeExpected, async () => { throw new Error("offline"); })).checks.connectLinks, "unverified"); cases++;
  console.log(`PASS: ${cases} strict native shopping-card and bounded exact-short-URL alias cases`);
}

void verifyNativeShoppingCards().catch(error => { console.error(error); process.exitCode = 1; });
