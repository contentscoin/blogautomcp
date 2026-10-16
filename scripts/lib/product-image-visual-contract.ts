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

export const PRODUCT_IMAGE_VISUAL_CONTRACT_RULES_KO = [
  "visualContract.purpose가 product-appearance이면 사진의 목적은 선택 상품·옵션의 외형 확인입니다. 같은 문단의 수영·육상 운동·Bluetooth·MP3·방수·재생 시간 등 제품 설명 전체를 한 사진이 입증하거나 모든 사용 장면을 동시에 보여줄 필요는 없습니다. 해당 기능이 사진에 없다는 이유만으로 올바른 외형 사진을 거절하지 마세요.",
  "sectionTitle과 sectionBody는 실제 발행 문장입니다. 실제 문장이 '이 사진이 성능/효과를 증명한다'처럼 사진 자체를 기능 증거로 제시하는 경우는 별도로 거절하세요. 단순한 제품 기능 설명과 사진을 증거로 주장하는 문장을 구별하세요. '사진은 효과를 입증하지 않습니다' 같은 부정·한계 설명은 증거 주장으로 오해하지 마세요. '사진 속 라벨에 100ml라고 적혀 있다' 같은 구체 픽셀 주장은 실제 판독 가능한 표기로 확인돼야 하며 불명확한 숫자를 추정하지 마세요. imageIntent는 사진의 역할이며 본문 주장을 입증하는 근거가 아닙니다.",
  "visualContract.purpose가 feature-evidence이면 요청한 구체 기능·작동·조작·구조가 픽셀에 직접 보여야 합니다. 실제 발행 문장의 기능과 다른 효능·질감·구조는 근거가 아닙니다. 이미지에서 보이지 않는 성능을 추정하지 마세요.",
  "모든 목적에서 선택 상품·보이는 옵션·구성이 본문과 모순되거나 다른 상품이면 거절하세요. 외형 목적이라도 설명판·프레임·인셋·추가 설명 텍스트가 있는 원본은 자연스러운 본문 사진으로 사용할 수 없습니다.",
].join("\n");

export const PRODUCT_IMAGE_VISUAL_CONTRACT_RULES_EN = [
  "visualContract defines the visual's role separately from the paragraph's facts. product-appearance shows the selected product's exterior/visible variant; it need not depict or prove every technical feature, mode, use environment or benefit mentioned alongside it. Technical prose alone does not make a correct seller overview into feature evidence.",
  "photoClaimMatches checks actual published sectionTitle/sectionBody for a claim that THIS PHOTO proves a function, measurement, performance or result. Reject such unsupported photo-as-proof claims. Otherwise set this check true; a paragraph explaining swimming/Bluetooth/MP3 or a product benefit does not itself assert photographic proof. A negation or disclaimer that the photo does NOT prove an effect is not a proof claim. Also verify explicit pixel assertions such as 'the photo label reads 100ml' against actually legible confirming pixels; unreadable print cannot support a precise asserted number. This differs from requiring OCR of specifications merely supplied as product facts. Planning intent cannot authorize a claim missing from the published text.",
  "For feature-evidence, the requested specific visible structure/operation must be shown and match the actual published claim; do not infer hidden performance. lifestyle-illustration is a plausible setting, not tested performance or a customer testimonial. Product identity, visible selected option and natural-photo format remain mandatory for every purpose.",
].join("\n");
