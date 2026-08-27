import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiKey } from "@/lib/api-auth";
import { requireTrustedLocalMutation } from "@/lib/local-request-auth";
import { getNaverSessionFile } from "@/lib/naver-session";
import {
  ConnectContractNotFoundError,
  ConnectSessionExpiredError,
  discoverConnectContract,
  isValidConnectUrl,
} from "@/lib/travel-connect-adapter";
import { getLogsDir } from "../../../../../scripts/lib/app-paths";

export const runtime = "nodejs";

function captureFileName(now: Date): string {
  return now.toISOString().replace(/[:.]/g, "-");
}

/**
 * 여행커넥트 목록 계약을 1회 캡처한다.
 *
 * 예전에는 응답 "구조"만 로그로 남기고 아무도 그 로그를 읽지 않아서, 캡처에
 * 성공해도 여행커넥트가 계속 막혀 있었다. 지금은 재사용 가능한 계약 파일을
 * 저장하고, 그 파일이 있으면 목록 조회가 열린다.
 */
export async function POST(request: NextRequest) {
  const untrusted = requireTrustedLocalMutation(request);
  if (untrusted) return untrusted;
  const unauthorized = requireAdminApiKey(request);
  if (unauthorized) return unauthorized;

  let body: { categoryUrl?: string };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const requestedUrl = body.categoryUrl?.trim() || process.env.BRANDCONNECT_TRAVEL_CATEGORY_URL?.trim() || "";
  const categoryUrl = requestedUrl && isValidConnectUrl(requestedUrl) ? requestedUrl : null;
  if (requestedUrl && !categoryUrl) {
    return NextResponse.json(
      { success: false, error: "여행커넥트 목록 URL은 https://brandconnect.naver.com/ 주소여야 합니다." },
      { status: 400 }
    );
  }

  const storageStatePath = getNaverSessionFile();
  if (!fs.existsSync(storageStatePath)) {
    return NextResponse.json(
      { success: false, error: "네이버 로그인 세션이 없습니다. 먼저 네이버 로그인을 완료하세요." },
      { status: 400 }
    );
  }

  try {
    const { contract, items, profiles, finalUrl } = await discoverConnectContract({
      kind: "travel",
      categoryUrl,
      storageStatePath,
    });

    // 값(개인정보) 없이 응답 구조만 남기는 진단 로그. 설치 경로가 읽기 전용일 수
    // 있으므로 쓰기 가능한 사용자 데이터 폴더에 쓴다.
    const outputDir = path.join(getLogsDir(), "travel-contract");
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, `${captureFileName(new Date())}.json`);
    fs.writeFileSync(
      outputPath,
      JSON.stringify(
        { capturedAt: contract.capturedAt, sourcePath: new URL(finalUrl).pathname, responses: profiles },
        null,
        2
      ),
      "utf8"
    );

    return NextResponse.json({
      success: true,
      data: {
        contractReady: true,
        responseProfiles: profiles.length,
        itemCount: items.length,
        listEndpoint: contract.listEndpoint,
        itemsPath: contract.itemsPath,
        fieldMap: contract.fieldMap,
        logFile: outputPath,
        rawPayloadStored: false,
        message: `여행커넥트 목록 계약을 저장했습니다. 항목 ${items.length}개를 확인했으며, 이제 "옵션 불러오기"로 목록을 가져올 수 있습니다.`,
      },
    });
  } catch (error) {
    if (error instanceof ConnectSessionExpiredError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 401 });
    }
    if (error instanceof ConnectContractNotFoundError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 422 });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: `여행커넥트 자동 캡처에 실패했습니다: ${message}` },
      { status: 502 }
    );
  }
}
