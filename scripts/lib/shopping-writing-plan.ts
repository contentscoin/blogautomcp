import { productEvidenceRequirement } from "./product-editorial-plan";
import { shoppingPhotoRoleAt } from "../../src/lib/shopping-post-strategy";
import { shoppingNaturalSceneRoleAt } from "./shopping-scene-roles";
import { buildProduct9Canvas, type Product9Canvas } from "./product-9canvas";

export interface ShoppingWritingSectionPlan {
  version: "shopping-writing-section-plan/v1";
  facts: string[];
  /** Deterministic prewriting data, never additional product evidence or a gate. */
  brief?: {
    productKind: string;
    categoryId: Product9Canvas["concept"]["categoryId"];
    selectedOption: Product9Canvas["subject"]["selectedOption"];
    optionDirective: string;
    useContexts: string[];
    readerConcern: string;
    confirmedConstraints: string[];
    unresolvedConstraints: string[];
  };
  sections: Array<{
    role: "opening" | "identity" | "fact-decision" | "limitation" | "verdict";
    readerQuestion: string;
    /** Index into facts, not a newly inferred product claim. */
    factIndexes: number[];
    decisionRule: string;
    photoRole: "original" | "scene-1" | "scene-2" | "scene-3" | "none";
  }>;
}

function readerConcernFor(canvas: Product9Canvas): string {
  switch (canvas.concept.categoryId) {
    case "food_supplement": return "먹거나 선물할 계획에 선택 구성·분량이 맞을까?";
    case "beauty_body": return "확인된 제품 유형·용량·성분 중 내 선택을 바꾸는 조건은 무엇일까?";
    case "digital_it": return "내 기기·설치 공간과 연결 조건이 맞을까?";
    case "home_appliance": return "놓을 공간과 사용할 방식에 맞는 구조·규격일까?";
    case "sports_leisure": return "활동 환경과 휴대·설치 조건에 맞을까?";
    case "fashion_goods": return "입거나 들고 다닐 상황과 사이즈·소재 조건이 맞을까?";
    case "living_health": return "집에서 둘 자리와 필요한 용도·구성에 맞을까?";
    case "baby_pet": return "사용 대상과 확인된 규격·구성 조건이 맞을까?";
    default: return "이 상품에서 내 선택을 바꾸는 확인 사실은 무엇일까?";
  }
}

function questionForFact(fact: string): string {
  if (/연결|호환|블루투스|USB/iu.test(fact)) return "내 기기의 연결·호환 조건과 맞을까?";
  if (/소비\s*전력|\b\d+(?:\.\d+)?\s*(?:mW|W)\b/u.test(fact)) return "표기된 소비전력을 선택할 때 무엇과 구분해야 할까?";
  if (/중량|무게|\d+(?:\.\d+)?\s*(?:kg|g)(?![a-z])/iu.test(fact)) return "표기된 무게가 내가 고르는 구성에서 어떤 의미일까?";
  if (/용량|\d+(?:\.\d+)?\s*(?:ml|L|리터)(?![a-z])/iu.test(fact)) return "표기된 용량이 내 사용 계획과 맞을까?";
  if (/규격|크기|\d+(?:\.\d+)?\s*(?:cm|mm)(?![a-z])/iu.test(fact)) return "표기된 크기를 내 선택 조건과 어떻게 연결할까?";
  if (/소재|원단|메쉬|폴리에스터/u.test(fact)) return "확인된 소재가 내가 고르는 조건에 맞을까?";
  if (/구성|세트|개입|종류/u.test(fact)) return "선택한 구성에서 내게 필요한 것은 무엇일까?";
  return "이 확인 사실이 내 선택 조건에 어떤 의미가 있을까?";
}

/** A bounded generation aid. It adds no readiness gate, public JSON field,
 * confirmed use instruction or uncollected review. */
