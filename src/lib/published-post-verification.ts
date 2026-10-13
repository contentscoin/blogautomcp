import type { ResolvedPostDocumentV1 } from "./post-composition-contract";
import { parseNaverPublishedUrl } from "./naver-published-url";
import { assertPublishedEditorText } from "../../scripts/lib/published-editor-audit";

export type PublishedCheckState = "pass" | "fail" | "unverified";
export interface PublishedPostSnapshot {
  scope: "confirmed" | "missing" | "ambiguous";
  reason: string;
  title: string | null;
  bodyText: string;
  leadingContent: "text" | "visual" | "none";
  images: Array<{ urls: string[]; offset: number; supported: boolean }>;
  links: Array<{ url: string; offset: number }>;
  connectCards: Array<{ urls: string[]; offset: number }>;
}
interface HtmlNode { tag: string; attrs: Record<string, string>; children: Array<HtmlNode | string>; parent?: HtmlNode; closed: boolean }
const compact = (text: string) => text.normalize("NFKC").replace(/[\s\u200b-\u200d\ufeff]+/gu, "");
const classes = (node: HtmlNode) => (node.attrs.class || "").split(/\s+/u);
const hasClass = (node: HtmlNode, name: string) => classes(node).includes(name);
const decodeEntities = (text: string) => text.replace(/&(?:#(x[0-9a-f]+|\d+)|([a-z]+));/giu, (whole, number: string, name: string) => {
  if (number) {
    const code = number[0].toLowerCase() === "x" ? Number.parseInt(number.slice(1), 16) : Number.parseInt(number, 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : whole;
  }
  return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " ", middot: "·", ndash: "–", mdash: "—",
    lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", copy: "©", reg: "®", trade: "™", hellip: "…" } as Record<string, string>)[name.toLowerCase()] ?? whole;
});
const hidden = (node: HtmlNode) => "hidden" in node.attrs || node.attrs["aria-hidden"] === "true" ||
  /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse))(?:\s*!important)?\s*(?:;|$)/iu.test(node.attrs.style || "") ||
  (node.attrs.style || "").split(";").some(declaration => {
    const match = declaration.match(/^\s*opacity\s*:\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(%)?\s*(?:!important)?\s*$/iu);
    return Boolean(match && Number(match[1]) === 0);
  });
const excluded = (node: HtmlNode) => hidden(node) || ["script", "style", "template", "noscript"].includes(node.tag);
const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const blockTags = new Set(["div", "p", "li", "ul", "ol", "section", "article", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "td"]);

