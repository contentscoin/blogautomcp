"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface FieldDef {
  key: string;
  label: string;
  type: "text" | "password" | "select";
  options?: string[];
  secret?: boolean;
  hint?: string;
  advanced?: boolean;
}

interface SessionState {
  hasSession: boolean;
  isValid: boolean;
  lastChecked?: string;
  error?: string;
}

interface RemoteAgentState {
  configured: boolean;
  siteUrl?: string | null;
  deviceId?: string | null;
}

export default function SettingsPage() {
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [configured, setConfigured] = useState<Record<string, boolean>>({});
  const [envPath, setEnvPath] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>("");

  const [session, setSession] = useState<SessionState | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [remoteAgent, setRemoteAgent] = useState<RemoteAgentState | null>(null);
  const [remoteMcpUrl, setRemoteMcpUrl] = useState("");
  const [remoteDeviceName, setRemoteDeviceName] = useState("");
  const [remoteBusy, setRemoteBusy] = useState(false);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      if (data.success) {
        setFields(data.data.fields);
        setValues(data.data.values);
        setConfigured(data.data.configured);
        setEnvPath(data.data.envPath);
      } else {
        setMessage(data.error || "설정을 불러오지 못했습니다.");
      }
    } catch {
      setMessage("설정을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSession = useCallback(async () => {
    try {
      const res = await fetch("/api/session");
      const data = await res.json();
      if (data.success) {
        setSession({
          hasSession: data.data.naver?.hasSession ?? data.data.hasSession,
          isValid: data.data.naver?.isValid ?? data.data.isValid,
          lastChecked: data.data.naver?.checkedAt,
          error: data.data.naver?.error,
        });
      }
    } catch {
      /* ignore */
    }
  }, []);

  const loadRemoteAgent = useCallback(async () => {
    try {
      const response = await fetch("/api/remote-agent", { cache: "no-store" });
      const payload = await response.json();
      if (payload.success) setRemoteAgent(payload.data);
    } catch {
      setRemoteAgent({ configured: false });
    }
  }, []);

  useEffect(() => {
    loadSettings();
    loadSession();
    loadRemoteAgent();
  }, [loadSettings, loadSession, loadRemoteAgent]);

  const handleSave = async () => {
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage(`✅ 저장됨 (${data.applied?.length ?? 0}개 항목)`);
        await loadSettings();
      } else {
        setMessage(`❌ ${data.error || "저장 실패"}`);
      }
    } catch {
      setMessage("❌ 저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const handleNaverLogin = async () => {
    setLoggingIn(true);
    setMessage("");
    try {
      const res = await fetch("/api/session/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "naver" }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "로그인 실행 실패");
      setMessage(`🌐 ${data.message}`);

      const jobId = data.data?.jobId as string | undefined;
      if (!jobId) throw new Error("로그인 작업 번호를 받지 못했습니다.");

      const deadline = Date.now() + 9 * 60_000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        const statusResponse = await fetch(`/api/session/login?jobId=${encodeURIComponent(jobId)}`, {
          cache: "no-store",
        });
        const statusPayload = await statusResponse.json();
        if (!statusResponse.ok || !statusPayload.success) continue;
        if (statusPayload.data.status === "succeeded") {
          await loadSession();
          setMessage("✅ 네이버 로그인 세션이 저장되었습니다.");
          return;
        }
        if (statusPayload.data.status === "failed") {
          throw new Error(statusPayload.data.error || "네이버 로그인에 실패했습니다.");
        }
      }

      throw new Error("로그인 확인 시간이 초과되었습니다.");
    } catch (error) {
      setMessage(`❌ ${error instanceof Error ? error.message : "로그인 실행 실패"}`);
    } finally {
      setLoggingIn(false);
    }
  };

  const handleRemotePair = async () => {
    if (!remoteMcpUrl.trim()) return;
    setRemoteBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/remote-agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mcpUrl: remoteMcpUrl, deviceName: remoteDeviceName }) });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || "PC 연결 실패");
      setRemoteMcpUrl("");
      setMessage(`✅ ${payload.message}`);
      await loadRemoteAgent();
    } catch (error) {
      setMessage(`❌ ${error instanceof Error ? error.message : "PC 연결 실패"}`);
    } finally {
      setRemoteBusy(false);
    }
  };

  const renderField = (f: FieldDef) => (
                <div key={f.key}>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    {f.label}
                    {f.secret && configured[f.key] ? (
                      <span className="ml-2 text-xs text-green-500">설정됨</span>
                    ) : null}
                  </label>
                  {f.type === "select" ? (
                    <select
                      value={values[f.key] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="">(미설정)</option>
                      {f.options?.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={f.type === "password" ? "password" : "text"}
                      value={values[f.key] ?? ""}
                      placeholder={f.secret ? "변경하려면 새 값 입력" : ""}
                      onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
                    />
                  )}
                  {f.hint ? <p className="text-xs text-gray-500 mt-1">{f.hint}</p> : null}
                </div>
  );

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">설정</h1>
          <Link href="/" className="text-sm text-blue-400 hover:underline">
            ← 대시보드
          </Link>
        </div>

        {/* 원격 MCP 연결 */}
        <section className="bg-gray-900 rounded-xl p-5 mb-6 border border-gray-800">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h2 className="text-lg font-semibold">사이트 · MCP 연결</h2>
              <p className="text-xs text-gray-500 mt-1">사이트에서 한 번만 표시된 MCP URL을 입력하면 이 PC가 활성 장치가 됩니다.</p>
            </div>
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${remoteAgent?.configured ? "bg-emerald-950 text-emerald-400" : "bg-gray-800 text-gray-400"}`}>
              {remoteAgent?.configured ? "연결됨" : "미연결"}
            </span>
          </div>
          {remoteAgent?.configured ? <p className="text-sm text-gray-300 mb-3">{remoteAgent.siteUrl} · 장치 {remoteAgent.deviceId?.slice(0, 10)}…</p> : null}
          <div className="space-y-3">
            <input type="password" value={remoteMcpUrl} onChange={(event) => setRemoteMcpUrl(event.target.value)} placeholder="https://사이트/api/mcp/…" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            <input type="text" value={remoteDeviceName} onChange={(event) => setRemoteDeviceName(event.target.value)} placeholder="PC 이름 (비우면 컴퓨터 이름 사용)" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            <button onClick={handleRemotePair} disabled={remoteBusy || !remoteMcpUrl.trim()} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-sm font-medium">{remoteBusy ? "연결 중…" : remoteAgent?.configured ? "이 PC로 다시 연결" : "이 PC 연결"}</button>
          </div>
        </section>

        {/* 로그인 세션 */}
        <section className="bg-gray-900 rounded-xl p-5 mb-6 border border-gray-800">
          <h2 className="text-lg font-semibold mb-3">브라우저 로그인 세션</h2>
          <div className="flex items-center gap-3 mb-3">
            <span
              className={`inline-block w-2.5 h-2.5 rounded-full ${
                session?.hasSession ? "bg-green-500" : "bg-gray-600"
              }`}
            />
            <span className="text-sm text-gray-300">
              {session?.hasSession
                ? `세션 있음${session.lastChecked ? ` · ${new Date(session.lastChecked).toLocaleString("ko-KR")}` : ""}`
                : "세션 없음 — 로그인이 필요합니다"}
            </span>
          </div>
          {session?.error ? <p className="text-xs text-amber-500 mb-3">{session.error}</p> : null}
          <button
            onClick={() => void handleNaverLogin()}
            disabled={loggingIn}
            className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-50 text-sm font-medium"
          >
            {loggingIn ? "로그인 대기 중…" : "네이버 로그인"}
          </button>
          <p className="mt-4 border-t border-gray-800 pt-4 text-xs leading-5 text-gray-500">
            ChatGPT는 이 프로그램에서 로그인하지 않습니다. 사이트에서 발급한 MCP 주소를 ChatGPT에 등록해 사용합니다.
          </p>
        </section>

        {/* 설정 폼 */}
        <section className="bg-gray-900 rounded-xl p-5 border border-gray-800">
          <h2 className="text-lg font-semibold mb-1">API · 발행 설정</h2>
          {envPath ? (
            <p className="text-xs text-gray-500 mb-4 break-all">저장 위치: {envPath}</p>
          ) : null}

          {loading ? (
            <p className="text-gray-400">불러오는 중…</p>
          ) : (
            <div className="space-y-4">
              {fields.filter((f) => !f.advanced).map((f) => renderField(f))}
              {fields.some((f) => f.advanced) ? (
                <details className="rounded-lg border border-gray-800 p-3">
                  <summary className="cursor-pointer text-sm text-gray-400">고급 설정</summary>
                  <div className="space-y-4 mt-3">
                    {fields.filter((f) => f.advanced).map((f) => renderField(f))}
                  </div>
                </details>
              ) : null}
            </div>
          )}

          <div className="flex items-center gap-3 mt-6">
            <button
              onClick={handleSave}
              disabled={saving || loading}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm font-medium"
            >
              {saving ? "저장 중…" : "저장"}
            </button>
            {message ? <span className="text-sm text-gray-300">{message}</span> : null}
          </div>
          <p className="text-xs text-gray-500 mt-3">
            저장 후 새로 시작하는 발행 작업부터 적용됩니다. 일부 설정은 앱 재시작이 필요할 수 있습니다.
          </p>
        </section>
      </div>
    </main>
  );
}
