import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { BrowserContext } from "playwright";

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;
export interface NaverSessionSnapshot {
  sessionPath: string;
  fingerprint: string;
  state: StorageState;
  manualRevision: string | null;
}
export interface NaverManualSessionBaseline { existed: boolean; manualRevision: string | null }
export type NaverSessionSaveResult = "saved" | "unchanged" | "superseded" | "unverified" | "unavailable";
type SessionContext = Pick<BrowserContext, "storageState">;
type AuthenticationProof = () => Promise<boolean>;

function fingerprint(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function readNaverSessionFingerprint(sessionPath: string): string | null {
  try { return fingerprint(fs.readFileSync(sessionPath, "utf8")); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function readNaverSessionSnapshot(sessionPath: string): NaverSessionSnapshot {
  const raw = fs.readFileSync(sessionPath, "utf8");
  const document = JSON.parse(raw) as StorageState & { __blogautoNaverSession?: { version: number; manualRevision: string } };
  if (!Array.isArray(document.cookies) || (document.origins !== undefined && !Array.isArray(document.origins))) throw new Error("네이버 세션 파일 형식을 확인하세요.");
  const metadata = document.__blogautoNaverSession;
  if (metadata !== undefined && (!metadata || metadata.version !== 1 || typeof metadata.manualRevision !== "string" ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(metadata.manualRevision))) throw new Error("네이버 세션의 로그인 저장 정보를 확인하세요.");
  // Playwright receives only its own storage schema, never internal metadata.
  const state: StorageState = { cookies: document.cookies, origins: document.origins ?? [] };
  return { sessionPath, fingerprint: fingerprint(raw), state, manualRevision: metadata?.manualRevision ?? null };
}

export function readNaverManualSessionBaseline(sessionPath: string): NaverManualSessionBaseline {
  try { return { existed: true, manualRevision: readNaverSessionSnapshot(sessionPath).manualRevision }; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { existed: false, manualRevision: null };
    throw error;
  }
}

function isNaverDomain(domain: string): boolean {
  return /(^|\.)naver\.com$/i.test(domain.replace(/^\./, ""));
}

function selectedAuthenticatedState(state: StorageState, baseline?: StorageState, now = Date.now()): StorageState | null {
  if (!Array.isArray(state.cookies) || !Array.isArray(state.origins)) return null;
  const cookies = state.cookies.filter(cookie => typeof cookie.domain === "string" && isNaverDomain(cookie.domain));
  for (const name of ["NID_AUT", "NID_SES"]) {
    const cookie = cookies.find(candidate => candidate.name === name && typeof candidate.value === "string" && candidate.value.length > 0 &&
      Number.isFinite(candidate.expires) && (candidate.expires === -1 || candidate.expires * 1000 > now));
    if (!cookie) return null;
  }
  const origins = state.origins.filter(origin => {
    try {
      const url = new URL(origin.origin);
      return url.protocol === "https:" && isNaverDomain(url.hostname);
    } catch { return false; }
  });
  const preservedCookies = (baseline?.cookies ?? []).filter(cookie => !isNaverDomain(cookie.domain));
  const preservedOrigins = (baseline?.origins ?? []).filter(origin => {
    try { return !isNaverDomain(new URL(origin.origin).hostname); } catch { return false; }
  });
  return { cookies: [...cookies, ...preservedCookies], origins: [...origins, ...preservedOrigins] };
}

function acquireWriterLock(sessionPath: string): (() => void) | null {
  const lockPath = `${sessionPath}.write-lock`;
  try {
    const fd = fs.openSync(lockPath, "wx", 0o600);
    try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid })); } catch (error) {
      fs.unlinkSync(lockPath);
      throw error;
    } finally { fs.closeSync(fd); }
    return () => { try { fs.unlinkSync(lockPath); } catch { /* File already removed. */ } };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    // PID inspection followed by unlink is not an atomic ownership check:
    // another process could install a live lock before the unlink. Preserve
    // every pre-existing lock, including after a crash, instead of reclaiming it.
    return null;
  }
}

