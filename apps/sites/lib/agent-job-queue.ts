import { ensureDatabase } from '@/db/init';
import { getD1 } from '@/db';
import { newId } from '@/lib/crypto';
import { canonicalJson, sameCanonicalJson } from '@/lib/completion-contract';
import { DEVICE_ONLINE_MS, findActiveDevice, isAgentOnline, parseStatusJson, sweepExpiredLeases } from '@/lib/jobs';
import { jobGuidance } from '@/lib/mcp-job-status';
import { compareVersions } from '@/lib/version';

type JsonObject = Record<string, unknown>;
type QueueTool = { jobType?: string; minAppVersion?: string };
type ExistingJob = { id: string; type: string; inputJson: string; status: string };

/** MCP and authenticated dashboard actions share the same queue and idempotency contract. */
export async function enqueueAgentJob(userId: string, tool: QueueTool, args: JsonObject): Promise<JsonObject> {
  await ensureDatabase();
  const d1 = getD1();
  const type = tool.jobType as string;
  const inputJson = canonicalJson(args);
  const idempotencyKey = typeof args.idempotencyKey === 'string' ? args.idempotencyKey.trim() : null;
  const readExisting = () => d1.prepare(`SELECT id,type,input_json AS inputJson,status FROM agent_jobs WHERE user_id=? AND idempotency_key=? LIMIT 1`).bind(userId, idempotencyKey).first<ExistingJob>();
  const replay = (job: ExistingJob): JsonObject => job.type === type && sameCanonicalJson(job.inputJson, inputJson)
    ? { ok: true, jobId: job.id, status: job.status, reused: true, ...jobGuidance(job.status, null) }
    : { ok: false, code: 'IDEMPOTENCY_CONFLICT', message: '같은 idempotencyKey가 다른 요청에 이미 사용되었습니다.' };
  if (idempotencyKey) {
    const existing = await readExisting();
    if (existing) return replay(existing);
  }
  const now = Date.now();
  await sweepExpiredLeases(d1, userId, now);
  const device = await findActiveDevice(d1, userId);
  if (!device || !await isAgentOnline(d1, userId, device, now))
    return { ok: false, code: 'AGENT_OFFLINE', message: '인증된 로컬 프로그램이 온라인 상태가 아닙니다. PC 앱이 실행 중인지 확인하세요.' };
  if (tool.minAppVersion && compareVersions(device.appVersion, tool.minAppVersion) < 0)
    return { ok: false, code: 'APP_UPDATE_REQUIRED', message: `이 도구는 PC 앱 ${tool.minAppVersion} 이상이 필요합니다. 현재 ${device.appVersion || '알 수 없음'}. 앱을 업데이트하세요.`, required: tool.minAppVersion, current: device.appVersion };

  const recovery = ['MATERIALS_REWRITE_FAILED', 'MATERIALS_REPAIR_BLOCKED'].includes(type);
  let connection: { id: string; generation: number } | null = null;
  if (recovery) {
    connection = await d1.prepare(`SELECT m.id,m.generation FROM mcp_connections m JOIN users u ON u.id=m.user_id WHERE m.user_id=? AND m.status='ACTIVE' AND u.status='APPROVED' AND u.role IN ('USER','ADMIN') LIMIT 1`).bind(userId).first<{ id: string; generation: number }>();
    if (!connection) return { ok: false, code: 'MCP_NOT_ISSUED', message: '승인된 계정의 활성 PC 연결이 필요합니다.' };
    const busy = await d1.prepare(`SELECT id FROM agent_jobs WHERE user_id=? AND status IN ('QUEUED','RUNNING') LIMIT 1`).bind(userId).first<{ id: string }>();
    const snapshot = parseStatusJson(device.statusJson);
    const background = snapshot?.backgroundWork as JsonObject | undefined;
    if (busy || background?.busy === true || ['publishing', 'drafting', 'processes', 'imageGeneration'].some(key => Number(background?.[key] || 0) > 0))
      return { ok: false, code: 'AGENT_BUSY', message: 'PC에서 진행 중인 작업이 끝난 뒤 소재 복구를 시작하세요.', ...(busy ? { activeJobId: busy.id } : {}) };
    if (typeof background?.busy !== 'boolean' || background?.error === 'BACKGROUND_STATUS_UNAVAILABLE')
      return { ok: false, code: 'BACKGROUND_STATUS_UNAVAILABLE', message: 'PC의 진행 작업 상태를 확인하지 못했습니다. PC 상태가 갱신된 뒤 다시 시도하세요.' };
  }

  const jobId = newId('job');
  // A simultaneous PC replacement, connection rotation, suspension or competing recovery cannot bypass the preflight.
  const sql = recovery
    ? `INSERT OR IGNORE INTO agent_jobs (id,user_id,type,connect_kind,input_json,status,progress,idempotency_key,created_at,updated_at)
       SELECT ?,?,?,?,?,'QUEUED',0,?,?,?
       WHERE EXISTS (SELECT 1 FROM users u WHERE u.id=? AND u.status='APPROVED' AND u.role IN ('USER','ADMIN'))
         AND EXISTS (SELECT 1 FROM devices d WHERE d.id=? AND d.user_id=? AND d.status='ACTIVE' AND d.app_version=? AND d.last_seen_at>=? AND d.status_json IS ?)
         AND EXISTS (SELECT 1 FROM mcp_connections m WHERE m.id=? AND m.user_id=? AND m.generation=? AND m.status='ACTIVE')
         AND NOT EXISTS (SELECT 1 FROM agent_jobs j WHERE j.user_id=? AND j.status IN ('QUEUED','RUNNING'))`
    : `INSERT OR IGNORE INTO agent_jobs (id,user_id,type,connect_kind,input_json,status,progress,idempotency_key,created_at,updated_at) VALUES (?,?,?,?,?,'QUEUED',0,?,?,?)`;
  const values = [jobId, userId, type, typeof args.connectKind === 'string' ? args.connectKind : null, inputJson, idempotencyKey, now, now];
  if (recovery) values.push(userId, device.id, userId, device.appVersion, now - DEVICE_ONLINE_MS, device.statusJson, connection!.id, userId, connection!.generation, userId);
  const inserted = await d1.prepare(sql).bind(...values).run();
  if (Number(inserted.meta.changes || 0) !== 1) {
    const raced = idempotencyKey ? await readExisting() : null;
    if (raced) return replay(raced);
    return { ok: false, code: recovery ? 'AGENT_STATE_CHANGED' : 'IDEMPOTENCY_CONFLICT', message: recovery ? 'PC 연결이나 진행 작업이 변경되어 접수하지 못했습니다. 현재 상태를 확인한 뒤 다시 시도하세요.' : '같은 idempotencyKey가 다른 요청과 충돌했습니다.' };
  }
  await d1.prepare(`INSERT INTO audit_events (id,actor_user_id,target_user_id,action,metadata_json,created_at) VALUES (?,?,?,?,?,?)`).bind(newId('audit'), userId, userId, 'AGENT_JOB_ENQUEUED', JSON.stringify({ jobId, type, connectKind: args.connectKind || null }), now).run();
  return { ok: true, jobId, status: 'QUEUED', ...jobGuidance('QUEUED', null), nextCall: { tool: 'job_get', arguments: { jobId, waitMs: 20000, includeResult: false } } };
}
