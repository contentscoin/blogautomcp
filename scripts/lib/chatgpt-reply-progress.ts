export interface ChatGptReplyProgress {
  lastText: string;
  lastTextChangedAt: number;
}

export function createChatGptReplyProgress(now: number): ChatGptReplyProgress {
  return { lastText: "", lastTextChangedAt: now };
}

export function recordChatGptReplyText(
  progress: ChatGptReplyProgress,
  candidate: string,
  now: number,
): { progress: ChatGptReplyProgress; changed: boolean } {
  if (!candidate || candidate === progress.lastText) {
    return { progress, changed: false };
  }
  return {
    progress: { lastText: candidate, lastTextChangedAt: now },
    changed: true,
  };
}

export function isChatGptReplyTextStalled(
  progress: ChatGptReplyProgress,
  now: number,
  idleTimeoutMs: number,
): boolean {
  return now - progress.lastTextChangedAt >= idleTimeoutMs;
}
