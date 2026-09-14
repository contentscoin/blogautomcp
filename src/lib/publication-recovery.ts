import { readPublishAttempt, publisherHasExited } from './publish-attempt';

type Database = {
  brandLink: {
    findMany(args: object): Promise<Array<{ id: string; updatedAt: Date }>>;
    updateMany(args: object): Promise<{ count: number }>;
  };
};

// Never infer failure from elapsed time. A dead publisher is recovered to unknown
// so another product can proceed without replaying a potentially submitted post.
export async function recoverExitedPublications(db: Database, read = readPublishAttempt, exited = publisherHasExited) {
  const rows = await db.brandLink.findMany({ where: { status: 'PUBLISHING' }, select: { id: true, updatedAt: true } });
  let recovered = 0;
  for (const row of rows) {
    let receipt;
    try { receipt = read(row.id); } catch { continue; }
    if (!receipt || !exited(receipt)) continue;
    const result = await db.brandLink.updateMany({
      where: { id: row.id, status: 'PUBLISHING', updatedAt: row.updatedAt },
      data: { status: 'OUTCOME_UNKNOWN', errorMessage: '발행 프로세스 종료를 확인했습니다. 실제 예약·게시 결과 확인 전 자동 재발행하지 않습니다.' },
    });
    recovered += result.count;
  }
  return recovered;
}
