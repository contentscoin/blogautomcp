import { allowsGenericBrandPostProductPhoto, isShoppingLifestyleImage, type BrandPostImageSourceHint } from "../../src/lib/brand-post-image-evidence";

/** The visual's job is separate from the paragraph's product facts. A seller
 * overview beside technical prose does not turn that photograph into a test. */
export function buildProductImageVisualContract(target: {
  sectionTitle: string; imageIntent: string; imageSource?: BrandPostImageSourceHint;
}, thumbnail = false) {
  const purpose = thumbnail ? "thumbnail" : isShoppingLifestyleImage(target) ? "lifestyle-illustration" :
    allowsGenericBrandPostProductPhoto(target) ? "product-appearance" : "feature-evidence";
  return {
    purpose,
    claimPolicy: purpose === "feature-evidence" ? "direct-requested-feature" : "visual-compatibility-and-explicit-photo-claims",
    identityAndVisibleOptionMustMatch: true,
    demonstrateEveryParagraphFeature: false,
    photoMustNotClaimUnseenPerformance: true,
  } as const;
}

/** Planning directives cannot turn an unresolved catalog choice into a fact
 * about the customer's purchase. This is classification guidance, not evidence
 * of kit membership and never an override of a pixel verdict. */
export const PRODUCT_IMAGE_COMPONENT_OPTION_RULE_EN = "Separate selected-listing appearance, verified included components and the confirmed purchased option. When optionResolution.catalogCandidatesAreConfirmedPurchaseSelection=false, a title-derived optionPolicy.directive or requireSingleOptionVisual is planning context, not evidence that catalog candidates are mutually exclusive selected SKUs. For text explicitly describing a catalog/listing overview and asking the buyer to confirm the order option, compare the visible product with its own mapped selected-listing reference; do not require proof of an unconfirmed complete purchased bundle. An exact source match or title alone cannot prove component inclusion. Different forms of verified included components are not alternative purchase options. Set mixedOptions=true for actual distinguishable conflicting alternatives and name the visible alternatives plus the selected fact/reference establishing their conflict. If product identity or source/component membership genuinely remains unresolved, reject with identityMatches/accepted and state that concrete uncertainty instead of inventing conflicting options. Confirmed-option contradictions, unreadable identifying details that leave identity unresolved, unselected gifts/cross-sells and unsupported included-content, whole-set, quantity or price claims still reject. This rule never changes a returned adverse boolean or grants automatic acceptance.";

export const PRODUCT_IMAGE_BUYER_CHECK_ADVICE_RULE_EN = "Distinguish a purchasing check from a photographic assertion: conditional or imperative advice to compare a listing photo with the option the buyer will choose does not assert that they already match or certify included contents. Do not rewrite that advice into an unconditional photo claim. An actual statement that the pictured items ARE the purchased bundle, a precise visible count/label or a claimed all-included set still requires confirming pixels and selected facts.";

export const PRODUCT_IMAGE_BODY_TEXT_RULE_EN = "An unchanged seller-original or exact selected-gallery source is not a publication-format exemption. In a BODY image, a seller-added product headline, SNS/review caption or floating badge/banner over the photograph is added text, not intrinsic physical package printing, even when its facts are accurate. Inspect the actual placement: text in a separate rounded marketing banner or floating review caption is not printed on the pictured object. Reject added body text with textPolicyMatches and a graphic banner/panel with noGraphicLayout. Genuine unchanged printing physically on the product/package remains allowed. A thumbnail elsewhere grants no body-image overlay permission.";

