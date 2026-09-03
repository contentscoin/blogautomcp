import fs from "node:fs";
import path from "node:path";
import { getBrandPostPackageDir } from "./brand-post-package";

/**
 * 초안 작업 진행률. 초안 라우트와 simple-agent 가 단계마다 패키지 디렉터리의 progress.json 에 기록하고,
 * 데스크톱 실행기(remote-agent poll)의 하트비트가 읽어 사이트 작업 진행률로 전달한다.
 * 파일 하나로 통일해 프로세스 경계(Next 라우트 ↔ ts-node 자식)를 넘어도 같은 값을 본다.
 */
export type DraftProgressStage =
  | "queued"
  | "facts"
  | "images"
  | "context"
  | "generate"
  | "qc"
  | "save"
  | "done"
  | "failed";

export interface DraftProgress {
  version: "draft-progress/v1";
  stage: DraftProgressStage | string;
  progress: number;
  message: string;
  updatedAt: string;
}

/** 단계별 기준 진행률. prepare(컨텍스트 준비)는 context 단계에서 완료된다. */
export const DRAFT_PROGRESS_MILESTONES: Record<Exclude<DraftProgressStage, "failed">, number> = {
  queued: 5,
  facts: 15,
  images: 25,
  context: 35,
  generate: 50,
  qc: 80,
  save: 90,
  done: 100,
};

export const DRAFT_PROGRESS_FILE_NAME = "progress.json";

export function getDraftProgressPath(brandLinkId: string): string {
  return path.join(getBrandPostPackageDir(brandLinkId), DRAFT_PROGRESS_FILE_NAME);
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** 경로를 직접 받는 저수준 기록기. simple-agent 는 BRANDLINK_DRAFT_PROGRESS_PATH 로 이 경로를 넘겨받는다. */
export function writeDraftProgressFile(filePath: string, update: {
  stage: DraftProgressStage | string;
  progress?: number;
  message: string;
}): DraftProgress | null {
  const target = filePath.trim();
  if (!target) return null;
  const progress = update.progress ?? DRAFT_PROGRESS_MILESTONES[update.stage as Exclude<DraftProgressStage, "failed">] ?? 0;
  const record: DraftProgress = {
    version: "draft-progress/v1",
    stage: update.stage,
    progress: clampProgress(progress),
    message: update.message.replace(/\s+/gu, " ").trim().slice(0, 240),
    updatedAt: new Date().toISOString(),
  };
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(record, null, 2), "utf8");
    fs.renameSync(temp, target);
    return record;
  } catch {
    // 진행률은 보조 정보다. 기록 실패가 초안 작업을 막으면 안 된다.
    return null;
  }
}

export function writeDraftProgress(brandLinkId: string, update: {
  stage: DraftProgressStage | string;
  progress?: number;
  message: string;
}): DraftProgress | null {
  return writeDraftProgressFile(getDraftProgressPath(brandLinkId), update);
}

export function readDraftProgressFile(filePath: string, options: { since?: number } = {}): DraftProgress | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<DraftProgress>;
    if (parsed.version !== "draft-progress/v1" || typeof parsed.stage !== "string" || typeof parsed.updatedAt !== "string") {
      return null;
    }
    const updatedAt = Date.parse(parsed.updatedAt);
    if (!Number.isFinite(updatedAt)) return null;
    // 작업 시작 이전의 낡은 기록은 이번 작업의 진행률이 아니다.
    if (options.since !== undefined && updatedAt < options.since) return null;
    return {
      version: "draft-progress/v1",
      stage: parsed.stage,
      progress: clampProgress(typeof parsed.progress === "number" ? parsed.progress : 0),
      message: typeof parsed.message === "string" ? parsed.message : "",
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return null;
  }
}

export function readDraftProgress(brandLinkId: string, options: { since?: number } = {}): DraftProgress | null {
  return readDraftProgressFile(getDraftProgressPath(brandLinkId), options);
}

export function clearDraftProgress(brandLinkId: string): void {
  try {
    fs.rmSync(getDraftProgressPath(brandLinkId), { force: true });
  } catch {
    // 없으면 그만.
  }
}
