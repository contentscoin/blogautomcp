/** Product import does not publish. Category discovery may be unavailable while
 * the BrandConnect session remains valid; defer category selection to publishing. */
export async function optionalBlogCategories(
  load: () => Promise<Map<string, string>>,
  warn: (message: string) => void = console.warn,
): Promise<Map<string, string>> {
  try { return await load(); }
  catch {
    warn('BLOG_CATEGORY_UNAVAILABLE: 게시판 목록을 읽지 못했습니다. 상품 동기화는 계속하며 발행 단계에서 게시판을 확인합니다.');
    return new Map();
  }
}
