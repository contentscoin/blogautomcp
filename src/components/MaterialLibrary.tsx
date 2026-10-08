"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Material = { productId: string; revision: string; title: string; productName?: string; connectKind: string; status: string; ready: boolean; blockers: string[]; score: number | null; imageCount: number; approvedAt: string | null };
type Job = { jobId: string; kind: string; status: string; startedAt: string; sourceJobId?: string; connectKind?: string; items: { productId: string; status: string; stage: string; error?: string; errorCode?: string; scheduledDate?: string }[] };
type FailedCandidate = { productId: string; productName: string | null; reason: string; errorCode?: string };
type RecoveryKind = "rewrite" | "repair";
const isRecoveryJob = (job: Job) => job.kind === "rewrite" || job.kind === "repair";
const jobLabel = (job: Job) => job.kind === "repair" ? "보완 필요 소재 보완·검증" : job.kind === "rewrite" ? "실패 소재 재작성·검증" : job.kind === "prepare" ? "소재 미리작성" : "선택 소재 발행";
const jobStatusLabel = (job: Job) => isRecoveryJob(job) && job.status === "completed"
  ? job.items.length === 0 ? job.kind === "repair" ? "보완 대상 없음" : "재작성 대상 없음" : job.items.every(item => item.status === "ready" && !item.error) ? "검증 완료" : "검증 확인 필요"
  : ({ running: "진행 중", queued: "대기 중", completed: "완료", partial: isRecoveryJob(job) ? job.items.some(item => item.status === "ready" && !item.error) ? "일부 검증 완료" : "검증 실패 · 확인 필요" : "일부 완료", failed: "실패 · 확인 필요", interrupted: "중단됨" } as Record<string, string>)[job.status] || job.status;