/** All writers use the same short lock. No network operation holds this lock. */
function writeAuthenticatedState(state: StorageState, sessionPath: string, expectedFingerprint?: string,
  baseline?: StorageState, manualBaseline?: NaverManualSessionBaseline): {
    result: NaverSessionSaveResult; fingerprint?: string; state?: StorageState; manualRevision?: string | null;
  } {
  const selected = selectedAuthenticatedState(state, baseline);
  if (!selected) return { result: "unverified" };
  fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
  const release = acquireWriterLock(sessionPath);
  if (!release) return { result: "unavailable" };
  const pendingPath = path.join(path.dirname(sessionPath), `${path.basename(sessionPath)}.refresh-${process.pid}-${randomUUID()}.pending`);
  try {
    const current = fs.existsSync(sessionPath) ? readNaverSessionSnapshot(sessionPath) : null;
    if (expectedFingerprint !== undefined && current?.fingerprint !== expectedFingerprint) return { result: "superseded" };
    if (manualBaseline && (manualBaseline.existed !== Boolean(current) || manualBaseline.manualRevision !== (current?.manualRevision ?? null))) return { result: "superseded" };
    // Background cookie renewal preserves the account generation. Only a
    // completed manual login installs a new generation, within this same file.
    const manualRevision = manualBaseline ? randomUUID() : current?.manualRevision ?? null;
    const raw = JSON.stringify({ ...selected, ...(manualRevision ? { __blogautoNaverSession: { version: 1, manualRevision } } : {}) });
    if (current?.fingerprint === fingerprint(raw)) return { result: "unchanged", fingerprint: fingerprint(raw), state: selected, manualRevision };
    const fd = fs.openSync(pendingPath, "wx", 0o600);
    try { fs.writeFileSync(fd, raw, "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    // Same-directory replacement preserves the old file if the rename fails,
    // without a reader-visible gap between moving a backup and installing it.
    fs.renameSync(pendingPath, sessionPath);
    return { result: "saved", fingerprint: fingerprint(raw), state: selected, manualRevision };
  } finally {
    try { if (fs.existsSync(pendingPath)) fs.unlinkSync(pendingPath); } catch { /* Never mask a successful replacement. */ }
    release();
  }
}

/** Unknown initial candidates are allowed only when no session existed at launch. */
export function commitNaverLoginSession(pendingPath: string, sessionPath: string, manualBaseline: NaverManualSessionBaseline,
  authenticationConfirmed: boolean): void {
  if (!authenticationConfirmed && manualBaseline.existed) throw new Error("서버 인증 확인이 완료되지 않아 기존 네이버 로그인 세션을 보존했습니다.");
  const state = readNaverSessionSnapshot(pendingPath).state;
  const result = writeAuthenticatedState(state, sessionPath, undefined, undefined, manualBaseline);
  if (result.result === "superseded") throw new Error("로그인 창이 열린 뒤 다른 로그인 작업이 새 계정을 저장해 최근 세션을 보존했습니다. 로그인 상태를 다시 확인하세요.");
  if (result.result !== "saved" && result.result !== "unchanged") throw new Error("확인된 네이버 로그인 세션을 안전하게 저장하지 못했습니다. 다시 시도하세요.");
}

/** A rejected or uncertain probe never replaces saved authentication. */
export async function saveRefreshedNaverSession(context: SessionContext, snapshot: NaverSessionSnapshot,
  proveAuthentication: AuthenticationProof, timeoutMs = 10_000,
  options: { preserveOrigins?: boolean } = {}): Promise<NaverSessionSaveResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    const result = await Promise.race([
      (async (): Promise<NaverSessionSaveResult> => {
        if (await proveAuthentication() !== true) return "unverified";
        if (timedOut) return "unavailable";
        // Capture after the positive request, so its rotated cookies are included.
        const state = await context.storageState({ indexedDB: true });
        if (timedOut) return "unavailable";
        // APIRequestContext cannot observe browser localStorage. Preserve the
        // already-bound snapshot's origins only when the caller selects API mode.
        if (options.preserveOrigins) state.origins = snapshot.state.origins;
        if (!selectedAuthenticatedState(state)) return "unverified";
        const committed = writeAuthenticatedState(state, snapshot.sessionPath, snapshot.fingerprint, snapshot.state);
        if (committed.fingerprint && committed.state) {
          // Bind to this writer's own bytes, never adopt a later manual login
          // that could arrive after releasing the lock.
          snapshot.fingerprint = committed.fingerprint;
          snapshot.state = committed.state;
          snapshot.manualRevision = committed.manualRevision ?? null;
        }
        return committed.result;
      })(),
      new Promise<NaverSessionSaveResult>(resolve => { timer = setTimeout(() => { timedOut = true; resolve("unavailable"); }, timeoutMs); }),
    ]);
    return result;
  } catch { return "unavailable"; } finally { if (timer) clearTimeout(timer); }
}

/** Saving failures are isolated from publishing outcomes. No browser is closed here. */
export function maintainNaverSession(context: SessionContext, snapshot: NaverSessionSnapshot, proveAuthentication: AuthenticationProof,
  options: { intervalMs?: number; timeoutMs?: number; onUnavailable?: () => void } = {}): { refresh(): Promise<NaverSessionSaveResult>; stop(): Promise<NaverSessionSaveResult> } {
  let inFlight: Promise<NaverSessionSaveResult> | null = null;
  let finalSave: Promise<NaverSessionSaveResult> | null = null;
  let stopped = false;
  let warned = false;
  const refresh = () => {
    if (!inFlight) inFlight = saveRefreshedNaverSession(context, snapshot, proveAuthentication, options.timeoutMs)
      .then(result => {
        if (result === "unavailable" && !warned) {
          warned = true;
          try {
            if (options.onUnavailable) options.onUnavailable();
            else console.warn("네이버 세션 갱신 확인·저장을 완료하지 못했습니다. 로그인 상태와 저장 권한을 확인하세요. 작업 결과에는 영향을 주지 않습니다.");
          } catch { /* Diagnostics cannot change a publication outcome. */ }
        }
        return result;
      })
      .finally(() => { inFlight = null; });
    return inFlight;
  };
  const interval = setInterval(() => { if (!stopped) void refresh(); }, options.intervalMs ?? 120_000);
  interval.unref();
  return { refresh, stop() {
    stopped = true;
    clearInterval(interval);
    return finalSave ??= refresh();
  } };
}
