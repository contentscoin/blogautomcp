import { request, type ClientRequest, type IncomingMessage } from "node:http";

export const LOCAL_JSON_FETCH_TIMEOUT_MS = 3 * 60 * 60 * 1000;
export const LOCAL_JSON_FETCH_MAX_BODY_BYTES = 32 * 1024 * 1024;

/** Buffered JSON transport for long-running local API calls. Never follows redirects. */
export async function localJsonFetch(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs: number = LOCAL_JSON_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const url = new URL(input);
  if (url.protocol !== "http:" || url.username || url.password ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new TypeError("localJsonFetch requires a loopback HTTP URL without credentials");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
    throw new RangeError("localJsonFetch timeoutMs must be between 1 and 2147483647");
  }
  if (init.signal?.aborted) throw init.signal.reason ?? new DOMException("Request aborted", "AbortError");
  // localApi sends serialized JSON. Reject unsupported bodies instead of silently changing them.
  if (init.body != null && typeof init.body !== "string") {
    throw new TypeError("localJsonFetch body must be a JSON string");
  }
  const body = init.body == null ? undefined : Buffer.from(init.body, "utf8");
  if (body && body.length > LOCAL_JSON_FETCH_MAX_BODY_BYTES) throw new RangeError("Request body exceeds 32 MiB");
  const method = (init.method || "GET").toUpperCase();
  if (method === "CONNECT" || method === "TRACE" || ((method === "GET" || method === "HEAD") && body !== undefined)) {
    throw new TypeError(`Unsupported localJsonFetch method/body combination: ${method}`);
  }
  const headers = new Headers(init.headers);
  if (!headers.has("host")) headers.set("host", url.host);
  // Pin localhost to a numeric loopback address: no DNS or proxy can redirect credentials.
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";

  return await new Promise<Response>((resolve, reject) => {
    const state: { request?: ClientRequest; response?: IncomingMessage; timer?: ReturnType<typeof setTimeout> } = {};
    let settled = false;
    const cleanup = () => {
      clearTimeout(state.timer);
      init.signal?.removeEventListener("abort", onAbort);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      state.response?.destroy();
      state.request?.destroy();
      reject(error);
    };
    const onAbort = () => fail(init.signal?.reason ?? new DOMException("Request aborted", "AbortError"));
    init.signal?.addEventListener("abort", onAbort, { once: true });
    state.timer = setTimeout(() => fail(new DOMException("Local HTTP request exceeded its total deadline", "TimeoutError")), timeoutMs);
    try {
      // A private non-pooled socket has no fetch/Undici headers timeout or inherited agent timeout.
      state.request = request(url, { method, headers: Object.fromEntries(headers.entries()), agent: false }, (response) => {
        state.response = response;
        response.on("error", fail);
        response.once("aborted", () => fail(new Error("Local HTTP response was aborted")));
        if (settled) { response.destroy(); return; }
        const status = response.statusCode || 500;
        if (status >= 300 && status < 400 && status !== 304) {
          fail(new Error(`Local HTTP redirects are not allowed (status ${status})`));
          return;
        }
        const noBody = method === "HEAD" || [204, 205, 304].includes(status);
        const declaredLength = Number(response.headers["content-length"]);
        if (!noBody && declaredLength > LOCAL_JSON_FETCH_MAX_BODY_BYTES) {
          fail(new RangeError("Response body exceeds 32 MiB"));
          return;
        }
        let length = 0;
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          if (settled) return;
          length += chunk.length;
          if (length > LOCAL_JSON_FETCH_MAX_BODY_BYTES) {
            fail(new RangeError("Response body exceeds 32 MiB"));
            return;
          }
          chunks.push(chunk);
        });
        response.once("end", () => {
          if (settled) return;
          try {
            const responseHeaders = new Headers();
            for (let i = 0; i < response.rawHeaders.length; i += 2) {
              responseHeaders.append(response.rawHeaders[i], response.rawHeaders[i + 1]);
            }
            const bytes = noBody ? null : new Uint8Array(Buffer.concat(chunks, length));
            const result = new Response(bytes, { status, statusText: response.statusMessage, headers: responseHeaders });
            settled = true;
            cleanup();
            resolve(result);
          } catch (error) { fail(error); }
        });
      });
      state.request.on("error", fail);
      state.request.once("upgrade", (_response, socket) => {
        socket.destroy();
        fail(new Error("Local HTTP protocol upgrades are not allowed"));
      });
      state.request.end(body);
    } catch (error) { fail(error); }
  });
}
