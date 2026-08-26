"use client";

import { useEffect, useState } from "react";

interface SessionData {
  hasSession: boolean;
  isValid: boolean;
  savedAt?: string;
  checkedAt?: string;
  error?: string;
  mode?: string;
}

interface SessionApiData extends SessionData {
  naver: SessionData;
  chatgpt: SessionData;
}

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

export default function SessionStatus() {
  const [session, setSession] = useState<SessionApiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingIn, setLoggingIn] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fetchSession = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/session", { cache: "no-store" });
      const data = await res.json();
      if (data.success) {
        setSession(data.data);
      }
    } catch (error) {
      console.error("세션 조회 실패:", error);
    } finally {
      setLoading(false);
    }
  };

  const startLogin = async (provider: "naver" | "chatgpt") => {
    try {
      setLoggingIn(provider);
      setNotice(null);
      const res = await fetch("/api/session/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const data = await res.json();
      if (data.success) {
        setNotice(data.message || "로그인 창을 열었습니다. 로그인 후 잠시 뒤 새로고침으로 상태를 확인하세요.");
        const jobId = data.data?.jobId as string | undefined;
        if (jobId) void pollLoginJob(jobId, provider);
      } else {
        setNotice(`오류: ${data.error || "로그인 실행에 실패했습니다."}`);
      }
    } catch (error) {
      console.error("로그인 실행 실패:", error);
      setNotice("로그인 실행 중 오류가 발생했습니다.");
    } finally {
      setLoggingIn(null);
    }
  };

  async function pollLoginJob(jobId: string, provider: "naver" | "chatgpt") {
    const deadline = Date.now() + 6 * 60_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      try {
        const response = await fetch(`/api/session/login?jobId=${encodeURIComponent(jobId)}`, { cache: "no-store" });
        const payload = await response.json();
        if (!payload.success) continue;
        if (payload.data.status === "succeeded") {
          setNotice(`${provider === "naver" ? "네이버" : "ChatGPT"} 로그인이 완료되었습니다.`);
          await fetchSession();
          return;
        }
        if (payload.data.status === "failed") {
          setNotice(`오류: ${payload.data.error || "로그인에 실패했습니다."}`);
          await fetchSession();
          return;
        }
      } catch {
        // 일시적인 조회 오류는 다음 주기에 재시도합니다.
      }
    }
    setNotice("로그인 확인 시간이 초과되었습니다. 상태를 다시 확인해주세요.");
    await fetchSession();
  }

  useEffect(() => {
    void fetchSession();
  }, []);

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex animate-pulse items-center gap-3">
          <div className="h-3 w-3 rounded-full bg-slate-300" />
          <div className="h-4 w-32 rounded bg-slate-200" />
        </div>
      </div>
    );
  }

  const cards: Array<{
    key: "naver" | "chatgpt";
    title: string;
    command: string;
    description: string;
    value: SessionData;
  }> = session
    ? [
        {
          key: "naver",
          title: "네이버 로그인",
          command: "npm run login",
          description: "발행, 예약발행, 블로그 카테고리에 사용",
          value: session.naver,
        },
        {
          key: "chatgpt",
          title: "ChatGPT 로그인",
          command: "npm run login:chatgpt",
          description: "글 작성, 이미지 생성에 사용",
          value: session.chatgpt,
        },
      ]
    : [];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-3">
        {cards.map(({ key, title, command, description, value }) => {
          const needsLogin = !value?.hasSession || !value?.isValid;

          return (
            <div
              key={key}
              className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3 md:flex-row md:items-center md:justify-between"
            >
              <div className="flex items-start gap-3">
                <div className={`mt-1 h-3 w-3 rounded-full ${getStatusDotClass(value)}`} />
                <div>
                  <h3 className="font-medium text-slate-900">{title}</h3>
                  <p className="text-sm text-slate-600">{getStatusText(value)}</p>
                  <p className="mt-1 text-xs text-slate-400">{description}</p>
                  {value?.mode ? <p className="mt-1 text-xs text-slate-400">모드: {value.mode}</p> : null}
                  {value?.error ? <p className="mt-1 text-xs text-amber-700">{value.error}</p> : null}
                </div>
              </div>

              <div className="flex flex-col items-start gap-2 md:items-end">
                <button
                  onClick={() => void startLogin(key)}
                  disabled={loggingIn === key}
                  className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    key === "naver"
                      ? "bg-green-600 hover:bg-green-700"
                      : "bg-slate-800 hover:bg-slate-900"
                  }`}
                  title={`${title} 창을 엽니다`}
                >
                  {loggingIn === key
                    ? "로그인 창 여는 중..."
                    : needsLogin
                      ? `${title}`
                      : `${title} 다시하기`}
                </button>

                <details className="text-left md:text-right">
                  <summary className="cursor-pointer text-xs text-slate-400">터미널 명령</summary>
                  <code className="mt-1 inline-block rounded bg-slate-100 px-2 py-1 font-mono text-xs">
                    {command}
                  </code>
                </details>

                {value?.savedAt ? (
                  <p className="text-xs text-slate-400">
                    저장 시각: {new Date(value.savedAt).toLocaleString("ko-KR")}
                  </p>
                ) : null}
                {value?.checkedAt ? (
                  <p className="text-xs text-slate-400">
                    확인 시각: {new Date(value.checkedAt).toLocaleString("ko-KR")}
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {notice ? <p className="mt-3 text-xs text-sky-700">{notice}</p> : null}
      <button
        type="button"
        onClick={() => void fetchSession()}
        className="mt-3 text-xs font-medium text-slate-600 underline underline-offset-2"
      >
        로그인 상태 다시 확인
      </button>
      {session?.error ? <p className="mt-2 text-xs text-red-600">{session.error}</p> : null}
    </div>
  );
}
