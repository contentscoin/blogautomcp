import { NextResponse } from 'next/server';
import { ensureDatabase } from '@/db/init';
import { getD1 } from '@/db';
import { newId } from '@/lib/crypto';
import { jsonValue, readObject } from '@/lib/http';
import { findActiveDevice, isAgentOnline, parseStatusJson, sweepExpiredLeases } from '@/lib/jobs';
import { resolveMcpConnection, splitMcpCredential } from '@/lib/mcp';
import { clientIp, enforceRateLimit } from '@/lib/rate-limit';
import { validateToolArguments, type JsonSchema } from '@/lib/tool-schema';
import { compareVersions } from '@/lib/version';

type JsonObject = Record<string, unknown>;
type JsonRpcId = string | number | null;

const MODERN_PROTOCOL = '2026-07-28';
const LEGACY_PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const;
const SUPPORTED_PROTOCOLS = [MODERN_PROTOCOL, ...LEGACY_PROTOCOLS] as const;
const RESPONSE_HEADERS = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' };
const CONNECT_KINDS = ['shopping', 'travel'];
const SERVER_INFO = { name: 'BlogAutoMCP', version: '1.2.0' };
const SERVER_INSTRUCTIONS = [
  '승인된 한 대의 Windows PC에서 네이버 쇼핑커넥트·여행커넥트 작업을 수행합니다. 대부분의 도구는 작업(jobId)을 큐에 넣고 즉시 반환하며, job_get 으로 진행 단계와 결과를 확인합니다.',
  '권장 흐름: brandconnect_sync_products → brandconnect_list_products → post_create_draft → post_get_draft(검토, readiness 확인) → 필요 시 post_revise_draft / post_set_thumbnail → post_approve_draft → post_publish 또는 post_schedule(confirmed=true).',
  '실제 발행·예약 전에는 사용자의 명시적 확인을 받고 confirmed=true 를 전달하세요. 발행은 승인된 초안만 가능합니다.',
  '여행커넥트가 잠겨 있으면(TRAVEL_CONTRACT_LOCKED) travel_capture_contract 로 먼저 계약을 캡처하세요.',
].join(' ');

const IDEMPOTENCY = { type: 'string', pattern: '^[A-Za-z0-9._:-]{8,120}$', description: '재시도 시 같은 값을 보내면 작업이 중복 생성되지 않습니다.' } as const;
const CONNECT_KIND = { type: 'string', enum: CONNECT_KINDS } as const;
const ID_FIELD = { type: 'string', minLength: 1, maxLength: 160 } as const;
const JOB_RESULT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: { ok: { type: 'boolean' }, jobId: { type: 'string' }, status: { type: 'string' }, reused: { type: 'boolean' }, code: { type: 'string' }, message: { type: 'string' } },
  required: ['ok'],
};

interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
  /** 큐 작업 타입. 없으면 사이트가 동기 처리한다. */
  jobType?: string;
  /** 이 작업을 이해하는 데스크톱 최소 버전. 미달이면 APP_UPDATE_REQUIRED 로 큐잉을 거부한다. */
  minAppVersion?: string;
  requiresIdempotency?: boolean;
  requiresConfirmation?: boolean;
}

const V2_TOOLS_MIN_APP = '1.2.0';

