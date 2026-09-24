/** Offline regressions for the internalized photoreal skill (parity with the original build_prompt.py + blog wiring). */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { buildBlogPhotorealDirection, buildPhotorealPrompt, selectPhotorealScene } from "./lib/photoreal/build";
import { BLOG_SCENES, ORIGINAL_SCENES } from "./lib/photoreal/scenes";
import { buildPhotorealQcPrompt, parsePhotorealQc, photorealChecksFor, reinforcePhotorealPrompt } from "./lib/photoreal/checklist";
import { buildBrandPostImagePrompt } from "../src/lib/brand-post-image-generation";

type GoldenCase = {
  input: { subject: string; scene: string | null; situation: string; variantIndex: number; level: "light" | "standard" | "full";
    shot: "other" | "selfie"; lang: "ko" | "en"; group: number; charm: "plain" | "attractive" | "none"; ageLock: boolean };
  expected: string;
};

// 1. Byte parity with the original script (golden fixture generated from build_prompt.py @ 92cca71).
const golden = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "photoreal-build-prompt-golden.json"), "utf8")) as { cases: GoldenCase[] };
assert.ok(golden.cases.length >= 30);
for (const { input, expected } of golden.cases) {
  const actual = buildPhotorealPrompt({ ...input, scene: input.scene ?? undefined });
  assert.equal(actual, expected, `${input.scene}/${input.variantIndex}/${input.level}/${input.lang}`);
}
assert.equal(Object.keys(ORIGINAL_SCENES).length, 8, "all original scenes ported");