export const PRODUCT_IMAGE_VISUAL_CONTRACT_RULES_KO = [
  "visualContract.purpose가 product-appearance이면 사진의 목적은 선택 상품·옵션의 외형 확인입니다. 같은 문단의 수영·육상 운동·Bluetooth·MP3·방수·재생 시간 등 제품 설명 전체를 한 사진이 입증하거나 모든 사용 장면을 동시에 보여줄 필요는 없습니다. 해당 기능이 사진에 없다는 이유만으로 올바른 외형 사진을 거절하지 마세요.",
  "sectionTitle과 sectionBody는 실제 발행 문장입니다. 실제 문장이 '이 사진이 성능/효과를 증명한다'처럼 사진 자체를 기능 증거로 제시하는 경우는 별도로 거절하세요. 단순한 제품 기능 설명과 사진을 증거로 주장하는 문장을 구별하세요. '사진은 효과를 입증하지 않습니다' 같은 부정·한계 설명은 증거 주장으로 오해하지 마세요. '사진 속 라벨에 100ml라고 적혀 있다' 같은 구체 픽셀 주장은 실제 판독 가능한 표기로 확인돼야 하며 불명확한 숫자를 추정하지 마세요. imageIntent는 사진의 역할이며 본문 주장을 입증하는 근거가 아닙니다.",
  "visualContract.purpose가 feature-evidence이면 요청한 구체 기능·작동·조작·구조가 픽셀에 직접 보여야 합니다. 실제 발행 문장의 기능과 다른 효능·질감·구조는 근거가 아닙니다. 이미지에서 보이지 않는 성능을 추정하지 마세요.",
  "모든 목적에서 선택 상품·보이는 옵션·구성이 본문과 모순되거나 다른 상품이면 거절하세요. 외형 목적이라도 설명판·프레임·인셋·추가 설명 텍스트가 있는 원본은 자연스러운 본문 사진으로 사용할 수 없습니다.",
  "판매목록의 외형, 근거가 확인된 세트 구성품, 확정된 구매 옵션을 구분하세요. catalogCandidatesAreConfirmedPurchaseSelection=false이면 상품명에서 만든 optionPolicy.directive·requireSingleOptionVisual은 기획 문구이며 서로 배타적인 구매 SKU나 포함 확정의 증거가 아닙니다. 본문이 카탈로그 외형 소개와 주문 옵션 확인 조언임을 분명히 한 경우에는 해당 사진의 실제 선택 판매목록 원본과 외형을 대조하되 미확정 구매세트 전체를 사진이 입증하도록 요구하지 마세요. 출처 일치나 상품명만으로 구성품 포함을 승인하지 마세요. 확인된 구성품의 서로 다른 모양을 대체 옵션 혼합으로 오인하지 말고, 실제로 충돌하는 옵션이면 보이는 대안과 충돌 근거를 명시하세요. 상품 정체성·해당 출처의 구성품 소속이 정말 불명확하거나 식별 표기가 판독되지 않아 다른 상품 가능성을 해소하지 못하면 identityMatches·accepted로 계속 거절하세요. 다른 SKU·증정품·교차판매, 미확인 포함·전체 구성·수량·가격 단정은 그대로 차단하며 불리한 판정을 바꾸거나 자동 승인하지 않습니다.",
  "구매할 옵션과 사진을 비교·확인하라는 조건형·확인 조언은 이미 일치한다고 확정하거나 구성품을 사진으로 입증하는 문장과 다릅니다. 조언을 단정형 사진 주장으로 바꿔 해석하지 마세요. 반대로 사진 속 품목이 구매세트와 같다는 단정, 구체적인 사진 속 수량·라벨 판독, 전 구성품 포함 주장은 실제 픽셀과 선택 근거가 뒷받침해야 합니다.",
  "판매자 원본이나 선택 갤러리와 바이트가 같아도 본문 형식 검사를 면제하지 않습니다. 사진 위 별도 라운드 배너·떠 있는 SNS 후기 문구·제품 홍보 제목은 실제 물체 표면에 인쇄된 포장 글자가 아니라 덧씌운 텍스트입니다. 내용이 맞아도 본문에서는 textPolicyMatches로 거절하고 그래픽 배너·패널은 noGraphicLayout으로 거절하세요. 실제 상품·포장 표면의 원래 인쇄는 허용하며 다른 썸네일의 큰 제목 허용을 본문에 적용하지 마세요.",
].join("\n");

export const PRODUCT_IMAGE_VISUAL_CONTRACT_RULES_EN = [
  "visualContract defines the visual's role separately from the paragraph's facts. product-appearance shows the selected product's exterior/visible variant; it need not depict or prove every technical feature, mode, use environment or benefit mentioned alongside it. Technical prose alone does not make a correct seller overview into feature evidence.",
  "photoClaimMatches checks actual published sectionTitle/sectionBody for a claim that THIS PHOTO proves a function, measurement, performance or result. Reject such unsupported photo-as-proof claims. Otherwise set this check true; a paragraph explaining swimming/Bluetooth/MP3 or a product benefit does not itself assert photographic proof. A negation or disclaimer that the photo does NOT prove an effect is not a proof claim. Also verify explicit pixel assertions such as 'the photo label reads 100ml' against actually legible confirming pixels; unreadable print cannot support a precise asserted number. This differs from requiring OCR of specifications merely supplied as product facts. Planning intent cannot authorize a claim missing from the published text.",
  "For feature-evidence, the requested specific visible structure/operation must be shown and match the actual published claim; do not infer hidden performance. lifestyle-illustration is a plausible setting, not tested performance or a customer testimonial. Product identity, visible selected option and natural-photo format remain mandatory for every purpose.",
  PRODUCT_IMAGE_COMPONENT_OPTION_RULE_EN,
  PRODUCT_IMAGE_BUYER_CHECK_ADVICE_RULE_EN,
  PRODUCT_IMAGE_BODY_TEXT_RULE_EN,
].join("\n");
