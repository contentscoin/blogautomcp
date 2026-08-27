"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  hasConnection: boolean;
  generation: number | null;
  deviceName: string | null;
  lastSeenAt: string | null;
}

export function McpConnectionCard(props: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [deviceOnline, setDeviceOnline] = useState(false);

  useEffect(() => {
    const update = () => {
      const lastSeen = props.lastSeenAt ? new Date(props.lastSeenAt).getTime() : Number.NaN;
      setDeviceOnline(Number.isFinite(lastSeen) && Date.now() - lastSeen < 90_000);
    };
    update();
    const timer = window.setInterval(update, 15_000);
    return () => window.clearInterval(timer);
  }, [props.lastSeenAt]);

  async function issue(rotate: boolean) {
    if (rotate && !window.confirm("기존 MCP 연결과 현재 PC 인증이 즉시 폐기됩니다. 새로 발급할까요?")) return;
    setBusy(true);
    setError("");
    setRevealed(null);
    const response = await fetch(rotate ? "/api/mcp-connections/rotate" : "/api/mcp-connections", { method: "POST" });
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error?.message || "MCP 연결을 발급하지 못했습니다.");
      setBusy(false);
      return;
    }
    setRevealed(payload.data.mcpUrl);
    setCopied(false);
    setBusy(false);
    router.refresh();
  }

  async function copy() {
    if (!revealed) return;
    await navigator.clipboard.writeText(revealed);
    setCopied(true);
  }

  return (
    <section className="card span-8">
      <div className="row"><div><h2>MCP 연결</h2><p>ChatGPT와 로컬 프로그램에 같은 URL을 입력합니다.</p></div>{props.hasConnection ? <span className="status">활성 · {props.generation}세대</span> : <span className="status pending">미발급</span>}</div>
      {revealed ? <div className="stack"><div className="warning"><b>지금 한 번만 표시됩니다.</b><br />복사한 뒤 창을 닫으면 원문을 다시 확인할 수 없습니다.</div><div className="codebox">{revealed}</div><div className="actions"><button className="button primary" onClick={copy}>{copied ? "복사됨" : "URL 복사"}</button><button className="button" onClick={() => setRevealed(null)}>닫기</button></div></div> : <div className="actions"><button className="button primary" disabled={busy || props.hasConnection} onClick={() => issue(false)}>{busy ? "처리 중…" : "MCP URL 최초 발급"}</button><button className="button danger" disabled={busy || !props.hasConnection} onClick={() => issue(true)}>추가 발행 · 기존 연결 폐기</button></div>}
      {error ? <div className="notice error">{error}</div> : null}
      <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "24px 0" }} />
      <div className="row"><div><b>활성 PC</b><div className="tiny muted" style={{ marginTop: 5 }}>{props.deviceName || "연결된 PC 없음"}{props.lastSeenAt ? ` · ${new Date(props.lastSeenAt).toLocaleString("ko-KR")}` : ""}</div></div><span className={`status ${deviceOnline ? "" : "pending"}`}>{deviceOnline ? "온라인" : props.deviceName ? "오프라인" : "미등록"}</span></div>
    </section>
  );
}
