import assert from 'node:assert/strict';
import { publisherHasExited, type PublishAttempt } from '../src/lib/publish-attempt';
import { recoverExitedPublications } from '../src/lib/publication-recovery';
import { optionalBlogCategories } from './lib/optional-blog-categories';

async function main() {
  const categories = new Map([['board', '1']]);
  assert.equal(await optionalBlogCategories(async () => categories), categories);
  const warnings: string[] = [];
  assert.equal((await optionalBlogCategories(async () => JSON.parse('<html>login</html>'), message => warnings.push(message))).size, 0);
  assert.equal(warnings.length, 1);
  assert.ok(!warnings[0].includes('<html>'));
  const receipt = { id: 'attempt', productId: 'product', publisherPid: 987, stage: 'SUBMITTING' } as PublishAttempt;
  assert.equal(publisherHasExited(receipt, () => true), false);
  assert.equal(publisherHasExited(receipt, () => { throw Object.assign(new Error(), { code: 'EPERM' }); }), false);
  assert.equal(publisherHasExited(receipt, () => { throw Object.assign(new Error(), { code: 'ESRCH' }); }), true);
  assert.equal(publisherHasExited({ ...receipt, publisherPid: undefined }), false);
  assert.equal(publisherHasExited({ ...receipt, publisherPid: undefined, ownerPid: 999 }, () => { throw Object.assign(new Error(), { code: 'ESRCH' }); }), false);
  const updates: any[] = [];
  const db = { brandLink: {
    findMany: async () => [{ id: 'product', updatedAt: new Date(1) }],
    updateMany: async (query: object) => { updates.push(query); return { count: 1 }; },
  } };
  assert.equal(await recoverExitedPublications(db, () => receipt, () => false), 0);
  assert.equal(await recoverExitedPublications(db, () => null, () => true), 0);
  assert.equal(await recoverExitedPublications(db, () => { throw new Error('corrupt'); }, () => true), 0);
  assert.equal(updates.length, 0);
  assert.equal(await recoverExitedPublications(db, () => receipt, () => true), 1);
  assert.equal(updates[0].data.status, 'OUTCOME_UNKNOWN');
  assert.deepEqual(updates[0].where, { id: 'product', status: 'PUBLISHING', updatedAt: new Date(1) });
  db.brandLink.updateMany = async () => ({ count: 0 });
  assert.equal(await recoverExitedPublications(db, () => receipt, () => true), 0);
  console.log('PASS: dead publisher recovery, live/unknown owner exclusion, CAS and no replay');
}
void main();