/** Bounded structural read of known SmartEditor HTML. Unknown/ambiguous layouts never grant full verification. */
export function readPublishedNaverHtml(html: string, pageUrl: string): PublishedPostSnapshot {
  const result: PublishedPostSnapshot = { scope: "missing", reason: "post-body-missing", title: null, bodyText: "", leadingContent: "none", images: [], links: [], connectCards: [] };
  if (!html || html.length > 800_000) return { ...result, scope: "ambiguous", reason: "html-read-limit" };
  const root: HtmlNode = { tag: "root", attrs: {}, children: [], closed: true };
  let current = root;
  let count = 0;
  let malformed = false;
  const invalidNodes = new Set<HtmlNode>();
  // Attribute values may themselves contain >. Never scan scripts for forged body markup.
  const tokens = html.match(/<!--[\s\S]*?-->|<![^>]*>|<\/?[A-Za-z][A-Za-z0-9:_-]*(?:"[^"]*"|'[^']*'|[^'">])*>|[^<]+|</gu) || [];
  for (const token of tokens) {
    if (++count > 30_000) return { ...result, scope: "ambiguous", reason: "html-node-limit" };
    if (token.startsWith("<!")) continue;
    const closing = token.match(/^<\/([A-Za-z][A-Za-z0-9:_-]*)\s*>$/u)?.[1]?.toLowerCase();
    if (["script", "style"].includes(current.tag) && closing !== current.tag) continue;
    if (closing) {
      let match: HtmlNode | undefined = current;
      while (match && match !== root && match.tag !== closing) match = match.parent;
      if (!match || match === root) continue; // harmless unmatched outer wrapper; body closure checked below
      match.closed = true;
      current = match.parent || root;
      continue;
    }
    const opening = token.match(/^<([A-Za-z][A-Za-z0-9:_-]*)/u);
    if (!opening) { if (token === "<") invalidNodes.add(current); else current.children.push(decodeEntities(token)); continue; }
    const tag = opening[1].toLowerCase();
    const attrs: Record<string, string> = {};
    let duplicateAttributes = false;
    const attrSource = token.slice(opening[0].length, token.length - 1);
    for (const match of attrSource.matchAll(/([^\s="'<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu)) {
      const key = match[1].toLowerCase();
      if (key in attrs) { duplicateAttributes = true; continue; }
      attrs[key] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
    }
    const node: HtmlNode = { tag, attrs, children: [], parent: current, closed: voidTags.has(tag) || /\/\s*>$/u.test(token) };
    if (duplicateAttributes) invalidNodes.add(node);
    current.children.push(node);
    if (!node.closed) current = node;
  }
  const visible = (node: HtmlNode): boolean => !excluded(node) && (!node.parent || visible(node.parent));
  const all: HtmlNode[] = [];
  const collect = (node: HtmlNode, depth = 0) => {
    if (depth > 128) { malformed = true; return; }
    all.push(node);
    for (const child of node.children) if (typeof child !== "string") collect(child, depth + 1);
  };
  collect(root);
  const bodies = all.filter(node => hasClass(node, "se-main-container") && visible(node));
  if (bodies.length !== 1) return { ...result, scope: bodies.length ? "ambiguous" : "missing", reason: bodies.length ? "multiple-post-bodies" : "unsupported-post-layout" };
  const body = bodies[0];
  const ancestors = (node: HtmlNode, test: (candidate: HtmlNode) => boolean): boolean => {
    for (let value: HtmlNode | undefined = node; value && value !== body.parent; value = value.parent) if (test(value)) return true;
    return false;
  };
  const inside = (node: HtmlNode, boundary: HtmlNode): boolean => {
    for (let value: HtmlNode | undefined = node; value; value = value.parent) if (value === boundary) return true;
    return false;
  };
  // Public Naver HTML puts the document title and body in sibling blocks under one se-viewer.
  // A generic page-level title outside that established viewer remains untrusted.
  let viewer: HtmlNode | undefined;
  for (let node = body.parent; node && node !== root; node = node.parent) if (hasClass(node, "se-viewer")) { viewer = node; break; }
  const titleBoundary = viewer || body;
  const titleInDocumentHeader = (node: HtmlNode): boolean => {
    for (let value: HtmlNode | undefined = node; value && value !== titleBoundary.parent; value = value.parent) if (hasClass(value, "se-documentTitle")) return true;
    return false;
  };
  const titles = all.filter(node => inside(node, titleBoundary) && hasClass(node, "se-title-text") && visible(node) && titleInDocumentHeader(node));
  const textOf = (node: HtmlNode, depth = 0): string => depth > 128 || excluded(node) ? "" : node.children.map(child => typeof child === "string" ? child : textOf(child, depth + 1)).join("");
  if (titles.length === 1) result.title = textOf(titles[0]).trim();
  else if (titles.length > 1) return { ...result, scope: "ambiguous", reason: "multiple-post-titles" };
  if (malformed || !body.closed || viewer && !viewer.closed || [...invalidNodes].some(node => inside(node, titleBoundary) && visible(node))) return { ...result, scope: "ambiguous", reason: "incomplete-or-malformed-html" };
  let text = "";
  const read = (node: HtmlNode, depth = 0, parentCard?: PublishedPostSnapshot["connectCards"][number]) => {
    if (depth > 128 || excluded(node) || hasClass(node, "se-documentTitle")) return;
    const isCard = hasClass(node, "se-oglink") || ancestors(node, candidate => hasClass(candidate, "se-oglink"));
    const offset = compact(text).length;
    let currentCard = parentCard;
    if (hasClass(node, "se-oglink") && !currentCard) {
      currentCard = { urls: [], offset };
      result.connectCards.push(currentCard);
    }
    if (node.tag === "a" && node.attrs.href) {
      try {
        const url = new URL(node.attrs.href, pageUrl).href;
        result.links.push({ url, offset });
        if (currentCard) currentCard.urls.push(url);
      } catch { /* keep an invalid link unverified */ }
    }
    if (node.tag === "img" && !isCard) {
      const supported = hasClass(node, "se-image-resource") && ancestors(node, candidate => hasClass(candidate, "se-image"));
      const urls = [...new Set([node.attrs["data-original-src"], node.attrs["data-lazy-src"], node.attrs["data-src"], node.attrs.src].filter(Boolean).flatMap(value => {
        try { return [new URL(value, pageUrl).href]; } catch { return []; }
      }))];
      result.images.push({ urls, offset, supported });
      if (result.leadingContent === "none") result.leadingContent = "visual";
    }
    if (["video", "iframe", "canvas"].includes(node.tag)) { malformed = true; if (result.leadingContent === "none") result.leadingContent = "visual"; }
    if (node.tag === "br") text += "\n";
    for (const child of node.children) {
      if (typeof child !== "string") read(child, depth + 1, currentCard);
      else if (!isCard) {
        text += child;
        if (result.leadingContent === "none" && compact(child)) result.leadingContent = "text";
      }
    }
    if (blockTags.has(node.tag)) text += "\n";
  };
  read(body);
  result.bodyText = text.trim();
  result.scope = malformed || result.images.some(image => !image.supported) ? "ambiguous" : "confirmed";
  result.reason = malformed ? "unsupported-visual-component" : result.scope === "ambiguous" ? "unsupported-image-wrapper" : "smarteditor-post-body";
  return result;
}

/** Known resize query variants can be read as original candidates; the URL alone never proves image identity. */
export function publishedImageOriginalCandidate(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !/^(?:blogfiles|postfiles)\.pstatic\.net$/iu.test(url.hostname) || url.username || url.password || url.port) return null;
    if (!/\.(?:png|jpe?g|webp)$/iu.test(url.pathname) || [...url.searchParams.keys()].some(key => key !== "type")) return null;
    url.searchParams.delete("type"); url.hash = "";
    return url.href;
  } catch { return null; }
}