const TOOLS: ToolDefinition[] = [
  {
    name: 'agent_get_status',
    title: '로컬 에이전트 상태 확인',
    description: '인증된 Windows PC의 온라인 여부, 앱 버전, 네이버 로그인·여행커넥트 계약·업데이트 상태와 실행 중 작업을 확인합니다.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'brandconnect_list_categories',
    title: '브랜드커넥트 카테고리·프로모션 목록',
    description: '상품 가져오기 필터에 쓸 수 있는 카테고리와 프로모션(할인/출발확정/노쇼핑 등) 목록을 로컬 PC에서 조회합니다.',
    inputSchema: { type: 'object', properties: { connectKind: CONNECT_KIND, idempotencyKey: IDEMPOTENCY }, required: ['connectKind'], additionalProperties: false },
    outputSchema: JOB_RESULT_SCHEMA,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    jobType: 'BRANDCONNECT_LIST_CATEGORIES',
    minAppVersion: V2_TOOLS_MIN_APP,
  },
  {
    name: 'brandconnect_list_products',
    title: '브랜드커넥트 상품 목록',
    description: '로컬 PC에 가져온 쇼핑커넥트 또는 여행커넥트 상품 목록을 조회합니다. keyword 로 상품명을 검색할 수 있습니다.',
    inputSchema: { type: 'object', properties: { connectKind: CONNECT_KIND, status: { type: 'string', enum: ['all', 'ready', 'published', 'failed'], default: 'all' }, keyword: { type: 'string', maxLength: 80 }, limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 }, sort: { type: 'string', enum: ['newest', 'oldest', 'name'], default: 'newest' }, idempotencyKey: IDEMPOTENCY }, required: ['connectKind'], additionalProperties: false },
    outputSchema: JOB_RESULT_SCHEMA,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    jobType: 'BRANDCONNECT_LIST_PRODUCTS',
  },
  {
    name: 'brandconnect_sync_products',
    title: '브랜드커넥트 상품 가져오기',
    description: '네이버 브랜드커넥트에서 쇼핑 또는 여행 상품을 로컬 작업 목록으로 가져옵니다. categoryFilter/promotionFilter 로 범위를 좁힐 수 있습니다.',
    inputSchema: { type: 'object', properties: { connectKind: CONNECT_KIND, count: { type: 'integer', minimum: 1, maximum: 50, default: 10 }, categoryFilter: { type: 'string', maxLength: 120 }, promotionFilter: { type: 'string', maxLength: 60 }, idempotencyKey: IDEMPOTENCY }, required: ['connectKind', 'idempotencyKey'], additionalProperties: false },
    outputSchema: JOB_RESULT_SCHEMA,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    jobType: 'BRANDCONNECT_SYNC_PRODUCTS',
    requiresIdempotency: true,
  },
  {
    name: 'post_create_draft',
    title: '포스팅 초안 생성',
    description: '선택한 상품으로 로컬 PC에서 포스팅 초안(글·이미지 슬롯·썸네일·검증 리포트)을 생성합니다. memo 로 톤이나 강조점을 지시할 수 있습니다. 결과는 job_get 으로 확인합니다.',
    inputSchema: { type: 'object', properties: { connectKind: CONNECT_KIND, productId: ID_FIELD, memo: { type: 'string', maxLength: 1000 }, idempotencyKey: IDEMPOTENCY }, required: ['connectKind', 'productId', 'idempotencyKey'], additionalProperties: false },
    outputSchema: JOB_RESULT_SCHEMA,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    jobType: 'POST_CREATE_DRAFT',
    requiresIdempotency: true,
  },
  {
    name: 'post_get_draft',
    title: '초안 읽기',
    description: '생성된 초안의 제목·섹션 개요·본문·해시태그·이미지 수·검증(readiness) 리포트를 읽습니다. includeImages=thumbnail 이면 대표 이미지를 함께 반환합니다.',
    inputSchema: { type: 'object', properties: { connectKind: CONNECT_KIND, draftId: ID_FIELD, includeImages: { type: 'string', enum: ['none', 'thumbnail'], default: 'none' }, idempotencyKey: IDEMPOTENCY }, required: ['connectKind', 'draftId'], additionalProperties: false },
    outputSchema: JOB_RESULT_SCHEMA,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    jobType: 'POST_GET_DRAFT',
    minAppVersion: V2_TOOLS_MIN_APP,
  },
  {
    name: 'post_revise_draft',
    title: '초안 부분 수정',
    description: '저장된 초안에서 지정한 섹션(없으면 검증에서 지적된 섹션)만 지시에 따라 다시 씁니다. 전체를 재생성하지 않습니다.',
    inputSchema: { type: 'object', properties: { connectKind: CONNECT_KIND, draftId: ID_FIELD, instructions: { type: 'string', minLength: 2, maxLength: 2000 }, sectionIndexes: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 39 }, maxItems: 20 }, idempotencyKey: IDEMPOTENCY }, required: ['connectKind', 'draftId', 'instructions', 'idempotencyKey'], additionalProperties: false },
    outputSchema: JOB_RESULT_SCHEMA,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    jobType: 'POST_REVISE_DRAFT',
    minAppVersion: V2_TOOLS_MIN_APP,
    requiresIdempotency: true,
  },
  {
    name: 'post_approve_draft',
    title: '초안 승인',
    description: '검토를 마친 초안을 발행 가능 상태로 승인합니다. post_publish / post_schedule 은 승인된 초안만 발행합니다.',
    inputSchema: { type: 'object', properties: { connectKind: CONNECT_KIND, draftId: ID_FIELD, idempotencyKey: IDEMPOTENCY }, required: ['connectKind', 'draftId', 'idempotencyKey'], additionalProperties: false },
    outputSchema: JOB_RESULT_SCHEMA,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    jobType: 'POST_APPROVE_DRAFT',
    minAppVersion: V2_TOOLS_MIN_APP,
    requiresIdempotency: true,
  },
  {
    name: 'post_set_thumbnail',
    title: '썸네일 생성·교체',
    description: '상품 사진을 참조해 gpt-image 로 썸네일을 새로 만들고(비전 검수 통과본만) 발행 첫 이미지로 저장합니다. mood 로 장면 분위기를, headline 으로 문구를 지정할 수 있습니다.',
    inputSchema: { type: 'object', properties: { connectKind: CONNECT_KIND, draftId: ID_FIELD, mood: { type: 'string', maxLength: 40 }, headline: { type: 'string', maxLength: 24 }, subline: { type: 'string', maxLength: 44 }, idempotencyKey: IDEMPOTENCY }, required: ['connectKind', 'draftId', 'idempotencyKey'], additionalProperties: false },
    outputSchema: JOB_RESULT_SCHEMA,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    jobType: 'POST_SET_THUMBNAIL',
    minAppVersion: V2_TOOLS_MIN_APP,
    requiresIdempotency: true,
  },
  {
    name: 'post_publish',
    title: '네이버 블로그 즉시 발행',
    description: '승인된 초안을 즉시 발행합니다. confirmed=true 가 반드시 필요합니다.',
    inputSchema: { type: 'object', properties: { connectKind: CONNECT_KIND, draftId: ID_FIELD, confirmed: { type: 'boolean', const: true }, idempotencyKey: IDEMPOTENCY }, required: ['connectKind', 'draftId', 'confirmed', 'idempotencyKey'], additionalProperties: false },
    outputSchema: JOB_RESULT_SCHEMA,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    jobType: 'POST_PUBLISH',
    requiresIdempotency: true,
    requiresConfirmation: true,
  },
  {
    name: 'post_schedule',
    title: '네이버 블로그 예약 발행',
    description: '승인된 초안을 Asia/Seoul 기준 날짜에 예약합니다. confirmed=true 가 반드시 필요합니다.',
    inputSchema: { type: 'object', properties: { connectKind: CONNECT_KIND, draftId: ID_FIELD, scheduledDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, confirmed: { type: 'boolean', const: true }, idempotencyKey: IDEMPOTENCY }, required: ['connectKind', 'draftId', 'scheduledDate', 'confirmed', 'idempotencyKey'], additionalProperties: false },
    outputSchema: JOB_RESULT_SCHEMA,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    jobType: 'POST_SCHEDULE',
    requiresIdempotency: true,
    requiresConfirmation: true,
  },
  {
    name: 'post_bulk_schedule',
    title: '여러 상품 예약 발행',
    description: '준비된 상품 여러 개를 시작 날짜부터 간격을 두고 예약 발행합니다. confirmed=true 가 반드시 필요합니다.',
    inputSchema: { type: 'object', properties: { connectKind: CONNECT_KIND, limit: { type: 'integer', minimum: 1, maximum: 50, default: 5 }, startDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, intervalDays: { type: 'integer', minimum: 1, maximum: 30, default: 1 }, confirmed: { type: 'boolean', const: true }, idempotencyKey: IDEMPOTENCY }, required: ['connectKind', 'confirmed', 'idempotencyKey'], additionalProperties: false },
    outputSchema: JOB_RESULT_SCHEMA,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    jobType: 'POST_BULK_SCHEDULE',
    minAppVersion: V2_TOOLS_MIN_APP,
    requiresIdempotency: true,
    requiresConfirmation: true,
  },
  {
    name: 'post_verify_published',
    title: '발행 결과 확인',
    description: '상품의 발행 상태와 블로그 글 URL 이 실제로 열리는지 확인합니다. AGENT_LOST_UNCERTAIN 이후 확인용으로도 씁니다.',
    inputSchema: { type: 'object', properties: { connectKind: CONNECT_KIND, draftId: ID_FIELD, idempotencyKey: IDEMPOTENCY }, required: ['connectKind', 'draftId'], additionalProperties: false },
    outputSchema: JOB_RESULT_SCHEMA,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    jobType: 'POST_VERIFY_PUBLISHED',
    minAppVersion: V2_TOOLS_MIN_APP,
  },
  {
    name: 'travel_capture_contract',
    title: '여행커넥트 계약 캡처',
    description: '여행커넥트 목록을 여는 데 필요한 계약을 로컬 PC의 네이버 로그인 세션으로 1회 캡처합니다. 여행커넥트가 잠겨 있을 때 먼저 실행합니다.',
    inputSchema: { type: 'object', properties: { categoryUrl: { type: 'string', maxLength: 400 }, confirmed: { type: 'boolean', const: true }, idempotencyKey: IDEMPOTENCY }, required: ['confirmed', 'idempotencyKey'], additionalProperties: false },
    outputSchema: JOB_RESULT_SCHEMA,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    jobType: 'TRAVEL_CAPTURE_CONTRACT',
    minAppVersion: V2_TOOLS_MIN_APP,
    requiresIdempotency: true,
    requiresConfirmation: true,
  },
  {
    name: 'settings_get',
    title: '로컬 설정 확인',
    description: '로컬 PC 의 블로그 ID 와 어떤 API 키가 설정되어 있는지(값은 마스킹) 확인합니다.',
    inputSchema: { type: 'object', properties: { idempotencyKey: IDEMPOTENCY }, additionalProperties: false },
    outputSchema: JOB_RESULT_SCHEMA,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    jobType: 'SETTINGS_GET',
    minAppVersion: V2_TOOLS_MIN_APP,
  },
  {
    name: 'job_get',
    title: '작업 결과 확인',
    description: '비동기 작업의 상태, 진행 단계, 결과 또는 오류를 확인합니다.',
    inputSchema: { type: 'object', properties: { jobId: { type: 'string', minLength: 1, maxLength: 80 } }, required: ['jobId'], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'job_cancel',
    title: '작업 취소',
    description: '대기 중 작업은 즉시 취소하고, 실행 중 작업에는 취소를 요청합니다(로컬 PC가 다음 하트비트에서 중단).',
    inputSchema: { type: 'object', properties: { jobId: { type: 'string', minLength: 1, maxLength: 80 } }, required: ['jobId'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
];

const TOOL_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

function publicTool(tool: ToolDefinition) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
    annotations: tool.annotations,
  };
}

function rpcResult(id: JsonRpcId, result: unknown, status = 200) {
  return NextResponse.json({ jsonrpc: '2.0', id, result }, { status, headers: RESPONSE_HEADERS });
}

function rpcError(id: JsonRpcId, code: number, message: string, status = 200, data?: unknown) {
  return NextResponse.json({ jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } }, { status, headers: RESPONSE_HEADERS });
}

