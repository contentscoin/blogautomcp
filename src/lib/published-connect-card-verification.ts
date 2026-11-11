import type { PublishedPostSnapshot } from "./published-post-verification";
import type { ResolvedPostDocumentV1 } from "./post-composition-contract";

/** Keep exact approved URL matching. A native card may expose the destination
 * of an approved naver.me URL; attach that original URL only after one observed
 * manual 307 response proves its exact native-card metadata destination. Never
 * follow or request the affiliate URL itself. */
export async function resolvePublishedConnectCardAliases(
  snapshot: PublishedPostSnapshot,
  expected: ResolvedPostDocumentV1 | null,
  fetcher: typeof fetch = fetch,
): Promise<PublishedPostSnapshot> {
  if (snapshot.scope !== "confirmed" || expected?.connectKind !== "SHOPPING" || snapshot.connectCards.length > 16) return snapshot;
  const nativeCards = snapshot.connectCards.filter(card => card.nativeShoppingConnect && card.urls.includes(card.nativeShoppingConnect.affiliateUrl));
  if (!nativeCards.length) return snapshot;
  const shorts = [...new Set(expected.renderNodes.flatMap(node => node.kind === "connectCard" && !snapshot.connectCards.some(card => card.urls.includes(node.url)) ? [node.url] : []))];
  if (shorts.length > 8) return snapshot;
  const proven = new Map<string, string>();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);
  try { for (const short of shorts) {
    if (controller.signal.aborted) break;
    let url: URL;
    try { url = new URL(short); } catch { continue; }
    if (url.protocol !== "https:" || url.hostname !== "naver.me" || url.port || url.username || url.password || url.search || url.hash ||
        !/^\/[A-Za-z0-9]{1,32}$/u.test(url.pathname) || url.href !== short) continue;
    let response: Response | null = null;
    try {
      response = await fetcher(short, { method: "GET", redirect: "manual", cache: "no-store", signal: controller.signal });
      if (response.status !== 307 || response.redirected || response.url && response.url !== short) continue;
      const location = response.headers.get("location");
      if (!location || location.length > 1_024 || Number(response.headers.get("content-length") || 0) > 16_384) continue;
      const destination = new URL(location);
      if (destination.protocol !== "https:" || destination.hostname !== "brandconnect.naver.com" || destination.port || destination.username || destination.password || destination.hash ||
          destination.href !== location || !/^\/affiliates\/[1-9]\d{0,19}$/u.test(destination.pathname) || Array.from(destination.searchParams).length !== 1 ||
          !/^[1-9]\d{0,19}$/u.test(destination.searchParams.get("channelProductNo") || "")) continue;
      // The response body is irrelevant to URL identity and is never buffered.
      // Cancelling it also bounds large/chunked redirects without reading them.
      if (nativeCards.some(card => card.nativeShoppingConnect!.affiliateUrl === location)) proven.set(short, location);
    } catch { /* Unknown, expired, redirected or unreachable URLs stay partial. */ }
    finally { await response?.body?.cancel().catch(() => {}); }
  } } finally { clearTimeout(timeout); }
  if (!proven.size) return snapshot;
  return { ...snapshot, connectCards: snapshot.connectCards.map(card => {
    const destination = card.nativeShoppingConnect?.affiliateUrl;
    const aliases = destination && card.urls.includes(destination) ? Array.from(proven).filter(([, value]) => value === destination).map(([short]) => short) : [];
    return aliases.length ? { ...card, urls: [...new Set([...card.urls, ...aliases])] } : card;
  }) };
}
