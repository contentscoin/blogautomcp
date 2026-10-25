/** A public post, a submission receipt and a complete content audit are distinct evidence. */
export function publicationVerificationSummary(data: Record<string, unknown>): string {
  if (data.published === true) {
    if (data.contentVerified === true && data.verificationStatus === "verified") return "공개 글과 게시 콘텐츠 검증 완료";
    return data.verificationStatus === "mismatch"
      ? "공개 글 확인 · 게시 콘텐츠 불일치 확인 필요"
      : "공개 글 확인 · 게시 콘텐츠 검증 추가 확인 필요";
  }
  if (data.scheduled === true) return "예약 접수 확인 · 현재 예약 목록과 실제 게시 여부는 별도 확인 필요";
  if (data.outcomeUnknown === true) return "발행 결과 확인 필요 · 기존 제출 결과를 조회하세요";
  const status = typeof data.status === "string" && /^(?:READY|FAILED|DRAFTING|PUBLISHING|PUBLISHED|SCHEDULED|OUTCOME_UNKNOWN)$/u.test(data.status) ? data.status : "미상";
  return `발행 확인 미완료 (상태 ${status})`;
}
