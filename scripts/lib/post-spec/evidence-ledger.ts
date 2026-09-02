/**
 * STAGE A′ — 섹션별 근거표.
 *
 * 생성 전에 "어느 섹션이 어떤 근거를 전담하는가"를 고정한다.
 *  - 모든 본문(prose) 섹션은 전용 근거를 최소 1개 갖는다.
 *  - 전용 근거는 한 섹션에만 배정되고 다른 섹션은 재사용하지 못한다.
 *  - 가격·상품명·기간처럼 여러 섹션이 참조해야 하는 값은 공용(shared)으로 둔다.
 *
 * 이렇게 하면 모델이 같은 기능을 섹션마다 되풀이하거나, 근거 없이 "확인해보세요"로
 * 문단을 채우는 일을 스펙 단계에서 막을 수 있다.
 */

import type { ProductReviewAnalysis } from "../product-editorial-plan";
import type { TravelProductFacts } from "../travel-content";
import type { EvidenceLedgerEntry, SectionRole } from "./types";
import type { SectionTemplate } from "./section-library";

export interface EvidenceLedgerInput {
  kind: "SHOPPING" | "TRAVEL";
  productName: string;
  factLines: string[];
  review: ProductReviewAnalysis | null;
  travel: TravelProductFacts | null;
  templates: SectionTemplate[];
}

function clean(value: string | null | undefined): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function uniqueLines(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values.map(clean)) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    output.push(value);
  }
  return output;
}

function isMeasured(line: string): boolean {
  return /\d[\d,.]*\s*(?:mAh|m|cm|mm|kg|g|W|V|시간|분|단|도|개|엽|%|원|ml|L|인치)/iu.test(line);
}

const SHARED_LABELS = /^(?:상품명|가격|원가|할인율|쿠폰\/혜택|배송|리뷰 수|평점):/u;

/** 근거 풀: 전용으로 나눠 줄 수 있는 줄과 공용 줄을 분리한다. */
function splitPool(factLines: string[]): { shared: string[]; exclusive: string[] } {
  const shared: string[] = [];
  const exclusive: string[] = [];
  for (const line of uniqueLines(factLines)) {
    if (SHARED_LABELS.test(line)) shared.push(line);
    else exclusive.push(line);
  }
  return { shared, exclusive };
}

class Pool {
  private remaining: string[];
  constructor(lines: string[]) {
    this.remaining = [...lines];
  }
  /** 조건에 맞는 줄을 하나 꺼낸다(없으면 null). 꺼낸 줄은 다른 섹션이 쓸 수 없다. */
  take(predicate?: (line: string) => boolean): string | null {
    const index = this.remaining.findIndex((line) => (predicate ? predicate(line) : true));
    if (index < 0) return null;
    const [line] = this.remaining.splice(index, 1);
    return line;
  }
  takeMany(count: number, predicate?: (line: string) => boolean): string[] {
    const output: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const line = this.take(predicate);
      if (!line) break;
      output.push(line);
    }
    return output;
  }
  get size(): number {
    return this.remaining.length;
  }
  drain(): string[] {
    const rest = this.remaining;
    this.remaining = [];
    return rest;
  }
}

function angleLine(kind: "장점" | "제약", angle: ProductReviewAnalysis["strengths"][number]): string {
  const evidence = angle.evidence.filter(Boolean).join(", ");
  const impact = angle.readerImpact.filter(Boolean).join(", ");
  return `${kind} 근거: ${angle.label}${evidence ? ` — 근거 ${evidence}` : ""}${impact ? ` — 독자 영향 ${impact}` : ""}`;
}

