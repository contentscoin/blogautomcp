import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getAppDataDir } from "../../scripts/lib/app-paths";

export type MaterialItemStatus = "queued" | "preparing" | "ready" | "publishing" | "published" | "scheduled" | "failed" | "outcome_unknown" | "interrupted";
export interface MaterialJob {
  jobId: string;
  kind: "prepare" | "publish";
  status: "running" | "completed" | "partial" | "failed" | "interrupted";
  ownerPid: number;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  sourceJobId?: string;
  requestHash?: string;
  events?: Array<{ at: string; productId: string; stage: string; status: MaterialItemStatus }>;
  publishMode?: "now" | "schedule";
  items: Array<{ productId: string; revision?: string; status: MaterialItemStatus; stage: string; error?: string; scheduledDate?: string; result?: unknown }>;
}
const directory = () => path.join(getAppDataDir(), "material-jobs");
const shared = globalThis as typeof globalThis & { materialLockOwners?: Set<string> };
const owned = shared.materialLockOwners ??= new Set<string>();
const jobPath = (id: string) => {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("잘못된 작업 ID입니다.");
  return path.join(directory(), `${id}.json`);
};
function alive(pid: number) {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}
export function saveMaterialJob(job: MaterialJob) {
  fs.mkdirSync(directory(), { recursive: true });
  job.updatedAt = new Date().toISOString();
  const target = jobPath(job.jobId);
  const temp = `${target}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(job, null, 2));
  fs.renameSync(temp, target);
}
export function readMaterialJob(id: string): MaterialJob | null {
  const file = jobPath(id);
  if (!fs.existsSync(file)) return null;
  const job = JSON.parse(fs.readFileSync(file, "utf8")) as MaterialJob;
  if (job.status === "running" && (!alive(job.ownerPid) || (job.ownerPid === process.pid && !owned.has(job.jobId)))) {
    job.status = "interrupted";
    job.completedAt = new Date().toISOString();
    for (const item of job.items) {
      if (item.status === "publishing") {
        item.status = "outcome_unknown";
        item.error = "앱이 중단되어 발행 결과를 확인해야 합니다. 자동 재발행하지 않습니다.";
      } else if (["queued", "preparing"].includes(item.status)) {
        item.status = "interrupted";
        item.error = "앱이 중단되었습니다. 저장된 소재를 확인한 후 준비를 재개하세요.";
      }
    }
    saveMaterialJob(job);
  }
  return job;
}
export function listMaterialJobs(): MaterialJob[] {
  if (!fs.existsSync(directory())) return [];
  return fs.readdirSync(directory()).filter(file => /^[a-f0-9-]{36}\.json$/.test(file))
    .map(file => readMaterialJob(file.slice(0, -5))!).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
// OS-exclusive creation also protects separate server workers. A live owner's lock
// is never stolen just because generation takes longer than expected.
export function acquireMaterialJobLock(jobId: string): () => void {
  fs.mkdirSync(directory(), { recursive: true });
  const file = path.join(directory(), "active.lock");
  const record = { pid: process.pid, jobId };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, JSON.stringify(record), { flag: "wx" });
      owned.add(jobId);
      return () => {
        if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file, "utf8")).jobId === jobId) fs.unlinkSync(file);
        owned.delete(jobId);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let previous: { pid: number; jobId: string };
      try { previous = JSON.parse(fs.readFileSync(file, "utf8")); }
      catch { throw new Error("소재 작업 잠금 기록이 손상되었습니다. 앱 진단에서 확인하세요."); }
      if (alive(previous.pid) && (previous.pid !== process.pid || owned.has(previous.jobId))) throw new Error("다른 소재 준비·발행 작업이 진행 중입니다. 진행상태를 확인하세요.");
      readMaterialJob(previous.jobId);
      fs.unlinkSync(file);
    }
  }
  throw new Error("소재 작업 잠금을 획득하지 못했습니다.");
}
