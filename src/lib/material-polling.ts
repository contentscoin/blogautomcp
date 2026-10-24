/** UI polling only. Publication and background automation keep their own gates. */
export function startMaterialPolling(options: {
  poll: (signal: AbortSignal) => Promise<boolean>;
  activeIntervalMs: number;
  idleIntervalMs?: number;
  requestTimeoutMs?: number;
  visibility: Pick<Document, "hidden" | "addEventListener" | "removeEventListener">;
  desktopVisibility?: Pick<Window, "addEventListener" | "removeEventListener"> & { __brandconnectMaterialUiVisible?: boolean };
  requireDesktopVisibility?: boolean;
  onError?: (error: unknown) => void;
}) {
  let stopped = false;
  const isHidden = () => options.visibility.hidden || Boolean(options.desktopVisibility &&
    (options.requireDesktopVisibility || options.desktopVisibility.__brandconnectMaterialUiVisible !== undefined) &&
    options.desktopVisibility.__brandconnectMaterialUiVisible !== true);
  let hidden = isHidden();
  let active = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;
  let pendingRefresh: Promise<void> | undefined;
  let controller: AbortController | undefined;
  const clearTimer = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  const refresh = async (): Promise<void> => {
    if (stopped || hidden) return;
    clearTimer();
    if (running) {
      // A post-action refresh must read after an older poll finishes, rather
      // than reuse a response which may predate the accepted action.
      pendingRefresh ??= running.catch(() => {}).then(() => {
        pendingRefresh = undefined;
        return refresh();
      });
      return pendingRefresh;
    }
    const request = new AbortController();
    controller = request;
    let timedOut = false;
    let cancel!: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      cancel = () => reject(new Error(timedOut ? "소재 목록 요청 시간이 초과되었습니다. 다음 조회에서 다시 확인합니다." : "Material polling cancelled"));
      request.signal.addEventListener("abort", cancel, { once: true });
    });
    const deadline = setTimeout(() => { timedOut = true; request.abort(); }, options.requestTimeoutMs ?? 30_000);
    running = Promise.race([cancelled,
      Promise.resolve().then(() => request.signal.aborted || stopped ? active : options.poll(request.signal)),
    ]).then(result => {
      if (!request.signal.aborted && !stopped) active = result;
    }).catch(error => {
      if (stopped || request.signal.aborted && !timedOut) return;
      options.onError?.(error);
      throw error;
    }).finally(() => {
      clearTimeout(deadline); request.signal.removeEventListener("abort", cancel);
      running = undefined; controller = undefined;
      if (!stopped && !hidden) timer = setTimeout(() => { void refresh().catch(() => {}); },
        active ? options.activeIntervalMs : options.idleIntervalMs ?? 30_000);
    });
    return running;
  };
  const onVisibility = () => {
    const nextHidden = isHidden();
    if (nextHidden === hidden) return;
    hidden = nextHidden;
    clearTimer();
    if (hidden) controller?.abort();
    else void refresh().catch(() => {});
  };
  options.visibility.addEventListener("visibilitychange", onVisibility);
  options.desktopVisibility?.addEventListener("blogautomcp:material-ui-visibility", onVisibility);
  void refresh().catch(() => {});
  return { refresh, stop: () => {
    stopped = true; clearTimer(); controller?.abort();
    options.visibility.removeEventListener("visibilitychange", onVisibility);
    options.desktopVisibility?.removeEventListener("blogautomcp:material-ui-visibility", onVisibility);
  } };
}
