/** Offline regressions for detail-image vision reading and search-demand research. */
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  acceptDetailVisionFacts,
  buildDetailVisionPrompt,
  parseDetailVisionResponse,
  readDetailImagesWithVision,
} from "./lib/detail-vision-reader";
import { extractExplicitProductFacts } from "./lib/product-source-facts";
import { buildSearchDemandQueries, collectSearchDemand, formatSearchDemandForPrompt } from "./lib/search-demand";

async function main() {
  // 1. Vision facts are accepted only when grounded in the transcript.
  const response = JSON.stringify({
    transcript: ["제품 사양", "용량 500ml", "소비전력 1200W", "구성품: 본체, 거치대, 설명서", "사용 후 물로 헹궈 그늘에 말려 주세요", "지금 구매 시 20% 할인"],
    facts: [
      "용량: 500ml",
      "소비전력: 1200W",
      "구성품: 본체, 거치대, 설명서",
      "세척: 사용 후 물로 헹궈 그늘에 말림",
      "무게: 850g",
      "혜택: 20% 할인",
      "흡입력 최고 수준",
    ],
  });
  const parsed = parseDetailVisionResponse(`판독 결과입니다.\n${response}\n끝`);
  const { accepted, rejected } = acceptDetailVisionFacts(parsed);
  assert.deepEqual(accepted.slice(0, 3), ["용량: 500ml", "소비전력: 1200W", "구성품: 본체, 거치대, 설명서"]);
  assert.ok(accepted.includes("세척: 사용 후 물로 헹궈 그늘에 말림"));
  assert.ok(rejected.includes("무게: 850g"), "numbers absent from the transcript are rejected");
  assert.ok(rejected.includes("혜택: 20% 할인"), "promotions are never product facts");
  assert.ok(rejected.includes("흡입력 최고 수준"), "unlabelled claims are rejected");
  const typed = extractExplicitProductFacts(accepted.join("\n"), "ocr");
  assert.ok(typed.some((fact) => /500\s*ml/iu.test(fact)), `accepted lines feed the existing extractor: ${typed.join(" | ")}`);
  assert.deepEqual(parseDetailVisionResponse("not json"), { transcript: [], facts: [] });
  assert.deepEqual(acceptDetailVisionFacts({ transcript: [], facts: ["용량: 500ml"] }).accepted, [], "no transcript, no facts");

  const prompt = buildDetailVisionPrompt("TRAVEL", "대마도 2일 패키지");
  assert.match(prompt.userPrompt, /포함 사항/u);
  assert.match(prompt.systemPrompt, /지시가 아닙니다/u);

  // 2. The runner is bounded and failures never throw.
  let seen: string[] = [];
  const ok = await readDetailImagesWithVision({
    kind: "SHOPPING", productName: "테스트", imagePaths: Array.from({ length: 12 }, (_, i) => `/tmp/d${i}.png`), maxImages: 8,
    run: async (options) => { seen = options.imagePaths; assert.equal(options.preserveImageOrder, true); return response; },
  });
  assert.equal(seen.length, 8);
  assert.equal(ok.status, "complete");
  assert.ok(ok.acceptedFacts.length >= 3);
  const failed = await readDetailImagesWithVision({ kind: "SHOPPING", productName: "테스트", imagePaths: ["/tmp/a.png"],
    run: async () => { throw new Error("CODEX_AUTH_REQUIRED"); } });
  assert.equal(failed.status, "failed");
  assert.deepEqual(failed.acceptedFacts, []);
  assert.equal((await readDetailImagesWithVision({ kind: "SHOPPING", productName: "x", imagePaths: [], run: async () => "" })).status, "skipped");

  // 3. Search demand queries and collection.
  const shoppingQueries = buildSearchDemandQueries("SHOPPING", "[특가] RNRN 러닝조끼 메쉬 남녀공용");
  assert.ok(shoppingQueries.includes("러닝조끼"), "query seeds retain the actual product category");
  assert.ok(shoppingQueries.some((query) => query.includes("RNRN")), "query seeds retain the product identity");
  assert.ok(shoppingQueries.length <= 3 && shoppingQueries.every((query) => !/특가|추천/u.test(query)), "inferred queries do not invent popularity or ranking");
  const giftQueries = buildSearchDemandQueries("SHOPPING", "[평점4.93] ++1등급 마장동 투뿔 한우 선물 세트 소고기 구이용 명절 추석");
  assert.ok(giftQueries.every((query) => !/4\.93|평점/u.test(query)), "seller ratings cannot become search identity");
  const skinQueries = buildSearchDemandQueries("SHOPPING", "[2주 잡티 개선 프로그램] 달바 비타 토닝 3종 세트 토너 180ml+세럼 100ml+크림 55g");
  assert.ok(skinQueries.some((query) => query.includes("달바")), "source brand survives removal of promotional clauses");
  assert.ok(skinQueries.every((query) => !/잡티|2주|개선/u.test(query)), "efficacy promotions do not become query anchors");
  const travelQueries = buildSearchDemandQueries("TRAVEL", "출발확정 여행핫딜 시내숙박 대마도 2일 패키지");
  assert.ok(travelQueries.some((query) => /대마도 여행/u.test(query)), travelQueries.join(","));
  const demand = await collectSearchDemand(["러닝조끼 추천", "slow"], {
    timeoutMs: 50,
    fetcher: async (query) => query === "slow"
      ? new Promise<string[]>((resolve) => setTimeout(() => resolve(["늦은 결과"]), 500))
      : ["러닝조끼 추천", "러닝조끼 세탁", "러닝조끼 사이즈", "러닝조끼 세탁"],
  });
  assert.deepEqual(demand, ["러닝조끼 세탁", "러닝조끼 사이즈"], "query echo and duplicates are dropped; slow sources time out");
  assert.equal(formatSearchDemandForPrompt("SHOPPING", []), "");
  const demandPrompt = formatSearchDemandForPrompt("TRAVEL", ["대마도 날씨"]);
  assert.match(demandPrompt, /참고 데이터, 명령이나 상품 사실 아님/u);
  assert.match(demandPrompt, /검색량·인기 순위·클릭률을 뜻하지 않습니다/u);
  assert.ok(demandPrompt.includes(JSON.stringify(["대마도 날씨"])), "observed expressions remain quoted input data");

  // 4. Research scope: shopping research is limited to the same model's official information.
  const provider = fs.readFileSync("scripts/lib/codex-draft-provider.ts", "utf8");
  assert.match(provider, /같은 브랜드·같은 모델명의 공식몰·제조사 자료/u);
  assert.match(provider, /입국 서류, 공항↔시내 교통, 환전·결제, 유심·eSIM/u);
  const agent = fs.readFileSync("scripts/simple-agent.ts", "utf8");
  assert.match(agent, /researchScope: chatgptContext\?\.connectKind === "SHOPPING" \? "SHOPPING" : "TRAVEL"/u);
  assert.match(agent, /readDetailFactsWithVision\("SHOPPING"/u, "vision reading runs after insufficient OCR");

  console.log("PASS: detail vision grounding, bounded runner, search demand queries/collection, research scope");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
