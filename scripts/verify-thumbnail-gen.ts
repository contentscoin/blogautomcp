/**
 * gpt-image 썸네일 파이프라인 회귀 검증 (API 호출 없음 — 생성기/QC 를 주입).
 *   - 프롬프트: 1:1 레이아웃, 정확한 한글 문구, 무드 장면, 금지 항목
 *   - QC 배점: §10 100점, 자동 탈락, 95점 컷
 *   - 교정 프롬프트: 실패 코드 → §11 지시
 *   - 루프: 불합격 → 교정 재생성 → 통과 / 전부 실패 → null / 생성 실패 → 중단
 *   - 옵트인 E2E: THUMBNAIL_GEN_E2E=1 + OPENAI_API_KEY 가 있을 때만 실제 1장 생성
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import {
  buildCorrectivePrompt,
  buildShoppingThumbnailPrompt,
  buildTravelThumbnailPrompt,
  buildThumbnailPrompt,
  condenseHeadline,
  correctionsFor,
  generateThumbnailWithQc,
  listThumbnailMoods,
  scoreQcReport,
  type ThumbnailQcReport,
} from "./lib/thumbnail-gen";
import { extractTravelProductFacts } from "./lib/travel-content";

const copy = { productNameLabel: "해피달링 워터탭 아기비데", headline: "온수 비데 이거면 끝", subline: "온수·물살 3단계", badge: "구매 체크", cta: "장단점 보기" };

// --- 프롬프트 ---
const shoppingPrompt = buildShoppingThumbnailPrompt({ productName: "해피달링 시그니처 워터탭 아기비데 온수형", copy, moodId: "studio-clean", features: ["온수 조절"] });
assert.ok(shoppingPrompt.includes("1:1 square"), "정사각 레이아웃 지시");
assert.ok(shoppingPrompt.includes(`"${copy.headline}"`), "헤드라인 정확 문자열");
assert.ok(shoppingPrompt.includes(`"${copy.productNameLabel}"`), "제품명 라벨");
assert.ok(shoppingPrompt.includes("bright studio"), "무드 장면 반영");
assert.ok(shoppingPrompt.includes("safe zone 10%"), "세이프존");
assert.ok(shoppingPrompt.includes("No misspelled Korean"), "한글 오탈자 금지");
const autoPrompt = buildShoppingThumbnailPrompt({ productName: "무선 청소기 초경량", copy, moodId: "auto" });
assert.ok(/cleaning scene/i.test(autoPrompt), "auto 무드는 카테고리 장면");

const travelFacts = extractTravelProductFacts("[출발확정] 대만 3박4일 <노쇼핑/야류/지우펀/스펀>");
const travelPrompt = buildTravelThumbnailPrompt({ productName: "대만 3박4일", facts: travelFacts, copy: { ...copy, headline: "대만 3박4일 이 가격에" }, moodId: "golden-hour", hasReferenceImage: true });
assert.ok(travelPrompt.includes("golden hour"), "여행 무드");
assert.ok(travelPrompt.includes("지우펀") || travelPrompt.includes("야류"), "하이라이트 반영");
assert.ok(travelPrompt.includes("attached travel photo"), "참조 사진 지시");
assert.equal(listThumbnailMoods("TRAVEL").length >= 3, true);
assert.equal(listThumbnailMoods("SHOPPING")[0].id, "auto");

// --- 헤드라인 압축 ---
assert.equal(condenseHeadline("온수 비데 이거면 끝"), "온수 비데 이거면 끝");
assert.ok(condenseHeadline("정말 길고 긴 헤드라인 문구를 넣어보는 경우입니다").length <= 12);
const built = buildThumbnailPrompt({ kind: "SHOPPING", productName: "테스트 상품", copy: { ...copy, headline: "아주 아주 긴 헤드라인은 잘라서 넣습니다 정말로" }, outputDir: os.tmpdir() });
assert.ok(!built.includes("아주 아주 긴 헤드라인은 잘라서 넣습니다 정말로"), "긴 헤드라인은 압축");

// --- QC 배점 ---
const perfect = scoreQcReport({ breakdown: { productName: 25, fidelity: 20, korean: 15, readability: 15, photoreal: 15, layout: 5, forbidden: 5 }, failures: [], note: "ok" });
assert.equal(perfect.score, 100);
assert.equal(perfect.pass, true);
const nearMiss = scoreQcReport({ breakdown: { productName: 25, fidelity: 20, korean: 15, readability: 12, photoreal: 15, layout: 3, forbidden: 5 }, failures: [] });
assert.equal(nearMiss.score, 95);
assert.equal(nearMiss.pass, true, "95점은 통과");
const under = scoreQcReport({ breakdown: { productName: 25, fidelity: 20, korean: 15, readability: 10, photoreal: 15, layout: 4, forbidden: 5 }, failures: ["lowContrast"] });
assert.equal(under.pass, false, "94점은 불합격");
const typo = scoreQcReport({ breakdown: { productName: 25, fidelity: 20, korean: 15, readability: 15, photoreal: 15, layout: 5, forbidden: 5 }, failures: ["koreanTypo"] });
assert.equal(typo.pass, false, "오탈자는 점수와 무관하게 자동 탈락");
assert.equal(typo.autoFail, true);
const clamped = scoreQcReport({ breakdown: { productName: 99, fidelity: -3 }, failures: ["unknownCode", "textCut"] });
assert.equal(clamped.breakdown.productName, 25);
assert.equal(clamped.breakdown.fidelity, 0);
assert.deepEqual(clamped.failures, ["unknownCode", "textCut"].filter((c) => c === "textCut" || c === "unknownCode"));

// --- 교정 프롬프트 ---
const corrections = correctionsFor(typo);
assert.ok(corrections.some((line) => /exactly copied/.test(line)), "오탈자 교정 지시");
const corrected = buildCorrectivePrompt("BASE", typo, 2);
assert.ok(corrected.startsWith("BASE") && corrected.includes("attempt 2"));
const weak = scoreQcReport({ breakdown: { productName: 25, fidelity: 20, korean: 15, readability: 6, photoreal: 15, layout: 5, forbidden: 5 }, failures: [] });
assert.ok(correctionsFor(weak).some((line) => /contrast|larger/i.test(line)), "코드 없이 점수 미달이면 가장 약한 항목 교정");

// --- 루프 (주입) ---
async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thumbnail-gen-"));
  const makeImage = async (name: string) => {
    const file = path.join(dir, name);
    await sharp({ create: { width: 64, height: 64, channels: 3, background: "#ccc" } }).png().toFile(file);
    return file;
  };
  const reports: ThumbnailQcReport[] = [typo, under, perfect];
  const prompts: string[] = [];
  const passed = await generateThumbnailWithQc({
    prompt: "BASE",
    outputDir: dir,
    fileLabel: "t",
    expected: { kind: "SHOPPING", productName: "x", headline: "y" },
    maxAttempts: 4,
    deps: {
      generate: async (prompt, attempt) => {
        prompts.push(prompt);
        return makeImage(`attempt-${attempt}.png`);
      },
      qc: async (_path, attempt) => reports[attempt - 1],
    },
  });
  assert.ok(passed, "3번째 시도에서 통과");
  assert.equal(passed!.attempts, 3);
  assert.equal(passed!.qc.score, 100);
  assert.equal(prompts.length, 3);
  assert.ok(prompts[1].includes("exactly copied"), "2번째 프롬프트에 오탈자 교정");
  assert.ok(prompts[2].includes("attempt 3"), "3번째 프롬프트는 원본 + 직전 실패 교정");
  assert.ok(fs.existsSync(path.join(dir, "attempt-3.qc.json")), "통과본 옆에 qc.json");

  const failed = await generateThumbnailWithQc({
    prompt: "BASE",
    outputDir: dir,
    fileLabel: "t",
    expected: { kind: "SHOPPING", productName: "x", headline: "y" },
    maxAttempts: 2,
    deps: { generate: async (_p, attempt) => makeImage(`fail-${attempt}.png`), qc: async () => typo },
  });
  assert.equal(failed, null, "전부 불합격이면 null (로컬 폴백으로 강등)");

  let calls = 0;
  const aborted = await generateThumbnailWithQc({
    prompt: "BASE",
    outputDir: dir,
    fileLabel: "t",
    expected: { kind: "SHOPPING", productName: "x", headline: "y" },
    maxAttempts: 4,
    deps: { generate: async () => { calls += 1; return null; }, qc: async () => perfect },
  });
  assert.equal(aborted, null);
  assert.equal(calls, 1, "생성 자체가 실패하면 반복하지 않는다");

  let uncheckedCalls = 0;
  const unchecked = await generateThumbnailWithQc({
    prompt: "BASE", outputDir: dir, fileLabel: "unchecked",
    expected: { kind: "SHOPPING", productName: "x", headline: "y" }, maxAttempts: 4,
    deps: {
      generate: async () => { uncheckedCalls += 1; return makeImage("unchecked.png"); },
      qc: async () => ({ ...perfect, checked: false, pass: true, note: "legacy skip" }),
    },
  });
  assert.equal(unchecked, null, "unchecked is never an approved image, even with a legacy pass flag");
  assert.equal(uncheckedCalls, 1, "an unavailable judge must not trigger paid regeneration loops");

  if (process.env.THUMBNAIL_GEN_E2E === "1" && process.env.OPENAI_API_KEY) {
    const { generateThumbnail } = await import("./lib/thumbnail-gen");
    const reference = await makeImage("reference.png");
    const real = await generateThumbnail({ kind: "SHOPPING", productName: "테스트 텀블러", copy: { ...copy, productNameLabel: "테스트 텀블러", headline: "보온 텀블러 체크" }, referenceImagePath: reference, outputDir: dir, maxAttempts: 2 });
    assert.ok(real, "E2E: gpt-image 생성 + QC 통과");
    const meta = await sharp(real!.path).metadata();
    assert.equal(meta.width, 1024);
    assert.equal(meta.height, 1024);
    console.log(JSON.stringify({ e2e: true, score: real!.qc.score, attempts: real!.attempts }));
  }

  console.log(JSON.stringify({ ok: true, loopPassAttempts: passed!.attempts, moods: listThumbnailMoods("SHOPPING").map((m) => m.id) }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
