/** Offline regressions for first-hand experience notes (storage, draft mode, grounding warning). */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  composeExperienceNotes,
  parseExperienceNotes,
  resolveDraftExperience,
  resolveStoredExperienceNotes,
} from "../src/lib/experience-notes";
import { countUngroundedExperienceSentences, getBrandLinkContentReadiness } from "./lib/brandlink-content-readiness";

async function main() {
  // 1. Structured input round-trips through the stored text.
  const values = { period: "3주 동안 주 4회", good: "땀이 차도 등판이 금방 말랐어요", bad: "", environment: "여름 한강 10km" };
  const text = composeExperienceNotes("SHOPPING", values);
  assert.equal(text, "사용 기간·횟수: 3주 동안 주 4회\n좋았던 점: 땀이 차도 등판이 금방 말랐어요\n사용 환경: 여름 한강 10km");
  assert.deepEqual(parseExperienceNotes("SHOPPING", text), { period: "3주 동안 주 4회", good: "땀이 차도 등판이 금방 말랐어요", environment: "여름 한강 10km" });
  assert.equal(parseExperienceNotes("TRAVEL", "그냥 적은 메모").bad, "그냥 적은 메모", "free text lands in the last field");

  // 2. Draft mode: stored notes decide unless the request is explicit.
  const stored = "사용 기간·횟수: 3주 동안 주 4회, 땀이 금방 말랐어요";
  assert.deepEqual(resolveDraftExperience({ requestedMode: undefined, requestedNotes: undefined, storedNotes: stored }), { mode: "VERIFIED_EXPERIENCE", notes: stored });
  assert.deepEqual(resolveDraftExperience({ requestedMode: undefined, requestedNotes: undefined, storedNotes: "" }), { mode: "AI_ASSISTED_INFORMATION", notes: "" });
  assert.deepEqual(resolveDraftExperience({ requestedMode: "ai_assisted_information", requestedNotes: undefined, storedNotes: stored }), { mode: "AI_ASSISTED_INFORMATION", notes: "" },
    "an explicit information request still wins");
  assert.ok("error" in resolveDraftExperience({ requestedMode: "verified_experience", requestedNotes: "짧음", storedNotes: "" }));
  assert.deepEqual(resolveDraftExperience({ requestedMode: undefined, requestedNotes: "요청으로 받은 긴 체험 메모입니다. 한 달 사용했어요.", storedNotes: stored }).valueOf(),
    { mode: "VERIFIED_EXPERIENCE", notes: "요청으로 받은 긴 체험 메모입니다. 한 달 사용했어요." });

  // 3. Topic posts inherit the parent's notes.
  const inherited = await resolveStoredExperienceNotes({ experienceNotes: "현장 꿀팁: 오전 방문 추천", parentBrandLinkId: "p" }, async () => ({ experienceNotes: "방문 시기: 5월" }));
  assert.equal(inherited, "방문 시기: 5월\n현장 꿀팁: 오전 방문 추천");
  assert.equal(await resolveStoredExperienceNotes({ experienceNotes: null, parentBrandLinkId: null }, async () => null), "");

  // 4. Grounding warning: experience sentences with no overlap with the notes are counted, never blocked.
  const body = "러닝조끼를 3주 동안 직접 사용해 봤어요. 땀이 차도 등판이 금방 말랐어요.\n캠핑에서도 직접 사용해 봤어요.";
  assert.equal(countUngroundedExperienceSentences(body, stored + " 한강 러닝"), 1, "the camping claim is not in the notes");
  assert.equal(countUngroundedExperienceSentences(body, ""), 0);
  const readiness = (experienceNotes: string) => getBrandLinkContentReadiness({
    productName: "RNRN 러닝조끼", title: "RNRN 러닝조끼 3주 착용 후기", brandLink: "https://naver.me/x",
    sections: [`착용감\n\n${body}`, "이 포스팅은 쇼핑커넥트 활동의 일환으로 판매 발생 시 수수료를 제공받습니다."],
    hashtags: ["러닝조끼", "러닝베스트", "RNRN"], generationSource: "AI", hasRepresentativeImage: true, requireRepresentativeImage: false,
    connectKind: "SHOPPING", experienceMode: "VERIFIED_EXPERIENCE", experienceNotes, mode: "editorial",
  });
  const warned = readiness(stored);
  assert.equal(warned.signals.find((signal) => signal.key === "experience-grounding")?.status, "warn");
  assert.ok(!warned.blockers.some((blocker) => blocker.code === "unsupported-experience-claim"), "verified mode never blocks on wording");

  // 5. PATCH stores notes; topic posts do not copy them (they inherit at draft time).
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "blogautomcp-experience-"));
  const databaseUrl = `file:${path.join(root, "test.db")}`;
  execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "db", "push", "--skip-generate"], {
    env: { ...process.env, DATABASE_URL: databaseUrl, PRISMA_HIDE_UPDATE_MESSAGE: "1" }, stdio: "ignore",
  });
  Object.assign(process.env, {
    DATABASE_URL: databaseUrl, DESKTOP_USER_DATA: root, REMOTE_SITE_URL: "https://fixture.invalid",
    REMOTE_DEVICE_ID: "fixture", REMOTE_DEVICE_TOKEN: "fixture-not-a-live-token",
  });
  delete process.env.ADMIN_API_KEY;
  const { prisma } = await import("../src/lib/db");
  const { PATCH } = await import("../src/app/api/brandlinks/[id]/route");
  const angles = await import("../src/app/api/brandlinks/[id]/angles/route");
  const { NextRequest } = await import("next/server");
  try {
    const parent = await prisma.brandLink.create({ data: { url: "https://naver.me/e", productName: "RNRN 러닝조끼",
      productFeatures: JSON.stringify(["메쉬 소재", "세탁망 사용 찬물 세탁"]) } });
    const patch = (body: unknown) => PATCH(new NextRequest(`http://localhost/api/brandlinks/${parent.id}`, {
      method: "PATCH", headers: { "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify(body),
    }), { params: Promise.resolve({ id: parent.id }) });
    assert.equal((await patch({ experienceNotes: `  ${stored}  ` })).status, 200);
    assert.equal((await prisma.brandLink.findUniqueOrThrow({ where: { id: parent.id } })).experienceNotes, stored);
    assert.equal((await patch({ experienceNotes: 3 })).status, 400);
    const created = await angles.POST(new NextRequest(`http://localhost/api/brandlinks/${parent.id}/angles`, {
      method: "POST", headers: { "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify({ angle: "how-to" }),
    }), { params: Promise.resolve({ id: parent.id }) });
    const child = await prisma.brandLink.findUniqueOrThrow({ where: { id: (await created.json()).data.id } });
    assert.equal(child.experienceNotes, null, "children inherit at draft time instead of copying");
    assert.equal(await resolveStoredExperienceNotes(child, (id) => prisma.brandLink.findUnique({ where: { id }, select: { experienceNotes: true } })), stored);
    assert.equal((await patch({ experienceNotes: null })).status, 200);
    assert.equal((await prisma.brandLink.findUniqueOrThrow({ where: { id: parent.id } })).experienceNotes, null);
  } finally {
    await prisma.$disconnect();
    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log("PASS: experience notes round-trip, draft mode resolution, parent inheritance, grounding warning, PATCH storage");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
