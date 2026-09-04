const MINUTE = 60_000;
const MAX_TIMER_MS = 3 * 60 * MINUTE;

/** Invalid settings must never become a NaN/overflow timer firing immediately. */
export function writingTimeoutMs(value: unknown, fallback: number, minimum = MINUTE): number {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(MAX_TIMER_MS, Math.max(minimum, parsed))
    : fallback;
}

export function getWritingTimeoutPolicy(env: Readonly<Record<string, string | undefined>> = process.env) {
  const codexMs = writingTimeoutMs(env.CODEX_DRAFT_TIMEOUT_MS, 10 * MINUTE);
  const responseMs = writingTimeoutMs(env.CHATGPT_RESPONSE_MAX_TIMEOUT_MS, 10 * MINUTE);
  // Initial draft + up to three existing travel QC repairs. Each direct browser
  // call may perform primary, stalled retry and structured-output repair.
  const browserCallMs = 3 * responseMs;
  const fallbackEnabled = env.CODEX_BROWSER_FALLBACK_ENABLED?.toLowerCase() === "true";
  const writingCallMs = fallbackEnabled ? codexMs + browserCallMs : Math.max(codexMs, browserCallMs);
  const writingChainMs = 4 * writingCallMs;
  const agentMs = Math.max(writingTimeoutMs(env.AGENT_MAX_RUNTIME_MS, 90 * MINUTE, 5 * MINUTE), writingChainMs + 30 * MINUTE);
  const prepareMs = Math.max(writingTimeoutMs(env.REMOTE_DRAFT_PREPARE_WAIT_MS, 95 * MINUTE), agentMs + 5 * MINUTE);
  const generateMs = Math.max(writingTimeoutMs(env.REMOTE_DRAFT_GENERATE_WAIT_MS, 100 * MINUTE), prepareMs + 5 * MINUTE);
  return {
    codexMs,
    idleMs: writingTimeoutMs(env.CHATGPT_RESPONSE_IDLE_TIMEOUT_MS, 5 * MINUTE),
    responseMs,
    writingChainMs,
    agentMs,
    prepareMs,
    generateMs,
  };
}
