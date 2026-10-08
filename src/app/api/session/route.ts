import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { validateNaverPublishingSession } from "@/lib/naver-session";
import { requireRemoteActivation } from "@/lib/api-auth";
import {
  isChatGptBrowserAutomationEnabled,
  readChatGptBrowserSessionSummary,
} from "@/lib/chatgpt-browser-automation";
import { getNaverSessionFile } from "../../../../scripts/lib/app-paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NAVER_SESSION_FILE = getNaverSessionFile();
interface SessionSummary {
  hasSession: boolean;
  isValid: boolean;
  savedAt?: string;
  checkedAt?: string;
  mode?: string;
  status?: "valid" | "auth-required" | "forbidden" | "unknown" | "configuration";
  authRequired?: boolean;
  code?: string;
  warning?: string;
  error?: string;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "알 수 없는 오류";
}

function getLastModifiedIso(targetPath: string): string | undefined {
  try {
    const stats = fs.statSync(targetPath);
    return stats.mtime.toISOString();
  } catch {
    return undefined;
  }
}

async function readNaverSessionSummary(): Promise<SessionSummary> {
  const hasSession = fs.existsSync(NAVER_SESSION_FILE);
  const base: SessionSummary = {
    hasSession,
    isValid: false,
    savedAt: hasSession ? getLastModifiedIso(NAVER_SESSION_FILE) : undefined,
    checkedAt: new Date().toISOString(),
    mode: "storage-state",
  };

  if (!hasSession) {
    return { ...base, status: "auth-required", authRequired: true, code: "NAVER_SESSION_EXPIRED", error: "저장된 네이버 세션이 없습니다. 네이버 로그인을 진행해 주세요." };
  }

  const blogId = process.env.NAVER_BLOG_ID?.trim();
  if (!blogId) {
    return { ...base, status: "configuration", authRequired: false, code: "NAVER_SESSION_CONFIGURATION_REQUIRED", error: "네이버 블로그 ID를 먼저 설정해 주세요." };
  }

  try {
    const validation = await validateNaverPublishingSession(NAVER_SESSION_FILE, blogId);
    return {
      ...base,
      isValid: validation.valid,
      status: validation.status,
      authRequired: validation.authRequired,
      code: validation.code,
      error: validation.error,
      warning: validation.warning,
    };
  } catch {
    return {
      ...base,
      status: "unknown", authRequired: false, code: "NAVER_SESSION_CHECK_FAILED",
      error: "네이버 상태 확인 중 오류가 발생했습니다. 저장된 세션은 유지됩니다. 잠시 후 다시 확인해 주세요.",
    };
  }
}

export async function GET(request: NextRequest) {
  const activationError = requireRemoteActivation(request);
  if (activationError) return activationError;
  try {
    const naver = await readNaverSessionSummary();
    const chatgpt = readChatGptBrowserSessionSummary();

    return NextResponse.json({
      success: true,
      data: {
        hasSession: naver.hasSession,
        isValid: naver.isValid,
        savedAt: naver.savedAt,
        checkedAt: naver.checkedAt,
        naver,
        chatgpt: {
          ...chatgpt,
          automationEnabled: isChatGptBrowserAutomationEnabled(),
        },
      },
    });
  } catch (error) {
    console.error("세션 조회 실패:", error);
    return NextResponse.json(
      {
        success: false,
        error: getErrorMessage(error),
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const activationError = requireRemoteActivation(request);
  if (activationError) return activationError;
  return NextResponse.json({
    success: true,
    message: "네이버 발행 세션과 GPT 원고 작성 연결을 준비해 주세요.",
    instructions: {
      naver: [
        "1. 터미널에서 `npm run login` 실행",
        "2. 열린 브라우저에서 네이버 로그인 완료",
        "3. 세션이 저장되면 페이지 새로고침",
      ],
      chatgpt: [
        "1. GPT 연결이 안 될 때만 프로그램에서 `웹 GPT 재로그인` 선택",
        "2. 열린 전용 브라우저에서 GPT 로그인 완료",
        "3. 입력창이 확인되면 예비 세션이 자동 저장되고 창이 닫힘",
      ],
    },
  });
}
