import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getAppDataDir } from '../../scripts/lib/app-paths';

export type PublishAttemptStage = 'PREPARING' | 'SUBMITTING' | 'CONFIRMED' | 'FAILED_BEFORE_SUBMIT' | 'OUTCOME_UNKNOWN';
export interface PublishAttempt {
  id: string;
  productId: string;
  mode: 'now' | 'schedule';
  manifestHash: string;
  stage: PublishAttemptStage;
  startedAt: string;
  updatedAt: string;
  ownerPid?: number;
  publisherPid?: number;
  submittedAt?: string;
  confirmedAt?: string;
  sourceManifestPath?: string;
  snapshotManifestPath?: string;
  snapshotHash?: string;
  evidence?: { postUrl?: string; reservationId?: string; scheduledDate?: string };
}
function location(productId: string) {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(productId)) throw new Error('Invalid publication product ID');
  return path.join(getAppDataDir(), 'publish-attempts', `${productId}.json`);
}
function persist(attempt: PublishAttempt) {
  const target = location(attempt.productId);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(attempt), { flag: 'wx' });
  fs.renameSync(temporary, target);
}
export function publicationMaterialHash(manifestPath: string): string {
  const bytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(bytes.toString('utf8')) as { markdownPath?: string; heroImagePath?: string; bodyImagePaths?: string[]; composition?: { sections?: Array<{ imagePaths?: string[] }> } };
  const hash = crypto.createHash('sha256').update(bytes);
  const files = new Set([manifest.markdownPath, manifest.heroImagePath, ...(manifest.bodyImagePaths || []), ...(manifest.composition?.sections || []).flatMap(section => section.imagePaths || [])].filter((file): file is string => Boolean(file)));
  for (const file of [...files].sort()) {
    const resolved = path.isAbsolute(file) ? file : path.resolve(path.dirname(manifestPath), file);
    hash.update(resolved).update(fs.readFileSync(resolved));
  }
  return hash.digest('hex');
}
export function readPublishAttempt(productId: string): PublishAttempt | null {
  const file = location(productId);
  if (!fs.existsSync(file)) return null;
  // A corrupt receipt cannot grant permission to repeat an external submission.
  const value = JSON.parse(fs.readFileSync(file, 'utf8')) as PublishAttempt;
  if (value.productId !== productId || !value.id || !['PREPARING', 'SUBMITTING', 'CONFIRMED', 'FAILED_BEFORE_SUBMIT', 'OUTCOME_UNKNOWN'].includes(value.stage)) throw new Error('발행 시도 기록을 읽지 못했습니다. 실제 게시 여부부터 확인하세요.');
  return value;
}
export function createPublishAttempt(productId: string, mode: 'now' | 'schedule', manifestPath: string): PublishAttempt {
  const previous = readPublishAttempt(productId);
  if (previous && previous.stage !== 'FAILED_BEFORE_SUBMIT') throw new Error('이 소재의 이전 발행 시도가 있습니다. 실제 게시 여부를 확인한 뒤 처리하세요.');
  const now = new Date().toISOString();
  const attempt: PublishAttempt = { id: crypto.randomUUID(), productId, mode, manifestHash: publicationMaterialHash(manifestPath), stage: 'PREPARING', startedAt: now, updatedAt: now, ownerPid: process.pid };
  const snapshotDir = path.join(path.dirname(location(productId)), 'snapshots', attempt.id);
  fs.mkdirSync(snapshotDir, { recursive: true });
  const source = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const files = new Set<string>([source.markdownPath, source.heroImagePath, ...(source.bodyImagePaths || []),
    ...(source.composition?.sections || []).flatMap((section: { imagePaths?: string[] }) => section.imagePaths || [])].filter(Boolean));
  const mapped = new Map<string, string>();
  for (const file of files) {
    const resolved = path.isAbsolute(file) ? file : path.resolve(path.dirname(manifestPath), file);
    const destination = path.join(snapshotDir, `${mapped.size}-${path.basename(resolved)}`);
    fs.copyFileSync(resolved, destination, fs.constants.COPYFILE_EXCL);
    mapped.set(file, destination);
    mapped.set(resolved, destination);
  }
  // Rewrite every occurrence, including render nodes and image provenance records.
  const snapshot = JSON.parse(JSON.stringify(source, (_key, value) => typeof value === 'string' ? mapped.get(value) || value : value));
  const snapshotPath = path.join(snapshotDir, 'manifest.json');
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot), { flag: 'wx' });
  // Detect replacement or in-place editing while copying, before spawning a publisher.
  if (publicationMaterialHash(manifestPath) !== attempt.manifestHash) throw new Error('소재 복사 중 내용이 변경되었습니다. 다시 선택하세요.');
  for (const file of files) {
    const resolved = path.isAbsolute(file) ? file : path.resolve(path.dirname(manifestPath), file);
    if (!fs.readFileSync(resolved).equals(fs.readFileSync(mapped.get(file)!))) throw new Error('소재 이미지 복사 중 내용이 변경되었습니다. 다시 선택하세요.');
  }
  attempt.sourceManifestPath = path.resolve(manifestPath);
  attempt.snapshotManifestPath = snapshotPath;
  attempt.snapshotHash = publicationMaterialHash(snapshotPath);
  persist(attempt);
  return attempt;
}
export function updatePublishAttempt(productId: string, id: string, stage: PublishAttemptStage, evidence?: PublishAttempt['evidence']) {
  const previous = readPublishAttempt(productId);
  if (!previous || previous.id !== id) throw new Error('발행 시도 식별자가 변경되었습니다. 중복 제출을 중단합니다.');
  if (previous.stage === 'CONFIRMED') return previous;
  if (stage === 'SUBMITTING' && previous.stage !== 'PREPARING') throw new Error('이미 제출된 발행 시도를 다시 실행할 수 없습니다.');
  if (stage === 'FAILED_BEFORE_SUBMIT' && !['PREPARING', 'FAILED_BEFORE_SUBMIT'].includes(previous.stage)) stage = 'OUTCOME_UNKNOWN';
  if (stage === 'CONFIRMED' && (previous.stage === 'PREPARING' || previous.stage === 'FAILED_BEFORE_SUBMIT' ||
      (previous.mode === 'now' ? !evidence?.postUrl : !evidence?.reservationId || !evidence?.scheduledDate))) throw new Error('확인된 발행 결과 증거가 없습니다.');
  const now = new Date().toISOString();
  const attempt = { ...previous, stage, updatedAt: now,
    ...(stage === 'SUBMITTING' ? { submittedAt: previous.submittedAt || now } : {}),
    ...(stage === 'CONFIRMED' ? { confirmedAt: previous.confirmedAt || now } : {}),
    ...(evidence ? { evidence } : {}) };
  persist(attempt);
  return attempt;
}
export function interruptedPublishStatus(attempt: PublishAttempt | null): 'FAILED' | 'OUTCOME_UNKNOWN' {
  return attempt && (attempt.stage === 'PREPARING' || attempt.stage === 'FAILED_BEFORE_SUBMIT') ? 'FAILED' : 'OUTCOME_UNKNOWN';
}

export function recordPublisherPid(productId: string, attemptId: string, publisherPid: number) {
  const attempt = readPublishAttempt(productId);
  if (!attempt || attempt.id !== attemptId || !Number.isInteger(publisherPid) || publisherPid < 1) throw new Error('발행 프로세스 식별자를 저장하지 못했습니다.');
  persist({ ...attempt, publisherPid });
}

/** A live PID or an access error never permits recovery. Legacy receipts lack proof. */
export function publisherHasExited(attempt: PublishAttempt, probe = (pid: number) => process.kill(pid, 0)): boolean {
  // The launcher can exit while its detached child is still publishing.
  const pid = attempt.publisherPid;
  if (!pid) return false;
  try { probe(pid); return false; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH'; }
}
