"use client";

import { useCallback, useEffect, useState } from "react";

interface AdminSessionState {
  required: boolean;
  authenticated: boolean;
}

/**
 * 관리자 키 게이트.
 *
 * ADMIN_API_KEY 가 설정된 서버에서는 대시보드도 키를 한 번 입력해 세션 쿠키를 받아야
 * 관리자 API(발행·설정·중지 등)를 부를 수 있다. 데스크톱 앱은 메인 프로세스가 헤더를
 * 붙여 주므로 이 화면이 보이지 않는다.
 */
export function AdminSessionGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AdminSessionState | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin-session", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || "관리자 세션 상태를 확인하지 못했습니다.");
      setState(payload.data as AdminSessionState);
    } catch {
      // 세션 API 를 못 읽으면 게이트를 띄우지 않고 기존 화면을 그대로 보여 준다.
      setState({ required: false, authenticated: true });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!key.trim()) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: key.trim() }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || "관리자 키가 일치하지 않습니다.");
      setKey("");
      setState(payload.data as AdminSessionState);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "관리자 키가 일치하지 않습니다.");
    } finally {
      setBusy(false);
    }
  }

  if (!state || !state.required || state.authenticated) {
    return <>{children}</>;
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-xl">
        <h1 className="text-lg font-bold">관리자 키 입력</h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          이 서버에는 관리자 API 키(ADMIN_API_KEY)가 설정되어 있어요. 발행·설정 같은 관리자 기능을 쓰려면 키를 한 번 입력해 주세요.
        </p>
        <input
          type="password"
          autoComplete="current-password"
          value={key}
          onChange={(event) => setKey(event.target.value)}
          placeholder="ADMIN_API_KEY"
          className="mt-5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-violet-500"
        />
        {message && <p className="mt-3 text-sm text-rose-400">{message}</p>}
        <button
          type="submit"
          disabled={busy || !key.trim()}
          className="mt-5 w-full rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "확인 중…" : "확인"}
        </button>
      </form>
    </main>
  );
}
