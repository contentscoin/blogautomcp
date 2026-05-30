/**
 * 앱 내 로그인 트리거 — login.ts(네이버) / chatgpt-login.ts를 백그라운드 실행한다.
 * 브라우저(시스템 Chrome)가 열리면 사용자가 로그인하고, 세션이 저장되면
 * UI는 /api/session 폴링으로 상태를 확인한다.
 */

import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import * as path from "path";
import { requireAdminApiKey } from "@/lib/api-auth";
import { buildTsScriptSpawn } from "@/lib/run-script";

const SCRIPTS: Record<string, string> = {
  naver: "login.ts",
  chatgpt: "chatgpt-login.ts",
};

export async function POST(request: NextRequest) {
  const unauthorized = requireAdminApiKey(request);
  if (unauthorized) return unauthorized;

  let target = "naver";
  try {
    const body = await request.json();
    if (body?.target && SCRIPTS[body.target]) target = body.target;
  } catch {
    /* 기본값 naver */
  }

  const projectRoot = process.env.DESKTOP_PROJECT_ROOT ?? process.cwd();
  const scriptPath = path.join(projectRoot, "scripts", SCRIPTS[target]);
  const { command, commandArgs, extraEnv } = buildTsScriptSpawn(scriptPath, [], projectRoot);

  try {
    const child = spawn(command, commandArgs, {
      cwd: projectRoot,
      detached: true,
      stdio: "ignore",
      shell: false,
      env: { ...process.env, ...extraEnv },
    });
    if (!child.pid) {
      throw new Error("로그인 프로세스를 시작하지 못했습니다.");
    }
    child.unref();
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "로그인 실행 실패" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    target,
    message:
      "로그인 브라우저를 열었습니다. 창에서 로그인을 완료하면 세션이 저장됩니다. (최대 8분)",
  });
}
