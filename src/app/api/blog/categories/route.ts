import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { requireRemoteActivation } from "@/lib/api-auth";
import { fetchNaverPublishingOptions, getNaverSessionFile } from "@/lib/naver-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RawCategory {
  categoryNo: number;
  categoryName: string;
  parentCategoryNo: number;
  blockYn?: boolean;
  open?: boolean;
}

interface FormManagerOptionsResponse {
  isSuccess?: boolean;
  result?: {
    formView?: {
      categoryListFormView?: {
        defaultCategoryId?: number;
        categoryFormViewList?: RawCategory[];
      };
    };
  };
}

interface CategoryItem {
  categoryNo: string;
  categoryName: string;
  parentCategoryNo: string | null;
  depth: number;
  displayName: string;
}

class BlogCategoryAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlogCategoryAuthError";
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "알 수 없는 오류";
}

function flattenCategories(rawCategories: RawCategory[]): CategoryItem[] {
  const visibleCategories = rawCategories.filter((category) => {
    if (category.blockYn === true) return false;
    if (category.open === false) return false;
    return true;
  });

  const byParent = new Map<number, RawCategory[]>();
  for (const category of visibleCategories) {
    const parentKey = category.parentCategoryNo ?? -1;
    const bucket = byParent.get(parentKey);
    if (bucket) {
      bucket.push(category);
    } else {
      byParent.set(parentKey, [category]);
    }
  }

  const ordered: CategoryItem[] = [];
  const visited = new Set<number>();

  const visit = (parentCategoryNo: number, depth: number) => {
    const children = byParent.get(parentCategoryNo) ?? [];
    for (const child of children) {
      if (visited.has(child.categoryNo)) continue;
      visited.add(child.categoryNo);

      ordered.push({
        categoryNo: String(child.categoryNo),
        categoryName: child.categoryName,
        parentCategoryNo: child.parentCategoryNo >= 0 ? String(child.parentCategoryNo) : null,
        depth,
        displayName: `${depth > 0 ? `${"· ".repeat(depth)}` : ""}${child.categoryName}`,
      });

      visit(child.categoryNo, depth + 1);
    }
  };

  visit(-1, 0);

  for (const category of visibleCategories) {
    if (visited.has(category.categoryNo)) continue;
    ordered.push({
      categoryNo: String(category.categoryNo),
      categoryName: category.categoryName,
      parentCategoryNo: category.parentCategoryNo >= 0 ? String(category.parentCategoryNo) : null,
      depth: 0,
      displayName: category.categoryName,
    });
  }

  return ordered;
}

export async function GET(request: NextRequest) {
  const activationError = requireRemoteActivation(request);
  if (activationError) return activationError;
  try {
    const blogId = process.env.NAVER_BLOG_ID?.trim();
    if (!blogId) {
      return NextResponse.json(
        { success: false, error: "네이버 블로그 ID를 먼저 설정해 주세요.", code: "NAVER_SESSION_CONFIGURATION_REQUIRED", authRequired: false, sessionStatus: "configuration" },
        { status: 400 },
      );
    }

    const storageStatePath = getNaverSessionFile();
    if (!fs.existsSync(storageStatePath)) throw new BlogCategoryAuthError("저장된 네이버 세션이 없습니다. 네이버 로그인을 진행해 주세요.");
    const { validation, data } = await fetchNaverPublishingOptions(storageStatePath, blogId);
    if (!validation.valid) {
      return NextResponse.json(
        { success: false, error: validation.error, code: validation.code, authRequired: validation.authRequired, sessionStatus: validation.status },
        { status: validation.authRequired ? 200 : validation.status === "forbidden" ? 403 : 503 },
      );
    }
    const parsed = data as FormManagerOptionsResponse;

    const categoryList = parsed.result?.formView?.categoryListFormView?.categoryFormViewList ?? [];
    const defaultCategoryId = parsed.result?.formView?.categoryListFormView?.defaultCategoryId;

    return NextResponse.json({
      success: true,
      data: {
        blogId,
        defaultCategoryNo: typeof defaultCategoryId === "number" ? String(defaultCategoryId) : null,
        categories: flattenCategories(categoryList),
      },
    });
  } catch (error: unknown) {
    console.error("블로그 카테고리 조회 실패:", error);
    const authRequired = error instanceof BlogCategoryAuthError;
    return NextResponse.json(
      {
        success: false,
        error: authRequired ? getErrorMessage(error) : "네이버 게시판 목록을 확인하지 못했습니다. 저장된 세션은 유지됩니다. 잠시 후 다시 확인해 주세요.",
        code: authRequired ? "NAVER_SESSION_EXPIRED" : "NAVER_SESSION_CHECK_FAILED",
        authRequired,
        sessionStatus: authRequired ? "auth-required" : "unknown",
      },
      { status: authRequired ? 200 : 503 },
    );
  }
}
