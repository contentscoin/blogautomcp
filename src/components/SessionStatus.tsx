"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

interface SessionData {
  hasSession: boolean;
  isValid: boolean;
  automationEnabled?: boolean;
  savedAt?: string;
  checkedAt?: string;
  error?: string;
  mode?: string;
}

interface SessionApiData extends SessionData {
  naver: SessionData;
  chatgpt: SessionData;
}

interface DesktopUpdateState {
  currentVersion: string | null;
  status: string;
  version: string | null;
  progress: number;
  error: string | null;
  installPending: boolean;
}

interface ActivationState {
  configured: boolean;
  siteUrl: string | null;
  deviceId: string | null;
}

type ControlAction = "restart" | "update" | null;

const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

function getStatusText(value: SessionData | undefined): string {
  if (!value?.hasSession) return "로그인 필요";
  if (value.isValid) return "로그인 확인됨";
  return "저장된 세션 확인 필요";
}

function getStatusDotClass(value: SessionData | undefined): string {
  if (!value?.hasSession) return "bg-red-500";
  if (value.isValid) return "bg-emerald-500";
  return "bg-amber-500";
}

function updateStatusText(update: DesktopUpdateState | null): string {
  if (!update) return "업데이트 상태 확인 중";
  if (update.status === "current") return "최신 버전입니다";
  if (update.status === "checking" || update.status === "starting") return "새 버전 확인 중";
  if (update.status === "available") return `v${update.version} 다운로드 준비 중`;
  if (update.status === "downloading") return `v${update.version} 다운로드 ${Math.round(update.progress)}%`;
  if (update.status === "downloaded" || update.status === "waiting-for-idle") return `v${update.version} 설치 대기 · 작업 종료 후 자동 재시작`;
  if (update.status === "installing") return `v${update.version} 자동 설치 중`;
  if (update.status === "waiting-for-activation") return "MCP 주소 연결 후 자동 업데이트가 시작됩니다";
  if (update.status === "disabled") return "개발 환경에서는 자동 업데이트가 꺼져 있습니다";
  if (update.status === "error" || update.status === "install-error") return "중앙 업데이트 연결을 다시 시도해야 합니다";
  return "중앙 업데이트 대기 중";
}

function updateStatusDotClass(update: DesktopUpdateState | null): string {
  if (!update) return "bg-slate-400";
  if (update.status === "error" || update.status === "install-error") return "bg-red-500";
  if (["available", "downloading", "downloaded", "waiting-for-idle", "installing"].includes(update.status)) return "bg-sky-500";
  if (update.status === "current") return "bg-emerald-500";
  return "bg-amber-500";
}