type ContentBlock = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

function toolPayload(data: JsonObject, isError = false, extraContent: ContentBlock[] = []) {
  return { content: [{ type: 'text', text: JSON.stringify(data) } as ContentBlock, ...extraContent], structuredContent: data, ...(isError ? { isError: true } : {}) };
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

async function enqueue(userId: string, tool: ToolDefinition, args: JsonObject) {
  await ensureDatabase();
  const d1 = getD1();
  const type = tool.jobType as string;
  const inputJson = JSON.stringify(args);
  const idempotencyKey = stringArg(args, 'idempotencyKey') || null;
  if (idempotencyKey) {
    const existing = await d1.prepare(`SELECT id,type,input_json AS inputJson,status FROM agent_jobs WHERE user_id=? AND idempotency_key=? LIMIT 1`).bind(userId, idempotencyKey).first<{ id: string; type: string; inputJson: string; status: string }>();
    if (existing) {
      if (existing.type !== type || existing.inputJson !== inputJson) return toolPayload({ ok: false, code: 'IDEMPOTENCY_CONFLICT', message: '같은 idempotencyKey가 다른 요청에 이미 사용되었습니다.' }, true);
      return toolPayload({ ok: true, jobId: existing.id, status: existing.status, reused: true });
    }
  }

  const now = Date.now();
  await sweepExpiredLeases(d1, userId, now);
  const device = await findActiveDevice(d1, userId);
  const online = await isAgentOnline(d1, userId, device, now);
  if (!device || !online) return toolPayload({ ok: false, code: 'AGENT_OFFLINE', message: '인증된 로컬 프로그램이 온라인 상태가 아닙니다. PC 앱이 실행 중인지 확인하세요.' }, true);
  if (tool.minAppVersion && compareVersions(device.appVersion, tool.minAppVersion) < 0) {
    return toolPayload({ ok: false, code: 'APP_UPDATE_REQUIRED', message: `이 도구는 PC 앱 ${tool.minAppVersion} 이상이 필요합니다. 현재 ${device.appVersion || '알 수 없음'}. 앱을 업데이트하세요.`, required: tool.minAppVersion, current: device.appVersion }, true);
  }

  const jobId = newId('job');
  const inserted = await d1.prepare(`INSERT OR IGNORE INTO agent_jobs (id,user_id,type,connect_kind,input_json,status,progress,idempotency_key,created_at,updated_at) VALUES (?,?,?,?,?,'QUEUED',0,?,?,?)`).bind(jobId, userId, type, typeof args.connectKind === 'string' ? args.connectKind : null, inputJson, idempotencyKey, now, now).run();
  if (Number(inserted.meta.changes || 0) !== 1 && idempotencyKey) {
    const raced = await d1.prepare(`SELECT id,type,input_json AS inputJson,status FROM agent_jobs WHERE user_id=? AND idempotency_key=? LIMIT 1`).bind(userId, idempotencyKey).first<{ id: string; type: string; inputJson: string; status: string }>();
    if (raced && raced.type === type && raced.inputJson === inputJson) return toolPayload({ ok: true, jobId: raced.id, status: raced.status, reused: true });
    return toolPayload({ ok: false, code: 'IDEMPOTENCY_CONFLICT', message: '같은 idempotencyKey가 다른 요청과 충돌했습니다.' }, true);
  }
  await d1.prepare(`INSERT INTO audit_events (id,actor_user_id,target_user_id,action,metadata_json,created_at) VALUES (?,?,?,?,?,?)`).bind(newId('audit'), userId, userId, 'AGENT_JOB_ENQUEUED', JSON.stringify({ jobId, type, connectKind: args.connectKind || null }), now).run();
  return toolPayload({ ok: true, jobId, status: 'QUEUED', message: '로컬 프로그램에 작업을 전달했습니다. job_get 으로 진행 상황을 확인하세요.' });
}

/** 결과 안의 대표 이미지(base64)는 MCP image 콘텐츠 블록으로 옮기고 구조화 결과에서는 뺀다. */
function extractImageBlocks(result: unknown): { result: unknown; blocks: ContentBlock[] } {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return { result, blocks: [] };
  const record = { ...(result as JsonObject) };
  const data = record.data && typeof record.data === 'object' && !Array.isArray(record.data) ? { ...(record.data as JsonObject) } : null;
  const blocks: ContentBlock[] = [];
  const holder = data || record;
  const image = holder.heroImage;
  if (image && typeof image === 'object' && typeof (image as JsonObject).base64 === 'string' && typeof (image as JsonObject).mimeType === 'string') {
    blocks.push({ type: 'image', data: (image as JsonObject).base64 as string, mimeType: (image as JsonObject).mimeType as string });
    delete holder.heroImage;
    holder.heroImageAttached = true;
  }
  if (data) record.data = data;
  return { result: record, blocks };
}

async function callTool(userId: string, name: string, rawArgs: JsonObject) {
  await ensureDatabase();
  const d1 = getD1();
  const tool = TOOL_BY_NAME.get(name);
  if (!tool) return toolPayload({ ok: false, code: 'TOOL_NOT_FOUND', message: '지원하지 않는 도구입니다.' }, true);
  const validation = validateToolArguments(tool.inputSchema, rawArgs);
  if (!validation.ok) return toolPayload({ ok: false, code: 'INVALID_ARGUMENT', message: `인자를 확인하세요: ${validation.errors.slice(0, 5).join('; ')}`, errors: validation.errors }, true);
  const args = validation.value;

  if (name === 'agent_get_status') {
    const now = Date.now();
    await sweepExpiredLeases(d1, userId, now);
    const device = await findActiveDevice(d1, userId);
    const online = await isAgentOnline(d1, userId, device, now);
    const running = device
      ? await d1.prepare(`SELECT id,type,stage,stage_message AS stageMessage,progress,heartbeat_at AS heartbeatAt FROM agent_jobs WHERE user_id=? AND status='RUNNING' ORDER BY claimed_at DESC LIMIT 1`).bind(userId).first<{ id: string; type: string; stage: string | null; stageMessage: string | null; progress: number; heartbeatAt: number | null }>()
      : null;
    const queued = await d1.prepare(`SELECT COUNT(*) AS count FROM agent_jobs WHERE user_id=? AND status='QUEUED'`).bind(userId).first<{ count: number }>();
    return toolPayload({
      ok: true,
      online,
      device: device ? { name: device.name, platform: device.platform, appVersion: device.appVersion, lastSeenAt: device.lastSeenAt ? new Date(device.lastSeenAt).toISOString() : null, status: parseStatusJson(device.statusJson) } : null,
      runningJob: running ? { id: running.id, type: running.type, stage: running.stage, stageMessage: running.stageMessage, progress: running.progress, heartbeatAt: running.heartbeatAt ? new Date(running.heartbeatAt).toISOString() : null } : null,
      queuedJobs: Number(queued?.count || 0),
    });
  }
  if (name === 'job_get') {
    const jobId = stringArg(args, 'jobId');
    await sweepExpiredLeases(d1, userId);
    const job = jobId ? await d1.prepare(`SELECT id,type,status,progress,stage,stage_message AS stageMessage,heartbeat_at AS heartbeatAt,cancel_requested AS cancelRequested,result_json AS resultJson,error_code AS errorCode,error_message AS errorMessage,created_at AS createdAt,finished_at AS finishedAt FROM agent_jobs WHERE id=? AND user_id=? LIMIT 1`).bind(jobId, userId).first<{ id: string; type: string; status: string; progress: number; stage: string | null; stageMessage: string | null; heartbeatAt: number | null; cancelRequested: number; resultJson: string | null; errorCode: string | null; errorMessage: string | null; createdAt: number; finishedAt: number | null }>() : null;
    if (!job) return toolPayload({ ok: false, code: 'JOB_NOT_FOUND', message: '작업을 찾을 수 없습니다.' }, true);
    const { result, blocks } = extractImageBlocks(jsonValue(job.resultJson));
    return toolPayload({
      ok: true,
      job: {
        id: job.id,
        type: job.type,
        status: job.status,
        progress: job.progress,
        stage: job.stage,
        stageMessage: job.stageMessage,
        cancelRequested: Number(job.cancelRequested || 0) === 1,
        heartbeatAt: job.heartbeatAt ? new Date(job.heartbeatAt).toISOString() : null,
        result,
        errorCode: job.errorCode,
        errorMessage: job.errorMessage,
        createdAt: new Date(job.createdAt).toISOString(),
        finishedAt: job.finishedAt ? new Date(job.finishedAt).toISOString() : null,
      },
    }, false, blocks);
  }
  if (name === 'job_cancel') {
    const jobId = stringArg(args, 'jobId');
    const now = Date.now();
    const cancelled = await d1.prepare(`UPDATE agent_jobs SET status='CANCELLED', progress=100, error_code='USER_CANCELLED', error_message='ChatGPT에서 대기 작업 취소를 요청함', updated_at=?, finished_at=? WHERE id=? AND user_id=? AND status='QUEUED'`).bind(now, now, jobId, userId).run();
    if (Number(cancelled.meta.changes || 0) === 1) {
      await d1.prepare(`INSERT INTO audit_events (id,actor_user_id,target_user_id,action,metadata_json,created_at) VALUES (?,?,?,?,?,?)`).bind(newId('audit'), userId, userId, 'AGENT_JOB_CANCELLED', JSON.stringify({ jobId }), now).run();
      return toolPayload({ ok: true, jobId, status: 'CANCELLED' });
    }
    const requested = await d1.prepare(`UPDATE agent_jobs SET cancel_requested=1, updated_at=? WHERE id=? AND user_id=? AND status='RUNNING'`).bind(now, jobId, userId).run();
    if (Number(requested.meta.changes || 0) === 1) {
      await d1.prepare(`INSERT INTO audit_events (id,actor_user_id,target_user_id,action,metadata_json,created_at) VALUES (?,?,?,?,?,?)`).bind(newId('audit'), userId, userId, 'AGENT_JOB_CANCEL_REQUESTED', JSON.stringify({ jobId }), now).run();
      return toolPayload({ ok: true, jobId, status: 'CANCEL_REQUESTED', message: '실행 중 작업에 취소를 요청했습니다. 로컬 PC가 다음 하트비트에서 중단합니다.' });
    }
    return toolPayload({ ok: false, code: 'JOB_NOT_ACTIVE', message: '대기 중이거나 실행 중인 작업만 취소할 수 있습니다.' }, true);
  }

  if (!tool.jobType) return toolPayload({ ok: false, code: 'TOOL_NOT_FOUND', message: '지원하지 않는 도구입니다.' }, true);
  if (tool.requiresIdempotency && !stringArg(args, 'idempotencyKey')) {
    return toolPayload({ ok: false, code: 'INVALID_IDEMPOTENCY_KEY', message: 'idempotencyKey는 영문·숫자·._:- 조합 8~120자로 입력해야 합니다.' }, true);
  }
  if (tool.requiresConfirmation && args.confirmed !== true) {
    return toolPayload({ ok: false, code: 'CONFIRMATION_REQUIRED', message: '실제 실행 전 confirmed=true 확인이 필요합니다.' }, true);
  }
  if (typeof args.scheduledDate === 'string' && !validDate(args.scheduledDate)) {
    return toolPayload({ ok: false, code: 'INVALID_SCHEDULE_DATE', message: 'scheduledDate는 존재하는 YYYY-MM-DD 날짜여야 합니다.' }, true);
  }
  if (typeof args.startDate === 'string' && !validDate(args.startDate)) {
    return toolPayload({ ok: false, code: 'INVALID_SCHEDULE_DATE', message: 'startDate는 존재하는 YYYY-MM-DD 날짜여야 합니다.' }, true);
  }
  return enqueue(userId, tool, args);
}

export async function POST(request: Request, context: { params: Promise<{ credential: string }> }) {
  if (!validOrigin(request)) return rpcError(null, -32000, 'Invalid Origin.', 403);
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) return rpcError(null, -32700, 'Content-Type must be application/json.', 415);

  const { credential } = await context.params;
  const split = splitMcpCredential(credential);
  if (!split) return rpcError(null, -32001, 'MCP endpoint is invalid.', 404);
  await ensureDatabase();
  const ipLimit = await enforceRateLimit(getD1(), `mcp:ip:${clientIp(request)}`, 600, 60_000);
  if (!ipLimit.allowed) return rpcError(null, -32029, 'Too many requests.', 429, { retryAfterMs: ipLimit.retryAfterMs });
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

  // 최신 프로토콜 협상: 헤더 또는 _meta 중 하나만 있어도 인정하되, 둘 다 있으면 일치해야 한다.
  const modern = protocolHeader === MODERN_PROTOCOL || metaProtocol === MODERN_PROTOCOL || method === 'server/discover';
  if (modern) {
    if ((protocolHeader && protocolHeader !== MODERN_PROTOCOL) || (metaProtocol && metaProtocol !== MODERN_PROTOCOL)) {
      return rpcError(id, -32020, 'Header mismatch: MCP-Protocol-Version must match request _meta.', 400);
    }
    const methodHeader = request.headers.get('mcp-method');
    if (methodHeader !== null && methodHeader !== method) {
      return rpcError(id, -32020, 'Header mismatch: Mcp-Method must match the request method.', 400);
    }
    if (method === 'tools/call') {
      const name = typeof params.name === 'string' ? params.name : '';
      const nameHeader = request.headers.get('mcp-name');
      if (!name || (nameHeader !== null && decodedHeaderValue(nameHeader) !== name)) {
        return rpcError(id, -32020, 'Header mismatch: Mcp-Name must match the requested tool name.', 400);
      }
    }
  }

  try {
    if (method === 'initialize') {
      const requested = stringArg(asObject(body.params), 'protocolVersion');
      const protocolVersion = SUPPORTED_PROTOCOLS.includes(requested as typeof SUPPORTED_PROTOCOLS[number]) ? requested : LEGACY_PROTOCOLS[0];
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
    const tools = TOOLS.map(publicTool);
    if (method === 'tools/list') return rpcResult(id, modern ? completeResult({ tools, ttlMs: 300_000, cacheScope: 'private' }) : { tools });
    if (method === 'tools/call') {
      const callLimit = await enforceRateLimit(getD1(), `mcp:call:${split.endpointId}`, 120, 60_000);
      if (!callLimit.allowed) return rpcError(id, -32029, 'Too many tool calls. Slow down.', 429, { retryAfterMs: callLimit.retryAfterMs });
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
