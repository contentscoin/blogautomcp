"use client";

import { useCallback, useEffect, useState } from "react";

interface ActivationState {
  configured: boolean;
  siteUrl?: string | null;
  deviceId?: string | null;
}

export function ActivationGate({ children }: { children: React.ReactNode }) {
  const [activation, setActivation] = useState<ActivationState | null>(null);
  const [mcpUrl, setMcpUrl] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const loadActivation = useCallback(async () => {
    try {
      const response = await fetch("/api/remote-agent", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || "활성화 상태를 확인하지 못했습니다.");
      setActivation(payload.data);
    } catch (error) {
      setActivation({ configured: false });
      setMessage(error instanceof Error ? error.message : "활성화 상태를 확인하지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    void loadActivation();
    const refresh = () => void loadActivation();
    window.addEventListener("blogautomcp:activation-changed", refresh);
    return () => window.removeEventListener("blogautomcp:activation-changed", refresh);
  }, [loadActivation]);

  async function pair() {
    if (!mcpUrl.trim()) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/remote-agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mcpUrl: mcpUrl.trim(), deviceName: deviceName.trim() }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || "이 PC를 연결하지 못했습니다.");
      setMcpUrl("");
      setActivation(payload.data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "이 PC를 연결하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  if (activation === null) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <p className="text-sm text-slate-400">BlogAutoMCP 활성화 상태 확인 중…</p>
      </main>
    );
  }

  if (!activation.configured) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <section className="w-full max-w-xl rounded-3xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
          <span className="text-xs font-semibold tracking-[0.2em] text-emerald-400">PC ACTIVATION</span>
          <h1 className="mt-3 text-3xl font-bold">MCP 주소로 이 PC 연결</h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            사이트에서 가입 승인 후 발급받은 MCP 주소를 입력하세요. 인증 전에는 자동화 기능을 사용할 수 없습니다.
          </p>
          <form
            className="mt-7 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void pair();
            }}
          >
            <label className="block text-sm font-medium text-slate-300" htmlFor="activation-mcp-url">MCP 주소</label>
            <input
              id="activation-mcp-url"
              name="mcp-activation-url"
              type="password"
              autoComplete="new-password"
              value={mcpUrl}
              onChange={(event) => {
                setMcpUrl(event.target.value);
                setMessage("");
              }}
              placeholder="https://사이트/api/mcp/…"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm outline-none focus:border-emerald-500"
            />
            <label className="block pt-2 text-sm font-medium text-slate-300" htmlFor="activation-device-name">PC 이름</label>
            <input
              id="activation-device-name"
              name="activation-device-name"
              type="text"
              autoComplete="off"
              value={deviceName}
              onChange={(event) => setDeviceName(event.target.value)}
              placeholder="비우면 컴퓨터 이름 사용"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm outline-none focus:border-emerald-500"
            />
            <button
              type="submit"
              disabled={busy || !mcpUrl.trim()}
              className="mt-3 w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "연결 확인 중…" : "이 PC 연결"}
            </button>
          </form>
          {message ? <p className="mt-4 text-sm text-amber-300" role="status">{message}</p> : null}
          <p className="mt-6 text-xs leading-5 text-slate-500">
            같은 MCP 주소를 ChatGPT에도 등록합니다. 주소가 재발급되거나 이 PC 인증이 폐기되면 프로그램은 자동으로 다시 잠깁니다.
          </p>
        </section>
      </main>
    );
  }

  return <>{children}</>;
}
