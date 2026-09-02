"use client";

import { useCallback, useEffect, useState } from "react";

interface ActivationState {
  configured: boolean;
  siteUrl?: string | null;
  deviceId?: string | null;
  defaultSiteUrl?: string | null;
}

const UNCONFIGURED_REFRESH_MS = 4_000;

/**
 * PC 활성화 게이트.
 *
 * 기본 경로는 사이트의 "PC 앱 연결" 버튼(딥링크)이다 — 이 화면에서는 아무것도 입력하지 않아도
 * 메인 프로세스가 페어링을 마치면 상태가 자동 갱신된다. 딥링크가 막힌 환경을 위해
 * 8자 코드 입력을 두고, 구버전 호환용 MCP 주소 붙여넣기는 접어 둔다.
 */
export function ActivationGate({ children }: { children: React.ReactNode }) {
  const [activation, setActivation] = useState<ActivationState | null>(null);
  const [pairCode, setPairCode] = useState("");
  const [mcpUrl, setMcpUrl] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);

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

  // 딥링크 페어링은 메인 프로세스가 처리하므로, 미연결 상태에서는 주기적으로 다시 읽는다.
  useEffect(() => {
    if (!activation || activation.configured) return;
    const timer = window.setInterval(() => void loadActivation(), UNCONFIGURED_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [activation, loadActivation]);

  async function submit(body: Record<string, string>) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/remote-agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, deviceName: deviceName.trim() }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || "이 PC를 연결하지 못했습니다.");
      setPairCode("");
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
    const siteUrl = activation.defaultSiteUrl || "https://blogautomcp.hiway350051.chatgpt.site";
    const inputClass = "w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm outline-none focus:border-emerald-500";
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <section className="w-full max-w-xl rounded-3xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
          <span className="text-xs font-semibold tracking-[0.2em] text-emerald-400">PC ACTIVATION</span>
          <h1 className="mt-3 text-3xl font-bold">이 PC를 계정에 연결</h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            BlogAutoMCP 사이트 대시보드에서 <b className="text-slate-200">PC 앱 연결</b> 버튼을 누르면 이 앱이 자동으로 연결됩니다.
            ChatGPT 로그인이나 MCP 주소 입력은 필요 없습니다.
          </p>
          <a
            href={`${siteUrl}/dashboard`}
            target="_blank"
            rel="noreferrer"
            className="mt-5 block w-full rounded-xl bg-emerald-600 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-emerald-500"
          >
            사이트 열어서 PC 앱 연결하기
          </a>
          <p className="mt-2 text-xs text-slate-500">연결되면 이 화면이 자동으로 닫힙니다.</p>

          <div className="mt-8 border-t border-slate-800 pt-6">
            <h2 className="text-base font-semibold">앱이 자동으로 열리지 않았나요? 코드로 연결</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">사이트의 「PC 앱 연결」 카드에 표시된 8자 코드를 90초 안에 입력하세요.</p>
            <form
              className="mt-4 space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (pairCode.trim()) void submit({ pairCode: pairCode.trim(), siteUrl });
              }}
            >
              <label className="block text-sm font-medium text-slate-300" htmlFor="activation-pair-code">연결 코드</label>
              <input
                id="activation-pair-code"
                name="activation-pair-code"
                type="text"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={12}
                value={pairCode}
                onChange={(event) => { setPairCode(event.target.value.toUpperCase()); setMessage(""); }}
                placeholder="예: K7PM3XQ2"
                className={`${inputClass} font-mono tracking-[0.3em]`}
              />
              <label className="block pt-2 text-sm font-medium text-slate-300" htmlFor="activation-device-name">PC 이름 (선택)</label>
              <input
                id="activation-device-name"
                name="activation-device-name"
                type="text"
                autoComplete="off"
                value={deviceName}
                onChange={(event) => setDeviceName(event.target.value)}
                placeholder="비우면 컴퓨터 이름 사용"
                className={inputClass}
              />
              <button
                type="submit"
                disabled={busy || pairCode.replace(/[\s-]/g, "").length !== 8}
                className="mt-2 w-full rounded-xl border border-emerald-600 px-4 py-3 text-sm font-semibold text-emerald-300 hover:bg-emerald-600/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? "연결 확인 중…" : "코드로 이 PC 연결"}
              </button>
            </form>
          </div>

          <div className="mt-6 border-t border-slate-800 pt-4">
            <button type="button" className="text-xs text-slate-500 underline-offset-2 hover:underline" onClick={() => setAdvancedOpen((open) => !open)}>
              {advancedOpen ? "고급 옵션 닫기" : "고급: MCP 주소를 직접 붙여넣기"}
            </button>
            {advancedOpen ? (
              <form
                className="mt-3 space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (mcpUrl.trim()) void submit({ mcpUrl: mcpUrl.trim() });
                }}
              >
                <input
                  id="activation-mcp-url"
                  name="mcp-activation-url"
                  type="password"
                  autoComplete="new-password"
                  value={mcpUrl}
                  onChange={(event) => { setMcpUrl(event.target.value); setMessage(""); }}
                  placeholder="https://사이트/api/mcp/…"
                  className={inputClass}
                />
                <button
                  type="submit"
                  disabled={busy || !mcpUrl.trim()}
                  className="w-full rounded-xl border border-slate-700 px-4 py-3 text-sm font-semibold text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  MCP 주소로 연결 (구버전 방식)
                </button>
              </form>
            ) : null}
          </div>

          {message ? <p className="mt-4 text-sm text-amber-300" role="status">{message}</p> : null}
          <p className="mt-6 text-xs leading-5 text-slate-500">
            MCP 주소가 재발급되거나 이 PC 인증이 폐기되면 프로그램은 자동으로 다시 잠깁니다.
          </p>
        </section>
      </main>
    );
  }

  return <>{children}</>;
}
