export function addDaysToYmd(ymd: string, offsetDays: number): string {
  const [yearText, monthText, dayText] = ymd.split("-");
  const year = Number.parseInt(yearText, 10);
  const month = Number.parseInt(monthText, 10);
  const day = Number.parseInt(dayText, 10);
  const date = new Date(Date.UTC(year, month - 1, day + offsetDays, 0, 0, 0, 0));
  return date.toISOString().slice(0, 10);
}

export function compactedScheduleDate(
  startDate: string,
  successfulCount: number,
  intervalDays: number,
  occupiedDates: Iterable<string> = [],
): string {
  const occupied = new Set(occupiedDates);
  let availableIndex = 0;
  for (let slotIndex = 0; slotIndex < 10_000; slotIndex += 1) {
    const candidate = addDaysToYmd(startDate, slotIndex * intervalDays);
    if (occupied.has(candidate)) continue;
    if (availableIndex === successfulCount) return candidate;
    availableIndex += 1;
  }
  throw new Error("예약 가능한 빈 날짜를 계산하지 못했습니다.");
}

export function ymdInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

export function normalizeBulkScheduleStartDate(
  requestedDate: string,
  now = new Date(),
  timeZone = "Asia/Seoul",
): string {
  const today = ymdInTimeZone(now, timeZone);
  return requestedDate <= today ? addDaysToYmd(today, 1) : requestedDate;
}

function ymdToUtcDays(ymd: string): number {
  const [year, month, day] = ymd.split("-").map((part) => Number.parseInt(part, 10));
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
}

/** 같은 상품의 전체 리뷰·주제 글끼리 둘 최소 예약 간격(일). 유사문서·도배 인상을 줄인다. */
export const SIBLING_POST_MIN_GAP_DAYS = 2;

/**
 * 같은 상품(형제 글)의 예약일과 최소 간격을 지키는 날짜를 고른다. 후보가 충돌하면 간격 단위로
 * 뒤로 밀되 이미 예약된 날짜는 건너뛴다. 밀린 날짜는 호출자가 점유 목록에 추가해야 한다.
 */
export function familySafeScheduleDate(
  candidate: string,
  intervalDays: number,
  familyDates: Iterable<string>,
  occupiedDates: ReadonlySet<string> = new Set(),
  minGapDays = SIBLING_POST_MIN_GAP_DAYS,
): string {
  const family = [...familyDates].map(ymdToUtcDays);
  const step = Math.max(1, Math.trunc(intervalDays) || 1);
  for (let offset = 0; offset < 10_000; offset += 1) {
    const date = addDaysToYmd(candidate, offset * step);
    if (offset > 0 && occupiedDates.has(date)) continue;
    const day = ymdToUtcDays(date);
    if (family.every((other) => Math.abs(day - other) >= minGapDays)) return date;
  }
  throw new Error("같은 상품 글 간격을 지키는 예약 날짜를 계산하지 못했습니다.");
}
