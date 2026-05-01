"use client";

import { useState, useEffect } from "react";

interface SessionData {
  hasSession: boolean;
  isValid: boolean;
  lastChecked?: string;
  error?: string;
  mode?: string;
  profilePath?: string;
}

interface SessionApiData extends SessionData {
  naver: SessionData;
  chatgpt: SessionData;
}

export default function SessionStatus() {
  const [session, setSession] = useState<SessionApiData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSession = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/session");
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

  useEffect(() => {
    fetchSession();
  }, []);

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="animate-pulse flex items-center gap-3">
          <div className="w-3 h-3 bg-slate-300 rounded-full"></div>
          <div className="h-4 bg-slate-200 rounded w-32"></div>
        </div>
      </div>
    );
  }

  const cards = session
    ? [
        {
          key: "naver",
          title: "네이버 로그인",
          command: "npm run login",
          description: "발행/예약에 사용",
          value: session.naver,
        },
        {
          key: "chatgpt",
          title: "ChatGPT 로그인",
          command: "npm run login:chatgpt",
          description: "글작성/이미지 생성에 사용",
          value: session.chatgpt,
        },
      ]
    : [];

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex flex-col gap-3">
        {cards.map(({ key, title, command, description, value }) => {
          const isValid = value?.hasSession && value?.isValid;
          return (
            <div
              key={key}
              className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3 md:flex-row md:items-center md:justify-between"
            >
              <div className="flex items-start gap-3">
                <div
                  className={`mt-1 h-3 w-3 rounded-full ${
                    isValid ? "bg-emerald-500" : "bg-amber-500"
                  }`}
                ></div>
                <div>
                  <h3 className="font-medium text-slate-900">{title}</h3>
                  <p className="text-sm text-slate-500">
                    {isValid
                      ? "세션 사용 가능"
                      : value?.hasSession
                      ? "세션 재확인 필요"
                      : "로그인 필요"}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">{description}</p>
                  {value?.mode && (
                    <p className="mt-1 text-xs text-slate-400">
                      모드: {value.mode}
                    </p>
                  )}
                </div>
              </div>

              <div className="text-left md:text-right">
                {!isValid ? (
                  <>
                    <p className="mb-1 text-xs text-slate-500">터미널에서 실행:</p>
                    <code className="rounded bg-slate-100 px-2 py-1 font-mono text-xs">
                      {command}
                    </code>
                  </>
                ) : null}

                {isValid && value?.lastChecked ? (
                  <p className="text-xs text-slate-400">
                    마지막 확인: {new Date(value.lastChecked).toLocaleString("ko-KR")}
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {session?.error && (
        <p className="mt-2 text-xs text-red-600">⚠️ {session.error}</p>
      )}
    </div>
  );
}
