import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSiteUrl } from "@/lib/env";
import { resolveMcpConnection, splitMcpCredential } from "@/lib/mcp-connection";
import { verifyMcpAccessToken } from "@/lib/oauth";
import { userCanUseMcp } from "@/lib/auth";
import { Prisma } from "@/generated/prisma";
import { readObject } from "@/lib/http";
import { isSameIdempotentRequest } from "@/lib/idempotency";

type JsonRpcId = string | number | null;
type JsonObject = Record<string, unknown>;

const SECURITY_SCHEMES = [{ type: "oauth2", scopes: ["mcp:tools"] }];

const TOOLS = [
  {
    name: "agent_get_status",
    title: "로컬 에이전트 상태 확인",
    description: "인증된 로컬 PC의 온라인 여부, 앱 버전, 마지막 접속 시각을 확인합니다.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    securitySchemes: SECURITY_SCHEMES,
    _meta: { securitySchemes: SECURITY_SCHEMES },
  },
  {
    name: "brandconnect_list_products",
    title: "브랜드커넥트 상품 목록",
    description: "로컬 PC에서 쇼핑커넥트 또는 여행커넥트 상품 목록을 조회하는 작업을 시작합니다.",
    inputSchema: { type: "object", properties: { connectKind: { type: "string", enum: ["shopping", "travel"] }, status: { type: "string", enum: ["all", "ready", "drafting", "publishing", "scheduled", "published", "failed"] }, writingStatus: { type: "string", enum: ["all", "unwritten", "written"] }, idempotencyKey: { type: "string", minLength: 8, maxLength: 120 } }, required: ["connectKind"], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    securitySchemes: SECURITY_SCHEMES,
    _meta: { securitySchemes: SECURITY_SCHEMES },
  },
  {
    name: "brandconnect_sync_products",
    title: "브랜드커넥트 상품 가져오기",
    description: "네이버 브랜드커넥트에서 브랜드명·스토어명·상품명으로 검색해 쇼핑커넥트 또는 여행커넥트 상품을 로컬 작업 목록으로 가져옵니다.",
    inputSchema: { type: "object", properties: { connectKind: { type: "string", enum: ["shopping", "travel"] }, count: { type: "integer", minimum: 1, maximum: 50, default: 10 }, brandKeyword: { type: "string", maxLength: 80 }, idempotencyKey: { type: "string", minLength: 8, maxLength: 120 } }, required: ["connectKind", "idempotencyKey"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    securitySchemes: SECURITY_SCHEMES,
    _meta: { securitySchemes: SECURITY_SCHEMES },
  },
  {
    name: "post_create_draft",
    title: "포스팅 초안 생성",
    description: "선택한 쇼핑커넥트 또는 여행커넥트 상품으로 로컬 PC에서 포스팅 초안을 생성합니다.",
    inputSchema: { type: "object", properties: { connectKind: { type: "string", enum: ["shopping", "travel"] }, productId: { type: "string", minLength: 1, maxLength: 160 }, memo: { type: "string", maxLength: 1000 }, idempotencyKey: { type: "string", minLength: 8, maxLength: 120 } }, required: ["connectKind", "productId", "idempotencyKey"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    securitySchemes: SECURITY_SCHEMES,
    _meta: { securitySchemes: SECURITY_SCHEMES },
  },
  {
    name: "post_publish",
    title: "네이버 블로그 즉시 발행",
    description: "검토된 초안을 네이버 블로그에 즉시 발행합니다. confirmed=true가 반드시 필요합니다.",
    inputSchema: { type: "object", properties: { draftId: { type: "string", minLength: 1, maxLength: 160 }, confirmed: { type: "boolean", const: true }, idempotencyKey: { type: "string", minLength: 8, maxLength: 120 } }, required: ["draftId", "confirmed", "idempotencyKey"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    securitySchemes: SECURITY_SCHEMES,
    _meta: { securitySchemes: SECURITY_SCHEMES },
  },
  {
    name: "post_schedule",
    title: "네이버 블로그 예약 발행",
    description: "검토된 초안을 지정 날짜의 로컬 기본 예약 시각에 발행합니다. confirmed=true가 반드시 필요합니다.",
    inputSchema: { type: "object", properties: { draftId: { type: "string", minLength: 1, maxLength: 160 }, scheduledDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Asia/Seoul 기준 YYYY-MM-DD" }, confirmed: { type: "boolean", const: true }, idempotencyKey: { type: "string", minLength: 8, maxLength: 120 } }, required: ["draftId", "scheduledDate", "confirmed", "idempotencyKey"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    securitySchemes: SECURITY_SCHEMES,
    _meta: { securitySchemes: SECURITY_SCHEMES },
  },
  {
    name: "job_get",
    title: "작업 결과 확인",
    description: "비동기 작업의 진행률, 결과 또는 오류를 확인합니다.",
    inputSchema: { type: "object", properties: { jobId: { type: "string", minLength: 1, maxLength: 80 } }, required: ["jobId"], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    securitySchemes: SECURITY_SCHEMES,
    _meta: { securitySchemes: SECURITY_SCHEMES },
  },
  {
    name: "job_cancel",
    title: "작업 취소",
    description: "대기 중이거나 실행 중인 로컬 작업을 취소합니다.",
    inputSchema: { type: "object", properties: { jobId: { type: "string", minLength: 1, maxLength: 80 } }, required: ["jobId"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    securitySchemes: SECURITY_SCHEMES,
    _meta: { securitySchemes: SECURITY_SCHEMES },
  },
] as const;

function rpcResult(id: JsonRpcId, result: unknown, status = 200) {
  return NextResponse.json({ jsonrpc: "2.0", id, result }, { status });
}

function rpcError(id: JsonRpcId, code: number, message: string, data?: unknown, status = 200) {
  return NextResponse.json({ jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } }, { status });
}

function toolPayload(data: JsonObject, isError = false) {
  return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data, ...(isError ? { isError: true } : {}) };
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function stringArg(args: JsonObject, key: string): string {
  return typeof args[key] === "string" ? (args[key] as string).trim() : "";
}

function validIdempotencyKey(args: JsonObject): string | null {
  const value = stringArg(args, "idempotencyKey");
  return value.length >= 8 && value.length <= 120 ? value : null;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

async function activeDevice(userId: string) {
  return db.device.findFirst({ where: { userId, status: "ACTIVE" }, orderBy: { pairedAt: "desc" } });
}

async function enqueue(userId: string, type: string, args: JsonObject) {
  const device = await activeDevice(userId);
  const online = Boolean(device?.lastSeenAt && Date.now() - device.lastSeenAt.getTime() < 90_000);
  if (!device || !online) return toolPayload({ ok: false, code: "AGENT_OFFLINE", message: "인증된 로컬 프로그램이 온라인 상태가 아닙니다." }, true);
  const idempotencyKey = stringArg(args, "idempotencyKey") || null;
  if (idempotencyKey) {
    const existing = await db.agentJob.findFirst({ where: { userId, idempotencyKey } });
    if (existing) {
      if (!isSameIdempotentRequest({
        existingType: existing.type,
        existingInput: existing.inputJson,
        requestedType: type,
        requestedInput: args,
      })) {
        return toolPayload({
          ok: false,
          code: "IDEMPOTENCY_CONFLICT",
          message: "같은 idempotencyKey가 다른 작업 내용에 이미 사용되었습니다. 새 키로 다시 요청하세요.",
          jobId: existing.id,
        }, true);
      }
      return toolPayload({ ok: true, jobId: existing.id, status: existing.status, reused: true });
    }
  }
  const job = await db.agentJob.create({
    data: { userId, type, inputJson: args as Prisma.InputJsonObject, idempotencyKey },
  });
  return toolPayload({ ok: true, jobId: job.id, status: job.status, message: "로컬 프로그램에 작업을 전달했습니다." });
}

async function callTool(userId: string, name: string, args: JsonObject) {
  if (name === "agent_get_status") {
    const device = await activeDevice(userId);
    const online = Boolean(device?.lastSeenAt && Date.now() - device.lastSeenAt.getTime() < 90_000);
    return toolPayload({ ok: true, online, device: device ? { name: device.name, platform: device.platform, appVersion: device.appVersion, lastSeenAt: device.lastSeenAt?.toISOString() ?? null } : null });
  }
  if (name === "job_get") {
    const jobId = stringArg(args, "jobId");
    const job = jobId ? await db.agentJob.findFirst({ where: { id: jobId, userId } }) : null;
    if (!job) return toolPayload({ ok: false, code: "JOB_NOT_FOUND", message: "작업을 찾을 수 없습니다." }, true);
    return toolPayload({ ok: true, job: { id: job.id, type: job.type, status: job.status, progress: job.progress, result: job.resultJson, errorCode: job.errorCode, errorMessage: job.errorMessage, createdAt: job.createdAt.toISOString(), finishedAt: job.finishedAt?.toISOString() ?? null } });
  }
  if (name === "job_cancel") {
    const jobId = stringArg(args, "jobId");
    const updated = await db.agentJob.updateMany({ where: { id: jobId, userId, status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "CANCELLED", finishedAt: new Date(), errorCode: "USER_CANCELLED", errorMessage: "ChatGPT에서 작업 취소를 요청했습니다." } });
    return updated.count ? toolPayload({ ok: true, jobId, status: "CANCELLED" }) : toolPayload({ ok: false, code: "JOB_NOT_ACTIVE", message: "취소할 수 있는 작업이 아닙니다." }, true);
  }
  const connectKind = stringArg(args, "connectKind");
  if (["brandconnect_list_products", "brandconnect_sync_products", "post_create_draft"].includes(name) && !["shopping", "travel"].includes(connectKind)) return toolPayload({ ok: false, code: "INVALID_CONNECT_KIND", message: "connectKind는 shopping 또는 travel이어야 합니다." }, true);
  const types: Record<string, string> = { brandconnect_list_products: "BRANDCONNECT_LIST_PRODUCTS", brandconnect_sync_products: "BRANDCONNECT_SYNC_PRODUCTS", post_create_draft: "POST_CREATE_DRAFT", post_publish: "POST_PUBLISH", post_schedule: "POST_SCHEDULE" };
  const type = types[name];
  if (!type) return toolPayload({ ok: false, code: "TOOL_NOT_FOUND", message: "지원하지 않는 도구입니다." }, true);
  const safeArgs: JsonObject = {};
  if (connectKind) safeArgs.connectKind = connectKind;

  if (name === "brandconnect_list_products") {
    const status = stringArg(args, "status") || "all";
    if (!["all", "ready", "drafting", "publishing", "scheduled", "published", "failed"].includes(status)) return toolPayload({ ok: false, code: "INVALID_STATUS", message: "지원하지 않는 상품 상태입니다." }, true);
    safeArgs.status = status;
    const writingStatus = stringArg(args, "writingStatus") || "all";
    if (!["all", "unwritten", "written"].includes(writingStatus)) return toolPayload({ ok: false, code: "INVALID_WRITING_STATUS", message: "writingStatus는 all, unwritten 또는 written이어야 합니다." }, true);
    safeArgs.writingStatus = writingStatus;
    return enqueue(userId, type, safeArgs);
  }

  const idempotencyKey = validIdempotencyKey(args);
  if (!idempotencyKey) return toolPayload({ ok: false, code: "INVALID_IDEMPOTENCY_KEY", message: "idempotencyKey는 8~120자로 입력해야 합니다." }, true);
  safeArgs.idempotencyKey = idempotencyKey;

  if (name === "brandconnect_sync_products") {
    const count = typeof args.count === "number" && Number.isInteger(args.count) ? args.count : 10;
    if (count < 1 || count > 50) return toolPayload({ ok: false, code: "INVALID_COUNT", message: "count는 1~50의 정수여야 합니다." }, true);
    safeArgs.count = count;
    const brandKeyword = stringArg(args, "brandKeyword");
    if (brandKeyword.length > 80) return toolPayload({ ok: false, code: "BRAND_KEYWORD_TOO_LONG", message: "brandKeyword는 80자 이하여야 합니다." }, true);
    if (brandKeyword) safeArgs.brandKeyword = brandKeyword;
  }

  if (name === "post_create_draft") {
    const productId = stringArg(args, "productId");
    if (!productId || productId.length > 160) return toolPayload({ ok: false, code: "INVALID_PRODUCT_ID", message: "productId를 확인하세요." }, true);
    safeArgs.productId = productId;
    const memo = stringArg(args, "memo");
    if (memo.length > 1000) return toolPayload({ ok: false, code: "MEMO_TOO_LONG", message: "memo는 1000자 이하여야 합니다." }, true);
    if (memo) safeArgs.memo = memo;
  }

  if (name === "post_publish" || name === "post_schedule") {
    if (args.confirmed !== true) return toolPayload({ ok: false, code: "CONFIRMATION_REQUIRED", message: "실제 발행 전 confirmed=true 확인이 필요합니다." }, true);
    const draftId = stringArg(args, "draftId");
    if (!draftId || draftId.length > 160) return toolPayload({ ok: false, code: "INVALID_DRAFT_ID", message: "draftId를 확인하세요." }, true);
    safeArgs.draftId = draftId;
    safeArgs.confirmed = true;
    if (name === "post_schedule") {
      const scheduledDate = stringArg(args, "scheduledDate");
      if (!validDate(scheduledDate)) return toolPayload({ ok: false, code: "INVALID_SCHEDULE_DATE", message: "scheduledDate는 존재하는 YYYY-MM-DD 날짜여야 합니다." }, true);
      safeArgs.scheduledDate = scheduledDate;
    }
  }

  return enqueue(userId, type, safeArgs);
}

export async function POST(request: NextRequest, context: { params: Promise<{ credential: string }> }) {
  const { credential } = await context.params;
  const split = splitMcpCredential(credential);
  if (!split) return rpcError(null, -32001, "MCP endpoint is invalid.", undefined, 404);
  const connection = await resolveMcpConnection(split.endpointId, split.secret);
  if (!connection) return rpcError(null, -32001, "MCP endpoint was revoked or is invalid.", undefined, 401);

  const resource = `${getSiteUrl()}/api/mcp/${credential}`;
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!bearer) {
    const metadata = `${getSiteUrl()}/api/oauth/protected-resource?resource=${encodeURIComponent(resource)}`;
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Authentication required." } }, { status: 401, headers: { "www-authenticate": `Bearer resource_metadata="${metadata}", scope="mcp:tools"` } });
  }
  if (bearer.length > 4096) return rpcError(null, -32001, "Access token is invalid or revoked.", undefined, 401);
  const claims = await verifyMcpAccessToken(bearer, resource);
  if (!claims || !claims.scope.split(/\s+/).includes("mcp:tools") || claims.connectionId !== connection.id || claims.userId !== connection.userId || claims.generation !== connection.generation || !userCanUseMcp(connection.user)) {
    const metadata = `${getSiteUrl()}/api/oauth/protected-resource?resource=${encodeURIComponent(resource)}`;
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Access token is invalid or revoked." } }, { status: 401, headers: { "www-authenticate": `Bearer resource_metadata="${metadata}", scope="mcp:tools"` } });
  }

  const body = await readObject(request);
  if (!body) return rpcError(null, -32700, "Parse error");
  const message: JsonObject = body;
  const id = (typeof message.id === "string" || typeof message.id === "number" || message.id === null) ? message.id : null;
  const method = typeof message.method === "string" ? message.method : "";
  if (method === "initialize") return rpcResult(id, { protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "BlogAutoMCP", version: "0.1.0" }, instructions: "인증된 로컬 PC에서 쇼핑커넥트와 여행커넥트 상품 조회 및 네이버 포스팅 작업을 수행합니다. 실제 발행 전에는 반드시 사용자의 명시적 확인을 받으세요." });
  if (method === "notifications/initialized" || method.startsWith("notifications/")) return new NextResponse(null, { status: 202 });
  if (method === "ping") return rpcResult(id, {});
  if (method === "tools/list") return rpcResult(id, { tools: TOOLS });
  if (method === "tools/call") {
    const params = asObject(message.params);
    const name = typeof params.name === "string" ? params.name : "";
    const result = await callTool(connection.userId, name, asObject(params.arguments));
    return rpcResult(id, result);
  }
  return rpcError(id, -32601, "Method not found");
}

export function GET() {
  return NextResponse.json({ error: "Use MCP Streamable HTTP POST." }, { status: 405, headers: { allow: "POST" } });
}