// 1b. Live parity when python3 is available (skips quietly otherwise).
try {
  const script = path.join(__dirname, "..", "skills", "photoreal", "scripts", "build_prompt.py");
  const live = execFileSync("python3", [script, "--subject", "20대 후반 한국인 여성", "--scene", "cafe", "--n", "2", "--lang", "ko"], { encoding: "utf8" });
  const blocks = live.split(/^--- \d+ ---$/mu).map((block) => block.trim()).filter(Boolean);
  blocks.forEach((block, index) => assert.equal(buildPhotorealPrompt({ subject: "20대 후반 한국인 여성", scene: "cafe", variantIndex: index }), block));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

// 2. People-free blog cuts use L1-L3 only: no gaze, anatomy, age or face-beauty sentences.
for (const scene of Object.keys(BLOG_SCENES)) {
  for (let index = 0; index < 4; index += 1) {
    const prompt = buildPhotorealPrompt({ subject: "빈 선반", scene, variantIndex: index, level: "full" });
    assert.match(prompt, /스마트폰으로 찍은 자연스러운 사진/u, `${scene}: L1`);
    assert.match(prompt, /CG 같은 질감과 과한 보정/u, `${scene}: L2 tail`);
    assert.doesNotMatch(prompt, /시선|동공|이목구비|모공|나이대|얼굴과 피부|눈썹/u, `${scene}: no people layers`);
    assert.match(prompt, /실존감·생활감·자연스러운 불완전함을 최우선으로\.$/u, "L5 none line always closes");
  }
}

// 3. Variants rotate moment and light; no camera specs or bokeh (skill rule).
const variants = [0, 1, 2].map((variantIndex) => buildPhotorealPrompt({ subject: "빈 자리", scene: "vanity", variantIndex, lang: "en" }));
assert.equal(new Set(variants).size, 3);
for (const scene of Object.keys(BLOG_SCENES)) for (const lang of ["ko", "en"] as const) {
  const prompt = buildPhotorealPrompt({ subject: "x", scene, variantIndex: 1, lang });
  assert.doesNotMatch(prompt, /\bmm\b|f\/\d|ISO|bokeh|보케|소니|캐논|DSLR/iu, `${scene}/${lang}: no camera specs`);
}

// 4. Scene selection from template recipes / travel place types.
assert.equal(selectPhotorealScene({ connectKind: "SHOPPING", stagingRecipe: "욕실 선반·화장대 위 자연광 클로즈업" }), "bathroom-shelf");
assert.equal(selectPhotorealScene({ connectKind: "SHOPPING", stagingRecipe: "정돈된 책상이나 작업 공간" }), "desk");
assert.equal(selectPhotorealScene({ connectKind: "SHOPPING", stagingRecipe: "운동장·코스·캠핑장 같은 실제 사용 환경" }), "outdoor-gear");
assert.equal(selectPhotorealScene({ connectKind: "SHOPPING", imageIntent: "대표 이미지", topicTemplateId: "beauty_body" }), "vanity");
assert.equal(selectPhotorealScene({ connectKind: "SHOPPING", imageIntent: "대표 이미지" }), "living");
assert.equal(selectPhotorealScene({ connectKind: "TRAVEL", sectionTitle: "히타카츠 항구 도착" }), "harbor");
assert.equal(selectPhotorealScene({ connectKind: "TRAVEL", sectionTitle: "청수사 무대" }), "temple");
assert.equal(selectPhotorealScene({ connectKind: "TRAVEL", sectionTitle: "호텔 체크인 꿀팁" }), "hotel-room");
assert.equal(selectPhotorealScene({ connectKind: "TRAVEL", sectionTitle: "산넨자카 골목" }), "street-day");

// 5. Blog image prompt carries the photoreal block without weakening the safety rules.
const shopping = buildBrandPostImagePrompt({ connectKind: "SHOPPING", productName: "닥터지 수딩 크림", sectionTitle: "제형과 향",
  imageIntent: "제형 텍스처 클로즈업 연출컷", role: "body", stagingRecipe: "욕실 선반·화장대 위 자연광 클로즈업", variantIndex: 2 });
assert.match(shopping, /Photoreal direction \(phone snapshot/u);
assert.match(shopping, /on a bathroom shelf/u);
assert.match(shopping, /Generate the environment only/u, "locked-product rule kept");
assert.match(shopping, /No text, letters, logos/u);
assert.doesNotMatch(shopping, /pores|pupils|likeable/u, "no face layers on a background cut");
const travel = buildBrandPostImagePrompt({ connectKind: "TRAVEL", productName: "대마도 2일", sectionTitle: "히타카츠 항구", imageIntent: "항구 풍경", role: "body", variantIndex: 1 });
assert.match(travel, /at a harbor/u);
assert.match(travel, /small passers-by/u, "travel keeps people incidental and intact");
assert.match(travel, /not evidence of an actual visit/u);
const direction = (variantIndex: number) => buildBlogPhotorealDirection({ connectKind: "TRAVEL", role: "body", variantIndex, sectionTitle: "해변 산책" }).text;
assert.notEqual(direction(0), direction(1), "slots in one post get different variants");

// 6. Checklist QC: people-free cuts check only object items; parse is lenient; reinforcement is positive and targeted.
assert.deepEqual(photorealChecksFor(false).map((check) => check.id), ["text", "background-people", "shadow-direction", "phone-texture"]);
assert.equal(photorealChecksFor(true).length, 11);
const qc = buildPhotorealQcPrompt({ people: false });
assert.match(qc.userPrompt, /shadow-direction/u);
assert.doesNotMatch(qc.userPrompt, /hand-anatomy/u);
assert.deepEqual(parsePhotorealQc('결과: {"failed":["text","hand-anatomy","nope"]}', { people: false }), ["text"]);
assert.deepEqual(parsePhotorealQc("잘 모르겠어요", { people: false }), [], "unreadable QC never blocks");
const reinforced = reinforcePhotorealPrompt("BASE", ["shadow-direction"]);
assert.ok(reinforced.startsWith("BASE\n"), "the original prompt is kept intact");
assert.match(reinforced, /single light source/u);
assert.doesNotMatch(reinforced.split("\n")[1]!, /\b(?:no|not|don't|never)\b/iu, "reinforcement is phrased positively");
assert.equal(reinforcePhotorealPrompt("BASE", []), "BASE");

console.log(`PASS: photoreal parity (${golden.cases.length} golden cases), people-free layers, variants, scene selection, blog prompt wiring, checklist QC`);
