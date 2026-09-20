import assert from "node:assert/strict";
import { normalizePublishedBodyLines, normalizePublishedPostText, resolvePostDocument } from "../src/lib/post-composition-contract";
import { normalizeLines } from "./lib/post-spec/render";

const disclosure = "이 글은 네이버 쇼핑 커넥트 활동의 일환으로, 구매 발생 시 수수료를 제공받을 수 있습니다.";
const faq = Array.from({ length: 3 }, (_, i) =>
  `Q.\n질문 ${i + 1}인가요?\nA.\n첫 답 ${i + 1}이에요.\nA.\n둘째 답 ${i + 1}이에요.`).join("\n");
const normalizedFaq = normalizeLines(faq.split("\n"), "qa-3");
assert.equal(normalizedFaq.length, 6);
assert.deepEqual(normalizeLines(normalizedFaq, "qa-3"), normalizedFaq);
assert.deepEqual(normalizePublishedBodyLines(normalizedFaq), normalizedFaq);
assert.deepEqual(normalizeLines(["질문1?", "답1.\n보충1.", "질문2?", "답2.\n보충2.", "질문3?", "답3.\n보충3."], "qa-3"),
  ["Q. 질문1?", "A. 답1. 보충1.", "Q. 질문2?", "A. 답2. 보충2.", "Q. 질문3?", "A. 답3. 보충3."]);
for (const connectKind of ["SHOPPING", "TRAVEL"] as const) {
  const document = resolvePostDocument({
    connectKind, title: "선택 안내", imagePaths: [], connectUrl: "https://example.com/product",
    sections: ["장소와 기능\n#서울 골목을 따라 걸어요.\nC# 예제도 설명해요.",
      `자주 묻는 질문\n${faq}\n#서울 #안내`,
      `마지막 안내\n의미 있는 설명을 남겨요.\n#안내${disclosure}`,
      "혼합 설명\n여행 커넥트 수수료 구조를 설명하는 본문도 보존해요."],
    hashtags: ["#서울", "서울", " 안내 ", "#안내", ""],
  });
  const body = document.sections[1].body.join("\n");
  assert.equal((body.match(/^Q\. /gm) || []).length, 3, "three attached questions");
  assert.equal((body.match(/^A\. /gm) || []).length, 3, "one answer marker per pair");
  for (let i = 1; i <= 3; i++) {
    assert.ok(body.includes(`첫 답 ${i}이에요.`));
    assert.ok(body.includes(`둘째 답 ${i}이에요.`));
  }
  assert.doesNotMatch(body, /#서울|#안내/);
  assert.deepEqual(document.sections[0].body, ["#서울 골목을 따라 걸어요.", "C# 예제도 설명해요."]);
  assert.deepEqual(document.sections[2].body, ["의미 있는 설명을 남겨요."]);
  assert.deepEqual(document.sections[3].body, ["여행 커넥트 수수료 구조를 설명하는 본문도 보존해요."]);
  const tags = document.renderNodes.filter(node => node.kind === "hashtags");
  assert.equal(tags.length, 1);
  assert.deepEqual(tags[0].values, ["서울", "안내"]);
  assert.equal(document.renderNodes.at(-1)?.kind, "disclosure");
  assert.equal(document.renderNodes.filter(node => node.kind === "connectCard").length, 2);
  for (const node of document.renderNodes) {
    if (node.kind === "paragraph") assert.doesNotMatch(node.text, /(?:^|\n)[QA]\.\s*(?:\n|$)/);
    if (node.kind === "disclosure") assert.equal(node.text, disclosure);
  }
  const sectionId = document.sections[1].id;
  const legacy = { ...document, sections: document.sections.map(section => section.id === sectionId
    ? { ...section, body: [...faq.split("\n"), "#서울 #안내"] } : section),
    renderNodes: [
      ...faq.split("\n").map(text => ({ kind: "paragraph" as const, sectionId, text })),
      { kind: "paragraph" as const, sectionId, text: "#서울 #안내" },
      { kind: "hashtags" as const, values: ["#서울", "서울"] },
      { kind: "hashtags" as const, values: ["안내"] },
      { kind: "disclosure" as const, disclosureType: "affiliate" as const, placement: "bottom" as const, text: `#안내${disclosure}` },
    ] };
  const repaired = normalizePublishedPostText(legacy);
  assert.deepEqual(repaired.sections[1].body, normalizedFaq);
  assert.equal(repaired.renderNodes.filter(node => node.kind === "hashtags").length, 1);
  assert.equal(repaired.renderNodes[0].kind === "paragraph" && repaired.renderNodes[0].text, normalizedFaq.join("\n"));
  assert.equal(repaired.renderNodes.at(-1)?.kind === "disclosure" && (repaired.renderNodes.at(-1) as { text: string }).text, disclosure);
  assert.deepEqual(normalizePublishedPostText(repaired), repaired, "read-time migration is idempotent");
}
console.log("published text layout regression passed");
