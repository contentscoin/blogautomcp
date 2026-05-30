/**
 * 네이버/ChatGPT 로그인 세션 관리 API
 */

import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import {
  getNaverSessionFile,
  getChatgptSessionFile,
  getSessionStorageDir,
} from "../../../../scripts/lib/app-paths";

const NAVER_SESSION_FILE = getNaverSessionFile();
const CHATGPT_SESSION_FILE = getChatgptSessionFile();
const CHATGPT_PROFILE_DIR =
  process.env.CHATGPT_USER_DATA_DIR || path.join(getSessionStorageDir(), "..", "profile");

interface SessionSummary {
  hasSession: boolean;
  isValid: boolean;
  lastChecked?: string;
  sessionPath?: string;
  profilePath?: string;
  mode?: string;
  error?: string;
}

function getLastModifiedIso(targetPath: string): string | undefined {
  try {
    const stats = fs.statSync(targetPath);
    return stats.mtime.toISOString();
  } catch {
    return undefined;
  }
}

function readNaverSessionSummary(): SessionSummary {
  const hasSession = fs.existsSync(NAVER_SESSION_FILE);
  return {
    hasSession,
    isValid: hasSession,
    lastChecked: hasSession ? getLastModifiedIso(NAVER_SESSION_FILE) : undefined,
    sessionPath: NAVER_SESSION_FILE,
    mode: "storage-state",
  };
}

function readChatGptSessionSummary(): SessionSummary {
  const hasSessionFile = fs.existsSync(CHATGPT_SESSION_FILE);
  const hasProfile = fs.existsSync(CHATGPT_PROFILE_DIR);
  const profileLastChecked = hasProfile ? getLastModifiedIso(CHATGPT_PROFILE_DIR) : undefined;
  const sessionLastChecked = hasSessionFile ? getLastModifiedIso(CHATGPT_SESSION_FILE) : undefined;
  const usesPersistentProfile =
    (process.env.CHATGPT_USE_PERSISTENT_CONTEXT || process.env.CHATGPT_USE_PERSISTENT_PROFILE || "true").toLowerCase() !==
    "false";

  return {
    hasSession: hasProfile || hasSessionFile,
    isValid: hasProfile || hasSessionFile,
    lastChecked: profileLastChecked || sessionLastChecked,
    sessionPath: hasSessionFile ? CHATGPT_SESSION_FILE : undefined,
    profilePath: hasProfile ? CHATGPT_PROFILE_DIR : undefined,
    mode: usesPersistentProfile ? "persistent-profile" : "storage-state",
  };
}

/**
 * GET /api/session
 * 현재 세션 상태 조회 (파일 존재 여부로 간단히 확인)
 */
export async function GET() {
  try {
    const naver = readNaverSessionSummary();
    const chatgpt = readChatGptSessionSummary();

    return NextResponse.json({
      success: true,
      data: {
        hasSession: naver.hasSession,
        isValid: naver.isValid,
        lastChecked: naver.lastChecked,
        sessionPath: naver.sessionPath,
        naver,
        chatgpt,
      },
    });
  } catch (error) {
    console.error("세션 조회 실패:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "세션 조회 실패",
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/session
 * 세션 갱신 요청 안내
 */
export async function POST() {
  return NextResponse.json({
    success: true,
    message: "필요한 세션에 맞는 로그인 명령을 실행해주세요.",
    instructions: {
      naver: [
        "1. 터미널에서 `npm run login` 실행",
        "2. 브라우저가 열리면 네이버에 로그인",
        "3. 로그인 완료 후 브라우저가 자동으로 닫힘",
        "4. 세션이 저장되면 이 페이지를 새로고침",
      ],
      chatgpt: [
        "1. 터미널에서 `npm run login:chatgpt` 실행",
        "2. 열린 브라우저에서 ChatGPT 로그인 및 보안 인증 완료",
        "3. 입력창이 보이는 상태까지 확인",
        "4. 프로필이 저장되면 이 페이지를 새로고침",
      ],
    },
  });
}
