"use client";

import { useEffect } from "react";

export function RemoteAgentPoller() {
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      if (stopped) return;
      try {
        const response = await fetch("/api/remote-agent/poll", { method: "POST", cache: "no-store" });
        if (response.status === 401 || response.status === 403) {
          window.dispatchEvent(new Event("blogautomcp:activation-changed"));
          return;
        }
      } catch { /* reconnect on next tick */ }
      if (!stopped) timer = setTimeout(poll, 3000);
    };
    void poll();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, []);
  return null;
}
