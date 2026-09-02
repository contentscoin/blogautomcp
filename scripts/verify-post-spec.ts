/**
 * Spec-first 파이프라인 회귀 검증 (API 키 없이 로컬 템플릿 경로로 실행).
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
import { buildCollageImage } from "./lib/post-spec/image-plan";
import { buildPostSpec, runSpecFirstPipeline, validateDraft, normalizeDraft } from "./lib/post-spec";
import type { ImageCandidateInput } from "./lib/post-spec";

process.env.OPENAI_API_KEY = "";
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
  assert.ok(spec.sections.length >= 8 && spec.sections.length <= 10, `쇼핑 섹션 수 ${spec.sections.length}`);
  for (const role of ["summary-glance", "key-facts", "faq", "fit-checklist", "product-reveal"]) {
    assert.ok(spec.sections.some((section) => section.role === role), `쇼핑 구성표에 ${role} 필요`);
  }
  assert.ok(spec.imagePlan.resolvedBody >= 4, `본문 이미지 ${spec.imagePlan.resolvedBody}장`);
  assert.equal(spec.imagePlan.shortfall, 0);
  assert.ok(spec.imagePlan.slots.every((slot) => fs.existsSync(slot.path)), "슬롯 경로는 생성 전에 확정되어야 함");
  assert.ok(spec.imagePlan.slots.some((slot) => slot.path.includes("_detail_crop_")), "상세 크롭이 본문 후보로 채택되어야 함");
  assert.ok(!spec.imagePlan.slots.some((slot) => slot.path.includes("tiny") || slot.path.includes("wide_banner")), "작은/배너 이미지는 제외");
  const imageSections = spec.sections.filter((section) => section.imageSlotIds.length > 0);
  assert.ok(imageSections.length >= 4, "이미지가 붙은 섹션이 4개 이상");
  assert.equal(spec.sections[0].imageSlotIds.length, 0, "요약 섹션 앞에는 hero 만 온다");

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
  assert.notEqual(shopping.validation.status, "BLOCKED", shopping.validation.summary);
  assert.ok(shopping.uploadImagePaths[0] === shopping.heroImagePath, "업로드 첫 장은 hero");
  assert.ok(shopping.uploadImagePaths.length >= 5);
  assert.ok(!shopping.hashtags.some((tag) => ["추천", "후기", "일상", "쇼핑"].includes(tag)), `일반 태그 금지: ${shopping.hashtags.join(",")}`);
  const fitSection = shopping.sections.find((section) => section.startsWith("이런 분께 잘 맞아요"));
  assert.ok(fitSection && fitSection.includes("판매 페이지 정보 기준"), "추천 섹션 끝에 근거 라인");
  const faqSection = shopping.sections.find((section) => section.startsWith("자주 묻는 질문")) || "";
  assert.equal((faqSection.match(/^Q\./gmu) || []).length, 3, "FAQ 3문답");
  assert.equal((faqSection.match(/^A\./gmu) || []).length, 3);
  const shoppingBody = shopping.sections.join("\n");
  assert.doesNotMatch(shoppingBody, /써봤|받아봤|직접 사용/u, "체험 단정 금지");
  assert.doesNotMatch(shoppingBody, /https?:\/\//u, "본문 URL 금지");

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
  assert.ok(travel.sections.at(-1)?.includes("여행 커넥트"));
  assert.notEqual(travel.validation.status, "BLOCKED", travel.validation.summary);
  const daySections = travel.spec.sections.filter((section) => section.role === "day-course");
  assert.ok(daySections.every((section) => section.imageSlotIds.length >= 1), "코스 포인트 섹션마다 이미지 1장 이상");
  assert.equal(travel.spec.generation.mode, "chunked");
  assert.equal(travel.spec.generation.chunks.length, 2);

  // --- 콜라주 ---
  const collage = await buildCollageImage([candidates[1].path, candidates[2].path, candidates[3].path], path.join(dir, "collage.jpg"));
  assert.ok(collage && fs.existsSync(collage));
  const meta = await sharp(collage!).metadata();
  assert.equal(meta.width, 1080);
  assert.equal(meta.height, 1080);

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
