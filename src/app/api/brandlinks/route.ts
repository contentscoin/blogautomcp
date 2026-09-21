import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { unstable_noStore as noStore } from "next/cache";
import { requireAdminApiKey } from "@/lib/api-auth";
import { parseConnectKind, toStoredConnectKind } from "@/lib/brandconnect-kind";
import { readBrandPostPackage } from "@/lib/brand-post-package";

export const dynamic = "force-dynamic";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "알 수 없는 오류";
}

interface CreateBrandLinkRequest {
  url?: string;
  memo?: string;
  categoryNo?: string | null;
  useSectionHeading?: boolean;
  connectKind?: "shopping" | "travel";
}

const ALLOWED_HOSTS = [
  "naver.me",
  "blog.naver.com",
  "smartstore.naver.com",
  "shopping.naver.com",
];

function normalizeBrandLinkUrl(raw: string): string | null {
  try {
    const parsed = new URL(raw.trim());
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }

    const allowed = ALLOWED_HOSTS.some(
      (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`)
    );
    if (!allowed) {
      return null;
    }

    parsed.hash = "";
    return `${parsed.origin}${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

function normalizeCategoryNo(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d{1,6}$/.test(trimmed)) return undefined;
  return trimmed;
}

// GET: 전체 링크 조회
export async function GET() {
  try {
    noStore();
    const links = await prisma.brandLink.findMany({
      orderBy: { createdAt: "desc" },
    });

    const data = links.map((link) => {
      try {
        const prepared = readBrandPostPackage(link.id, { migrate: false });
        return {
          ...link,
          draftPrepared: Boolean(prepared),
          draftApproved: Boolean(prepared?.approvedAt),
          draftTitle: prepared?.title || null,
          draftPreparedAt: prepared?.createdAt || null,
          draftRevision: prepared ? `${prepared.markdownSha256}:${prepared.sourceSnapshot?.snapshotId || ""}` : null,
        };
      } catch {
        return {
          ...link,
          draftPrepared: false,
          draftApproved: false,
          draftTitle: null,
          draftPreparedAt: null,
        };
      }
    });

    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    console.error("링크 조회 실패:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

// POST: 링크 추가
export async function POST(request: NextRequest) {
  try {
    const authError = requireAdminApiKey(request);
    if (authError) {
      return authError;
    }

    const body = (await request.json()) as CreateBrandLinkRequest;
    const { url, memo, categoryNo: rawCategoryNo, useSectionHeading } = body;
    const connectKind = parseConnectKind(body.connectKind);

    if (!url?.trim()) {
      return NextResponse.json(
        { success: false, error: "URL이 필요합니다." },
        { status: 400 }
      );
    }

    const normalizedUrl = normalizeBrandLinkUrl(url);
    if (!normalizedUrl) {
      return NextResponse.json(
        {
          success: false,
          error: "지원하지 않는 URL 형식입니다. naver.me 또는 네이버 도메인 URL을 입력하세요.",
        },
        { status: 400 }
      );
    }

    const categoryNo = normalizeCategoryNo(rawCategoryNo);
    if (categoryNo === undefined) {
      return NextResponse.json(
        { success: false, error: "게시판 번호(categoryNo)는 숫자 문자열이어야 합니다." },
        { status: 400 }
      );
    }

    if (
      useSectionHeading !== undefined &&
      typeof useSectionHeading !== "boolean"
    ) {
      return NextResponse.json(
        { success: false, error: "useSectionHeading은 boolean이어야 합니다." },
        { status: 400 }
      );
    }

    // 중복 체크
    const existing = await prisma.brandLink.findFirst({
      where: { url: normalizedUrl },
    });

    if (existing) {
      return NextResponse.json(
        { success: false, error: "이미 등록된 URL입니다." },
        { status: 400 }
      );
    }

    const link = await prisma.brandLink.create({
      data: {
        url: normalizedUrl,
        memo: memo || null,
        categoryNo: categoryNo ?? null,
        useSectionHeading:
          typeof useSectionHeading === "boolean" ? useSectionHeading : true,
        connectKind: toStoredConnectKind(connectKind),
        sourceUrl: normalizedUrl,
        status: "READY",
      },
    });

    return NextResponse.json({ success: true, data: link });
  } catch (error: unknown) {
    console.error("링크 추가 실패:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
