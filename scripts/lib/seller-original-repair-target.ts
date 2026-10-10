import type { ProductSectionImageDiagnostics } from "./product-photo-review";

export interface SellerOriginalRepairTarget {
  code: "IMAGE_SOURCE_BINDING_REQUIRED";
  sectionId: string;
  imageSource: "seller-original";
  action: "provide-clean-seller-photo";
  candidateCount: number;
  rejectedCount: number;
  causes: Array<{ kind: "graphic-layout" | "notice" | "identity-variant" | "section-evidence" | "unresolved"; count: number; example: string }>;
  message: string;
}

/** Explain only actual current pixel verdicts; never relabel a provider failure as missing photos. */
export function buildSellerOriginalRepairTarget(options: {
  sectionId: string;
  targetIndex: number;
  diagnostics?: ProductSectionImageDiagnostics;
}): SellerOriginalRepairTarget | null {
  const report = options.diagnostics;
  if (!report || report.status !== "complete" || !Number.isInteger(options.targetIndex) || options.targetIndex < 0 || options.targetIndex >= report.targetCount) return null;
  const entries = report.entries.filter(entry => entry.targetIndex === options.targetIndex);
  // An accepted proposal may have failed a later binding step; don't diagnose its pixels as rejected.
  if (entries.some(entry => entry.status === "proposed" || entry.status === "review-failed")) return null;
  const kinds = new Map<SellerOriginalRepairTarget["causes"][number]["kind"], { count: number; example: string }>();
  const rejected = entries.filter(entry => entry.status === "rejected");
  for (const entry of rejected) {
    const reason = entry.reason.replace(/[\r\n\u0000-\u001f]+/gu, " ").trim();
    const kind = /설명판|설명\s*패널|프레임|인셋|정보\s*카드|콜라주|추가(?:\s*설명)?\s*텍스트|단일(?:\s*자연스러운)?\s*사진|오버레이/u.test(reason) ? "graphic-layout"
      : /공지|배송|쿠폰|이벤트|저작권|안내\s*(?:표|판|이미지)/u.test(reason) ? "notice"
        : /기능\s*근거\s*부족|기능.*(?:불일치|다르)|직접\s*근거/u.test(reason) ? "section-evidence"
          : /일치.*(?:실패|불확실)|식별|혼합\s*옵션|다른\s*(?:상품|제품|옵션|구성)|구성.*(?:다르|확인할\s*수\s*없)|용량.*(?:다르|불일치)/u.test(reason) ? "identity-variant" : "unresolved";
    const previous = kinds.get(kind);
    kinds.set(kind, { count: (previous?.count || 0) + 1, example: previous?.example || reason });
  }
  const causes = [...kinds].map(([kind, value]) => ({ kind, ...value }));
  const labels = { "graphic-layout": "설명판·추가 텍스트·프레임 포함", notice: "공지·판매 안내",
    "identity-variant": "선택 상품·옵션 식별 또는 구성 불일치", "section-evidence": "본문 근거 불일치", unresolved: "기타 픽셀 부적합" };
  const summary = causes.map(cause => `${labels[cause.kind]} ${cause.count}장`).join(", ");
  const detail = [...new Set(rejected.map(entry => entry.reason.replace(/[\r\n\u0000-\u001f]+/gu, " ").trim()).filter(Boolean))].join(" / ");
  const candidateCount = Number.isFinite(report.candidateCount) ? Math.max(0, Math.floor(report.candidateCount)) : 0;
  const message = `IMAGE_SOURCE_BINDING_REQUIRED: 원본 사진 슬롯 ${options.sectionId}에 검증을 통과한 판매자 사진을 배정하지 못했습니다. ` +
    `검토 후보 ${candidateCount}장${summary ? `: ${summary}` : ""}. ` +
    (detail ? ` 실제 거절 사유: ${detail}. ` : "") +
    "선택 상품·옵션이 식별되고 제품 전체가 보이는 판매자 실사 사진을 추가하세요. 같은 옵션의 용기 한 개 근접 사진은 허용합니다. 상품 밖 설명 텍스트·프레임·인셋·다른 구성은 제외하고 제품 자체 라벨은 보존해야 합니다. " +
    "추가 사진이 없으면 같은 후보의 반복 수집 대신 원본 사진을 보완하세요. AI 연출로 원본 슬롯을 대체하지 않습니다.";
  return { code: "IMAGE_SOURCE_BINDING_REQUIRED", sectionId: options.sectionId, imageSource: "seller-original",
    action: "provide-clean-seller-photo", candidateCount, rejectedCount: rejected.length, causes, message };
}