export type MaterialSelectionRequest = { productId?: string; mode: "now" | "schedule" | "prepare"; nonce: number };
export function MaterialLibrary({ connectKind, candidates, selectionRequest, onPreview, onChanged }: {
  connectKind: string; candidates: { id: string; productName: string | null }[];
  selectionRequest?: MaterialSelectionRequest | null;
  onPreview: (id: string) => void; onChanged: () => void;
}) {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [failedCandidates, setFailedCandidates] = useState<FailedCandidate[]>([]);
  const [failedCandidateCount, setFailedCandidateCount] = useState(0);
  const [rewriteMessage, setRewriteMessage] = useState("");
  const [rewriteRequestId, setRewriteRequestId] = useState("");
  const pendingRewrite = useRef<{ sourceJobId: string; storageKey: string } | null>(null);
  const [repairCandidates, setRepairCandidates] = useState<FailedCandidate[]>([]);
  const [repairCandidateCount, setRepairCandidateCount] = useState(0);
  const [repairMessage, setRepairMessage] = useState("");
  const [repairRequestId, setRepairRequestId] = useState("");
  const pendingRepair = useRef<{ sourceJobId: string; storageKey: string } | null>(null);
  const currentConnectKind = useRef(connectKind); currentConnectKind.current = connectKind;
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
  const rewriteStorageKey = `material-failed-rewrite-v1:${connectKind}`;
  const repairStorageKey = `material-blocked-repair-v1:${connectKind}`;
  useEffect(() => {
    try { setSelection(JSON.parse(localStorage.getItem(storageKey) || "{}")); } catch { setSelection({}); }
    setPrepareSelection([]);
    setFailedCandidates([]); setFailedCandidateCount(0); setLoading(true); setRewriteMessage("");
    setRepairCandidates([]); setRepairCandidateCount(0); setRepairMessage("");
    try {
      const sourceJobId = localStorage.getItem(rewriteStorageKey) || "";
      pendingRewrite.current = sourceJobId ? { sourceJobId, storageKey: rewriteStorageKey } : null;
      setRewriteRequestId(sourceJobId);
      if (sourceJobId) setRewriteMessage("접수 결과가 확인되지 않은 재작성 요청이 있습니다. 이전 요청을 확인·재시도하세요.");
    } catch { pendingRewrite.current = null; setRewriteRequestId(""); }
    try {
      const sourceJobId = localStorage.getItem(repairStorageKey) || "";
      pendingRepair.current = sourceJobId ? { sourceJobId, storageKey: repairStorageKey } : null;
      setRepairRequestId(sourceJobId);
      if (sourceJobId) setRepairMessage("접수 결과가 확인되지 않은 보완 요청이 있습니다. 이전 요청을 확인·재시도하세요.");
    } catch { pendingRepair.current = null; setRepairRequestId(""); }
  }, [storageKey, rewriteStorageKey, repairStorageKey]);
  const select = (next: Record<string, string>) => {
    setSelection(next); localStorage.setItem(storageKey, JSON.stringify(next));
  };
  const refresh = useCallback(async () => {
    const response = await fetch(`/api/materials?connectKind=${encodeURIComponent(connectKind)}`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || "소재 목록을 읽지 못했습니다.");
    if (currentConnectKind.current !== connectKind) return;
    setMaterials(result.data.materials); setJobs(result.data.jobs); setLoading(false);
    setFailedCandidates(result.data.failedCandidates || []);
    setFailedCandidateCount(result.data.failedCandidateCount ?? 0);
    setRepairCandidates(result.data.repairCandidates || []);
    setRepairCandidateCount(result.data.repairCandidateCount ?? 0);
    const pending = pendingRewrite.current;
    if (pending && result.data.jobs.some((job: Job) => job.sourceJobId === pending.sourceJobId && job.kind === "rewrite")) {
      try { localStorage.removeItem(pending.storageKey); } catch { /* The stable ID remains safe to replay. */ }
      pendingRewrite.current = null; setRewriteRequestId("");
      setRewriteMessage("실패 소재 재작성 요청이 접수되었습니다. 검증을 통과한 소재만 준비완료로 저장됩니다.");
    }
    const pendingComplement = pendingRepair.current;
    if (pendingComplement && result.data.jobs.some((job: Job) => job.sourceJobId === pendingComplement.sourceJobId && job.kind === "repair")) {
      try { localStorage.removeItem(pendingComplement.storageKey); } catch { /* The stable ID remains safe to replay. */ }
      pendingRepair.current = null; setRepairRequestId("");
      setRepairMessage("소재 보완 요청이 접수되었습니다. 검증을 통과한 소재만 준비완료로 저장됩니다.");
    }
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
  const active = jobs.some(job => ["running", "queued"].includes(job.status));
  const pendingRecovery = Boolean(rewriteRequestId || repairRequestId);
  const readyCount = materials.filter(item => item.ready).length;
  const matchesConnectKind = (job: Job) => !job.connectKind || job.connectKind.toUpperCase() === connectKind.toUpperCase();
  const preparationJob = jobs.find(job => job.kind === "prepare" || (isRecoveryJob(job) && matchesConnectKind(job)));
  const rewriteJob = jobs.find(job => job.kind === "rewrite" && matchesConnectKind(job));
  const repairJob = jobs.find(job => job.kind === "repair" && matchesConnectKind(job));
  const acceptRecovery = (kind: RecoveryKind, job: Job, sourceJobId: string) => {
    const pending = kind === "rewrite" ? pendingRewrite : pendingRepair;
    const notify = kind === "rewrite" ? setRewriteMessage : setRepairMessage;
    const setRequestId = kind === "rewrite" ? setRewriteRequestId : setRepairRequestId;
    const label = kind === "rewrite" ? "실패 소재 재작성·검증" : "소재 보완·검증";
    setJobs(current => [job, ...current.filter(item => item.jobId !== job.jobId)]);
    if (pending.current?.sourceJobId === sourceJobId) {
      try { localStorage.removeItem(pending.current.storageKey); } catch { /* Replaying this ID will resolve the saved job. */ }
      pending.current = null; setRequestId("");
    }
    if (currentConnectKind.current === connectKind) notify(["running", "queued"].includes(job.status)
      ? `${label}을 시작했습니다. 검증을 통과한 소재만 준비완료로 저장됩니다.`
      : `기존 ${kind === "rewrite" ? "재작성" : "보완"} 요청의 결과를 확인했습니다: ${jobStatusLabel(job)}. 아래에서 소재별 검증 결과를 확인하세요.`);
    changeRef.current();
  };
  const recoverMaterials = async (kind: RecoveryKind) => {
    const pending = kind === "rewrite" ? pendingRewrite : pendingRepair;
    const otherPending = kind === "rewrite" ? pendingRepair : pendingRewrite;
    const recoveryStorageKey = kind === "rewrite" ? rewriteStorageKey : repairStorageKey;
    const notify = kind === "rewrite" ? setRewriteMessage : setRepairMessage;
    const setRequestId = kind === "rewrite" ? setRewriteRequestId : setRepairRequestId;
    const label = kind === "rewrite" ? "재작성" : "보완";
    if (requestInFlight.current || active || (otherPending.current && !pending.current)) return;
    requestInFlight.current = true; setBusy(true);
    const previousId = pending.current?.storageKey === recoveryStorageKey ? pending.current.sourceJobId : "";
    let sourceJobId = previousId;
    const lookup = async () => {
      const response = await fetch(`/api/materials?sourceJobId=${encodeURIComponent(sourceJobId)}`, { cache: "no-store" });
      if (response.status === 404) return null;
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || `이전 ${label} 요청을 확인하지 못했습니다.`);
      if (!result.data?.jobId || result.data.kind !== kind) throw new Error(`이전 ${label} 작업 응답을 확인하지 못했습니다.`);
      return result.data as Job;
    };
    try {
      if (sourceJobId) {
        notify(`이전 ${label} 요청의 접수 결과를 확인하고 있습니다…`);
        const existing = await lookup();
        if (existing) { acceptRecovery(kind, existing, sourceJobId); await refresh(); return; }
        if (otherPending.current) throw new Error("다른 복구 요청의 접수 결과를 먼저 확인하세요.");
      } else {
        sourceJobId = crypto.randomUUID();
        // Persist before submission so a lost response or reload cannot create a second job.
        localStorage.setItem(recoveryStorageKey, sourceJobId);
        pending.current = { sourceJobId, storageKey: recoveryStorageKey }; setRequestId(sourceJobId);
      }
      notify(`${kind === "rewrite" ? "실패 소재 전체 재작성" : "보완 필요 소재 전체 보완"}·검증 요청을 보내고 있습니다…`);
      const response = await fetch(`/api/materials/${kind === "rewrite" ? "rewrite-failed" : "repair-blocked"}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ connectKind, sourceJobId }) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || `${label} 요청을 접수하지 못했습니다.`);
      if (!result.data?.jobId || result.data.kind !== kind) throw new Error(`${label} 요청의 접수 결과를 확인하지 못했습니다.`);
      acceptRecovery(kind, result.data, sourceJobId);
      await refresh().catch(() => notify(`${label} 요청은 접수됐습니다. 진행상태 조회가 지연되고 있습니다. 새로고침으로 확인하세요.`));
    } catch (error) {
      let recovered = false;
      if (sourceJobId && pending.current?.sourceJobId === sourceJobId) {
        try { const existing = await lookup(); if (existing) { acceptRecovery(kind, existing, sourceJobId); recovered = true; } } catch { /* Keep the same ID until the outcome is known. */ }
      }
      if (!recovered && currentConnectKind.current === connectKind) notify(`${error instanceof Error ? error.message : String(error)}${pending.current?.sourceJobId === sourceJobId ? " 이전 요청을 확인·재시도하면 같은 요청 ID로 이어집니다." : ""}`);
    } finally { requestInFlight.current = false; setBusy(false); }
  };
  const request = async (path: string, payload: object) => {
    if (requestInFlight.current || pendingRewrite.current || pendingRepair.current) return;
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
    <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold text-amber-950">실패 소재 복구</h3><p className="mt-1 text-sm text-amber-900">대상 {failedCandidateCount}개를 재작성하고 원고·이미지 검증과 승인까지 진행해 발행 준비를 마칩니다.</p></div>
        <button type="button" disabled={loading || failedCandidateCount === 0 || active || busy || pendingRecovery} onClick={() => void recoverMaterials("rewrite")} className="rounded-lg bg-amber-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">실패 소재 전체 재작성·검증 ({failedCandidateCount}개)</button>
        {rewriteRequestId && <button type="button" disabled={busy || active} onClick={() => void recoverMaterials("rewrite")} className="rounded-lg border border-amber-800 px-4 py-2 text-sm font-semibold text-amber-950 disabled:opacity-40">이전 재작성 요청 확인·재시도</button>}
      </div>
      <p className="text-xs text-amber-900">검증 통과 후 준비완료로 저장되며, 발행은 아래에서 별도로 선택합니다.</p>
      {active && <p className="text-xs text-amber-900">다른 소재 작업이 진행 중입니다. 완료 후 재작성할 수 있습니다.</p>}
      {rewriteMessage && <p role="status" className="rounded bg-white p-3 text-sm text-amber-950">{rewriteMessage}</p>}
      {rewriteJob && <div role="status" className="rounded bg-white p-3 text-sm"><p className="font-semibold">재작성: 검증 통과 {rewriteJob.items.filter(item => item.status === "ready" && !item.error).length}/{rewriteJob.items.length}개 · 실패 {rewriteJob.items.filter(item => ["failed", "interrupted", "outcome_unknown"].includes(item.status) || item.error).length}개 · {jobStatusLabel(rewriteJob)}</p>{rewriteJob.items.filter(item => item.status !== "ready" || item.error).map(item => <p key={item.productId} className="mt-1 break-words">{candidates.find(candidate => candidate.id === item.productId)?.productName || failedCandidates.find(candidate => candidate.productId === item.productId)?.productName || item.productId}: {item.error || item.stage}{item.errorCode ? ` (${item.errorCode})` : ""}</p>)}</div>}
      {failedCandidates.length > 0 && <details><summary className="cursor-pointer text-sm font-semibold text-amber-950">재작성 대상과 실패 원인 보기</summary><div className="mt-2 max-h-48 space-y-1 overflow-auto">{failedCandidates.map(item => <p key={item.productId} className="break-words text-sm text-amber-950">{item.productName || item.productId} — {item.reason}{item.errorCode ? ` (${item.errorCode})` : ""}</p>)}</div></details>}
    </div>
    <div className="space-y-3 rounded-lg border border-sky-200 bg-sky-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold text-sky-950">보완 필요 소재 일괄 보완</h3><p className="mt-1 text-sm text-sky-900">대상 {repairCandidateCount}개의 기존 원고와 검증을 통과한 이미지를 바탕으로 부족한 부분을 보완하고 다시 검증합니다.</p></div>
        <button type="button" disabled={loading || repairCandidateCount === 0 || active || busy || pendingRecovery} onClick={() => void recoverMaterials("repair")} className="rounded-lg bg-sky-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">보완 필요 소재 전체 보완·검증 ({repairCandidateCount}개)</button>
        {repairRequestId && <button type="button" disabled={busy || active} onClick={() => void recoverMaterials("repair")} className="rounded-lg border border-sky-800 px-4 py-2 text-sm font-semibold text-sky-950 disabled:opacity-40">이전 보완 요청 확인·재시도</button>}
      </div>
      <p className="text-xs text-sky-900">기존 원고와 검증 통과 이미지를 보존하며 필요한 부분만 보완합니다. 검증 통과한 소재만 준비완료로 저장되고 발행은 별도로 선택합니다.</p>
      {active && <p className="text-xs text-sky-900">다른 소재 작업이 진행 중입니다. 완료 후 보완할 수 있습니다.</p>}
      {repairMessage && <p role="status" className="rounded bg-white p-3 text-sm text-sky-950">{repairMessage}</p>}
      {repairJob && <div role="status" className="rounded bg-white p-3 text-sm"><p className="font-semibold">보완: 검증 통과 {repairJob.items.filter(item => item.status === "ready" && !item.error).length}/{repairJob.items.length}개 · 실패 {repairJob.items.filter(item => ["failed", "interrupted", "outcome_unknown"].includes(item.status) || item.error).length}개 · {jobStatusLabel(repairJob)}</p>{repairJob.items.filter(item => item.status !== "ready" || item.error).map(item => <p key={item.productId} className="mt-1 break-words">{candidates.find(candidate => candidate.id === item.productId)?.productName || repairCandidates.find(candidate => candidate.productId === item.productId)?.productName || item.productId}: {item.error || item.stage}{item.errorCode ? ` (${item.errorCode})` : ""}</p>)}</div>}
      {repairCandidates.length > 0 && <details><summary className="cursor-pointer text-sm font-semibold text-sky-950">보완 대상과 필요한 보완 내용 보기</summary><div className="mt-2 max-h-48 space-y-1 overflow-auto">{repairCandidates.map(item => <p key={item.productId} className="break-words text-sm text-sky-950">{item.productName || item.productId} — {item.reason}{item.errorCode ? ` (${item.errorCode})` : ""}</p>)}</div></details>}
    </div>
    {pendingRecovery && <p role="status" className="rounded bg-slate-100 p-3 text-sm text-slate-700">이전 복구 요청의 접수 결과를 확인해야 합니다. 같은 요청을 확인·재시도한 뒤 다음 준비·보완·재작성·발행 작업을 시작하세요.</p>}
    <details className="rounded-lg bg-violet-50 p-3" open={prepareOpen || materials.length === 0 || undefined}>
      <summary className="cursor-pointer font-semibold text-violet-900">1. 소재 미리작성 · 준비할 상품 선택</summary>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => setPrepareSelection(candidates.filter(item => !materials.some(material => material.productId === item.id && material.ready)).slice(0, 10).map(item => item.id))} className="rounded border px-3 py-2 text-sm">미준비 상품 10개 선택</button>
        <button type="button" disabled={!prepareSelection.length || busy || active || pendingRecovery} onClick={() => void request("/api/materials/prepare", { productIds: prepareSelection })} className="rounded bg-violet-700 px-4 py-2 text-sm text-white disabled:opacity-40">{busy ? "요청 접수 중…" : `선택 ${prepareSelection.length}개 소재 미리작성 시작`}</button>
      </div>
      {prepareMessage && <p role="status" className="mt-3 rounded bg-white p-3 text-sm text-violet-900">{prepareMessage}</p>}
      {preparationJob && <div role="status" className="mt-3 rounded bg-white p-3 text-sm"><p>{jobLabel(preparationJob)}: {preparationJob.items.filter(item => item.status === "ready" && !item.error).length}/{preparationJob.items.length}개 {isRecoveryJob(preparationJob) ? "검증 통과" : "완료"} · {jobStatusLabel(preparationJob)}</p>{preparationJob.items.filter(item => item.status === "preparing" || item.error).map(item => <p key={item.productId}>{candidates.find(candidate => candidate.id === item.productId)?.productName || item.productId}: {item.error || item.stage}</p>)}</div>}
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
      <button type="button" disabled={!valid || active || busy || pendingRecovery} onClick={() => { if (mode === "schedule") { setDate(date || tomorrow); setScheduleOpen(true); } else void publish(); }} className="rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white disabled:opacity-40">{mode === "schedule" ? "예약일 설정" : `선택 ${selected.length}개 바로 발행`}</button>
      <p className="w-full text-xs text-slate-500">발행에는 저장된 원고와 이미지만 사용합니다. 미완성 소재는 선택할 수 없습니다.</p>
    </div>
    {message && <p role="status" className="rounded bg-blue-50 p-3 text-sm text-blue-900">{message}</p>}
    {jobs.length > 0 && <details open={active || undefined} className="rounded-lg border p-3"><summary className="cursor-pointer font-semibold">작업 기록 {active ? "· 진행 중" : ""}</summary><div className="mt-2 max-h-72 space-y-3 overflow-auto">{jobs.slice(0, 10).map(job => <div key={job.jobId} className="rounded bg-slate-50 p-3 text-sm"><p className="font-semibold">{jobLabel(job)} · {jobStatusLabel(job)} · {job.items.length}개{isRecoveryJob(job) ? ` · 검증 통과 ${job.items.filter(item => item.status === "ready" && !item.error).length}개` : ""}</p><p className="text-xs text-slate-500">{new Date(job.startedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</p>{job.items.map(item => <p key={item.productId} className="mt-1 break-words">{materials.find(material => material.productId === item.productId)?.title || candidates.find(candidate => candidate.id === item.productId)?.productName || item.productId} — {item.stage}{item.scheduledDate ? ` (${item.scheduledDate})` : ""}{item.error ? `: ${item.error}` : ""}{item.errorCode ? ` (${item.errorCode})` : ""}</p>)}</div>)}</div></details>}
    {scheduleOpen && <div role="dialog" aria-modal="true" aria-labelledby="material-schedule-title" className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"><div className="w-full max-w-md space-y-4 rounded-xl bg-white p-6">
      <h3 id="material-schedule-title" className="text-lg font-bold">선택 {selected.length}개 예약발행</h3>
      <label className="block text-sm">예약 시작일 (한국시간)<input autoFocus type="date" min={tomorrow} value={date} onChange={event => setDate(event.target.value)} className="mt-1 w-full rounded border p-2" /></label>
      <label className="block text-sm">소재별 예약 간격 (일)<input type="number" min={1} max={30} value={intervalDays} onChange={event => setIntervalDays(Number(event.target.value))} className="mt-1 w-full rounded border p-2" /></label>
      <p className="text-sm text-slate-600">선택 목록 순서대로 하루에 한 소재씩, 지정한 간격으로 예약합니다.</p>
      {message && <p role="alert" className="text-sm text-red-700">{message}</p>}
      <div className="flex justify-end gap-2"><button type="button" onClick={() => setScheduleOpen(false)} className="rounded border px-4 py-2">취소</button><button type="button" disabled={busy || active || pendingRecovery || !valid || date < tomorrow} onClick={() => void publish()} className="rounded bg-indigo-700 px-4 py-2 text-white disabled:opacity-40">선택 소재 예약발행</button></div>
    </div></div>}
  </section>;
}
