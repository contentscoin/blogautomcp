/** Parse only real Naver blog post identities, never arbitrary logNo query strings. */
export function parseNaverPublishedUrl(value: string, expectedBlogId?: string | null): { blogId: string; logNo: string; url: string } | null {
  try {
    const input = new URL(value);
    if (!['https:', 'http:'].includes(input.protocol) || !/^(?:m\.)?blog\.naver\.com$/i.test(input.hostname)) return null;
    const pathMatch = input.pathname.match(/^\/([A-Za-z0-9_-]+)\/(\d+)\/?$/);
    const blogId = pathMatch?.[1] || (/^\/PostView(?:\.naver)?\/?$/i.test(input.pathname) ? input.searchParams.get('blogId') : null);
    const logNo = pathMatch?.[2] || input.searchParams.get('logNo');
    if (!blogId || !/^[A-Za-z0-9_-]+$/.test(blogId) || !logNo || !/^\d+$/.test(logNo)) return null;
    if (expectedBlogId && blogId.toLowerCase() !== expectedBlogId.toLowerCase()) return null;
    return { blogId, logNo, url: `https://blog.naver.com/${encodeURIComponent(blogId)}/${logNo}` };
  } catch { return null; }
}
