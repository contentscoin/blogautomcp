export const BLOGAUTO_OAUTH_MCP_URL = 'https://blogautomcp.hiway350051.chatgpt.site/api/mcp';

// The operator's private Sites plugin is not installable by general users.
const PRIVATE_SITES_PLUGIN_ID = 'plugin_asdk_app_sites_a4ba33aa14088191b648c875a67bb5ea';

/** The server must explicitly confirm public approval before exposing an install link. */
export function resolvePublicPluginInstallUrl(value: unknown, approved = false): string | null {
  if (approved !== true || typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.origin !== 'https://chatgpt.com' || url.username || url.password || url.search || url.hash) return null;
    const match = /^\/plugins\/(plugin_[A-Za-z0-9_-]+)$/.exec(url.pathname);
    if (!match || match[1] === PRIVATE_SITES_PLUGIN_ID) return null;
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}
