import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { validateNaverPublishingSession } from "@/lib/naver-session";
import { requireRemoteActivation } from "@/lib/api-auth";
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

export async function GET(request: NextRequest) {
  const activationError = requireRemoteActivation(request);
  if (activationError) return activationError;
  try {
    const naver = await readNaverSessionSummary();

    return NextResponse.json({
      success: true,
      data: {
        hasSession: naver.hasSession,
        isValid: naver.isValid,
        savedAt: naver.savedAt,
        checkedAt: naver.checkedAt,
        naver,
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
    message: "네이버 로그인 세션을 준비해주세요. ChatGPT는 로컬 로그인 대신 MCP 주소로 연결합니다.",
    instructions: {
      naver: [
        "1. 터미널에서 `npm run login` 실행",
        "2. 열린 브라우저에서 네이버 로그인 완료",
        "3. 세션이 저장되면 페이지 새로고침",
      ],
    },
  });
}