function buildShoppingLedger(input: EvidenceLedgerInput): EvidenceLedgerEntry[] {
  const { shared, exclusive } = splitPool(input.factLines);
  const review = input.review;
  const reviewLines = exclusive.filter((line) => /^구매후기 원문 근거:/u.test(line));
  const featureLines = exclusive.filter((line) => !/^구매후기 원문 근거:/u.test(line) && !/^설명:/u.test(line));
  const descriptionLine = exclusive.find((line) => /^설명:/u.test(line)) || null;
  const strengthLines = (review?.strengths || []).map((angle) => angleLine("장점", angle));
  const limitationLines = (review?.limitations || []).map((angle) => angleLine("제약", angle));
  const fitLines = uniqueLines([
    review?.bestFor.length ? `잘 맞는 대상: ${review.bestFor.join(" / ")}` : "",
    review?.notFor.length ? `맞지 않을 수 있는 대상: ${review.notFor.join(" / ")}` : "",
  ]);
  const comparisonLine = review?.comparisonAxes.length ? `비교 기준: ${review.comparisonAxes.join(", ")}` : null;
  const unresolvedLine = review?.unresolvedFacts.length ? `미확인 사실: ${review.unresolvedFacts.join(", ")}` : null;
  const identityLines = uniqueLines([
    review?.categoryLabel ? `분류: ${review.categoryLabel}` : "",
    review?.primaryUse ? `1차 용도: ${review.primaryUse}` : "",
    descriptionLine || "",
  ]);

  const features = new Pool(featureLines);
  const strengths = new Pool(strengthLines);
  const limitations = new Pool(limitationLines);
  const reviews = new Pool(reviewLines);
  const fits = new Pool(fitLines);
  const identities = new Pool(identityLines);

  const entries: EvidenceLedgerEntry[] = input.templates.map((template, index) => ({
    sectionIndex: index,
    role: template.role,
    exclusive: [],
    shared: [],
  }));
  const byRole = (role: SectionRole) => entries.find((entry) => entry.role === role);

  // 1차 배정: 역할이 요구하는 종류의 근거를 먼저 준다.
  const summary = byRole("summary-glance");
  if (summary) summary.shared.push(...shared.filter((line) => /^(?:상품명|가격):/u.test(line)));
  const hook = byRole("hook-problem");
  if (hook) {
    const fit = fits.take((line) => line.startsWith("잘 맞는 대상"));
    if (fit) hook.exclusive.push(fit);
  }
  const reveal = byRole("product-reveal");
  if (reveal) {
    reveal.exclusive.push(...identities.takeMany(2));
    const structural = features.take((line) => !isMeasured(line));
    if (structural) reveal.exclusive.push(structural);
  }
  const keyFacts = byRole("key-facts");
  if (keyFacts) keyFacts.shared.push(...shared, ...featureLines.filter(isMeasured).slice(0, 4));
  const benefit = byRole("benefit");
  if (benefit) {
    const strength = strengths.take();
    if (strength) benefit.exclusive.push(strength);
    const measured = features.take(isMeasured);
    if (measured) benefit.exclusive.push(measured);
  }
  const useCase = byRole("use-case");
  if (useCase) {
    const strength = strengths.take();
    if (strength) useCase.exclusive.push(strength);
    const usage = features.take((line) => /(?:설치|충전|세척|관리|보관|조작|모드|회전|각도|접이|분리|휴대)/u.test(line));
    if (usage) useCase.exclusive.push(usage);
  }
  const proof = byRole("proof");
  if (proof) {
    proof.exclusive.push(...reviews.takeMany(2));
    proof.shared.push(...shared.filter((line) => /^(?:리뷰 수|평점):/u.test(line)));
    const measured = features.take(isMeasured);
    if (measured) proof.exclusive.push(measured);
  }
  const comparison = byRole("comparison");
  if (comparison) {
    if (comparisonLine) comparison.exclusive.push(comparisonLine);
    const limitation = limitations.take();
    if (limitation) comparison.exclusive.push(limitation);
  }
  const offer = byRole("offer-check");
  if (offer) offer.shared.push(...shared.filter((line) => /^(?:가격|원가|할인율|쿠폰\/혜택|배송):/u.test(line)));
  const faq = byRole("faq");
  if (faq) {
    const limitation = limitations.take();
    if (limitation) faq.exclusive.push(limitation);
    if (unresolvedLine) faq.exclusive.push(unresolvedLine);
  }
  const fit = byRole("fit-checklist");
  if (fit) {
    fit.exclusive.push(...fits.drain());
    const strength = strengths.take();
    if (strength) fit.exclusive.push(strength);
  }

  // 2차 배정: 전용 근거가 없는 본문 섹션에 남은 근거를 라운드로빈으로 나눠 준다.
  const needsExclusive = (template: SectionTemplate) => template.shape === "prose" || template.shape === "qa-3" || template.shape === "checklist";
  const rotate = [features, strengths, limitations, reviews, identities];
  for (const entry of entries) {
    const template = input.templates[entry.sectionIndex];
    if (!needsExclusive(template) || entry.exclusive.length > 0) continue;
    for (const pool of rotate) {
      const line = pool.take();
      if (line) {
        entry.exclusive.push(line);
        break;
      }
    }
  }
  // 남은 상세 근거는 아직 1개뿐인 본문 섹션부터 한 줄씩 더 준다(섹션당 최대 3개).
  let guard = 0;
  while (features.size > 0 && guard < 50) {
    guard += 1;
    const target = entries
      .filter((entry) => needsExclusive(input.templates[entry.sectionIndex]) && entry.exclusive.length < 3)
      .sort((a, b) => a.exclusive.length - b.exclusive.length)[0];
    if (!target) break;
    const line = features.take();
    if (!line) break;
    target.exclusive.push(line);
  }
  return entries;
}

