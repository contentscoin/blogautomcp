import { readBrandPostPackage } from "./brand-post-package";

// Stable partition: preserve the caller's date/order within each group.
// Check all eligible rows before limiting, otherwise saved drafts outside the
// first page would never receive priority.
export function preparedPostsFirst<T extends { id: string }>(rows: T[], limit: number, hasPrepared = (id: string) => Boolean(readBrandPostPackage(id, { migrate: false }))): T[] {
  const prepared = new Set(rows.filter(row => {
    try { return hasPrepared(row.id); }
    catch { return false; }
  }).map(row => row.id));
  return [...rows.filter(row => prepared.has(row.id)), ...rows.filter(row => !prepared.has(row.id))].slice(0, limit);
}
