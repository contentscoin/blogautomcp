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
  { key: "AI_PROVIDER", label: "AI 공급자", type: "select", options: ["openai", "codex"], defaultValue: "openai", hint: "글 생성 엔진. openai = OpenAI API 키로 PC 에서 Spec-first 생성(기본), codex = 로그인된 Codex/GPT 사용" },
  {
    key: "CODEX_DRAFT_ENABLED",
    label: "GPT(Codex) 원고 작성",
    type: "select",
    options: ["true", "false"],
    defaultValue: "false",
    hint: "켜면 로그인된 Codex/GPT 를 백그라운드 원고 작성 엔진으로 우선 사용합니다(선택).",
  },
  { key: "CODEX_DRAFT_MODEL", label: "GPT 작성 모델", type: "text", defaultValue: "gpt-5.5", hint: "기본값은 gpt-5.5입니다." },
  {
    key: "CHATGPT_BROWSER_AUTOMATION_ENABLED",
    label: "ChatGPT 웹 자동작성",
    type: "select",
    options: ["true", "false"],
    defaultValue: "false",
    hint: "켜면 API 키가 없을 때 로그인된 ChatGPT 웹 세션으로 초안을 자동 작성합니다(선택, 기본 꺼짐).",
    advanced: true,
  },
  { key: "OPENAI_API_KEY", label: "OpenAI API 키 (선택)", type: "password", secret: true, hint: "글·썸네일 생성에 사용. 없으면 ChatGPT 2단계 경로 또는 로컬 템플릿 초안으로 동작합니다." },
  { key: "UNSPLASH_ACCESS_KEY", label: "Unsplash 액세스 키", type: "password", secret: true, hint: "스톡 이미지(선택)" },
  { key: "NAVER_BLOG_ID", label: "네이버 블로그 ID", type: "text", hint: "blog.naver.com/<여기>" },
  { key: "ADMIN_API_KEY", label: "관리자 API 키", type: "password", secret: true, hint: "로컬 API 를 외부 스크립트에서 호출할 때만 필요(선택). 일반 사용에는 비워 두세요.", advanced: true },
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

  const provider = (process.env.AI_PROVIDER ?? fileEnv.AI_PROVIDER ?? "openai").trim().toLowerCase();
  const desktopDraftProviderConfigured = provider === "openai" || provider === "gemini"
    ? Boolean((process.env.OPENAI_API_KEY ?? fileEnv.OPENAI_API_KEY ?? "").trim())
    : false;
  const browserDraftAutomationEnabled = isChatGptBrowserAutomationEnabled({
    ...fileEnv,
    ...process.env,
  });
  const codexDraftEnabled = (process.env.CODEX_DRAFT_ENABLED ?? fileEnv.CODEX_DRAFT_ENABLED ?? "false").trim().toLowerCase() === "true";
  const codexDraft = readCodexLocalStatus();

  return NextResponse.json({
    success: true,
    data: {
      fields: FIELDS,
      values,
      configured,
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

  if (applied.includes("CHATGPT_BROWSER_AUTOMATION_ENABLED")) {
    const enabled = isChatGptBrowserAutomationEnabled(process.env);
    process.env.BROWSER_GPT_MODE = enabled ? "true" : "false";
    process.env.ALLOW_CHATGPT_BROWSER_MODE = enabled ? "true" : "false";
    process.env.CHATGPT_USE_CUSTOM_GPTS = "false";
  }

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

  return NextResponse.json({ success: true, applied, envPath: getEnvFilePath() });
}