export default function SessionStatus() {
  const [session, setSession] = useState<SessionApiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [naverLoggingIn, setNaverLoggingIn] = useState(false);
  const [chatGptLoggingIn, setChatGptLoggingIn] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [update, setUpdate] = useState<DesktopUpdateState | null>(null);
  const [activation, setActivation] = useState<ActivationState | null>(null);
  const [controlBusy, setControlBusy] = useState<ControlAction>(null);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [mcpUrl, setMcpUrl] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [reconnecting, setReconnecting] = useState(false);
  const [blogId, setBlogId] = useState("");
  const [savingBlogId, setSavingBlogId] = useState(false);
  const [browserAutomationEnabled, setBrowserAutomationEnabled] = useState(true);
  const [savingBrowserMode, setSavingBrowserMode] = useState(false);

  const fetchSession = useCallback(async () => {
    try {
      const response = await fetch("/api/session", { cache: "no-store" });
      const payload = await response.json();
      if (response.ok && payload.success) {
        setSession(payload.data);
        if (typeof payload.data?.chatgpt?.automationEnabled === "boolean") {
          setBrowserAutomationEnabled(payload.data.chatgpt.automationEnabled);
        }
      }
    } catch (error) {
      console.error("세션 조회 실패:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchUpdate = useCallback(async () => {
    try {
      const response = await fetch("/api/system/update-readiness", { cache: "no-store" });
      const payload = await response.json();
      if (response.ok && payload.success) setUpdate(payload.data.update);
    } catch {
      // 주기 확인에서 다시 시도합니다.
    }
  }, []);

  const fetchActivation = useCallback(async () => {
    try {
      const response = await fetch("/api/remote-agent", { cache: "no-store" });
      const payload = await response.json();
      if (response.ok && payload.success) setActivation(payload.data);
    } catch {
      // 활성화 게이트에서도 상태를 확인하므로 여기서는 화면을 유지합니다.
    }
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const response = await fetch("/api/settings", { cache: "no-store" });
      const payload = await response.json();
      if (response.ok && payload.success) {
        setBlogId(payload.data?.values?.NAVER_BLOG_ID || "");
        setBrowserAutomationEnabled(payload.data?.browserDraftAutomationEnabled !== false);
      }
    } catch {
      // 설정 입력란은 서버 상태를 확인할 수 있을 때 채웁니다.
    }
  }, []);

  async function saveBrowserAutomation(enabled: boolean) {
    setSavingBrowserMode(true);
    setNotice(null);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values: { CHATGPT_BROWSER_AUTOMATION_ENABLED: enabled ? "true" : "false" } }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || "ChatGPT 작성 방식을 저장하지 못했습니다.");
      setBrowserAutomationEnabled(enabled);
      setNotice(enabled
        ? "ChatGPT 웹 자동작성을 켰습니다. 로그인 상태가 확인되면 데스크톱에서 초안이 자동 생성됩니다."
        : "ChatGPT 웹 자동작성을 껐습니다. 초안 요청문을 ChatGPT로 넘기는 방식으로 동작합니다.");
      await fetchSession();
      window.dispatchEvent(new Event("blogautomcp:draft-mode-changed"));
    } catch (error) {
      setNotice(`오류: ${error instanceof Error ? error.message : "ChatGPT 작성 방식을 저장하지 못했습니다."}`);
    } finally {
      setSavingBrowserMode(false);
    }
  }

  async function saveBlogId() {
    setSavingBlogId(true);
    setNotice(null);
    try {
      const value = blogId.trim().replace(/^https?:\/\/(?:www\.)?blog\.naver\.com\//i, "").replace(/\/.*/, "");
      if (!value) throw new Error("네이버 블로그 ID를 입력해주세요.");
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values: { NAVER_BLOG_ID: value } }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || "블로그 ID를 저장하지 못했습니다.");
      setBlogId(value);
      setNotice("네이버 블로그 ID가 저장되었습니다. 게시판 목록을 다시 확인합니다.");
      await fetchSession();
      window.dispatchEvent(new Event("blogautomcp:blog-id-changed"));
    } catch (error) {
      setNotice(`오류: ${error instanceof Error ? error.message : "블로그 ID를 저장하지 못했습니다."}`);
    } finally {
      setSavingBlogId(false);
    }
  }

  async function pollLoginJob(jobId: string, provider: "naver" | "chatgpt") {
    const providerLabel = provider === "chatgpt" ? "ChatGPT" : "네이버";
    const deadline = Date.now() + (provider === "chatgpt" ? 10 : 6) * 60_000;
    const setProviderLoggingIn = provider === "chatgpt" ? setChatGptLoggingIn : setNaverLoggingIn;
    while (Date.now() < deadline) {
      await wait(3_000);
      try {
        const response = await fetch(`/api/session/login?jobId=${encodeURIComponent(jobId)}`, { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok || !payload.success) continue;
        if (payload.data.status === "succeeded") {
          setNotice(`${providerLabel} 재로그인이 완료되었습니다.`);
          setProviderLoggingIn(false);
          await fetchSession();
          return;
        }
        if (payload.data.status === "failed") {
          setNotice(`오류: ${payload.data.error || `${providerLabel} 로그인에 실패했습니다.`}`);
          setProviderLoggingIn(false);
          await fetchSession();
          return;
        }
      } catch {
        // 로그인 창이 열려 있는 동안 일시적인 조회 실패는 재시도합니다.
      }
    }
    setNotice(`${providerLabel} 로그인 확인 시간이 초과되었습니다. 로그인 상태를 다시 확인해주세요.`);
    setProviderLoggingIn(false);
    await fetchSession();
  }

  async function startLogin(provider: "naver" | "chatgpt") {
    const providerLabel = provider === "chatgpt" ? "ChatGPT" : "네이버";
    const setProviderLoggingIn = provider === "chatgpt" ? setChatGptLoggingIn : setNaverLoggingIn;
    try {
      setProviderLoggingIn(true);
      setNotice(null);
      const response = await fetch("/api/session/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, force: true }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || `${providerLabel} 로그인을 시작하지 못했습니다.`);
      setNotice(payload.message || `열린 창에서 ${providerLabel} 로그인을 완료하세요.`);
      const jobId = payload.data?.jobId as string | undefined;
      if (jobId) void pollLoginJob(jobId, provider);
      else setProviderLoggingIn(false);
    } catch (error) {
      setNotice(`오류: ${error instanceof Error ? error.message : `${providerLabel} 로그인을 시작하지 못했습니다.`}`);
      setProviderLoggingIn(false);
    }
  }

  async function restartServer() {
    setControlBusy("restart");
    setNotice("로컬 서버 재시작을 요청하고 있습니다…");
    try {
      const response = await fetch("/api/system/control", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "restart-server" }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || "서버를 다시 시작하지 못했습니다.");
      setNotice(payload.message || "로컬 서버를 다시 시작합니다.");

      await wait(1_500);
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        try {
          const health = await fetch("/api/system/control", { cache: "no-store" });
          if (health.ok) {
            window.location.reload();
            return;
          }
        } catch {
          // 서버가 내려갔다 올라오는 동안 연결 실패는 정상입니다.
        }
        await wait(750);
      }
      throw new Error("서버가 제한 시간 안에 다시 연결되지 않았습니다. 트레이에서 프로그램을 다시 열어주세요.");
    } catch (error) {
      setNotice(`오류: ${error instanceof Error ? error.message : "서버를 다시 시작하지 못했습니다."}`);
      setControlBusy(null);
    }
  }

  async function checkUpdates() {
    setControlBusy("update");
    setNotice("중앙 서버에서 새 버전을 확인하고 있습니다…");
    try {
      const response = await fetch("/api/system/control", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "check-updates" }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || "업데이트 확인을 시작하지 못했습니다.");
      await fetchUpdate();
      const updateError = payload.data?.update?.error as string | undefined;
      setNotice(updateError ? `업데이트 확인 실패: ${updateError}` : payload.message || "업데이트 확인을 완료했습니다.");
    } catch (error) {
      setNotice(`오류: ${error instanceof Error ? error.message : "업데이트를 확인하지 못했습니다."}`);
    } finally {
      setControlBusy(null);
    }
  }

  async function reconnectMcp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mcpUrl.trim()) return;
    setReconnecting(true);
    setNotice("새 MCP 주소로 이 PC를 다시 연결하고 있습니다…");
    try {
      const response = await fetch("/api/remote-agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mcpUrl: mcpUrl.trim(), deviceName: deviceName.trim() }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || "GPT(MCP)를 다시 연결하지 못했습니다.");
      setActivation(payload.data);
      setMcpUrl("");
      setDeviceName("");
      setMcpOpen(false);
      setNotice("GPT(MCP) 재연결이 완료되었습니다. 이 PC의 인증이 즉시 교체되었습니다.");
      window.dispatchEvent(new Event("blogautomcp:activation-changed"));
    } catch (error) {
      setNotice(`오류: ${error instanceof Error ? error.message : "GPT(MCP)를 다시 연결하지 못했습니다."}`);
    } finally {
      setReconnecting(false);
    }
  }

  useEffect(() => {
    void Promise.all([fetchSession(), fetchUpdate(), fetchActivation(), fetchSettings()]);
    const timer = window.setInterval(() => void fetchUpdate(), 15_000);
    return () => window.clearInterval(timer);
  }, [fetchActivation, fetchSession, fetchSettings, fetchUpdate]);

  const naver = session?.naver;
  const chatgpt = session?.chatgpt;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-[0.18em] text-sky-600">LOCAL CONTROL</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">로컬 프로그램 제어</h2>
          <p className="mt-1 text-sm text-slate-500">Electron 프로그램과 연결 상태를 이 화면에서 바로 관리합니다.</p>
        </div>
        {activation?.siteUrl ? (
          <span className="max-w-full truncate rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700" title={activation.siteUrl}>
            MCP 연결됨 · {activation.siteUrl}
          </span>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
        <button
          type="button"
          onClick={() => void restartServer()}
          disabled={controlBusy === "restart"}
          className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-sky-300 hover:bg-sky-50 disabled:cursor-wait disabled:opacity-60"
        >
          <span className="text-xl" aria-hidden="true">↻</span>
          <span className="mt-2 block text-sm font-semibold text-slate-900">{controlBusy === "restart" ? "재시작 중…" : "서버 재시작"}</span>
          <span className="mt-1 block text-xs leading-5 text-slate-500">프로그램과 로컬 MCP 서버를 안전하게 다시 실행</span>
        </button>
        <button
          type="button"
          onClick={() => void startLogin("naver")}
          disabled={naverLoggingIn}
          className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-emerald-300 hover:bg-emerald-50 disabled:cursor-wait disabled:opacity-60"
        >
          <span className="text-xl" aria-hidden="true">N</span>
          <span className="mt-2 block text-sm font-semibold text-slate-900">{naverLoggingIn ? "로그인 대기 중…" : "네이버 재로그인"}</span>
          <span className="mt-1 block text-xs leading-5 text-slate-500">전용 창을 열고 저장된 네이버 세션 교체</span>
        </button>
        <button
          type="button"
          onClick={() => void startLogin("chatgpt")}
          disabled={chatGptLoggingIn}
          className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-violet-300 hover:bg-violet-50 disabled:cursor-wait disabled:opacity-60"
        >
          <span className="text-xl" aria-hidden="true">✦</span>
          <span className="mt-2 block text-sm font-semibold text-slate-900">{chatGptLoggingIn ? "로그인 대기 중…" : "ChatGPT 재로그인"}</span>
          <span className="mt-1 block text-xs leading-5 text-slate-500">자동 초안 작성에 사용할 전용 웹 세션 저장</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setMcpOpen((open) => !open);
            setNotice(null);
          }}
          aria-expanded={mcpOpen}
          className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-violet-300 hover:bg-violet-50"
        >
          <span className="text-xl" aria-hidden="true">◎</span>
          <span className="mt-2 block text-sm font-semibold text-slate-900">GPT(MCP) 재연결</span>
          <span className="mt-1 block text-xs leading-5 text-slate-500">새 MCP 주소로 이 PC 인증 즉시 교체</span>
        </button>
        <button
          type="button"
          onClick={() => void checkUpdates()}
          disabled={controlBusy === "update"}
          className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-amber-300 hover:bg-amber-50 disabled:cursor-wait disabled:opacity-60"
        >
          <span className="text-xl" aria-hidden="true">⇩</span>
          <span className="mt-2 block text-sm font-semibold text-slate-900">{controlBusy === "update" ? "확인 중…" : "업데이트 확인"}</span>
          <span className="mt-1 block text-xs leading-5 text-slate-500">중앙 배포 서버에서 최신 설치본 확인</span>
        </button>
      </div>

      {mcpOpen ? (
        <form onSubmit={reconnectMcp} className="mt-4 rounded-xl border border-violet-200 bg-violet-50/60 p-4">
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-slate-900">새 MCP 주소로 다시 연결</h3>
            <p className="mt-1 text-xs leading-5 text-slate-600">사이트에서 새로 발급한 주소를 입력하세요. 연결에 성공해야 현재 인증이 교체됩니다.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_auto] md:items-end">
            <label className="block text-xs font-medium text-slate-700" htmlFor="control-mcp-url">
              MCP 주소
              <input
                id="control-mcp-url"
                type="password"
                autoComplete="new-password"
                value={mcpUrl}
                onChange={(event) => setMcpUrl(event.target.value)}
                placeholder="https://사이트/api/mcp/…"
                className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-violet-500"
              />
            </label>
            <label className="block text-xs font-medium text-slate-700" htmlFor="control-device-name">
              PC 이름 (선택)
              <input
                id="control-device-name"
                type="text"
                autoComplete="off"
                value={deviceName}
                onChange={(event) => setDeviceName(event.target.value)}
                placeholder="비우면 컴퓨터 이름"
                className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-violet-500"
              />
            </label>
            <button
              type="submit"
              disabled={reconnecting || !mcpUrl.trim()}
              className="rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {reconnecting ? "연결 중…" : "인증 교체"}
            </button>
          </div>
        </form>
      ) : null}

      {notice ? (
        <p className={`mt-4 rounded-lg px-3 py-2 text-sm ${notice.startsWith("오류") || notice.includes("실패") ? "bg-red-50 text-red-700" : "bg-sky-50 text-sky-700"}`} role="status">
          {notice}
        </p>
      ) : null}

      <div className="mt-4 grid gap-3 xl:grid-cols-3">
        <div className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
          <div className="flex items-start gap-3">
            <div className={`mt-1 h-3 w-3 shrink-0 rounded-full ${loading ? "bg-slate-400" : getStatusDotClass(naver)}`} />
            <div>
              <h3 className="font-medium text-slate-900">네이버 로그인</h3>
              <p className="text-sm text-slate-600">{loading ? "상태 확인 중" : getStatusText(naver)}</p>
              <p className="mt-1 text-xs text-slate-400">브랜드커넥트 조회와 블로그 발행에 사용</p>
              {naver?.error ? <p className="mt-1 text-xs text-amber-700">{naver.error}</p> : null}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor="naver-blog-id">네이버 블로그 ID</label>
                <input
                  id="naver-blog-id"
                  type="text"
                  value={blogId}
                  onChange={(event) => setBlogId(event.target.value)}
                  placeholder="네이버 블로그 ID"
                  className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:border-emerald-500"
                />
                <button type="button" onClick={() => void saveBlogId()} disabled={savingBlogId} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60">
                  {savingBlogId ? "저장 중…" : "ID 저장"}
                </button>
              </div>
              <p className="mt-1 text-xs text-slate-400">blog.naver.com/ 뒤의 아이디만 입력해도 됩니다.</p>
            </div>
          </div>
          <button type="button" onClick={() => void fetchSession()} className="shrink-0 text-xs font-medium text-slate-600 underline underline-offset-2">상태 확인</button>
        </div>
        <div className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className={`mt-1 h-3 w-3 shrink-0 rounded-full ${!browserAutomationEnabled ? "bg-slate-400" : loading ? "bg-slate-400" : getStatusDotClass(chatgpt)}`} />
            <div className="min-w-0">
              <h3 className="font-medium text-slate-900">ChatGPT 자동작성</h3>
              <p className="text-sm text-slate-600">
                {!browserAutomationEnabled
                  ? "요청문 전달 방식"
                  : loading
                    ? "상태 확인 중"
                    : chatgpt?.isValid
                      ? "자동작성 준비됨"
                      : "ChatGPT 로그인 필요"}
              </p>
              <p className="mt-1 text-xs text-slate-400">API 키 없이 로그인된 ChatGPT 웹에서 초안을 만들고 미리보기를 엽니다.</p>
              {browserAutomationEnabled && chatgpt?.error ? <p className="mt-1 text-xs text-amber-700">{chatgpt.error}</p> : null}
              <button
                type="button"
                role="switch"
                aria-checked={browserAutomationEnabled}
                onClick={() => void saveBrowserAutomation(!browserAutomationEnabled)}
                disabled={savingBrowserMode}
                className={`mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition disabled:opacity-60 ${browserAutomationEnabled ? "bg-violet-100 text-violet-700 hover:bg-violet-200" : "bg-slate-200 text-slate-600 hover:bg-slate-300"}`}
              >
                <span className={`h-2 w-2 rounded-full ${browserAutomationEnabled ? "bg-violet-600" : "bg-slate-500"}`} />
                {savingBrowserMode ? "저장 중…" : browserAutomationEnabled ? "웹 자동작성 켜짐" : "웹 자동작성 꺼짐"}
              </button>
            </div>
          </div>
          <button type="button" onClick={() => void fetchSession()} className="shrink-0 text-xs font-medium text-slate-600 underline underline-offset-2">상태 확인</button>
        </div>
        <div className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
          <div className="flex items-start gap-3">
            <div className={`mt-1 h-3 w-3 shrink-0 rounded-full ${updateStatusDotClass(update)}`} />
            <div>
              <h3 className="font-medium text-slate-900">프로그램 자동 업데이트{update?.currentVersion ? ` · v${update.currentVersion}` : ""}</h3>
              <p className="text-sm text-slate-600">{updateStatusText(update)}</p>
              <p className="mt-1 text-xs text-slate-400">포스팅 작업 중에는 설치를 기다렸다가 안전할 때 자동 재시작합니다.</p>
              {update?.error ? <p className="mt-1 break-all text-xs text-amber-700">{update.error}</p> : null}
            </div>
          </div>
          <button type="button" onClick={() => void fetchUpdate()} className="shrink-0 text-xs font-medium text-slate-600 underline underline-offset-2">상태 확인</button>
        </div>
      </div>
      {session?.error ? <p className="mt-3 text-xs text-red-600">{session.error}</p> : null}
    </section>
  );
}