function buildTravelLedger(input: EvidenceLedgerInput): EvidenceLedgerEntry[] {
  const { shared } = splitPool(input.factLines);
  const travel = input.travel;
  const highlights = uniqueLines(travel?.highlights || []);
  const conditions = uniqueLines(travel?.conditions || []);
  const destinationLine = travel?.destinations.length ? `목적지: ${travel.destinations.join(", ")}` : null;
  const durationLine = travel?.duration ? `기간: ${travel.duration}` : null;
  const highlightLine = highlights.length ? `핵심 방문지: ${highlights.join(", ")}` : null;
  const conditionPool = new Pool(conditions.map((value) => `상품 조건: ${value}`));

  const entries: EvidenceLedgerEntry[] = input.templates.map((template, index) => ({
    sectionIndex: index,
    role: template.role,
    exclusive: [],
    shared: [],
  }));
  const commonShared = uniqueLines([destinationLine || "", durationLine || "", ...shared.filter((line) => /^(?:상품명|가격):/u.test(line))]);
  const byRole = (role: SectionRole) => entries.filter((entry) => entry.role === role);

  for (const entry of byRole("summary-glance")) entry.shared.push(...commonShared);
  for (const entry of byRole("key-facts")) entry.shared.push(...commonShared, ...shared, ...conditions.map((value) => `상품 조건: ${value}`));
  for (const entry of byRole("itinerary-overview")) {
    if (highlightLine) entry.exclusive.push(highlightLine);
    entry.shared.push(...commonShared);
  }
  // 코스 포인트 섹션은 각자 다른 방문지를 전담한다.
  const dayCourses = byRole("day-course");
  dayCourses.forEach((entry, index) => {
    const highlight = input.templates[entry.sectionIndex]?.requiredKeywords[0] || highlights[index];
    if (highlight) entry.exclusive.push(`방문지: ${highlight}`);
  });
  for (const entry of byRole("inclusions")) entry.shared.push(...shared, ...commonShared);
  for (const entry of byRole("reasons-3")) {
    entry.exclusive.push(...conditionPool.takeMany(2));
    entry.shared.push(...commonShared);
  }
  for (const entry of byRole("booking-check")) {
    const condition = conditionPool.take();
    if (condition) entry.exclusive.push(condition);
    entry.shared.push(...commonShared);
  }
  for (const entry of byRole("faq")) {
    const condition = conditionPool.take();
    if (condition) entry.exclusive.push(condition);
    entry.shared.push(...commonShared);
  }
  for (const entry of byRole("fit-checklist")) {
    if (durationLine) entry.exclusive.push(`${durationLine} 기준 추천 대상`);
    entry.shared.push(...commonShared);
  }
  for (const entry of byRole("closing")) entry.shared.push(...commonShared);
  return entries;
}

export function buildEvidenceLedger(input: EvidenceLedgerInput): EvidenceLedgerEntry[] {
  const entries = input.kind === "SHOPPING" ? buildShoppingLedger(input) : buildTravelLedger(input);
  // 안전장치: 전용 근거는 어떤 경우에도 두 섹션에 동시에 배정되지 않는다.
  const seen = new Set<string>();
  for (const entry of entries) {
    entry.exclusive = entry.exclusive.filter((line) => {
      if (seen.has(line)) return false;
      seen.add(line);
      return true;
    });
    entry.shared = uniqueLines(entry.shared).filter((line) => !entry.exclusive.includes(line));
  }
  return entries;
}

/** 프롬프트에 넣을 "다른 섹션 전용 근거" 목록. 길어지지 않게 섹션당 1줄만 보여 준다. */
export function otherSectionsEvidence(ledger: EvidenceLedgerEntry[], sectionIndex: number, titles: string[]): string[] {
  return ledger
    .filter((entry) => entry.sectionIndex !== sectionIndex && entry.exclusive.length > 0)
    .map((entry) => `${titles[entry.sectionIndex] || `섹션 ${entry.sectionIndex + 1}`}: ${entry.exclusive[0]}`);
}
