"use client";

import { useEffect } from "react";

export function RemoteAgentPoller() {
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      if (stopped) return;
      // 기본 3초 주기. 인증 문제(401/403)면 알림을 보내되 폴링을 멈추지 않고
      // 간격만 늘린다 — 예전에는 여기서 완전히 멈춰서, 재활성화한 뒤에도 앱을
      // 재시작할 때까지 MCP 작업이 영영 실행되지 않았다.
      let nextDelayMs = 3000;
      try {
        const response = await fetch("/api/remote-agent/poll", { method: "POST", cache: "no-store" });
        if (response.status === 401 || response.status === 403) {
          window.dispatchEvent(new Event("blogautomcp:activation-changed"));
          nextDelayMs = 15000;
        } else if (response.status === 428) {
          // 아직 MCP 활성화 전 — 느긋하게 재확인.
          nextDelayMs = 15000;
        }
      } catch { /* reconnect on next tick */ }
      if (!stopped) timer = setTimeout(poll, nextDelayMs);
    };
    void poll();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, []);
  return null;
}
