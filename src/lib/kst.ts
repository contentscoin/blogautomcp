/**
 * KST(한국 표준시) 시각 유틸.
 *
 * 한국은 DST(서머타임)가 없어 KST = UTC+9 고정이다. 이 프로젝트의 실제 발행 단계
 * (simple-agent / topic-agent)와 NAVER_SCHEDULE_TIMEZONE 기본값(Asia/Seoul)이 모두
 * KST를 전제로 하므로, 예약 시각 산정도 서버 로컬 타임존이 아닌 KST 기준으로 통일한다.
 *
 * 서버가 KST 머신이면 기존 `new Date(y, m, d, 9, ...)`와 동일한 결과를 내고,
 * 서버가 UTC(컨테이너/클라우드)이면 9시간 밀림 버그를 제거한다.
 */

export const KST_OFFSET_MINUTES = 9 * 60;

/**
 * KST 벽시계 시각(연/월/일/시/분/초)을 정확한 UTC instant(Date)로 변환한다.
 * @param month 1~12 (사람이 읽는 월)
 */
export function kstWallClockToInstant(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0
): Date {
  // KST(H시) = UTC(H-9시) 동일 날짜. Date.UTC가 음수 시각도 정규화한다.
  return new Date(Date.UTC(year, month - 1, day, hour - 9, minute, second, 0));
}

/** 임의의 instant를 KST 벽시계 기준 연/월/일/시/분으로 분해한다. */
export function getKstParts(date: Date): {
  year: number;
  month: number; // 1~12
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const shifted = new Date(date.getTime() + KST_OFFSET_MINUTES * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

/** KST 기준 YYYY-MM-DD 문자열. */
export function formatKstYmd(date: Date): string {
  const { year, month, day } = getKstParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
