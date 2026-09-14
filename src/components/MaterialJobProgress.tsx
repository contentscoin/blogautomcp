"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
type Job = { jobId: string; kind: string; status: string; startedAt: string; sourceJobId?: string; items: Array<{ productId: string; stage: string; status: string; error?: string }> };
export function MaterialJobProgress({ history = false }: { history?: boolean }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  useEffect(() => {
    let alive = true;
    const poll = () => { void fetch("/api/materials?jobsOnly=1", { cache: "no-store" }).then(response => response.json()).then(result => {
      if (alive && result.success) setJobs(result.data.jobs);
    }).catch(() => undefined); };
    poll(); const timer = setInterval(poll, 5000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  const active = jobs.find(job => job.status === "running");
  if (!history) return active ? <div role="status" className="border-b border-violet-200 bg-violet-50 px-4 py-2 text-sm text-violet-900">
    {active.kind === "prepare" ? "소재 미리작성" : "선택 소재 발행"} · 완료 {active.items.filter(item => ["ready", "published", "scheduled"].includes(item.status)).length}/{active.items.length} · {active.items.find(item => ["preparing", "publishing"].includes(item.status))?.stage || "대기 중"}
    <Link href="/#material-library" className="ml-3 underline">소재·진행상태 보기</Link>
  </div> : null;
  return <section className="rounded-xl border bg-white p-4"><h2 className="font-bold">소재 준비·발행 작업 이력</h2><p className="mt-1 text-sm text-slate-500">개별 실행 기록입니다. 이전 실패와 중단 기록도 유지됩니다.</p>
    {!jobs.length && <p className="mt-3 text-sm text-slate-500">새 소재 프로세스에서 시작한 작업이 없습니다.</p>}
    <div className="mt-3 max-h-[500px] space-y-3 overflow-auto">{jobs.map(job => <details key={job.jobId} className="rounded border p-3"><summary className="cursor-pointer text-sm font-semibold">{job.kind === "prepare" ? "소재 미리작성" : "선택 소재 발행"} · {({ running: "진행 중", completed: "완료", partial: "일부 완료", failed: "확인 필요", interrupted: "중단됨" } as Record<string, string>)[job.status] || job.status} · {job.items.length}건 · {new Date(job.startedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</summary>
      <p className="mt-2 break-all text-xs text-slate-500">작업 {job.jobId}{job.sourceJobId ? ` · MCP 요청 ${job.sourceJobId}` : ""}</p>
      {job.items.map(item => <p key={item.productId} className="mt-2 text-sm">{item.productId} · {item.stage}{item.error ? ` — ${item.error}` : ""}</p>)}
      <Link href="/#material-library" className="mt-3 inline-block text-sm text-violet-700 underline">소재 확인</Link>
    </details>)}</div>
  </section>;
}
