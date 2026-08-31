/**
 * 발행 라이프사이클 상태 — 단일 진실원(Single Source of Truth).
 *
 * Prisma schema가 SQLite라 enum을 못 쓰고 status를 자유 문자열(String)로 저장하기 때문에,
 * 허용 값이 주석/페이지/스크립트에 흩어져 오타·누락이 컴파일타임에 안 잡히는 문제가 있었다.
 * 이 모듈을 import해 리터럴 대신 상수/타입을 사용하면 새 코드의 정합성을 강제할 수 있다.
 *
 * 관련 기존 정의:
 * - TopicCampaignStatus / TopicDraftStatus  → src/lib/topic-workflow.ts
 * - TOPIC_TASK_PIPELINE_STAGES (pipelineStage) → src/services/topic-task-pipeline.ts
 */

/** Post.status (스케줄러/크론 경로). */
export const POST_STATUSES = [
  "PENDING",
  "QUEUED",
  "RUNNING",
  "SUCCESS",
  "FAIL",
  "CANCELLED",
] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

/** BrandLink.status / TopicPostTask.status (UI 발행 경로 공통). */
export const CONTENT_PUBLISH_STATUSES = [
  "READY",
  "DRAFTING",
  "PUBLISHING",
  "SCHEDULED",
  "PUBLISHED",
  "FAILED",
] as const;
export type ContentPublishStatus = (typeof CONTENT_PUBLISH_STATUSES)[number];

/** 더 이상 전이되지 않는 종료 상태. */
export const TERMINAL_POST_STATUSES: readonly PostStatus[] = [
  "SUCCESS",
  "FAIL",
  "CANCELLED",
];
export const TERMINAL_CONTENT_STATUSES: readonly ContentPublishStatus[] = [
  "PUBLISHED",
  "SCHEDULED",
  "FAILED",
];

export function isPostStatus(value: unknown): value is PostStatus {
  return typeof value === "string" && (POST_STATUSES as readonly string[]).includes(value);
}

export function isContentPublishStatus(value: unknown): value is ContentPublishStatus {
  return (
    typeof value === "string" &&
    (CONTENT_PUBLISH_STATUSES as readonly string[]).includes(value)
  );
}

export function isTerminalPostStatus(value: string): boolean {
  return (TERMINAL_POST_STATUSES as readonly string[]).includes(value);
}

export function isTerminalContentStatus(value: string): boolean {
  return (TERMINAL_CONTENT_STATUSES as readonly string[]).includes(value);
}
