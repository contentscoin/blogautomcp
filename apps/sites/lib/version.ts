/** "1.2.3" 형태 버전 비교. 파싱 불가한 값은 0 으로 본다. */
export function compareVersions(left: string | null | undefined, right: string | null | undefined): number {
  const parse = (value: string | null | undefined) => String(value || '').split('.').map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
