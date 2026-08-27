import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { requireRemoteActivation } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface StoredCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  secure?: boolean;
}

interface PlaywrightStorageState {
  cookies?: StoredCookie[];
}

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

function isDomainMatch(hostname: string, cookieDomain: string): boolean {
  const normalized = cookieDomain.replace(/^\./, "");
  return hostname === normalized || hostname.endsWith(`.${normalized}`);
}

function buildCookieHeaderForHost(storageStatePath: string, hostname: string): string {
  if (!fs.existsSync(storageStatePath)) {
    throw new BlogCategoryAuthError("네이버 로그인 세션 파일이 없습니다. `npm run login`을 먼저 실행하세요.");
  }

  const raw = fs.readFileSync(storageStatePath, "utf-8");
  const parsed = JSON.parse(raw) as PlaywrightStorageState;
  const cookies = Array.isArray(parsed.cookies) ? parsed.cookies : [];
  const nowSec = Date.now() / 1000;

  const usableCookies = cookies.filter((cookie) => {
    if (!cookie.name || cookie.value === undefined || !cookie.domain) return false;
    if (!isDomainMatch(hostname, cookie.domain)) return false;
    if (typeof cookie.expires === "number" && cookie.expires > 0 && cookie.expires <= nowSec) {
      return false;
    }
    return true;
  });

  const header = usableCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  if (!header) {
    throw new BlogCategoryAuthError("유효한 네이버 세션 쿠키를 찾지 못했습니다. `npm run login` 후 다시 시도하세요.");
  }

  return header;
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
        { success: false, error: "NAVER_BLOG_ID가 설정되어 있지 않습니다." },
        { status: 500 },
      );
    }

    const storageDir = process.env.SESSION_STORAGE_DIR?.trim();
    const storageStatePath = path.join(storageDir || path.join(process.cwd(), "playwright", "storage"), "naver-session.json");
    const cookieHeader = buildCookieHeaderForHost(storageStatePath, "blog.naver.com");
    const endpoint = `https://blog.naver.com/PostWriteFormManagerOptions.naver?blogId=${encodeURIComponent(
      blogId,
    )}`;

    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        cookie: cookieHeader,
        accept: "application/json, text/plain, */*",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new BlogCategoryAuthError("네이버 로그인 세션이 만료되었거나 권한이 없습니다. `npm run login`을 다시 실행하세요.");
      }
      throw new Error(`네이버 카테고리 조회 실패 (HTTP ${response.status})`);
    }

    const text = await response.text();
    let parsed: FormManagerOptionsResponse;
    try {
      parsed = JSON.parse(text) as FormManagerOptionsResponse;
    } catch {
      if (text.includes("<!DOCTYPE") || text.includes("<html") || text.includes("<script")) {
        throw new BlogCategoryAuthError(
          "네이버 로그인 세션이 만료되었거나 권한이 없습니다. 터미널에서 `npm run login`을 다시 실행해주세요.",
        );
      }
      console.error("네이버 카테고리 JSON 파싱 실패. 원본 응답:", text.substring(0, 500));
      throw new Error("네이버 카테고리 응답을 분석할 수 없습니다.");
    }

    if (!parsed.isSuccess) {
      throw new Error("네이버 카테고리 응답이 정상적이지 않습니다.");
    }

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
      { success: false, error: getErrorMessage(error), authRequired },
      { status: authRequired ? 200 : 500 },
    );
  }
}
