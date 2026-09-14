"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Material = { productId: string; revision: string; title: string; productName?: string; connectKind: string; status: string; ready: boolean; blockers: string[]; score: number | null; imageCount: number; approvedAt: string | null };
type Job = { jobId: string; kind: string; status: string; startedAt: string; items: { productId: string; status: string; stage: string; error?: string; scheduledDate?: string }[] };
export type MaterialSelectionRequest = { productId?: string; mode: "now" | "schedule" | "prepare"; nonce: number };
export function MaterialLibrary({ connectKind, candidates, selectionRequest, onPreview, onChanged }: {
  connectKind: string; candidates: { id: string; productName: string | null }[];
  selectionRequest?: MaterialSelectionRequest | null;
  onPreview: (id: string) => void; onChanged: () => void;
}) {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [prepareSelection, setPrepareSelection] = useState<string[]>([]);
  const [prepareOpen, setPrepareOpen] = useState(false);
  const [prepareMessage, setPrepareMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const requestInFlight = useRef(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"now" | "schedule">("now");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [date, setDate] = useState("");
  const [intervalDays, setIntervalDays] = useState(1);
  const previousJobs = useRef("");
  const changeRef = useRef(onChanged); changeRef.current = onChanged;
  const storageKey = `material-selection-v1:${connectKind}`;
  useEffect(() => {
    try { setSelection(JSON.parse(localStorage.getItem(storageKey) || "{}")); } catch { setSelection({}); }
    setPrepareSelection([]);
  }, [storageKey]);
  const select = (next: Record<string, string>) => {
    setSelection(next); localStorage.setItem(storageKey, JSON.stringify(next));
  };
  const refresh = useCallback(async () => {
    const response = await fetch(`/api/materials?connectKind=${encodeURIComponent(connectKind)}`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || "소재 목록을 읽지 못했습니다.");
    setMaterials(result.data.materials); setJobs(result.data.jobs); setLoading(false);
    const signature = JSON.stringify(result.data.jobs.map((job: Job) => [job.jobId, job.status, job.items.map(item => item.status)]));
    if (previousJobs.current && signature !== previousJobs.current) changeRef.current();
    previousJobs.current = signature;
  }, [connectKind]);
  useEffect(() => {
    let disposed = false;
    const update = () => { if (!disposed) void refresh().catch(error => { if (!disposed) setMessage(error.message); }); };
    update(); const timer = setInterval(update, 4000);
    return () => { disposed = true; clearInterval(timer); };
  }, [refresh]);
  useEffect(() => {
    if (!selectionRequest) return;
    if (selectionRequest.mode === "prepare") {
      setPrepareOpen(true);
      const ids = candidates.filter(item => !materials.some(material => material.productId === item.id && material.ready)).slice(0, 10).map(item => item.id);
      setPrepareSelection(ids);
      setPrepareMessage(ids.length ? `${ids.length}개 상품을 선택했습니다. 목록을 확인한 뒤 소재 미리작성 시작을 눌러주세요.` : "준비할 상품이 없습니다. 상품 목록을 확인하세요.");
      setMessage("");
      return;
    }
    if (selectionRequest.productId) {
      const material = materials.find(item => item.productId === selectionRequest.productId);
      if (!material?.ready) { setMessage("이 상품의 소재 준비를 먼저 완료하세요. 아래에서 원고·이미지를 확인할 수 있습니다."); return; }
      const next = { [material.productId]: material.revision };
      setSelection(next); localStorage.setItem(storageKey, JSON.stringify(next));
    }
    setMode(selectionRequest.mode);
    setMessage("준비된 소재를 선택한 뒤 아래 발행 버튼을 눌러주세요.");
    // A selection request is an explicit action; background refresh must not reselect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionRequest?.nonce]);
  const selected = materials.filter(item => selection[item.productId]);
  const valid = selected.length > 0 && selected.length === Object.keys(selection).length && selected.every(item => item.ready && selection[item.productId] === item.revision);
  const active = jobs.some(job => job.status === "running");
  const readyCount = materials.filter(item => item.ready).length;
  const preparationJob = jobs.find(job => job.kind === "prepare");
  const request = async (path: string, payload: object) => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    const preparing = path.endsWith("prepare");
    const notify = preparing ? setPrepareMessage : setMessage;
    setBusy(true); notify("작업 요청을 보내고 있습니다…");
    try {
      const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "작업을 시작하지 못했습니다.");
      setJobs(current => [result.data, ...current.filter(job => job.jobId !== result.data.jobId)]);
      notify(preparing ? "소재 미리작성을 시작했습니다. 완료된 소재는 아래에 저장됩니다." : "선택한 소재만 발행합니다. 진행상태는 아래 작업 기록에서 확인하세요.");
      if (path.endsWith("publish")) { select({}); setScheduleOpen(false); }
      else setPrepareSelection([]);
      await refresh().catch(() => notify("작업 요청은 접수됐습니다. 진행상태 조회가 지연되고 있습니다. 새로고침으로 확인하세요.")); changeRef.current();
    } catch (error) { notify(error instanceof Error ? error.message : String(error)); }
    finally { requestInFlight.current = false; setBusy(false); }
  };
  const publish = () => request("/api/materials/publish", {
    materials: selected.map(item => ({ productId: item.productId, revision: selection[item.productId] })),
    publishMode: mode, ...(mode === "schedule" ? { scheduledAt: date, intervalDays } : {}),
  });
  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  return <section id="material-library" className="my-5 space-y-4 rounded-xl border border-violet-200 bg-white p-5">
    <div><h2 className="text-lg font-bold text-slate-900">소재 보관함</h2><p className="mt-1 text-sm text-slate-600">1. 원고·이미지 미리작성 → 2. 준비된 소재 선택 → 3. 바로 또는 예약 발행</p></div>
    <details className="rounded-lg bg-violet-50 p-3" open={prepareOpen || materials.length === 0 || undefined}>
      <summary className="cursor-pointer font-semibold text-violet-900">1. 소재 미리작성 · 준비할 상품 선택</summary>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => setPrepareSelection(candidates.filter(item => !materials.some(material => material.productId === item.id && material.ready)).slice(0, 10).map(item => item.id))} className="rounded border px-3 py-2 text-sm">미준비 상품 10개 선택</button>
        <button type="button" disabled={!prepareSelection.length || busy || active} onClick={() => void request("/api/materials/prepare", { productIds: prepareSelection })} className="rounded bg-violet-700 px-4 py-2 text-sm text-white disabled:opacity-40">{busy ? "요청 접수 중…" : `선택 ${prepareSelection.length}개 소재 미리작성 시작`}</button>
      </div>
      {prepareMessage && <p role="status" className="mt-3 rounded bg-white p-3 text-sm text-violet-900">{prepareMessage}</p>}
      {preparationJob && <div role="status" className="mt-3 rounded bg-white p-3 text-sm"><p>소재 준비: {preparationJob.items.filter(item => item.status === "ready").length}/{preparationJob.items.length}개 완료 · {preparationJob.status === "running" ? "진행 중" : preparationJob.status === "completed" ? "완료" : "확인 필요"}</p>{preparationJob.items.filter(item => item.status === "preparing" || item.error).map(item => <p key={item.productId}>{candidates.find(candidate => candidate.id === item.productId)?.productName || item.productId}: {item.error || item.stage}</p>)}</div>}
      <div className="mt-3 max-h-48 space-y-2 overflow-auto">{candidates.map(item => <label key={item.id} className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label={`${item.productName || item.id} 소재 준비`} checked={prepareSelection.includes(item.id)} onChange={event => setPrepareSelection(current => event.target.checked ? [...current, item.id].slice(0, 50) : current.filter(id => id !== item.id))} />{item.productName || item.id}</label>)}</div>
      {!candidates.length && <p className="mt-2 text-sm">상품을 먼저 동기화해 주세요.</p>}
    </details>
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="mr-auto font-semibold">2. 준비된 소재 선택</h3>
      <button type="button" disabled={loading || readyCount === 0 || active || busy} onClick={() => select(Object.fromEntries(materials.filter(item => item.ready).slice(0, 10).map(item => [item.productId, item.revision])))} className="rounded border px-3 py-2 text-sm">준비완료 {Math.min(readyCount, 10)}개 선택</button>
      <button type="button" onClick={() => select({})} className="rounded border px-3 py-2 text-sm">선택 해제</button>
      <button type="button" onClick={() => void refresh().catch(error => setMessage(error.message))} className="rounded border px-3 py-2 text-sm">새로고침</button>
    </div>
    {loading && <p role="status">소재 목록을 불러오는 중입니다…</p>}
    {!loading && !materials.length && <p className="rounded bg-slate-50 p-5 text-sm text-slate-500">저장된 소재가 없습니다. 위에서 상품을 선택하고 ‘소재 미리작성 시작’을 눌러주세요.</p>}
    <div className="max-h-[560px] space-y-2 overflow-auto">{materials.map(item => <div key={item.productId} className={`rounded-lg border p-3 ${selection[item.productId] ? "border-violet-400 bg-violet-50" : "border-slate-200"}`}>
      <div className="flex items-start gap-3"><input type="checkbox" className="mt-1" aria-label={`${item.title} 발행 선택`} disabled={!item.ready || active} checked={Boolean(selection[item.productId])} onChange={event => { const next = { ...selection }; if (event.target.checked) next[item.productId] = item.revision; else delete next[item.productId]; select(next); }} />
        <div className="min-w-0 flex-1"><p className="font-semibold">{item.title}</p><p className="mt-1 text-xs text-slate-500">{item.ready ? "발행 준비완료" : item.status === "PUBLISHED" ? "발행 완료" : item.status === "SCHEDULED" ? "예약 등록 완료" : "확인 필요"} · 내용 {item.score ?? "미평가"}{item.score !== null ? "점" : ""} · 이미지 {item.imageCount}장</p>
          {item.blockers.map((reason, index) => <p key={index} className="mt-1 text-xs text-amber-800">{reason}</p>)}
          {selection[item.productId] && selection[item.productId] !== item.revision && <p className="mt-1 text-xs text-red-700">선택 후 소재가 변경되었습니다. 해제 후 다시 선택하세요.</p>}</div>
        <button type="button" onClick={() => onPreview(item.productId)} className="shrink-0 rounded border px-3 py-2 text-sm">원고·이미지 확인</button></div>
    </div>)}</div>
    <div className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 p-3">
      <span className="font-semibold">3. 선택 {selected.length}개 발행</span>
      <label className="text-sm"><input type="radio" name="material-publish-mode" checked={mode === "now"} onChange={() => setMode("now")} /> 바로 발행</label>
      <label className="text-sm"><input type="radio" name="material-publish-mode" checked={mode === "schedule"} onChange={() => setMode("schedule")} /> 예약 발행</label>
      <button type="button" disabled={!valid || active || busy} onClick={() => { if (mode === "schedule") { setDate(date || tomorrow); setScheduleOpen(true); } else void publish(); }} className="rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white disabled:opacity-40">{mode === "schedule" ? "예약일 설정" : `선택 ${selected.length}개 바로 발행`}</button>
      <p className="w-full text-xs text-slate-500">발행에는 저장된 원고와 이미지만 사용합니다. 미완성 소재는 선택할 수 없습니다.</p>
    </div>
    {message && <p role="status" className="rounded bg-blue-50 p-3 text-sm text-blue-900">{message}</p>}
    {jobs.length > 0 && <details open={active || undefined} className="rounded-lg border p-3"><summary className="cursor-pointer font-semibold">작업 기록 {active ? "· 진행 중" : ""}</summary><div className="mt-2 max-h-72 space-y-3 overflow-auto">{jobs.slice(0, 10).map(job => <div key={job.jobId} className="rounded bg-slate-50 p-3 text-sm"><p className="font-semibold">{job.kind === "prepare" ? "소재 미리작성" : "선택 소재 발행"} · {({ running: "진행 중", completed: "완료", partial: "일부 완료", failed: "확인 필요", interrupted: "중단됨" } as Record<string, string>)[job.status] || job.status} · {job.items.length}개</p><p className="text-xs text-slate-500">{new Date(job.startedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</p>{job.items.map(item => <p key={item.productId} className="mt-1 break-words">{materials.find(material => material.productId === item.productId)?.title || candidates.find(candidate => candidate.id === item.productId)?.productName || item.productId} — {item.stage}{item.scheduledDate ? ` (${item.scheduledDate})` : ""}{item.error ? `: ${item.error}` : ""}</p>)}</div>)}</div></details>}
    {scheduleOpen && <div role="dialog" aria-modal="true" aria-labelledby="material-schedule-title" className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"><div className="w-full max-w-md space-y-4 rounded-xl bg-white p-6">
      <h3 id="material-schedule-title" className="text-lg font-bold">선택 {selected.length}개 예약발행</h3>
      <label className="block text-sm">예약 시작일 (한국시간)<input autoFocus type="date" min={tomorrow} value={date} onChange={event => setDate(event.target.value)} className="mt-1 w-full rounded border p-2" /></label>
      <label className="block text-sm">소재별 예약 간격 (일)<input type="number" min={1} max={30} value={intervalDays} onChange={event => setIntervalDays(Number(event.target.value))} className="mt-1 w-full rounded border p-2" /></label>
      <p className="text-sm text-slate-600">선택 목록 순서대로 하루에 한 소재씩, 지정한 간격으로 예약합니다.</p>
      {message && <p role="alert" className="text-sm text-red-700">{message}</p>}
      <div className="flex justify-end gap-2"><button type="button" onClick={() => setScheduleOpen(false)} className="rounded border px-4 py-2">취소</button><button type="button" disabled={busy || !valid || date < tomorrow} onClick={() => void publish()} className="rounded bg-indigo-700 px-4 py-2 text-white disabled:opacity-40">선택 소재 예약발행</button></div>
    </div></div>}
  </section>;
}
