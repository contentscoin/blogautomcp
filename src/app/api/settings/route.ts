/**
 * 앱 설정 API — 사용자 설정(.env) 읽기/쓰기.
 * 패키징 앱은 userData/.env, 개발은 프로젝트 .env (app-paths.getEnvFilePath).
 * 저장 시 process.env에 즉시 반영해 새로 spawn되는 발행 스크립트가 바로 사용한다.
 */

import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import { requireAdminApiKey } from "@/lib/api-auth";
import { isChatGptBrowserAutomationEnabled } from "@/lib/chatgpt-browser-automation";
import { getEnvFilePath } from "../../../../scripts/lib/app-paths";
import { readCodexLocalStatus } from "@/lib/codex-local";
import draftRuntimePolicy from "../../../../scripts/lib/draft-runtime-policy.json";

interface FieldDef {
  key: string;
  label: string;
  type: "text" | "password" | "select";
  options?: string[];
  secret?: boolean;
  hint?: string;
  defaultValue?: string;
  /** 고급 섹션(접힘)에 표시 */
  advanced?: boolean;
}

// 편집 허용 키 화이트리스트(임의 env 노출/주입 방지).
const FIELDS: FieldDef[] = [
  { key: "OPENAI_API_KEY", label: "OpenAI API 키 (선택)", type: "password", secret: true, hint: "API 기반 보조 기능에 사용합니다. 기본 원고는 로그인된 Codex/GPT로 작성하므로 API 키는 필수가 아닙니다." },
  { key: "UNSPLASH_ACCESS_KEY", label: "Unsplash 액세스 키", type: "password", secret: true, hint: "스톡 이미지(선택)" },
  { key: "NAVER_BLOG_ID", label: "네이버 블로그 ID", type: "text", hint: "blog.naver.com/<여기>" },
  { key: "ADMIN_API_KEY", label: "관리자 API 키", type: "password", secret: true, hint: "설정하면 발행·설정 같은 관리자 API 가 이 키를 요구합니다(선택). 외부 스크립트는 x-admin-api-key 헤더, 브라우저 대시보드는 첫 화면에서 키를 한 번 입력하고, 데스크톱 앱은 자동으로 붙입니다. 일반 로컬 사용에는 비워 두세요.", advanced: true },
];

const MASK = "********";
const EDITABLE_KEYS = new Set(FIELDS.map((f) => f.key));

function parseEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function serializeEnv(map: Record<string, string>): string {
  return (
    Object.entries(map)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"')}"`)
      .join("\n") + "\n"
  );
}

function readEnvFile(): Record<string, string> {
  try {
    const p = getEnvFilePath();
    if (fs.existsSync(p)) return parseEnv(fs.readFileSync(p, "utf8"));
  } catch {
    /* ignore */
  }
  return {};
}

export async function GET(request: NextRequest) {
  const unauthorized = requireAdminApiKey(request);
  if (unauthorized) return unauthorized;

  const fileEnv = readEnvFile();
  const values: Record<string, string> = {};
  const configured: Record<string, boolean> = {};
  for (const f of FIELDS) {
    const current = process.env[f.key] ?? fileEnv[f.key] ?? f.defaultValue ?? "";
    configured[f.key] = current.trim().length > 0;
    values[f.key] = f.secret ? (configured[f.key] ? MASK : "") : current;
  }

  const desktopDraftProviderConfigured = Boolean((process.env.OPENAI_API_KEY ?? fileEnv.OPENAI_API_KEY ?? "").trim());
  const browserDraftAutomationEnabled = isChatGptBrowserAutomationEnabled({
    ...fileEnv,
    ...process.env,
  });
  const codexDraftEnabled = draftRuntimePolicy.CODEX_DRAFT_ENABLED === "true";
  const codexDraft = readCodexLocalStatus();

  return NextResponse.json({
    success: true,
    data: {
      fields: FIELDS,
      values,
      configured,
      fixedDraftSettings: draftRuntimePolicy,
      desktopDraftProviderConfigured,
      browserDraftAutomationEnabled,
      codexDraftEnabled,
      codexDraft,
      draftCreationMode: codexDraftEnabled && codexDraft.authenticated
        ? "codex"
        : desktopDraftProviderConfigured
        ? "local-ai"
        : browserDraftAutomationEnabled
          ? "browser-chatgpt"
          : "chatgpt",
      envPath: getEnvFilePath(),
    },
  });
}

export async function POST(request: NextRequest) {
  const unauthorized = requireAdminApiKey(request);
  if (unauthorized) return unauthorized;

  let body: { values?: Record<string, string> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "잘못된 요청 본문" }, { status: 400 });
  }
  const incoming = body.values || {};

  const merged = readEnvFile();
  const applied: string[] = [];
  for (const [key, value] of Object.entries(incoming)) {
    if (!EDITABLE_KEYS.has(key)) continue;
    // 시크릿 마스크 값은 "변경 없음"이므로 건너뛴다.
    if (value === MASK) continue;
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (trimmed === "") {
      delete merged[key];
      delete process.env[key];
    } else {
      merged[key] = trimmed;
      process.env[key] = trimmed; // 새로 spawn되는 스크립트에 즉시 반영
    }
    applied.push(key);
  }

  // Even an old UI cannot disable the fixed pipeline. Preserve unrelated settings/secrets.
  Object.assign(merged, draftRuntimePolicy);

  try {
    const p = getEnvFilePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, serializeEnv(merged), { mode: 0o600 });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "설정 저장 실패" },
      { status: 500 }
    );
  }

  Object.assign(process.env, draftRuntimePolicy);
  process.env.BROWSER_GPT_MODE = "false";
  process.env.ALLOW_CHATGPT_BROWSER_MODE = "true";
  process.env.CHATGPT_BASE_URL = "https://chatgpt.com/";
  return NextResponse.json({ success: true, applied, envPath: getEnvFilePath() });
}
