/**
 * STAGE C — 검증. 모든 신호를 계산하고(early-return 없음) 섹션 단위 수리 목록을 돌려준다.
 * 안전 게이트(허위 체험·URL 노출·내부 지침·수수료·고지)는 기존 readiness 신호 계산을 그대로 재사용한다.
 */

import { stripClickbaitFromTitle } from "../blog-writing-style";
import {
  COMMISSION_RATE_PATTERNS,
  getBrandLinkContentReadiness,
  getProductTokens,
  INTERNAL_GUIDANCE_PATTERNS,
  detectUnsupportedExperience,
} from "../brandlink-content-readiness";
import { assessGenericLanguage, evidenceUsedIn, sentenceTokens, tokenSimilarity } from "../draft-quality-signals";
import { scanAiTells } from "../humanize-korean";
import { countChars, looseText, renderSectionText } from "./render";
import type { GeneratedDraft, PostSpec, RepairTarget, ValidationReport, ValidationSignal } from "./types";

export interface ValidateOptions {
  brandLink: string;
  hasRepresentativeImage: boolean;
  requireRepresentativeImage: boolean;
  thumbnailGenerated: boolean;
  maxRepairAttempts?: number;
}

const EMOJI_IN_TITLE = /[\p{Extended_Pictographic}️]/u;
/** 하드 차단 코드: 허위 체험, URL 노출, 내부 지침 유출, 수수료율, 카테고리 혼입, 제목 상품명, 이미지 부족 */
const P0_CODES = new Set(["FORBIDDEN_CLAIM", "RAW_LINK", "INTERNAL_LEAK", "COMMISSION_RATE", "CATEGORY_MISMATCH", "TITLE_PRODUCT_TOKEN", "IMAGE_SHORTFALL"]);
const NEAR_DUPLICATE_THRESHOLD = 0.72;

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

/** Restore the editorial wrapper only, never promote title/description to visits. */
export function sourceFeaturesForValidation(spec: Pick<PostSpec, "connectKind" | "facts">): string[] {
  if (spec.connectKind !== "TRAVEL") return spec.facts.lines;
  const lines = spec.facts.lines.map((line) => line.replace(/^상세 근거:\s*/u, ""));
  // The editorial feature filter can discard duration. Identity may raise the
  // required coverage, but must never supply missing visits or itinerary rows.
  const days = spec.facts.travel?.duration?.match(/(\d+)\s*일/u)?.[1];
  return days ? [`여행 기간: ${days}일`, ...lines] : lines;
}