export interface PublishedContentVerification {
  version: "published-content-verification/v1";
  status: "verified" | "mismatch" | "partial" | "unverified";
  contentVerified: boolean;
  checks: { postIdentity: PublishedCheckState; title: PublishedCheckState; disclosure: PublishedCheckState; bodyOrder: PublishedCheckState; imageCount: PublishedCheckState; imageIdentity: PublishedCheckState; connectLinks: PublishedCheckState; revision: PublishedCheckState };
  expectedImages: number | null;
  actualImages: number | null;
  reasons: string[];
}

/** A matched title proves existence; every required check must pass to confirm the submitted content. */
export function verifyPublishedPostContent(input: {
  snapshot: PublishedPostSnapshot; expected: ResolvedPostDocumentV1 | null; revisionMatched: boolean | null; postIdentityMatched: boolean | null;
  imageHashes?: Array<string | null>; expectedImageHashes?: string[];
}): PublishedContentVerification {
  const { snapshot, expected } = input;
  const checks: PublishedContentVerification["checks"] = { postIdentity: input.postIdentityMatched === null ? "unverified" : input.postIdentityMatched ? "pass" : "fail", title: "unverified", disclosure: "unverified", bodyOrder: "unverified", imageCount: "unverified", imageIdentity: "unverified", connectLinks: "unverified", revision: input.revisionMatched === null ? "unverified" : input.revisionMatched ? "pass" : "fail" };
  const reasons: string[] = [];
  const imageNodes = expected?.renderNodes.filter(node => node.kind === "image") || [];
  const result = (): PublishedContentVerification => {
    const values = Object.values(checks);
    const status = values.includes("fail") ? "mismatch" : values.every(value => value === "pass") ? "verified" : values.includes("pass") ? "partial" : "unverified";
    return { version: "published-content-verification/v1", status, contentVerified: status === "verified", checks,
      expectedImages: expected ? imageNodes.length : null, actualImages: snapshot.scope === "confirmed" ? snapshot.images.length : null, reasons };
  };
  if (checks.revision === "fail") reasons.push("MATERIAL_REVISION_CHANGED: 현재 소재가 제출 당시 선택한 소재와 다릅니다.");
  if (checks.postIdentity !== "pass") reasons.push("POST_IDENTITY_UNVERIFIED: 요청한 게시물과 실제 응답 주소·제출 기록의 일치를 확인하지 못했습니다.");
  if (!expected) { reasons.push("PUBLISH_SNAPSHOT_REQUIRED: 제출 당시 원고·이미지 계약을 확인할 수 없습니다."); return result(); }
  if (snapshot.title) checks.title = compact(snapshot.title) === compact(expected.title) ? "pass" : "fail";
  if (checks.title !== "pass") reasons.push(snapshot.title ? "POST_TITLE_MISMATCH: 공개 글 제목이 선택한 원고와 다릅니다." : "POST_TITLE_UNVERIFIED: 공개 글 제목 범위를 확인할 수 없습니다.");
  if (snapshot.scope !== "confirmed") { reasons.push(`POST_BODY_UNVERIFIED: ${snapshot.reason}`); return result(); }
  const first = expected.renderNodes[0];
  const notice = first?.kind === "disclosure" && first.placement === "top" ? compact(first.text) : "";
  const actual = compact(snapshot.bodyText);
  checks.disclosure = notice && snapshot.leadingContent === "text" && actual.startsWith(notice) && actual.split(notice).length === 2 ? "pass" : "fail";
  if (checks.disclosure === "fail") reasons.push("POST_DISCLOSURE_MISMATCH: 공개 본문 첫 부분에 상단 고지가 한 번 있어야 합니다.");
  try { assertPublishedEditorText(expected, snapshot.bodyText); checks.bodyOrder = "pass"; }
  catch { checks.bodyOrder = "fail"; reasons.push("POST_BODY_ORDER_MISMATCH: 공개 본문의 문장·캡션·해시태그가 누락되거나 순서가 다릅니다."); }
  const expectedBody = expected.renderNodes.flatMap(node => {
    if (node.kind === "image") return node.caption ? [node.caption] : [];
    if (node.kind === "paragraph" || node.kind === "disclosure" || node.kind === "heading" || node.kind === "quotation") return [node.text];
    if (node.kind === "hashtags") return [node.values.map(value => `#${value.replace(/^#+/u, "").replace(/\s+/gu, "")}`).join(" ")];
    return [];
  }).join("\n");
  if (actual !== compact(expectedBody)) {
    checks.bodyOrder = "fail";
    reasons.push("POST_BODY_CONTENT_MISMATCH: 공개 본문에 승인하지 않은 추가 문장이 있거나 선택한 본문과 다른 내용이 있습니다.");
  }
  checks.imageCount = snapshot.images.length === imageNodes.length ? "pass" : "fail";
  if (checks.imageCount === "fail") reasons.push(`POST_IMAGE_COUNT_MISMATCH: 공개 본문 이미지 ${snapshot.images.length}/${imageNodes.length}장입니다.`);
  if (checks.imageCount === "pass" && input.expectedImageHashes?.length === imageNodes.length && input.imageHashes?.length === imageNodes.length) {
    const knownMismatch = input.imageHashes.some((hash, index) => hash !== null && hash !== input.expectedImageHashes![index]);
    // Naver can resize/re-encode upload bytes. A differing hash is insufficient to condemn the photo or prove it matches.
    checks.imageIdentity = !knownMismatch && input.imageHashes.every(Boolean) ? "pass" : "unverified";
  }
  if (checks.imageIdentity !== "pass") reasons.push("POST_IMAGE_IDENTITY_UNVERIFIED: 사진 원본 바이트·배치의 동일성을 확인하지 못했습니다. 네이버 리사이즈·재인코딩 또는 다른 사진 여부를 실제 글에서 확인하세요.");
  const expectedLinks = expected.renderNodes.filter(node => node.kind === "connectCard");
  let cursor = 0;
  const usedImages = new Set<number>();
  const usedLinks = new Set<number>();
  let linksMatch = expectedLinks.length > 0 && snapshot.connectCards.length === expectedLinks.length;
  for (const node of expected.renderNodes) {
    if (["paragraph", "heading", "quotation", "disclosure"].includes(node.kind) && "text" in node) {
      const found = actual.indexOf(compact(node.text), cursor);
      if (found >= 0) cursor = found + compact(node.text).length;
      else { checks.bodyOrder = "fail"; reasons.push("POST_COMPONENT_ORDER_MISMATCH: 공개 문장·사진·카드의 상대 순서가 원고 계약과 다릅니다."); }
    } else if (node.kind === "image") {
      const index = snapshot.images.findIndex((image, imageIndex) => !usedImages.has(imageIndex) && image.offset >= cursor);
      if (index < 0) { checks.bodyOrder = "fail"; reasons.push("POST_IMAGE_ORDER_MISMATCH: 공개 사진 위치가 원고 계약과 다릅니다."); }
      else { usedImages.add(index); cursor = snapshot.images[index].offset; }
    } else if (node.kind === "connectCard") {
      const index = snapshot.connectCards.findIndex((card, linkIndex) => !usedLinks.has(linkIndex) && card.urls.includes(node.url) && card.offset >= cursor);
      if (index < 0) linksMatch = false;
      else { usedLinks.add(index); cursor = snapshot.connectCards[index].offset; }
    }
  }
  checks.connectLinks = linksMatch ? "pass" : "unverified";
  if (!linksMatch) reasons.push("POST_CONNECT_LINK_UNVERIFIED: 지정 커넥트 URL 또는 카드 위치를 확인하지 못했습니다. 알 수 없는 리다이렉트 래퍼는 성공으로 판정하지 않습니다.");
  return result();
}

