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
