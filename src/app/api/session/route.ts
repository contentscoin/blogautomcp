import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { readUsableCookies, validateNaverPublishingSession } from "@/lib/naver-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NAVER_SESSION_FILE = path.join(process.cwd(), "playwright", "storage", "naver-session.json");
const CHATGPT_SESSION_FILE = path.join(process.cwd(), "playwright", "storage", "chatgpt-session.json");
const CHATGPT_PROFILE_DIR =
  process.env.CHATGPT_USER_DATA_DIR || path.join(process.cwd(), "playwright", "storage", "chatgpt-profile");
interface SessionSummary {
  hasSession: boolean;
  isValid: boolean;
  savedAt?: string;
  checkedAt?: string;
  mode?: string;
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
    return { ...base, error: "네이버 세션 파일이 없습니다. `npm run login`을 실행하세요." };
  }

  const blogId = process.env.NAVER_BLOG_ID?.trim();
  if (!blogId) {
    return { ...base, error: "NAVER_BLOG_ID가 설정되어 있지 않습니다." };
  }

  try {
    const validation = await validateNaverPublishingSession(NAVER_SESSION_FILE, blogId);
    return validation.valid
      ? { ...base, isValid: true, error: undefined }
      : { ...base, error: `${validation.error} \`npm run login\`을 다시 실행하세요.` };
  } catch (error) {
    return {
      ...base,
      error: `네이버 세션 확인 실패: ${getErrorMessage(error)}. \`npm run login\`을 다시 실행하세요.`,
    };
  }
}

function readChatGptSessionSummary(): SessionSummary {
  const hasSessionFile = fs.existsSync(CHATGPT_SESSION_FILE);
  const hasProfile = fs.existsSync(CHATGPT_PROFILE_DIR);
  const profileSavedAt = hasProfile ? getLastModifiedIso(CHATGPT_PROFILE_DIR) : undefined;
  const sessionSavedAt = hasSessionFile ? getLastModifiedIso(CHATGPT_SESSION_FILE) : undefined;
  const usesPersistentProfile =
    (process.env.CHATGPT_USE_PERSISTENT_CONTEXT || process.env.CHATGPT_USE_PERSISTENT_PROFILE || "true").toLowerCase() !==
    "false";
  const hasSession = hasProfile || hasSessionFile;
  const hasSessionToken = hasSessionFile
    ? readUsableCookies(CHATGPT_SESSION_FILE, "chatgpt.com").some((cookie) =>
        cookie.name.startsWith("__Secure-next-auth.session-token"),
      )
    : false;

  return {
    hasSession,
    isValid: hasSessionToken,
    savedAt: profileSavedAt || sessionSavedAt,
    checkedAt: new Date().toISOString(),
    mode: usesPersistentProfile ? "persistent-profile" : "storage-state",
    error: hasSessionToken
      ? undefined
      : hasSession
        ? "저장된 ChatGPT 세션/프로필이 있지만 세션 토큰이 확인되지 않습니다. `npm run login:chatgpt`를 다시 실행하세요."
        : "ChatGPT 세션 파일이 없습니다. `npm run login:chatgpt`를 실행하세요.",
  };
}

export async function GET() {
  try {
    const naver = await readNaverSessionSummary();
    const chatgpt = readChatGptSessionSummary();

    return NextResponse.json({
      success: true,
      data: {
        hasSession: naver.hasSession,
        isValid: naver.isValid,
        savedAt: naver.savedAt,
        checkedAt: naver.checkedAt,
        naver,
        chatgpt,
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

export async function POST() {
  return NextResponse.json({
    success: true,
    message: "필요한 세션에 맞는 로그인 명령을 실행해주세요.",
    instructions: {
      naver: [
        "1. 터미널에서 `npm run login` 실행",
        "2. 열린 브라우저에서 네이버 로그인 완료",
        "3. 세션이 저장되면 페이지 새로고침",
      ],
      chatgpt: [
        "1. 터미널에서 `npm run login:chatgpt` 실행",
        "2. 열린 브라우저에서 ChatGPT 로그인 및 보안 인증 완료",
        "3. 입력창이 보이는 상태까지 확인 후 페이지 새로고침",
      ],
    },
  });
}