export function publishedPostIdentityMatches(requestedUrl: string, responseUrl: string): boolean {
  const requested = parseNaverPublishedUrl(requestedUrl);
  const actual = parseNaverPublishedUrl(responseUrl);
  return Boolean(requested && actual && requested.url === actual.url);
}

export function reservationVerification(input: { status: string; attempt: { stage: string; mode: string; evidence?: { reservationId?: string; scheduledDate?: string } } | null; scheduledAt: Date | null; now: Date }) {
  const receipt = input.attempt;
  const scheduledDate = receipt?.evidence?.scheduledDate;
  const reservationId = receipt?.evidence?.reservationId;
  const accepted = Boolean(input.status === "SCHEDULED" && receipt?.stage === "CONFIRMED" && receipt.mode === "schedule" &&
    reservationId && /^[A-Za-z0-9_-]{1,100}$/u.test(reservationId) && reservationId !== "0" && scheduledDate && /^\d{4}-\d{2}-\d{2}$/u.test(scheduledDate) &&
    Number.isFinite(Date.parse(scheduledDate)) && new Date(scheduledDate).toISOString().slice(0, 10) === scheduledDate && input.scheduledAt && Date.parse(scheduledDate) === input.scheduledAt.getTime());
  // A receipt remains historical acceptance evidence after its date; it does not prove the current reservation list or publication.
  const nowYmd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(input.now);
  return { receiptAccepted: accepted, liveListChecked: false as const, liveReservationConfirmed: null,
    dueDateReached: accepted && scheduledDate! <= nowYmd, publicationConfirmed: false,
    status: accepted ? scheduledDate! <= nowYmd ? "due-publication-unverified" : "receipt-accepted-live-list-unverified" : "unverified",
    nextAction: accepted ? scheduledDate! <= nowYmd ? "예정일이 지났습니다. 현재 예약 목록 또는 실제 게시 URL을 확인하세요. 재발행하지 마세요." : "예약 접수는 확인됐습니다. 현재 예약 목록은 별도 조회가 필요합니다. 재예약하지 마세요." : "제출 결과를 먼저 확인하세요. 검증 불명 상태에서 자동 재발행하지 마세요." };
}
