import assert from "node:assert/strict";
import {
  assessProductEditorialCoverage,
  buildProductEditorialPlan,
  formatProductEditorialPlanForPrompt,
} from "./lib/product-editorial-plan";
import { getBrandLinkContentReadiness } from "./lib/brandlink-content-readiness";

const plan = buildProductEditorialPlan({
  productName: "테스트 보냉백",
  description: "휴대용 소프트 쿨러",
  features: ["접이식", "지퍼형 수납"],
  price: "39,000원",
  targetSectionCount: 8,
});

assert.equal(plan.sections.length, 8);
assert.equal(plan.sections[0]?.role, "hook-problem");
assert.equal(plan.sections[3]?.role, "proof");
assert.ok(formatProductEditorialPlanForPrompt(plan).includes("사용 가능한 확인 사실"));
assert.ok(!plan.verifiedFactLines.some((line) => line.includes("평점")));

const sections = [
  "구매 전에 먼저 볼 기준\n\n테스트 보냉백을 고를 때 확인할 점이에요.",
  "상품 구성과 핵심 특징\n\n접이식 구성과 수납 형태를 확인해요.",
  "기능이 주는 이점\n\n휴대 상황에 맞는지 살펴봐요.",
  "스펙과 상세 정보\n\n크기와 재질을 상세 화면에서 확인해요.",
  "어떤 상황에 잘 맞는지\n\n이동이 잦은 상황에 맞을 수 있어요.",
  "구매 전 주의사항\n\n옵션과 배송 조건을 확인해요.",
  "이 포스팅은 네이버 쇼핑 커넥트 활동의 일환으로, 판매 발생 시 수수료를 제공받습니다.",
];
const coverage = assessProductEditorialCoverage(sections.slice(0, -1));
assert.equal(coverage.missingCoreRoles.length, 0);

const readiness = getBrandLinkContentReadiness({
  productName: "테스트 보냉백",
  title: "테스트 보냉백 구매 전 비교와 확인 포인트",
  sections: sections.map((section, index) =>
    index < sections.length - 1
      ? `${section}\n테스트 보냉백의 확인 가능한 정보를 기준으로 정리해요. `.repeat(5)
      : section,
  ),
  hashtags: [
    "테스트보냉백", "보냉백", "쿨러백", "추천", "후기", "리뷰", "비교", "가격", "장단점", "쇼핑",
    "구매전확인", "상품정보", "옵션확인", "가격비교", "네이버쇼핑",
  ],
  brandLink: "https://naver.me/example",
  hasRepresentativeImage: true,
  thumbnailGenerated: true,
});

assert.equal(readiness.canPublish, true, readiness.reason || readiness.summary);
assert.equal(readiness.signals.find((signal) => signal.key === "editorial-flow")?.status, "pass");

console.log(JSON.stringify({
  ok: true,
  framework: plan.framework,
  sectionRoles: plan.sections.map((section) => section.role),
  readinessScore: readiness.score,
}, null, 2));
