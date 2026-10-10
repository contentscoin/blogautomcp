"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { MaterialJobItemResult } from "./MaterialJobItemResult";
import { currentJobReadyCount, type CurrentMaterialDisplay } from "../lib/material-job-display";
type Job = { jobId: string; kind: string; status: string; startedAt: string; sourceJobId?: string; items: Array<{ productId: string; stage: string; status: string; error?: string; errorCode?: string }> };
const isRecoveryJob = (job: Job) => job.kind === "rewrite" || job.kind === "repair";
const jobLabel = (job: Job) => job.kind === "repair" ? "보완 필요 소재 보완·검증" : job.kind === "rewrite" ? "실패 소재 재작성·검증" : job.kind === "prepare" ? "소재 미리작성" : "선택 소재 발행";
const passedCount = (job: Job) => job.items.filter(item => !item.error && (isRecoveryJob(job) ? item.status === "ready" : ["ready", "published", "scheduled"].includes(item.status))).length;
const jobStatusLabel = (job: Job) => isRecoveryJob(job) && job.status === "completed"
  ? job.items.length === 0 ? job.kind === "repair" ? "보완 대상 없음" : "재작성 대상 없음" : passedCount(job) === job.items.length ? "검증 완료" : "검증 확인 필요"
  : ({ running: "진행 중", queued: "대기 중", completed: "완료", partial: isRecoveryJob(job) ? passedCount(job) > 0 ? "일부 검증 완료" : "검증 실패 · 확인 필요" : "일부 완료", failed: "실패 · 확인 필요", interrupted: "중단됨" } as Record<string, string>)[job.status] || job.status;
export function MaterialJobProgress({ history = false }: { history?: boolean }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [materials, setMaterials] = useState<CurrentMaterialDisplay[]>([]);
  useEffect(() => {
    let alive = true;
    const poll = () => { void fetch("/api/materials?jobsOnly=1", { cache: "no-store" }).then(response => response.json()).then(result => {
      if (alive && result.success) { setJobs(result.data.jobs); setMaterials(result.data.materials || []); }
    }).catch(() => undefined); };
    poll(); const timer = setInterval(poll, 5000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  const active = jobs.find(job => ["running", "queued"].includes(job.status));
  if (!history) return active ? <div role="status" className="border-b border-violet-200 bg-violet-50 px-4 py-2 text-sm text-violet-900">
    {jobLabel(active)} · {isRecoveryJob(active) ? "검증 통과" : "완료"} {passedCount(active)}/{active.items.length} · 실패 {active.items.filter(item => ["failed", "interrupted", "outcome_unknown"].includes(item.status) || item.error).length}개 · {active.items.find(item => ["preparing", "publishing"].includes(item.status))?.stage || "대기 중"}
    <Link href="/#material-library" className="ml-3 underline">소재·진행상태 보기</Link>
  </div> : null;
  return <section className="rounded-xl border bg-white p-4"><h2 className="font-bold">소재 준비·보완·재작성·발행 작업 이력</h2><p className="mt-1 text-sm text-slate-500">당시 실행 기록과 현재 소재 상태를 함께 표시합니다. 이후 복구된 소재의 이전 실패는 접어서 보존합니다.</p>
    {!jobs.length && <p className="mt-3 text-sm text-slate-500">새 소재 프로세스에서 시작한 작업이 없습니다.</p>}
    <div className="mt-3 max-h-[500px] space-y-3 overflow-auto">{jobs.map(job => <details key={job.jobId} className="rounded border p-3"><summary className="cursor-pointer text-sm font-semibold">{jobLabel(job)} · 당시 {jobStatusLabel(job)} · {job.items.length}건{isRecoveryJob(job) ? ` · 검증 통과 ${passedCount(job)}건` : ""} · {new Date(job.startedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</summary>
      <p className="mt-2 break-all text-xs text-slate-500">작업 {job.jobId}{job.sourceJobId ? ` · 요청 ${job.sourceJobId}` : ""}</p>
      {job.kind !== "publish" && <p className="mt-2 text-sm text-emerald-800">현재 준비완료 {currentJobReadyCount(job.items.map(item => item.productId), materials)}/{job.items.length}건</p>}
      {job.items.map(item => <MaterialJobItemResult key={item.productId} item={item} title={item.productId} current={materials.find(material => material.productId === item.productId)} />)}
      <Link href="/#material-library" className="mt-3 inline-block text-sm text-violet-700 underline">소재 확인</Link>
    </details>)}</div>
  </section>;
}
