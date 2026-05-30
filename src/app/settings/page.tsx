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
}

interface SessionState {
  hasSession: boolean;
  isValid: boolean;
  lastChecked?: string;
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
  const [loginBusy, setLoginBusy] = useState(false);

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
          hasSession: data.data.hasSession,
          isValid: data.data.isValid,
          lastChecked: data.data.lastChecked,
        });
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadSettings();
    loadSession();
  }, [loadSettings, loadSession]);

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
    setLoginBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/session/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "naver" }),
      });
      const data = await res.json();
      setMessage(data.success ? `🌐 ${data.message}` : `❌ ${data.error || "로그인 실행 실패"}`);
      // 세션 저장될 때까지 폴링(최대 ~8분)
      let tries = 0;
      const poll = setInterval(async () => {
        tries += 1;
        await loadSession();
        const r = await fetch("/api/session");
        const d = await r.json();
        if ((d.success && d.data.hasSession && d.data.isValid) || tries > 100) {
          clearInterval(poll);
          setLoginBusy(false);
          if (d.success && d.data.hasSession) setMessage("✅ 네이버 세션이 저장되었습니다.");
        }
      }, 5000);
    } catch {
      setMessage("❌ 로그인 실행 실패");
      setLoginBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">설정</h1>
          <Link href="/" className="text-sm text-blue-400 hover:underline">
            ← 대시보드
          </Link>
        </div>

        {/* 네이버 세션 */}
        <section className="bg-gray-900 rounded-xl p-5 mb-6 border border-gray-800">
          <h2 className="text-lg font-semibold mb-3">네이버 로그인 세션</h2>
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
          <button
            onClick={handleNaverLogin}
            disabled={loginBusy}
            className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-50 text-sm font-medium"
          >
            {loginBusy ? "로그인 대기 중… (열린 창에서 로그인)" : "네이버 로그인"}
          </button>
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
              {fields.map((f) => (
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
              ))}
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