export function validateDraft(spec: PostSpec, draft: GeneratedDraft, options: ValidateOptions): ValidationReport {
  const signals: ValidationSignal[] = [];
  const targets: RepairTarget[] = [];
  const push = (signal: ValidationSignal) => signals.push(signal);
  const target = (t: RepairTarget) => {
    if (!targets.some((existing) => existing.sectionIndex === t.sectionIndex && existing.code === t.code)) targets.push(t);
  };

  const sectionTexts = draft.sections.map((section) => renderSectionText(section));
  const gate = getBrandLinkContentReadiness({
    productName: spec.productName,
    title: draft.title,
    sections: [...sectionTexts, spec.disclosure],
    hashtags: draft.hashtags,
    brandLink: options.brandLink,
    generationSource: "AI",
    hasRepresentativeImage: options.hasRepresentativeImage,
    requireRepresentativeImage: options.requireRepresentativeImage,
    thumbnailGenerated: options.thumbnailGenerated,
    connectKind: spec.connectKind,
    sourceDescription: spec.facts.lines.join("\n"),
    sourceFeatures: sourceFeaturesForValidation(spec),
    mode: "editorial",
  });

  for (const signal of gate.signals) {
    if (signal.key === "disclosure" || signal.key === "hashtags") {
      // 고지·해시태그는 조립 단계에서 코드가 확정하므로 경고로만 남긴다.
      push({ key: `gate:${signal.key}`, label: signal.label, status: signal.status === "fail" ? "warn" : signal.status });
      continue;
    }
    push({ key: `gate:${signal.key}`, label: signal.label, status: signal.status });
  }

  // 안전 게이트 실패를 섹션 단위 수리 타깃으로 바꾼다.
  draft.sections.forEach((section) => {
    const text = section.lines.join("\n");
    const experienceMatches = detectUnsupportedExperience(renderSectionText(section));
    if (experienceMatches.length > 0) {
      target({ sectionIndex: section.index, code: "FORBIDDEN_CLAIM", priority: "P0", reason: `직접 구매·사용·방문을 단정하는 문장 (감지: ${experienceMatches.join(", ")})`, instruction: "체험 단정 문장을 조건형·조사형 표현으로 바꾸세요 (예: '써보니' → '이런 상황이라면', '다녀왔' → '찾아보니 ~라고 해요')." });
    }
    if (/https?:\/\/\S+/iu.test(text)) {
      target({ sectionIndex: section.index, code: "RAW_LINK", priority: "P0", reason: "본문에 URL 직접 노출", instruction: "URL을 지우고 '아래 링크에서 확인'처럼 안내 문장으로 바꾸세요." });
    }
    if (matchesAny(text, INTERNAL_GUIDANCE_PATTERNS)) {
      target({ sectionIndex: section.index, code: "INTERNAL_LEAK", priority: "P0", reason: "내부 지침·프롬프트 문구 유출", instruction: "지침·역할·형식 설명 문장을 지우고 독자에게 보이는 본문만 남기세요." });
    }
    if (matchesAny(text, COMMISSION_RATE_PATTERNS)) {
      target({ sectionIndex: section.index, code: "COMMISSION_RATE", priority: "P0", reason: "수수료율·정산 정보 노출", instruction: "수수료율·정산 관련 문장을 삭제하세요." });
    }
  });
  // 카테고리 혼입(쇼핑: 다른 상품군 용어, 여행: 배송·교환 같은 쇼핑 문구)은 판정기 차단을 섹션 타깃으로 옮긴다.
  const mismatch = gate.blockers.find((blocker) => blocker.code === "category-mismatch");
  if (mismatch) {
    const terms = (mismatch.reason.split(":")[1] || "").split(",").map((term) => term.trim()).filter(Boolean);
    const offending = draft.sections.filter((section) => terms.some((term) => section.lines.join("\n").includes(term)));
    for (const section of offending.length ? offending : draft.sections.slice(0, 1)) {
      target({ sectionIndex: section.index, code: "CATEGORY_MISMATCH", priority: "P0", reason: mismatch.reason, instruction: `이 상품·여행지와 맞지 않는 표현(${terms.join(", ") || "혼입 문구"})을 지우고 확인된 근거로 바꾸세요.` });
    }
  }
  const titleHasProduct = gate.signals.find((signal) => signal.key === "product-title")?.status === "pass";
  if (!titleHasProduct) {
    target({ sectionIndex: null, code: "TITLE_PRODUCT_TOKEN", priority: "P0", reason: "제목에 상품명 토큰 없음", instruction: `제목에 ${spec.seo.title.mustIncludeTokens.join(", ") || spec.productName}을 포함하세요.` });
  }

  // 제목 규칙
  const title = draft.title.trim();
  const titleLength = title.length;
  const { minChars, maxChars } = spec.seo.title;
  const titleFar = titleLength < minChars - 5 || titleLength > maxChars + 5;
  const titleNear = !titleFar && (titleLength < minChars || titleLength > maxChars);
  push({ key: "title-length", label: `제목 길이 ${minChars}~${maxChars}자`, status: titleFar ? "fail" : titleNear ? "warn" : "pass", detail: `${titleLength}자` });
  if (titleFar) target({ sectionIndex: null, code: "TITLE_LENGTH", priority: "P1", reason: `제목 ${titleLength}자`, instruction: `제목을 ${minChars}~${maxChars}자로 다시 쓰세요.` });
  const keywordPos = looseText(title).indexOf(looseText(spec.seo.primaryKeyword));
  const keywordFirst = keywordPos >= 0 && keywordPos <= 12;
  push({ key: "title-keyword-first", label: "제목 앞쪽 핵심 키워드", status: keywordFirst ? "pass" : keywordPos >= 0 ? "warn" : "fail", detail: spec.seo.primaryKeyword });
  if (keywordPos < 0) target({ sectionIndex: null, code: "TITLE_KEYWORD", priority: "P1", reason: "제목에 핵심 키워드 없음", instruction: `제목 앞쪽에 "${spec.seo.primaryKeyword}"를 넣으세요.` });
  const clickbaitStripped = stripClickbaitFromTitle(title) !== title;
  const titleEmoji = EMOJI_IN_TITLE.test(title);
  push({ key: "title-clean", label: "낚시성 문구·이모지 없는 제목", status: clickbaitStripped || titleEmoji ? "fail" : "pass" });
  if (clickbaitStripped || titleEmoji) target({ sectionIndex: null, code: "TITLE_CLEAN", priority: "P1", reason: clickbaitStripped ? "낚시성 문구" : "이모지 포함", instruction: "낚시성 문구와 이모지를 빼고 정보형 제목으로 다시 쓰세요." });

  // 섹션 규칙
  const seenLines = new Map<string, { sectionIndex: number; tokens: string[] }>();
  const productTokens = getProductTokens(spec.productName);
  let aiTellTotal = 0;
  for (const section of draft.sections) {
    const spec$ = spec.sections[section.index];
    if (!spec$) continue;
    const lines = section.lines;
    const chars = countChars(lines);
    const lineOk = lines.length >= spec$.minLines && lines.length <= spec$.maxLines;
    const charOk = chars >= spec$.minChars && chars <= spec$.maxChars;
    const charFar = chars < spec$.minChars * 0.6 || chars > spec$.maxChars * 1.5;
    push({ key: `section:${section.index}:length`, label: `${spec$.title} 분량`, status: lineOk && charOk ? "pass" : charFar || lines.length === 0 ? "fail" : "warn", sectionIndex: section.index, detail: `${lines.length}줄 ${chars}자` });
    if (!(lineOk && charOk)) {
      target({ sectionIndex: section.index, code: "LENGTH_OUT_OF_RANGE", priority: charFar || lines.length === 0 ? "P1" : "P2", reason: `${lines.length}줄 ${chars}자 (목표 ${spec$.minLines}~${spec$.maxLines}줄, ${spec$.minChars}~${spec$.maxChars}자)`, instruction: `분량을 ${spec$.minLines}~${spec$.maxLines}줄, 공백 제외 ${spec$.minChars}~${spec$.maxChars}자로 맞추세요.` });
    }
    let shapeOk = true;
    if (spec$.shape === "qa-3") {
      shapeOk = lines.length === 6 && lines.every((line, index) => (index % 2 === 0 ? /^Q\./.test(line) : /^A\./.test(line)));
    } else if (spec$.shape === "lines-3") {
      shapeOk = lines.length === 3;
    }
    push({ key: `section:${section.index}:shape`, label: `${spec$.title} 형식(${spec$.shape})`, status: shapeOk ? "pass" : "warn", sectionIndex: section.index });
    if (!shapeOk) target({ sectionIndex: section.index, code: "SHAPE_VIOLATION", priority: "P1", reason: `형식 ${spec$.shape} 불일치`, instruction: spec$.shape === "qa-3" ? "Q. 질문 / A. 답변 순서로 정확히 3쌍(6줄)을 쓰세요." : "정확히 3줄로 쓰세요." });
    const loose = looseText(lines.join(" "));
    const missing = spec$.requiredKeywords.filter((keyword) => keyword && !loose.includes(looseText(keyword)));
    if (missing.length > 0) {
      push({ key: `section:${section.index}:keywords`, label: `${spec$.title} 필수 키워드`, status: "warn", sectionIndex: section.index, detail: missing.join(", ") });
      target({ sectionIndex: section.index, code: "MISSING_KEYWORD", priority: "P1", reason: `누락: ${missing.join(", ")}`, instruction: `본문에 ${missing.join(", ")}을(를) 자연스럽게 포함하세요.` });
    }
    // 반복: 정확히 같은 줄뿐 아니라 숫자·어미만 바뀐 근사 중복도 다른 섹션과 겹치면 잡는다.
    for (const line of lines) {
      const key = looseText(line);
      if (key.length < 12) continue;
      const tokens = sentenceTokens(line);
      let earlier: number | undefined = seenLines.get(key)?.sectionIndex;
      // "항목: 값" 형식의 사실 목록은 가격·상품명이 여러 섹션에 정당하게 반복되므로 정확 일치만 본다.
      const structuredLine = spec$.shape === "facts-list" || spec$.shape === "checklist" || /^[•▸]\s/u.test(line);
      if (earlier === undefined && !structuredLine && tokens.length >= 3) {
        for (const [, seen] of seenLines) {
          if (seen.sectionIndex === section.index || seen.tokens.length < 3) continue;
          if (tokenSimilarity(tokens, seen.tokens) >= NEAR_DUPLICATE_THRESHOLD) {
            earlier = seen.sectionIndex;
            break;
          }
        }
      }
      if (earlier !== undefined && earlier !== section.index) {
        push({ key: `section:${section.index}:repeat`, label: `${spec$.title} 중복 문장`, status: "warn", sectionIndex: section.index, detail: line.slice(0, 40) });
        target({ sectionIndex: section.index, code: "REPEATED_LINE", priority: "P1", reason: `${spec.sections[earlier]?.title || earlier}와 같은 뜻의 문장: "${line.slice(0, 30)}"`, instruction: "다른 섹션과 겹치는 문장을 이 섹션 전용 근거로 만든 새 정보로 바꾸세요." });
        break;
      }
      if (!seenLines.has(key)) seenLines.set(key, { sectionIndex: section.index, tokens });
    }
    // 전용 근거 사용: 배정된 근거를 하나도 쓰지 않은 섹션은 일반론으로 채워졌을 가능성이 높다.
    // 저장된 구버전 스펙에는 mustUseEvidence 가 없을 수 있다.
    const mustUse = spec$.mustUseEvidence || [];
    if (mustUse.length > 0) {
      const sectionText = lines.join("\n");
      const used = mustUse.filter((evidence) => evidenceUsedIn(evidence, sectionText));
      push({ key: `section:${section.index}:evidence`, label: `${spec$.title} 전용 근거 사용`, status: used.length > 0 ? "pass" : "fail", sectionIndex: section.index, detail: `${used.length}/${mustUse.length}` });
      if (used.length === 0) {
        target({ sectionIndex: section.index, code: "EVIDENCE_UNUSED", priority: "P1", reason: "배정된 전용 근거를 쓰지 않음", instruction: `다음 근거 중 최소 1개를 수치·이름 그대로 쓰고 독자에게 어떤 차이인지 이어 쓰세요: ${mustUse.join(" / ")}` });
      }
    }
    // 확인 안내·일반론: 섹션의 절반 이상이 안내·일반론이면 정보가 없는 문단이다.
    const generic = assessGenericLanguage(lines.join("\n"), { evidenceTokens: [...productTokens, ...mustUse] });
    const emptyCount = generic.guidanceCount + generic.generalStatementCount;
    const genericHeavy = emptyCount >= 2 && emptyCount * 2 >= Math.max(1, generic.sentenceCount);
    if (genericHeavy) {
      push({ key: `section:${section.index}:generic`, label: `${spec$.title} 확인 안내·일반론`, status: "warn", sectionIndex: section.index, detail: `${emptyCount}/${generic.sentenceCount}문장` });
      target({ sectionIndex: section.index, code: "GENERIC_GUIDANCE", priority: "P1", reason: `확인 안내·일반론 문장 ${emptyCount}/${generic.sentenceCount}개`, instruction: "확인 안내·일반론 문장을 1개 이하로 줄이고, 지운 자리는 이 섹션 전용 근거와 그 근거가 만드는 사용 장면으로 채우세요." });
    }
    const tells = scanAiTells(lines.join("\n"));
    aiTellTotal += tells.score;
    if (tells.score >= 8) {
      push({ key: `section:${section.index}:ai-tell`, label: `${spec$.title} AI 티`, status: "warn", sectionIndex: section.index, detail: tells.summary });
      target({ sectionIndex: section.index, code: "AI_TELL", priority: "P1", reason: tells.summary, instruction: `AI 티 표현을 자연스럽게 고치세요: ${tells.findings.map((finding) => finding.label).join(", ")}` });
    }
  }

  // 키워드 밀도
  const bodyText = looseText(draft.sections.flatMap((section) => section.lines).join(" "));
  const keyword = looseText(spec.seo.primaryKeyword);
  const totalChars = draft.sections.reduce((sum, section) => sum + countChars(section.lines), 0);
  const keywordMentions = keyword ? bodyText.split(keyword).length - 1 : 0;
  const per1000 = totalChars > 0 ? (keywordMentions / totalChars) * 1000 : 0;
  const [minPer, maxPer] = spec.seo.keywordMentionsPer1000;
  push({ key: "keyword-density", label: "핵심 키워드 밀도", status: per1000 >= minPer && per1000 <= maxPer ? "pass" : "warn", detail: `${keywordMentions}회 (${per1000.toFixed(1)}/1000자)` });
  if (per1000 < minPer) {
    const candidate = spec.sections.find((section) => section.role === "benefit" || section.role === "use-case" || section.role === "itinerary-overview");
    if (candidate) target({ sectionIndex: candidate.index, code: "KEYWORD_DENSITY_LOW", priority: "P2", reason: `핵심 키워드 ${keywordMentions}회`, instruction: `"${spec.seo.primaryKeyword}"를 문장 안에 자연스럽게 1~2회 더 넣으세요.` });
  }
  const firstLine = looseText(draft.sections[0]?.lines[0] || "");
  const firstOk = firstLine.includes(looseText(spec.seo.firstSentenceMustInclude));
  push({ key: "first-sentence", label: "첫 문장 상품명", status: firstOk ? "pass" : "warn" });
  if (!firstOk && draft.sections[0]) target({ sectionIndex: 0, code: "FIRST_SENTENCE", priority: "P1", reason: "첫 문장에 상품명 없음", instruction: `첫 줄을 "${spec.seo.firstSentenceMustInclude}"으로 시작하세요.` });

  // 분량·이미지
  const [minTotal, maxTotal] = spec.totalChars;
  push({ key: "total-length", label: `전체 분량 ${minTotal}~${maxTotal}자`, status: totalChars >= minTotal && totalChars <= maxTotal ? "pass" : totalChars >= minTotal * 0.8 ? "warn" : "fail", detail: `${totalChars}자` });
  const imageCount = (spec.imagePlan.hero ? 1 : 0) + spec.imagePlan.resolvedBody;
  const imageShort = spec.imagePlan.shortfall > 0;
  push({ key: "images", label: `본문 이미지 ${spec.imagePlan.minBody}장 이상`, status: imageShort ? "fail" : spec.imagePlan.shrinkApplied ? "warn" : "pass", detail: `본문 ${spec.imagePlan.resolvedBody}장 / 목표 ${spec.imagePlan.targetBody}장` });
  if (imageShort) target({ sectionIndex: null, code: "IMAGE_SHORTFALL", priority: "P0", reason: `본문 이미지 ${spec.imagePlan.resolvedBody}장 (최소 ${spec.imagePlan.minBody}장)`, instruction: "이미지를 더 확보해야 합니다(재생성으로 해결되지 않음)." });

  // 점수와 통과 여부의 의미 통일:
  //  - 하드 차단(P0)이 있으면 점수와 무관하게 BLOCKED
  //  - 차단이 없으면 판정기 품질 점수(60%) + 스펙 준수 점수(40%)를 점수로 쓰고,
  //    품질 점수가 기준 미만이거나 수리 대상이 남아 있으면 NEEDS_REVIEW
  const fails = signals.filter((signal) => signal.status === "fail").length;
  const warns = signals.filter((signal) => signal.status === "warn").length;
  const specScore = Math.max(0, 100 - fails * 15 - warns * 4);
  const qualityScore = gate.quality.score;
  const score = Math.round(qualityScore * 0.6 + specScore * 0.4);
  const qualityFail = gate.quality.categories.some((category) => category.status === "fail") || qualityScore < gate.quality.passScore;
  const hasP0 = targets.some((t) => P0_CODES.has(t.code));
  const hasP1 = targets.some((t) => t.priority === "P1");
  const status: ValidationReport["status"] = hasP0 ? "BLOCKED" : hasP1 || qualityFail || warns >= 5 ? "NEEDS_REVIEW" : "READY";
  const failingCategories = gate.quality.categories.filter((category) => category.status === "fail").map((category) => category.label);
  const summary =
    status === "READY"
      ? `발행 준비 완료 (${score}점 · 품질 ${qualityScore}점, 경고 ${warns})`
      : status === "NEEDS_REVIEW"
        ? `검토 필요 (${score}점 · 품질 ${qualityScore}/${gate.quality.passScore}점, 수리 대상 ${targets.length}건${failingCategories.length ? `, 품질 미달: ${failingCategories.join(", ")}` : ""})`
        : `발행 보류 (${score}점, ${targets.filter((t) => P0_CODES.has(t.code)).map((t) => t.reason).slice(0, 3).join(" / ")})`;
  return {
    canPublish: status !== "BLOCKED",
    status,
    score,
    quality: {
      score: qualityScore,
      passScore: gate.quality.passScore,
      categories: gate.quality.categories.map((category) => ({ key: category.key, label: category.label, score: category.score, maxScore: category.maxScore, status: category.status, notes: category.notes })),
      blockers: gate.blockers.map((blocker) => ({ code: blocker.code, tier: blocker.tier, reason: blocker.reason })),
    },
    signals,
    metrics: { totalChars, keywordMentions, keywordMentionsPer1000: Number(per1000.toFixed(2)), imageCount, aiTellScore: aiTellTotal },
    repair: { strategy: "targeted", maxAttempts: options.maxRepairAttempts ?? 2, targets },
    summary,
  };
}
