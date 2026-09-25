/**
 * 브랜드 표기가 없는 농산물·식품·명절 선물세트 판정.
 * 이런 상품은 판매자 사진 어디에도 브랜드·모델 표기가 없어서, 픽셀로 "이 브랜드의 이 상품"을 증명할 수 없다.
 * 그래서 식별 기준을 "같은 품목, 상품명과 맞는 포장·구성, 모순 없음"으로 둔다. 옵션 혼합·공지 거절은 그대로다.
 */

const COMMODITY = /(?:김치|배추|곶감|반건시|건시|사과|배(?:\s|$)|한우|한돈|돼지|소고기|갈비|굴비|조기|전복|꽃게|새우|오징어|멸치|김(?:\s|$)|미역|다시마|쌀|현미|잡곡|고구마|감자|옥수수|귤|한라봉|천혜향|레드향|딸기|포도|샤인머스캣|복숭아|수박|참외|블루베리|견과|호두|밤(?:\s|$)|대추|꿀|떡|한과|약과|젓갈|장아찌|된장|고추장|간장|참기름|들기름|나물|버섯|인삼|홍삼(?!정\s*에브리타임)|과일|채소|수산|농산|정육|선물\s*세트|선물세트|명절\s*선물|추석\s*선물|설\s*선물)/u;
// 영문+숫자 모델명(예: T13 PRO, WQ61-1EDB)이 있으면 공산품으로 본다.
const MODEL_NUMBER = /\b[A-Z]{1,5}[-\s]?\d{1,5}[A-Z0-9-]*\b/u;

export function isUnbrandedCommodityProduct(productName: string): boolean {
  const name = String(productName || "");
  return COMMODITY.test(name) && !MODEL_NUMBER.test(name);
}

export const UNBRANDED_COMMODITY_IDENTITY_RULE_KO =
  "이 상품은 브랜드·모델 표기가 없는 농산물·식품·선물세트 유형입니다. 판매자 사진에 브랜드 표기가 보이지 않는다는 이유만으로 거부하지 마세요. " +
  "같은 품목이 보이고 포장·구성이 상품명과 맞으며, 다른 품목·다른 옵션·다른 브랜드 표기 같은 모순이 없으면 일치로 판정하세요. 옵션 혼합·공지 이미지 거부 규칙은 그대로 적용합니다.";

export const UNBRANDED_COMMODITY_IDENTITY_RULE_EN =
  "This product is an unbranded commodity/food/gift-set type whose seller photos carry no brand or model marks. Do not reject merely because no brand marking is visible. " +
  "Treat identity as matching when the same kind of item is shown, the packaging and composition fit the product name, and nothing contradicts it (a different item, a different option, or another brand's marking). The mixed-option and notice rejection rules still apply.";
