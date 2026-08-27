import { NextResponse } from 'next/server';
import { ensureDatabase } from '@/db/init';
import { getD1 } from '@/db';
import { newId } from '@/lib/crypto';
import { jsonValue, readObject } from '@/lib/http';
import { resolveMcpConnection, splitMcpCredential } from '@/lib/mcp';

type JsonObject = Record<string, unknown>;
type JsonRpcId = string | number | null;

const MODERN_PROTOCOL = '2026-07-28';
const LEGACY_PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const;
const SUPPORTED_PROTOCOLS = [MODERN_PROTOCOL, ...LEGACY_PROTOCOLS] as const;
const RESPONSE_HEADERS = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' };
const CONNECT_KINDS = ['shopping', 'travel'];
const SERVER_INFO = { name: 'BlogAutoMCP', version: '1.1.0' };
const SERVER_INSTRUCTIONS = '승인된 한 대의 Windows PC에서 쇼핑커넥트와 여행커넥트 조회·초안·발행 작업을 수행합니다. 실제 발행 또는 예약 전에는 사용자의 명시적 확인을 받고 confirmed=true를 전달하세요.';

const TOOLS = [
  {
    name: 'agent_get_status',
    title: '로컬 에이전트 상태 확인',
    description: '인증된 Windows PC의 온라인 여부, 앱 버전, 마지막 접속 시각을 확인합니다.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'brandconnect_list_products',
    title: '브랜드커넥트 상품 목록',
    description: '로컬 PC에서 쇼핑커넥트 또는 여행커넥트 상품 목록을 조회합니다.',
    inputSchema: { type: 'object', properties: { connectKind: { type: 'string', enum: CONNECT_KINDS }, status: { type: 'string', enum: ['all', 'ready', 'published', 'failed'], default: 'all' }, idempotencyKey: { type: 'string', pattern: '^[A-Za-z0-9._:-]{8,120}$' } }, required: ['connectKind'], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: 'brandconnect_sync_products',
    title: '브랜드커넥트 상품 가져오기',
    description: '네이버 브랜드커넥트에서 쇼핑 또는 여행 상품을 로컬 작업 목록으로 가져옵니다.',
    inputSchema: { type: 'object', properties: { connectKind: { type: 'string', enum: CONNECT_KINDS }, count: { type: 'integer', minimum: 1, maximum: 50, default: 10 }, idempotencyKey: { type: 'string', pattern: '^[A-Za-z0-9._:-]{8,120}$' } }, required: ['connectKind', 'idempotencyKey'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: 'post_create_draft',
    title: '포스팅 초안 생성',
    description: '선택한 쇼핑 또는 여행 상품으로 로컬 PC에서 포스팅 초안을 생성합니다.',
    inputSchema: { type: 'object', properties: { connectKind: { type: 'string', enum: CONNECT_KINDS }, productId: { type: 'string', minLength: 1, maxLength: 160 }, memo: { type: 'string', maxLength: 1000 }, idempotencyKey: { type: 'string', pattern: '^[A-Za-z0-9._:-]{8,120}$' } }, required: ['connectKind', 'productId', 'idempotencyKey'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: 'post_publish',
    title: '네이버 블로그 즉시 발행',
    description: '검토된 쇼핑 또는 여행 초안을 즉시 발행합니다. confirmed=true가 반드시 필요합니다.',
    inputSchema: { type: 'object', properties: { connectKind: { type: 'string', enum: CONNECT_KINDS }, draftId: { type: 'string', minLength: 1, maxLength: 160 }, confirmed: { type: 'boolean', const: true }, idempotencyKey: { type: 'string', pattern: '^[A-Za-z0-9._:-]{8,120}$' } }, required: ['connectKind', 'draftId', 'confirmed', 'idempotencyKey'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  {
    name: 'post_schedule',
    title: '네이버 블로그 예약 발행',
    description: '검토된 쇼핑 또는 여행 초안을 Asia/Seoul 기준 날짜에 예약합니다. confirmed=true가 반드시 필요합니다.',
    inputSchema: { type: 'object', properties: { connectKind: { type: 'string', enum: CONNECT_KINDS }, draftId: { type: 'string', minLength: 1, maxLength: 160 }, scheduledDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, confirmed: { type: 'boolean', const: true }, idempotencyKey: { type: 'string', pattern: '^[A-Za-z0-9._:-]{8,120}$' } }, required: ['connectKind', 'draftId', 'scheduledDate', 'confirmed', 'idempotencyKey'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  {
    name: 'job_get',
    title: '작업 결과 확인',
    description: '비동기 작업의 상태, 진행률, 결과 또는 오류를 확인합니다.',
    inputSchema: { type: 'object', properties: { jobId: { type: 'string', minLength: 1, maxLength: 80 } }, required: ['jobId'], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'job_cancel',
    title: '대기 작업 취소',
    description: '아직 로컬 PC가 가져가지 않은 대기 작업만 취소합니다.',
    inputSchema: { type: 'object', properties: { jobId: { type: 'string', minLength: 1, maxLength: 80 } }, required: ['jobId'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
] as const;

function rpcResult(id: JsonRpcId, result: unknown, status = 200) {
  return NextResponse.json({ jsonrpc: '2.0', id, result }, { status, headers: RESPONSE_HEADERS });
}

function rpcError(id: JsonRpcId, code: number, message: string, status = 200, data?: unknown) {
  return NextResponse.json({ jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } }, { status, headers: RESPONSE_HEADERS });
}

function toolPayload(data: JsonObject, isError = false) {
  return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data, ...(isError ? { isError: true } : {}) };
}

function completeResult(result: JsonObject) {
  return { resultType: 'complete', ...result };
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function stringArg(args: JsonObject, key: string): string {
  return typeof args[key] === 'string' ? (args[key] as string).trim() : '';
}

function validIdempotencyKey(args: JsonObject): string | null {
  const value = stringArg(args, 'idempotencyKey');
  return /^[A-Za-z0-9._:-]{8,120}$/.test(value) ? value : null;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function validOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

function decodedHeaderValue(value: string | null): string | null {
  if (value === null) return null;
  const encoded = /^=\?base64\?([A-Za-z0-9+/]*={0,2})\?=$/.exec(value);
  if (encoded) {
    try {
      const binary = atob(encoded[1]);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return null;
    }
  }
  if (value.startsWith('=?base64?') || value.endsWith('?=')) return null;
  if (!/^[\x20-\x7E]*$/.test(value) || value.trim() !== value) return null;
  return value;
}

async function activeDevice(userId: string) {
  await ensureDatabase();
  return getD1().prepare(`SELECT id,name,platform,app_version AS appVersion,last_seen_at AS lastSeenAt FROM devices WHERE user_id=? AND status='ACTIVE' ORDER BY paired_at DESC LIMIT 1`).bind(userId).first<{ id: string; name: string; platform: string | null; appVersion: string | null; lastSeenAt: number | null }>();
}

async function enqueue(userId: string, type: string, args: JsonObject) {
  await ensureDatabase();
  const d1 = getD1();
  const inputJson = JSON.stringify(args);
  const idempotencyKey = stringArg(args, 'idempotencyKey') || null;
  if (idempotencyKey) {
    const existing = await d1.prepare(`SELECT id,type,input_json AS inputJson,status FROM agent_jobs WHERE user_id=? AND idempotency_key=? LIMIT 1`).bind(userId, idempotencyKey).first<{ id: string; type: string; inputJson: string; status: string }>();
    if (existing) {
      if (existing.type !== type || existing.inputJson !== inputJson) return toolPayload({ ok: false, code: 'IDEMPOTENCY_CONFLICT', message: '같은 idempotencyKey가 다른 요청에 이미 사용되었습니다.' }, true);
      return toolPayload({ ok: true, jobId: existing.id, status: existing.status, reused: true });
    }
  }

  const device = await activeDevice(userId);
  const online = Boolean(device?.lastSeenAt && Date.now() - device.lastSeenAt < 90_000);
  if (!device || !online) return toolPayload({ ok: false, code: 'AGENT_OFFLINE', message: '인증된 로컬 프로그램이 온라인 상태가 아닙니다.' }, true);

  const jobId = newId('job');
  const now = Date.now();
  const inserted = await d1.prepare(`INSERT OR IGNORE INTO agent_jobs (id,user_id,type,connect_kind,input_json,status,progress,idempotency_key,created_at,updated_at) VALUES (?,?,?,?,?,'QUEUED',0,?,?,?)`).bind(jobId, userId, type, typeof args.connectKind === 'string' ? args.connectKind : null, inputJson, idempotencyKey, now, now).run();
  if (Number(inserted.meta.changes || 0) !== 1 && idempotencyKey) {
    const raced = await d1.prepare(`SELECT id,type,input_json AS inputJson,status FROM agent_jobs WHERE user_id=? AND idempotency_key=? LIMIT 1`).bind(userId, idempotencyKey).first<{ id: string; type: string; inputJson: string; status: string }>();
    if (raced && raced.type === type && raced.inputJson === inputJson) return toolPayload({ ok: true, jobId: raced.id, status: raced.status, reused: true });
    return toolPayload({ ok: false, code: 'IDEMPOTENCY_CONFLICT', message: '같은 idempotencyKey가 다른 요청과 충돌했습니다.' }, true);
  }
  await d1.prepare(`INSERT INTO audit_events (id,actor_user_id,target_user_id,action,metadata_json,created_at) VALUES (?,?,?,?,?,?)`).bind(newId('audit'), userId, userId, 'AGENT_JOB_ENQUEUED', JSON.stringify({ jobId, type, connectKind: args.connectKind || null }), now).run();
  return toolPayload({ ok: true, jobId, status: 'QUEUED', message: '로컬 프로그램에 작업을 전달했습니다.' });
}

async function callTool(userId: string, name: string, args: JsonObject) {
  const d1 = getD1();
  if (name === 'agent_get_status') {
    const device = await activeDevice(userId);
    const online = Boolean(device?.lastSeenAt && Date.now() - device.lastSeenAt < 90_000);
    return toolPayload({ ok: true, online, device: device ? { name: device.name, platform: device.platform, appVersion: device.appVersion, lastSeenAt: device.lastSeenAt ? new Date(device.lastSeenAt).toISOString() : null } : null });
  }
  if (name === 'job_get') {
    const jobId = stringArg(args, 'jobId');
    const job = jobId ? await d1.prepare(`SELECT id,type,status,progress,result_json AS resultJson,error_code AS errorCode,error_message AS errorMessage,created_at AS createdAt,finished_at AS finishedAt FROM agent_jobs WHERE id=? AND user_id=? LIMIT 1`).bind(jobId, userId).first<{ id: string; type: string; status: string; progress: number; resultJson: string | null; errorCode: string | null; errorMessage: string | null; createdAt: number; finishedAt: number | null }>() : null;
    if (!job) return toolPayload({ ok: false, code: 'JOB_NOT_FOUND', message: '작업을 찾을 수 없습니다.' }, true);
    return toolPayload({ ok: true, job: { id: job.id, type: job.type, status: job.status, progress: job.progress, result: jsonValue(job.resultJson), errorCode: job.errorCode, errorMessage: job.errorMessage, createdAt: new Date(job.createdAt).toISOString(), finishedAt: job.finishedAt ? new Date(job.finishedAt).toISOString() : null } });
  }
  if (name === 'job_cancel') {
    const jobId = stringArg(args, 'jobId');
    if (!jobId || jobId.length > 80) return toolPayload({ ok: false, code: 'JOB_NOT_FOUND', message: '작업을 찾을 수 없습니다.' }, true);
    const now = Date.now();
    const cancelled = await d1.prepare(`UPDATE agent_jobs SET status='CANCELLED', progress=100, error_code='USER_CANCELLED', error_message='ChatGPT에서 대기 작업 취소를 요청함', updated_at=?, finished_at=? WHERE id=? AND user_id=? AND status='QUEUED'`).bind(now, now, jobId, userId).run();
    if (Number(cancelled.meta.changes || 0) !== 1) return toolPayload({ ok: false, code: 'JOB_NOT_QUEUED', message: '실행 전 대기 상태의 작업만 취소할 수 있습니다.' }, true);
    await d1.prepare(`INSERT INTO audit_events (id,actor_user_id,target_user_id,action,metadata_json,created_at) VALUES (?,?,?,?,?,?)`).bind(newId('audit'), userId, userId, 'AGENT_JOB_CANCELLED', JSON.stringify({ jobId }), now).run();
    return toolPayload({ ok: true, jobId, status: 'CANCELLED' });
  }

  const types: Record<string, string> = { brandconnect_list_products: 'BRANDCONNECT_LIST_PRODUCTS', brandconnect_sync_products: 'BRANDCONNECT_SYNC_PRODUCTS', post_create_draft: 'POST_CREATE_DRAFT', post_publish: 'POST_PUBLISH', post_schedule: 'POST_SCHEDULE' };
  const type = types[name];
  if (!type) return toolPayload({ ok: false, code: 'TOOL_NOT_FOUND', message: '지원하지 않는 도구입니다.' }, true);
  const connectKind = stringArg(args, 'connectKind');
  if (!CONNECT_KINDS.includes(connectKind)) return toolPayload({ ok: false, code: 'INVALID_CONNECT_KIND', message: 'connectKind는 shopping 또는 travel이어야 합니다.' }, true);
  const safeArgs: JsonObject = { connectKind };

  if (name === 'brandconnect_list_products') {
    const status = stringArg(args, 'status') || 'all';
    if (!['all', 'ready', 'published', 'failed'].includes(status)) return toolPayload({ ok: false, code: 'INVALID_STATUS', message: '지원하지 않는 상품 상태입니다.' }, true);
    safeArgs.status = status;
    const optionalKey = stringArg(args, 'idempotencyKey');
    if (optionalKey && !validIdempotencyKey(args)) return toolPayload({ ok: false, code: 'INVALID_IDEMPOTENCY_KEY', message: 'idempotencyKey는 영문·숫자·._:- 조합 8~120자로 입력해야 합니다.' }, true);
    if (optionalKey) safeArgs.idempotencyKey = optionalKey;
    return enqueue(userId, type, safeArgs);
  }

  const idempotencyKey = validIdempotencyKey(args);
  if (!idempotencyKey) return toolPayload({ ok: false, code: 'INVALID_IDEMPOTENCY_KEY', message: 'idempotencyKey는 영문·숫자·._:- 조합 8~120자로 입력해야 합니다.' }, true);
  safeArgs.idempotencyKey = idempotencyKey;

  if (name === 'brandconnect_sync_products') {
    const count = typeof args.count === 'number' && Number.isInteger(args.count) ? args.count : 10;
    if (count < 1 || count > 50) return toolPayload({ ok: false, code: 'INVALID_COUNT', message: 'count는 1~50의 정수여야 합니다.' }, true);
    safeArgs.count = count;
  }
  if (name === 'post_create_draft') {
    const productId = stringArg(args, 'productId');
    if (!productId || productId.length > 160) return toolPayload({ ok: false, code: 'INVALID_PRODUCT_ID', message: 'productId를 확인하세요.' }, true);
    safeArgs.productId = productId;
    const memo = stringArg(args, 'memo');
    if (memo.length > 1000) return toolPayload({ ok: false, code: 'MEMO_TOO_LONG', message: 'memo는 1000자 이하여야 합니다.' }, true);
    if (memo) safeArgs.memo = memo;
  }
  if (name === 'post_publish' || name === 'post_schedule') {
    if (args.confirmed !== true) return toolPayload({ ok: false, code: 'CONFIRMATION_REQUIRED', message: '실제 발행 전 confirmed=true 확인이 필요합니다.' }, true);
    const draftId = stringArg(args, 'draftId');
    if (!draftId || draftId.length > 160) return toolPayload({ ok: false, code: 'INVALID_DRAFT_ID', message: 'draftId를 확인하세요.' }, true);
    safeArgs.draftId = draftId;
    safeArgs.confirmed = true;
    if (name === 'post_schedule') {
      const scheduledDate = stringArg(args, 'scheduledDate');
      if (!validDate(scheduledDate)) return toolPayload({ ok: false, code: 'INVALID_SCHEDULE_DATE', message: 'scheduledDate는 존재하는 YYYY-MM-DD 날짜여야 합니다.' }, true);
      safeArgs.scheduledDate = scheduledDate;
    }
  }
  return enqueue(userId, type, safeArgs);
}

export async function POST(request: Request, context: { params: Promise<{ credential: string }> }) {
  if (!validOrigin(request)) return rpcError(null, -32000, 'Invalid Origin.', 403);
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) return rpcError(null, -32700, 'Content-Type must be application/json.', 415);

  const { credential } = await context.params;
  const split = splitMcpCredential(credential);
  if (!split) return rpcError(null, -32001, 'MCP endpoint is invalid.', 404);
  const connection = await resolveMcpConnection(split.endpointId, split.secret);
  if (!connection) return rpcError(null, -32001, 'MCP endpoint was revoked or is invalid.', 401);

  const body = await readObject(request, 256 * 1024);
  if (!body) return rpcError(null, -32700, 'Parse error');
  const id = typeof body.id === 'string' || typeof body.id === 'number' || body.id === null ? body.id : null;
  if (body.jsonrpc !== '2.0') return rpcError(id, -32600, 'Invalid Request');
  const method = typeof body.method === 'string' ? body.method : '';
  if (!method) return new NextResponse(null, { status: 202, headers: RESPONSE_HEADERS });

  const params = asObject(body.params);
  const meta = asObject(params._meta);
  const protocolHeader = request.headers.get('mcp-protocol-version');
  const metaProtocol = typeof meta['io.modelcontextprotocol/protocolVersion'] === 'string'
    ? meta['io.modelcontextprotocol/protocolVersion'] as string
    : null;
  const requestedProtocol = protocolHeader || metaProtocol;

  if (requestedProtocol && !SUPPORTED_PROTOCOLS.includes(requestedProtocol as typeof SUPPORTED_PROTOCOLS[number])) {
    return rpcError(id, -32022, 'Unsupported protocol version.', 400, { supported: [...SUPPORTED_PROTOCOLS], requested: requestedProtocol });
  }

  const modern = protocolHeader === MODERN_PROTOCOL || metaProtocol === MODERN_PROTOCOL || method === 'server/discover';
  if (modern) {
    if (protocolHeader !== MODERN_PROTOCOL || metaProtocol !== MODERN_PROTOCOL) {
      return rpcError(id, -32020, 'Header mismatch: MCP-Protocol-Version must match request _meta.', 400);
    }
    if (request.headers.get('mcp-method') !== method) {
      return rpcError(id, -32020, 'Header mismatch: Mcp-Method must match the request method.', 400);
    }
    const clientCapabilities = meta['io.modelcontextprotocol/clientCapabilities'];
    if (!clientCapabilities || typeof clientCapabilities !== 'object' || Array.isArray(clientCapabilities)) {
      return rpcError(id, -32602, 'Invalid params: clientCapabilities metadata is required.', 400);
    }
    if (method === 'tools/call') {
      const name = typeof params.name === 'string' ? params.name : '';
      if (!name || decodedHeaderValue(request.headers.get('mcp-name')) !== name) {
        return rpcError(id, -32020, 'Header mismatch: Mcp-Name must match the requested tool name.', 400);
      }
    }
  }

  try {
    if (method === 'initialize') {
      const requested = stringArg(asObject(body.params), 'protocolVersion');
      const protocolVersion = LEGACY_PROTOCOLS.includes(requested as typeof LEGACY_PROTOCOLS[number]) ? requested : LEGACY_PROTOCOLS[0];
      return rpcResult(id, { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: SERVER_INSTRUCTIONS });
    }
    if (method.startsWith('notifications/')) return new NextResponse(null, { status: 202, headers: RESPONSE_HEADERS });
    if (method === 'server/discover') {
      return rpcResult(id, completeResult({
        supportedVersions: [MODERN_PROTOCOL],
        capabilities: { tools: { listChanged: false } },
        _meta: { 'io.modelcontextprotocol/serverInfo': SERVER_INFO },
        instructions: SERVER_INSTRUCTIONS,
        ttlMs: 300_000,
        cacheScope: 'private',
      }));
    }
    if (method === 'ping') return rpcResult(id, modern ? completeResult({}) : {});
    if (method === 'tools/list') return rpcResult(id, modern ? completeResult({ tools: TOOLS, ttlMs: 300_000, cacheScope: 'private' }) : { tools: TOOLS });
    if (method === 'tools/call') {
      const name = typeof params.name === 'string' ? params.name : '';
      const result = await callTool(connection.userId, name, asObject(params.arguments));
      return rpcResult(id, modern ? completeResult(result) : result);
    }
    return rpcError(id, -32601, 'Method not found', modern ? 404 : 200);
  } catch {
    return rpcError(id, -32603, 'Internal error');
  }
}

export function GET() {
  return NextResponse.json({ error: 'This stateless MCP endpoint accepts Streamable HTTP POST requests.' }, { status: 405, headers: { ...RESPONSE_HEADERS, allow: 'POST' } });
}

export function DELETE() {
  return new NextResponse(null, { status: 405, headers: { ...RESPONSE_HEADERS, allow: 'POST' } });
}
