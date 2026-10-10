/**
 * Spec-first 파이프라인 회귀 검증 (주입된 로컬 픽스처로 실행).
 *   - 이미지 풀 → 섹션 수 파생 → 슬롯 경로 확정
 *   - 쇼핑/여행 구성표(GEO 블록 포함)
 *   - 검증기가 망가진 초안에서 정확한 섹션 타깃을 잡는지
 *   - 조립 결과의 해시태그 금지어·근거 라인·업로드 순서
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { buildPostSpec, runSpecFirstPipeline, validateDraft, normalizeDraft, shortProductName } from "./lib/post-spec";
import type { ImageCandidateInput } from "./lib/post-spec";
import { assessTravelFeatureCoverage } from "./lib/travel-content";
import { sourceFeaturesForValidation } from "./lib/post-spec/validate";
import { getConnectAffiliateDisclosure } from "../src/lib/connect-disclosure";
import { hasCanonicalAffiliateDisclosure, resolvePostDocument } from "../src/lib/post-composition-contract";
import { renderTitleRules } from "./lib/post-spec/generate";
import { buildLocalTitle } from "./lib/post-spec/local-template";
import { buildDraftJsonSchema } from "./lib/post-spec/schema";
import type { OpenCrabSeoBrief } from "./lib/opencrab-seo-brief";

process.env.UNSPLASH_ACCESS_KEY = "";

async function makeImage(dir: string, name: string, width: number, height: number, color: string): Promise<string> {
  const file = path.join(dir, name);
  await sharp({ create: { width, height, channels: 3, background: color } }).jpeg({ quality: 80 }).toFile(file);
  return file;
}

async function fixtures(dir: string): Promise<ImageCandidateInput[]> {
  const hero = await makeImage(dir, "hero.jpg", 900, 900, "#dde3ea");
  const sources = await Promise.all([1, 2, 3, 4, 5].map((n) => makeImage(dir, `source_${n}.jpg`, 800 + n * 10, 800, "#c8d6e5")));
  const crop = await makeImage(dir, `product_detail_crop_1.jpg`, 700, 700, "#a5b1c2");
  const wide = await makeImage(dir, "wide_banner.jpg", 1600, 500, "#8395a7");
  const tiny = await makeImage(dir, "tiny.jpg", 200, 200, "#576574");
  return [
    { path: hero, kind: "hero", score: 1000 },
    ...sources.map((p, index) => ({ path: p, kind: "source" as const, score: 500 - index })),
    { path: crop, kind: "crop", score: 300 },
    { path: wide, kind: "source", score: 100 },
    { path: tiny, kind: "source", score: 50 },
  ];
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "post-spec-"));
  const candidates = await fixtures(dir);

  // --- 쇼핑 ---
  const shoppingInput = {
    kind: "SHOPPING" as const,
    productId: null,
    product: {
      name: "해피달링 시그니처 워터탭 아기비데 온수형",
      description: "온수 조절과 물살 3단계를 지원하는 아기 비데",
      features: ["온수 조절", "물살 3단계", "분리 세척 노즐"],
      price: "89,000원",
      deliveryInfo: "무료배송",
      reviewCount: "1,240",
      rating: "4.8",
    },
    brief: null,
    imageCandidates: candidates,
    tempDir: dir,
    brandLink: "https://naver.me/example",
    options: { forceLocal: true, quotationHeaders: false },
  };
  const { spec } = await buildPostSpec(shoppingInput);
  assert.equal(spec.disclosure, getConnectAffiliateDisclosure("SHOPPING"));
  assert.ok(spec.sections.length >= 8 && spec.sections.length <= 10, `쇼핑 섹션 수 ${spec.sections.length}`);
  for (const role of ["summary-glance", "key-facts", "faq", "fit-checklist", "product-reveal"]) {
    assert.ok(spec.sections.some((section) => section.role === role), `쇼핑 구성표에 ${role} 필요`);
  }
  assert.equal(spec.imagePlan.resolvedBody, 1, "원본은 한 장만 확보하고 AI 연출 3장은 생성·검수까지 미완료로 둔다");
  assert.equal(spec.imagePlan.shortfall, 3);
  assert.ok(spec.imagePlan.slots.every((slot) => fs.existsSync(slot.path)), "슬롯 경로는 생성 전에 확정되어야 함");
  assert.ok(!spec.imagePlan.slots.some((slot) => slot.path.includes("_detail_crop_")), "사양표 크롭은 본문 자연사진을 대체하지 못한다");
  assert.ok(!spec.imagePlan.slots.some((slot) => slot.path.includes("tiny") || slot.path.includes("wide_banner")), "작은/배너 이미지는 제외");
  const imageSections = spec.sections.filter((section) => section.imageSlotIds.length > 0);
  assert.equal(imageSections.length, 1, "원본 반복으로 빈 연출 슬롯을 채우지 않는다");
  assert.equal(spec.sections[0].imageSlotIds.length, 1, "첫 섹션은 원본 상품 사진");

  // --- 섹션별 근거표: 본문 섹션마다 전용 근거 1개 이상, 전용 근거는 한 섹션에만 ---
  assert.equal(spec.evidenceLedger.length, spec.sections.length, "근거표는 섹션 수와 같아야 함");
  const exclusiveSeen = new Map<string, number>();
  for (const entry of spec.evidenceLedger) {
    for (const line of entry.exclusive) {
      assert.ok(!exclusiveSeen.has(line), `전용 근거 "${line}"가 섹션 ${exclusiveSeen.get(line)}와 ${entry.sectionIndex}에 중복 배정됨`);
      exclusiveSeen.set(line, entry.sectionIndex);
    }
  }
  for (const section of spec.sections) {
    if (section.shape === "prose" || section.shape === "qa-3" || section.shape === "checklist") {
      assert.ok(section.mustUseEvidence.length >= 1, `${section.title}(${section.role}) 섹션에 전용 근거가 없음`);
    }
    for (const line of section.mustUseEvidence) assert.ok(section.evidence.includes(line), "전용 근거는 사용 가능 근거에도 포함");
  }
  assert.ok(spec.sections.some((section) => section.mustUseEvidence.some((line) => /물살 3단계|온수 조절|분리 세척 노즐/u.test(line))), "상세 근거 줄이 전용 근거로 배정되어야 함(특징 접두사 버그 회귀)");

  const shopping = await runSpecFirstPipeline(shoppingInput);
  assert.equal(shopping.generationSource, "local-template");
  assert.equal(shopping.sections.length, spec.sections.length + 1, "마지막은 고지 섹션");
  assert.equal(shopping.composition.sections.length, spec.sections.length);
  assert.ok(shopping.sections.at(-1)?.includes("쇼핑 커넥트"));
  assert.equal(shopping.sections.at(-1), getConnectAffiliateDisclosure("SHOPPING"));
  assert.equal(shopping.validation.status, "BLOCKED", "연출 사진이 생성되지 않았으므로 글 생성만으로 발행 가능해지지 않는다");
  assert.ok(shopping.uploadImagePaths[0] === shopping.heroImagePath, "업로드 첫 장은 hero");
  assert.equal(new Set(shopping.uploadImagePaths).size, 1);
  assert.ok(!shopping.hashtags.some((tag) => ["추천", "후기", "일상", "쇼핑"].includes(tag)), `일반 태그 금지: ${shopping.hashtags.join(",")}`);
  const fitSection = shopping.sections.find((section) => section.startsWith("이런 분께 잘 맞아요"));
  assert.ok(fitSection && fitSection.includes("판매 페이지 정보 기준"), "추천 섹션 끝에 근거 라인");
  const faqSection = shopping.sections.find((section) => section.startsWith("자주 묻는 질문")) || "";
  assert.equal((faqSection.match(/^Q\./gmu) || []).length, 3, "FAQ 3문답");
  assert.equal((faqSection.match(/^A\./gmu) || []).length, 3);
  const shoppingBody = shopping.sections.join("\n");
  assert.doesNotMatch(shoppingBody, /써봤|받아봤|직접 사용/u, "체험 단정 금지");
  assert.doesNotMatch(shoppingBody, /https?:\/\//u, "본문 URL 금지");

  // Title planning is source-grounded and advisory on length/exact placement.
  // These local fixtures do not call a model or manufacture search-demand data.
  const staleBrief: OpenCrabSeoBrief = { source: "opencrab-local-pack", packName: "offline", workflowName: "offline",
    workflowVersion: null, packVersion: null, sourceDate: "2026-10-11", sourcePath: null, productId: null,
    anchor: null, evidenceNote: [], guardRule: null, guardStatus: null, confidence: 1, matchType: "category",
    matchedProductName: "다른 상품", categoryLabel: "무선이어폰", searchQueries: [shoppingInput.product.name, "무선이어폰 배터리"],
    competitors: [], titleCandidates: [], recommendedSectionTitles: [], mediaTargetImageCount: 4,
    thumbnailGuidance: [], writingGuidance: [], qaChecklist: [], hashtags: [],
  };
  const groundedSpec = (await buildPostSpec({ ...shoppingInput, brief: staleBrief })).spec;
  assert.notEqual(groundedSpec.seo.primaryKeyword, shoppingInput.product.name, "the entire first search query is not the primary keyword");
  assert.match(groundedSpec.seo.primaryKeyword, /비데/u);
  assert.doesNotMatch(groundedSpec.seo.primaryKeyword, /이어폰/u, "a stale brief cannot change the selected product category");
  assert.match(shortProductName("[샥즈] 오픈스윔 골전도 이어폰 [특가 20%]"), /^\[샥즈\]/u,
    "short product identity retains an actual short bracketed brand");
  assert.doesNotMatch(shortProductName("[샥즈] 오픈스윔 골전도 이어폰 [특가 20%]"), /특가|20%/u);
  assert.deepEqual(groundedSpec.seo.title, spec.seo.title, "existing numeric API targets remain unchanged");
  const titleRules = renderTitleRules(groundedSpec);
  assert.match(titleRules, /25~35자는 권장 범위/u);
  assert.match(titleRules, /나열이나 절단은 하지/u);
  assert.match(titleRules, /3개/u);
  assert.doesNotMatch(titleRules, /제목에 반드시 포함/u);
  const requestedRules = renderTitleRules(groundedSpec, { memo: '제목은 정확히 "해피달링 아기비데"로 작성.' });
  assert.match(requestedRules, /공백·문장부호까지 그대로/u);
  assert.match(requestedRules, /후보 선택이나 SEO 권장값으로 변경하지/u);
  const outputSchema = buildDraftJsonSchema(groundedSpec, [0], true);
  assert.deepEqual(Object.keys(outputSchema.properties).sort(), ["hashtags", "sections", "title"],
    "title candidate planning does not add JSON output fields");
  const titleOnlySpec = { ...spec, seo: { ...spec.seo, primaryKeyword: `${shoppingInput.product.name} 구매 선택 정보` } };
  const titleOptions = { brandLink: shoppingInput.brandLink, hasRepresentativeImage: true,
    requireRepresentativeImage: true, thumbnailGenerated: true };
  for (const title of ["아기비데 온수, 꼭 필요할까?", "온수로 돌볼 때 따져볼 질문, 해피달링 아기비데"]) {
    const report = validateDraft(titleOnlySpec, { ...shopping.draft, title }, titleOptions);
    assert.ok(!report.repair.targets.some(target => ["TITLE_LENGTH", "TITLE_KEYWORD", "TITLE_PRODUCT_TOKEN"].includes(target.code)),
      `a recognizable natural title is not rewritten for length or exact full keyword: ${title}`);
    assert.equal(report.signals.find(signal => signal.key === "title-keyword-first")?.status, "warn");
  }
  for (const title of ["해피달링 아기비데, 후기만 보고 골라도 될까?", "해피달링 아기비데, 내돈내산 후기 없이 사양 확인하기"]) {
    const report = validateDraft(spec, { ...shopping.draft, title }, titleOptions);
    assert.ok(!report.repair.targets.some(target => target.code === "FORBIDDEN_CLAIM" && target.sectionIndex === null),
      `a question/denial about reviews does not assert experience: ${title}`);
  }
  const offProductTitle = validateDraft(spec, { ...shopping.draft, title: "무선이어폰 배터리와 연결을 고르는 질문" }, titleOptions);
  assert.ok(offProductTitle.repair.targets.some(target => target.code === "TITLE_PRODUCT_TOKEN" && target.priority === "P0"));
  const fakeExperienceTitle = validateDraft(spec, { ...shopping.draft, title: "해피달링 아기비데 직접 써본 후기" }, titleOptions);
  assert.ok(fakeExperienceTitle.repair.targets.some(target => target.code === "FORBIDDEN_CLAIM" && target.sectionIndex === null));
  assert.equal(fakeExperienceTitle.repair.targets.filter(target => target.sectionIndex === null && (target.code.startsWith("TITLE_") || target.code === "FORBIDDEN_CLAIM")).length, 1,
    "shared title truth checks do not duplicate the existing experience repair target");
  const exaggeratedTitle = validateDraft(spec, { ...shopping.draft, title: "해피달링 아기비데 역대급 완벽 가이드" }, titleOptions);
  assert.ok(exaggeratedTitle.repair.targets.some(target => target.code === "TITLE_CLEAN"));
  for (const title of ["삼성 해피달링 아기비데", "해피달링 아기비데 S99", "해피달링 아기비데 999ml"]) {
    const report = validateDraft({ ...spec, brief: staleBrief }, { ...shopping.draft, title }, titleOptions);
    assert.equal(report.signals.find(signal => signal.key === "title-content")?.status, "fail", title);
    assert.ok(report.repair.targets.some(target => target.code === "TITLE_CONTENT" && target.priority === "P1"), title);
    assert.equal(report.canPublish, false, "other brands/models and unsupported numeric specs cannot pass a structured draft");
  }
  const sourcedNumericTitle = validateDraft({ ...spec, facts: { ...spec.facts, lines: [...spec.facts.lines, "세척 물 용량: 500ml"] } },
    { ...shopping.draft, title: "해피달링 아기비데 500ml, 세척 전에 볼 점" }, titleOptions);
  assert.equal(sourcedNumericTitle.signals.find(signal => signal.key === "title-content")?.status, "pass");
  const bodyNumericTitle = validateDraft(spec, { ...shopping.draft, title: "해피달링 아기비데 500ml, 세척 전에 볼 점",
    sections: shopping.draft.sections.map((section, index) => index ? section : { ...section, lines: [...section.lines, "세척 물 용량은 500ml입니다."] }),
  }, titleOptions);
  assert.equal(bodyNumericTitle.signals.find(signal => signal.key === "title-content")?.status, "fail",
    "generated body text cannot authorize a numerical fact absent from canonical source facts");
  assert.ok(buildLocalTitle({ ...spec, seo: { ...spec.seo, title: { ...spec.seo.title, maxChars: 6 } } }, "해피달링").length > 6,
    "local fallback titles are never mechanically sliced to the preferred maximum");
  const explicitShortTitle = await runSpecFirstPipeline({ ...shoppingInput, memo: '제목은 정확히 "해피달링 아기비데"로 작성.' });
  assert.equal(explicitShortTitle.title, "해피달링 아기비데", "local generation retains exact requested short titles");
  const explicitFalseTitle = await runSpecFirstPipeline({ ...shoppingInput, memo: '제목은 정확히 "해피달링 아기비데 직접 써본 후기"로 작성.' });
  assert.equal(explicitFalseTitle.title, "해피달링 아기비데 직접 써본 후기", "an unsafe explicit title is not silently rewritten");
  assert.equal(explicitFalseTitle.validation.status, "BLOCKED");
  assert.ok(explicitFalseTitle.validation.repair.targets.some(target => target.code === "FORBIDDEN_CLAIM"));
  const explicitWrongModelTitle = await runSpecFirstPipeline({ ...shoppingInput, memo: '제목은 정확히 "해피달링 아기비데 S99"로 작성.' });
  assert.equal(explicitWrongModelTitle.title, "해피달링 아기비데 S99", "a requested title still has exact precedence over repair");
  assert.equal(explicitWrongModelTitle.validation.canPublish, false);
  assert.ok(explicitWrongModelTitle.validation.repair.targets.some(target => target.code === "TITLE_CONTENT"));

  // --- 검증기: 망가진 초안에서 섹션 타깃 ---
  const broken = normalizeDraft(spec, shopping.draft);
  broken.sections[2].lines = [...broken.sections[2].lines, "제가 직접 써봤더니 정말 좋았어요."];
  broken.sections[4].lines = [...broken.sections[4].lines, "자세한 내용은 https://naver.me/abc 에서 보세요."];
  broken.title = "완벽 가이드 총정리 " + broken.title + " 역대급 꿀팁 Zip 모음집 완전정복편";
  const report = validateDraft(spec, broken, { brandLink: "https://naver.me/example", hasRepresentativeImage: true, requireRepresentativeImage: true, thumbnailGenerated: true });
  assert.equal(report.status, "BLOCKED");
  assert.ok(report.repair.targets.some((t) => t.code === "FORBIDDEN_CLAIM" && t.sectionIndex === 2), "체험 단정 섹션 2 타깃");
  assert.ok(report.repair.targets.some((t) => t.code === "RAW_LINK" && t.sectionIndex === 4), "URL 섹션 4 타깃");
  assert.ok(report.repair.targets.some((t) => t.sectionIndex === null && t.code.startsWith("TITLE_")), "제목 타깃");
  assert.ok(report.signals.length >= 20, "모든 신호를 계산해야 함(early-return 금지)");
  assert.ok(report.quality && typeof report.quality.score === "number" && report.quality.categories.length === 6, "검증 보고서는 품질 카테고리를 담아야 함");
  assert.ok(report.quality.blockers.length === 0 || report.quality.blockers.every((b) => b.tier === "safety" || b.tier === "structure"));

  // --- 검증기: 근거를 안 쓴 일반론 섹션 / 숫자만 바뀐 반복 문장 ---
  const generic = normalizeDraft(spec, shopping.draft);
  const benefitIndex = spec.sections.find((section) => section.role === "benefit")!.index;
  const useCaseIndex = spec.sections.find((section) => section.role === "use-case")!.index;
  generic.sections[benefitIndex].lines = [
    "사용 환경에 따라 체감이 달라질 수 있어요.",
    "구매 전에 상세 설명을 한 번 더 확인해보세요.",
    "옵션은 주문 화면에서 살펴보는 게 좋아요.",
    "상황에 따라 다른 제품이 맞을 수도 있어요.",
  ];
  generic.sections[useCaseIndex].lines = generic.sections[benefitIndex].lines.map((line, index) => `${line.slice(0, -1)} ${index + 1}.`);
  const genericReport = validateDraft(spec, generic, { brandLink: "https://naver.me/example", hasRepresentativeImage: true, requireRepresentativeImage: true, thumbnailGenerated: true });
  assert.ok(genericReport.repair.targets.some((t) => t.code === "EVIDENCE_UNUSED" && t.sectionIndex === benefitIndex), "전용 근거를 쓰지 않은 섹션은 수리 타깃");
  assert.ok(genericReport.repair.targets.some((t) => t.code === "GENERIC_GUIDANCE" && t.sectionIndex === benefitIndex), "확인 안내·일반론으로 채운 섹션은 수리 타깃");
  assert.ok(genericReport.repair.targets.some((t) => t.code === "REPEATED_LINE" && t.sectionIndex === useCaseIndex), "숫자만 바뀐 반복 문장은 REPEATED_LINE 타깃");
  assert.notEqual(genericReport.status, "READY", "일반론·반복 초안은 READY 가 될 수 없음");
  assert.ok(genericReport.score <= shopping.validation.score, "품질이 나빠지면 점수도 내려가야 함");

  // --- 검증기: 카테고리 혼입은 하드 차단(P0) ---
  const mixed = normalizeDraft(spec, shopping.draft);
  mixed.sections[benefitIndex].lines = [...mixed.sections[benefitIndex].lines, "구성품 확인 후 배송 조건과 교환 규정을 살펴보세요."];
  const mixedReport = validateDraft({ ...spec, connectKind: "TRAVEL" }, mixed, { brandLink: "https://naver.me/example", hasRepresentativeImage: true, requireRepresentativeImage: true, thumbnailGenerated: true });
  assert.equal(mixedReport.status, "BLOCKED", "여행 글에 쇼핑 문구가 섞이면 차단");
  assert.ok(mixedReport.repair.targets.some((t) => t.code === "CATEGORY_MISMATCH" && t.sectionIndex === benefitIndex));

  // --- 여행 ---
  const travelInput = {
    kind: "TRAVEL" as const,
    productId: null,
    product: {
      name: "[출발확정/여행핫딜] 스위스/이탈리아 2국 9일 <노쇼핑/융프라우/루체른/관광열차/피사/폼페이/콜로세움내부>",
      description: "",
      features: [],
      price: "3,149,000원",
    },
    brief: null,
    imageCandidates: candidates,
    tempDir: dir,
    brandLink: "https://naver.me/travel",
    options: { forceLocal: true },
  };
  const travel = await runSpecFirstPipeline(travelInput);
  const turkey = await buildPostSpec({ ...travelInput, product: { ...travelInput.product,
    name: "월드체인 튀르키예 9일 <이스탄불/카파도키아>", description: "튀르키예 여행 상품", features: [],
  } });
  assert.equal(turkey.spec.seo.primaryKeyword, "튀르키예 패키지", "a source-present country precedes the retailer token");
  assert.doesNotMatch(buildLocalTitle(turkey.spec, turkey.shortName), /^월드체인/u,
    "a retailer token does not become the title's destination");
  assert.equal(travel.spec.disclosure, getConnectAffiliateDisclosure("TRAVEL"));
  assert.equal(travel.sections.at(-1), getConnectAffiliateDisclosure("TRAVEL"));
  for (const [connectKind, assembled, brandLink] of [["SHOPPING", shopping, shoppingInput.brandLink], ["TRAVEL", travel, travelInput.brandLink]] as const) {
    const document = resolvePostDocument({ connectKind, title: assembled.title, sections: assembled.sections,
      hashtags: assembled.hashtags, imagePaths: assembled.uploadImagePaths,
      sectionImagePaths: assembled.composition.sections.map(section => section.imagePaths),
      sectionPlan: assembled.sectionPlan, connectUrl: brandLink });
    assert.ok(hasCanonicalAffiliateDisclosure(document), `${connectKind} Spec-first publishes its clear notice first`);
    assert.deepEqual(document.renderNodes.filter(node => node.kind === "image").map(node => node.assetPath),
      assembled.uploadImagePaths, "Moving the notice must not shuffle the assigned photographs");
  }
  const travelTitles = travel.spec.sections.map((section) => section.title);
  assert.ok(travel.spec.sections.length >= 10 && travel.spec.sections.length <= 12, `여행 섹션 수 ${travel.spec.sections.length}`);
  assert.match(travelTitles[0], /결론부터/u);
  assert.ok(travelTitles.includes("상품 한눈에 보기"));
  assert.ok(travelTitles.some((title) => title.includes("코스 포인트 1 · 융프라우")), travelTitles.join(" | "));
  assert.ok(travelTitles.includes("가격, 포함과 불포함"));
  assert.ok(travelTitles.includes("예약 전 체크리스트"));
  assert.equal(travelTitles.at(-1), "마무리");
  assert.equal(new Set(travelTitles).size, travelTitles.length, "여행 소제목 중복 금지");
  const travelBody = travel.sections.join("\n");
  assert.doesNotMatch(travelBody, /배송|교환|반품|구성품/u, "쇼핑 문구 금지");
  assert.doesNotMatch(travelBody, /다녀왔|먹어봤|묵어봤/u, "체험 단정 금지");
  assert.equal(
    travel.validation.repair.targets.some((target) => target.code === "REPEATED_LINE"),
    false,
    "코스별 폴백 문장이 같은 뜻으로 반복되면 안 됩니다.",
  );
  assert.ok(travel.sections.at(-1)?.includes("여행 커넥트"));
  assert.notEqual(travel.validation.status, "BLOCKED", travel.validation.summary);
  const daySections = travel.spec.sections.filter((section) => section.role === "day-course");
  assert.ok(daySections.every((section) => section.imageSlotIds.length >= 1), "코스 포인트 섹션마다 이미지 1장 이상");
  assert.equal(travel.spec.generation.mode, "chunked");
  assert.equal(travel.spec.generation.chunks.length, 2);
  assert.ok(!travel.validation.repair.targets.some((t) => t.code === "REPEATED_LINE"), "코스 포인트 문장이 장소 이름만 바꾼 반복이면 안 됨");
  assert.equal(travel.validation.quality.categories.find((c) => c.key === "diversity")?.status, "pass", "문단 다양성 통과");
  // 렌더 계약 플랜은 스펙 슬롯 배정과 같아야 한다.
  assert.equal(travel.sectionPlan.length, travel.spec.sections.length);
  for (const [index, planned] of travel.sectionPlan.entries()) {
    const section = travel.spec.sections[index];
    assert.equal(planned.role, section.role);
    assert.equal(planned.imagePaths.length, section.imageSlotIds.length, `${section.title} 플랜 이미지 수`);
    assert.equal(planned.imageMin, section.imageCount?.[0]);
  }
  assert.ok(travel.sectionPlan.find((planned) => planned.role === "itinerary-overview")?.earlyConnectCard, "첫 커넥트 카드는 일정 흐름 뒤");

  // --- 여행: 같은 유형(마사지 2개)·긴 상품명·출발지 꼬리표 — 로컬 템플릿만으로 발행 게이트를 통과해야 한다 ---
  const banaInput = {
    ...travelInput,
    product: {
      name: "대한항공 노쇼핑 VVIP 풀패키지 [신축 M 호텔 다낭 3박5일] 바나힐/호이안 1일 1마사지 - 인천 오후 출발변경",
      description: "",
      // Synthetic collector fixture, not verified details of a real package.
      features: [
        "핵심 방문지: 발마사지 1시간, 호이안 야투 (소원배+소원등+야시장), 아로마 핫스톤 마사지 2시간, 바나힐 테마파크 입장권",
        "여행 기간: 5일",
        "1일차 일정: 인천 출발 → 다낭 도착",
        "2일차 일정: 바나힐 테마파크 → 발마사지 1시간",
        "3일차 일정: 호이안 야시장 → 아로마 핫스톤 마사지 2시간",
        "4일차 일정: 다낭 해변 산책 → 다낭 공항 출발",
      ],
      price: "1,011,000원",
    },
  };
  const sparseBana = await runSpecFirstPipeline({
    ...banaInput,
    product: { ...banaInput.product, features: banaInput.product.features.slice(0, 1) },
  });
  assert.notEqual(sparseBana.validation.status, "READY", "방문지 목록만 있고 일차별 일정이 없으면 발행 준비 완료가 아님");
  assert.equal(sparseBana.validation.quality.categories.find((c) => c.key === "productEvidence")?.status, "fail");
  assert.equal(assessTravelFeatureCoverage(banaInput.product.features).sufficient, true, "정상 경로 fixture는 명시적 일정 근거를 충족해야 함");
  const bana = await runSpecFirstPipeline(banaInput);
  assert.deepEqual(bana.spec.facts.travel?.destinations, ["바나힐", "호이안"], "출발지(인천)·출발 시간(오후)은 목적지가 아님");
  assert.equal(assessTravelFeatureCoverage(sourceFeaturesForValidation(bana.spec)).sufficient, true,
    `수집기 일정 근거가 스펙→검증기 전달 과정에서도 인식되어야 함: ${JSON.stringify(bana.spec.facts.lines)}`);
  assert.equal(bana.validation.status, "READY", bana.validation.summary);
  assert.ok(!bana.validation.repair.targets.some((t) => t.code === "REPEATED_LINE"), "마사지 코스 2개가 같은 문장을 쓰면 안 됨");
  for (const key of ["diversity", "specificity", "usefulness", "clarity"]) {
    assert.equal(bana.validation.quality.categories.find((c) => c.key === key)?.status, "pass", `${key} 통과`);
  }
  const banaBody = bana.sections.join("\n");
  assert.match(banaBody, /호이안 구시가지는 유네스코/u, "호이안 코스에는 널리 알려진 배경 한 줄");
  assert.doesNotMatch(banaBody, /콜로세움|포로 로마노/u, "'아로마'가 로마로 잘못 매칭되면 안 됨");
  assert.doesNotMatch(banaBody, /보여요|보입니다|것 같아요/u, "모호한 말투 금지");
  assert.ok((banaBody.match(/바나힐 패키지/gu) || []).length >= 2, "핵심 키워드가 본문에 2회 이상");
  // 실제 발행 게이트(simple-agent 가 쓰는 비-편집 모드)도 통과해야 승인 버튼이 열린다.
  const { getBrandLinkContentReadiness } = await import("./lib/brandlink-content-readiness");
  const banaComposition = resolvePostDocument({
    connectKind: "TRAVEL",
    title: bana.title,
    sections: bana.sections,
    hashtags: bana.hashtags,
    // simple-agent 와 같은 순서: [생성 썸네일, 대표 이미지, 슬롯 순서…]
    imagePaths: [path.join(dir, "generated-thumbnail.jpg"), ...bana.uploadImagePaths],
    connectUrl: "https://naver.me/travel",
    qualityPreset: "PREMIUM",
    sectionPlan: bana.sectionPlan,
  });
  assert.equal(banaComposition.qualityReport.canAutoPublish, true, banaComposition.qualityReport.blockers.join(" "));
  const courseSections = banaComposition.sections.filter((section) => section.id.startsWith("travel-day-course"));
  assert.equal(courseSections.length, 3);
  assert.ok(courseSections.every((section) => section.imagePaths.length >= 1 && section.imageMin === 1), "코스 포인트마다 이미지가 실제로 배치되고 하한이 표시된다");
  assert.ok(banaComposition.sections.every((section) => !/travel-(?:hook|route|day-1|day-2|lodging)/u.test(section.id)), "팔레트 id 를 끼워 맞추지 않는다");
  const banaGate = getBrandLinkContentReadiness({
    productName: banaInput.product.name,
    title: bana.title,
    sections: bana.sections,
    hashtags: bana.hashtags,
    brandLink: "https://naver.me/travel",
    generationSource: "AI",
    hasRepresentativeImage: true,
    requireRepresentativeImage: true,
    thumbnailGenerated: true,
    connectKind: "TRAVEL",
    experienceMode: "AI_ASSISTED_INFORMATION",
    compositionQualityReport: banaComposition.qualityReport,
    sourceDescription: "",
    sourceFeatures: banaInput.product.features,
  });
  assert.equal(banaGate.canPublish, true, `${banaGate.code}: ${banaGate.reason || banaGate.summary}`);
  assert.ok(banaGate.score >= 90, `발행 게이트 점수 ${banaGate.score}`);

  assert.ok(!fs.readdirSync(dir).some(file => file.startsWith("collage_")), "콜라주로 부족한 연출 사진을 대신하지 않는다");

  // --- 이미지 부족 시 BLOCKED (콜라주 재료도 없을 때) ---
  const scarce = await runSpecFirstPipeline({ ...shoppingInput, imageCandidates: candidates.slice(0, 2) });
  assert.equal(scarce.validation.status, "BLOCKED", "이미지 부족은 발행 보류");
  assert.ok(scarce.validation.repair.targets.some((t) => t.code === "IMAGE_SHORTFALL"));

  console.log(
    JSON.stringify(
      {
        ok: true,
        shopping: { sections: spec.sections.length, bodyImages: spec.imagePlan.resolvedBody, status: shopping.validation.status, score: shopping.validation.score, hashtags: shopping.hashtags },
        travel: { sections: travel.spec.sections.length, bodyImages: travel.spec.imagePlan.resolvedBody, status: travel.validation.status, titles: travelTitles },
        brokenTargets: report.repair.targets.map((t) => `${t.sectionIndex}:${t.code}`),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