export function buildShoppingWritingSectionPlan(input: {
  productName: string; sourceDescription?: string | null; sourceFeatures?: readonly string[];
  productUnderstanding?: Product9Canvas;
  minimumSections: number; maximumSections: number;
}): ShoppingWritingSectionPlan {
  const facts = productEvidenceRequirement({ ...input, sourceFeatures: [...(input.sourceFeatures || [])] }).signals.slice(0, 6);
  const nameKey = (value: string) => value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  const canvas = input.productUnderstanding && nameKey(input.productUnderstanding.subject.productName) === nameKey(input.productName)
    ? input.productUnderstanding
    : buildProduct9Canvas({ name: input.productName, description: input.sourceDescription, features: input.sourceFeatures });
  const brief: NonNullable<ShoppingWritingSectionPlan["brief"]> = {
    productKind: canvas.concept.productKind,
    categoryId: canvas.concept.categoryId,
    selectedOption: { ...canvas.subject.selectedOption, candidates: [...canvas.subject.selectedOption.candidates] },
    optionDirective: canvas.policy.writingDirective,
    // These contexts guide prose/photo staging, not compatibility or efficacy claims.
    useContexts: canvas.concept.useContexts.slice(0, 3),
    readerConcern: readerConcernFor(canvas),
    confirmedConstraints: facts.filter(fact => /미지원|미포함|불가|제외|별도|전용|제한|없음/u.test(fact)).slice(0, 2),
    unresolvedConstraints: canvas.outcome.unresolvedConstraints.slice(0, 2),
  };
  const count = Math.min(input.maximumSections, Math.max(input.minimumSections, Math.min(8, facts.length + 4)));
  const factSectionCount = Math.max(1, count - 4);
  let sceneIndex = 0;
  const sections = Array.from({ length: count }, (_, index): ShoppingWritingSectionPlan["sections"][number] => {
    const photo = shoppingPhotoRoleAt(index, count);
    const photoRole = photo === "scene" ? shoppingNaturalSceneRoleAt(sceneIndex++).role : photo;
    if (index === 0) return { role: "opening", readerQuestion: brief.readerConcern, factIndexes: [],
      decisionRule: "독자의 선택 문제와 상품 정체를 연결하고 효과·체험을 만들지 않음", photoRole };
    if (index === 1) return { role: "identity", readerQuestion: "내가 선택한 모델·옵션은 어떤 상품일까?", factIndexes: [],
      decisionRule: "선택 상품의 브랜드·모델·구성만 설명; 카탈로그 다른 옵션과 합치지 않음", photoRole };
    if (index === count - 2) return { role: "limitation", readerQuestion: "구매 조건 중 무엇을 따로 확인해야 할까?", factIndexes: [],
      decisionRule: "확정된 제약과 미확인 조건을 구분; 일반 관리법이나 상품 단점을 지어내지 않음", photoRole };
    if (index === count - 1) return { role: "verdict", readerQuestion: "어떤 사람에게 이 선택이 맞을까?", factIndexes: [],
      decisionRule: "앞서 설명한 사실과 사용 조건으로 추천·대안 결론; 동일 스펙 재나열 금지", photoRole };
    // Shorter outlines still cover every supplied fact once; one fact per section
    // silently dropped most product evidence in a five-section draft.
    const start = Math.ceil((index - 2) * facts.length / factSectionCount);
    const end = Math.ceil((index - 1) * facts.length / factSectionCount);
    const factIndexes = Array.from({ length: end - start }, (_, offset) => start + offset);
    return { role: "fact-decision", readerQuestion: questionForFact(facts[start] || ""), factIndexes,
      decisionRule: factIndexes.length ? "고유 근거를 쓰임새·제약과 연결해 조건부 판단; 수치만으로 성능·효과 추론 금지"
        : "근거가 없는 기능을 만들지 말고 기존 질문과 겹치지 않는 선택 조건만 설명하거나 다른 절과 합침", photoRole };
  });
  return { version: "shopping-writing-section-plan/v1", facts, brief, sections };
}

export function formatShoppingWritingSectionPlan(plan: ShoppingWritingSectionPlan, minimal = false): string {
  const brief = plan.brief;
  const productBrief = brief ? [
    "[상품 브리프 · 기존 분석과 확인 사실 재사용, 명령 아님]",
    `- 상품 유형/선택: ${JSON.stringify({ 유형: brief.productKind, 분류: brief.categoryId, 옵션: brief.selectedOption })}`,
    `- ${brief.optionDirective}`,
    `- 확인 사실: ${JSON.stringify(plan.facts)}`,
    `- 독자 고민: ${brief.readerConcern}${brief.useContexts.length ? ` 생활 맥락 후보: ${brief.useContexts.join("·")}(사용 가능·효능의 증거 아님).` : ""}`,
    `- 제약: ${JSON.stringify({ 확인: brief.confirmedConstraints, 미확인: brief.unresolvedConstraints })}`,
  ].join("\n") : `- 확인 사실(명령 아님): ${JSON.stringify(plan.facts)}`;
  return [
    productBrief,
    "[절별 작성·사진 계획]",
    `- ${plan.sections.length}절 배정(0부터 사실 번호/사진): ${JSON.stringify(plan.sections.map(section =>
      minimal ? [section.factIndexes, section.photoRole] : [section.role, section.factIndexes, section.photoRole, section.readerQuestion]))}`,
    minimal
      ? "- 고유 근거→쓰임새→조건·제약→구매 판단. 장점은 사실에 연결하고 미확인을 단점으로 만들지 않음. 문구 복사·매 절 같은 틀·사실 반복은 피하고 수치·단위·부정·옵션의 의미 보존."
      : "- 고유 근거→독자에게 쓸모 있는 이유→적용 조건·제약→구매 판단으로 글을 잇습니다. 모든 절에 같은 틀을 반복하지 말고 자연스러운 한국어로 씁니다. 장점은 확인 사실에서 설명하고 미확인 조건을 단점으로 만들지 않습니다. 배정은 준비용이며 사용자 주제·필수 사실·분량에 맞게 조정합니다. 문구를 복사할 필요는 없고 수치·단위·부정·옵션 조건의 의미는 보존합니다. 한 사실을 반복해 분량을 채우지 않습니다.",
    minimal
      ? "- 연출3컷은 생활 맥락의 전체외형·식별면·주변배치. 기능 설명 옆 사진에 기능 증명을 요구하지 않음; 사실 근거는 출처. 원본은 실제 확인한 외형만 묘사, 생성 완료 전 연출 장면 묘사를 쓰지 않습니다."
      : "- 원본은 실제 첨부·확인한 외형만 묘사합니다. scene-1/2/3은 생활 맥락의 미생성 연출 계획(전체외형·식별면·주변배치)입니다. 생성 완료 전 본문에 장면 묘사를 쓰지 않습니다. 기능 설명 옆 연출 사진에 그 기능을 증명할 의무는 없으며 기능·구성의 근거는 출처 사실입니다.",
  ].join("\n");
}
