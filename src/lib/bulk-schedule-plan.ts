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
): string {
  return addDaysToYmd(startDate, successfulCount * intervalDays);
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
