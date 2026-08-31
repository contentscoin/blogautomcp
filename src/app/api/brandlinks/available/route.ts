import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApiKey } from "@/lib/api-auth";
import { ConnectSessionExpiredError, ConnectContractNotFoundError, listTravelItems } from "@/lib/travel-connect-adapter";
import { getNaverSessionFile } from "../../../../../scripts/lib/app-paths";

export const dynamic = "force-dynamic";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "여행커넥트 상품 목록을 불러오지 못했습니다.";
}

function normalizeUrl(value: string | null | undefined): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString().replace(/\/$/u, "").toLowerCase();
  } catch {
    return value.trim().replace(/\/$/u, "").toLowerCase();
  }
}

/**
 * 여행커넥트 화면의 추천 피드 전체를 반환한다.
 * /api/brandlinks는 이미 DB에 등록된 링크만 반환하므로, 목록 조회와
 * 등록 작업을 혼동하지 않도록 이 엔드포인트는 외부 후보도 AVAILABLE로 표시한다.
 */
export async function GET(request: NextRequest) {
  const authError = requireAdminApiKey(request);
  if (authError) return authError;

  const status = (request.nextUrl.searchParams.get("status") || "all").trim().toUpperCase();
  if (!["ALL", "READY", "PUBLISHED", "SCHEDULED", "PUBLISHING", "FAILED"].includes(status)) {
    return NextResponse.json({ success: false, error: "지원하지 않는 상품 상태입니다." }, { status: 400 });
  }

  try {
    const storageStatePath = getNaverSessionFile();
    const { items, contract, source } = await listTravelItems({
      storageStatePath,
      limit: 800,
      allowDiscovery: false,
    });
    const existing = await prisma.brandLink.findMany({
      where: { connectKind: "TRAVEL" },
      select: { id: true, externalItemId: true, url: true, productName: true, storeName: true, productPrice: true, status: true, postUrl: true, errorMessage: true },
    });
    const byExternalId = new Map(existing.filter((row) => row.externalItemId).map((row) => [row.externalItemId as string, row]));
    const byUrl = new Map(existing.map((row) => [normalizeUrl(row.url), row]));

    const products = items
      .map((item) => {
        const row = (item.externalItemId ? byExternalId.get(item.externalItemId) : undefined) || byUrl.get(normalizeUrl(item.linkUrl));
        const itemStatus = row?.status || "AVAILABLE";
        return {
          id: row?.id || null,
          externalProductId: item.externalItemId,
          productName: item.name,
          storeName: item.storeName,
          price: item.price,
          status: itemStatus,
          statusMeaning: row ? (itemStatus === "FAILED" ? "이전 작업이 실패한 기록입니다. 다시 초안을 만들 수 있습니다." : "로컬 작업 목록에 등록된 상품입니다.") : "여행커넥트에서 확인된 상품입니다. 초안 작업 전 로컬 목록으로 동기화하세요.",
          canCreateDraft: Boolean(row && (itemStatus === "READY" || itemStatus === "FAILED")),
          registered: Boolean(row),
          url: row?.url || item.linkUrl,
          postUrl: row?.postUrl || null,
          lastError: row?.errorMessage || null,
        };
      })
      .filter((item) => status === "ALL" || item.status === status)
      .sort((left, right) => left.productName.localeCompare(right.productName, "ko"));

    return NextResponse.json({
      success: true,
      data: {
        connectKind: "travel",
        count: products.length,
        registeredCount: products.filter((item) => item.registered).length,
        availableCount: products.filter((item) => !item.registered).length,
        source,
        contractSampleCount: contract.sampleCount,
        products,
      },
    });
  } catch (error: unknown) {
    if (error instanceof ConnectSessionExpiredError) return NextResponse.json({ success: false, error: error.message }, { status: 401 });
    if (error instanceof ConnectContractNotFoundError) return NextResponse.json({ success: false, error: error.message }, { status: 501 });
    console.error("Available travel product load failed:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 502 });
  }
}
