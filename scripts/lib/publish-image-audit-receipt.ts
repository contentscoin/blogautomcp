import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";
import { getAppDataDir } from "./app-paths";
import { atomicWriteTextFile } from "../../src/lib/atomic-text-file";

const VERSION = "publication-image-audit-success/v1";
const root = () => path.join(getAppDataDir(), "publication-image-audit-receipts");
const scope = (id: string) => {
  if (!id || id.length > 200 || id !== id.trim()) throw new Error("IMAGE_AUDIT_RECEIPT_INVALID_ID");
  return crypto.createHash("sha256").update(id).digest("hex");
};
const file = (id: string) => path.join(root(), `${scope(id)}.json`);
const validKey = (key: string) => /^[a-f0-9]{64}$/.test(key);
/** A completed composition may explicitly leave tiny/unobservable lettering
 * uncertified. This signed summary survives reuse; it never grants generation. */
export interface SuccessfulImageAuditPrintWarning {
  nodeIndex: number;
  sha256: string;
  evidenceSha256: string;
  kind?: "suspected-omission-uncorroborated";
}
function validPrintWarnings(value: unknown): value is SuccessfulImageAuditPrintWarning[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 64 && value.every(row => row &&
    Object.keys(row).sort().join("|") === (row.kind === undefined ? "evidenceSha256|nodeIndex|sha256" : "evidenceSha256|kind|nodeIndex|sha256") &&
    (row.kind === undefined || row.kind === "suspected-omission-uncorroborated") && Number.isSafeInteger(row.nodeIndex) && row.nodeIndex >= 0 &&
    typeof row.sha256 === "string" && validKey(row.sha256) && typeof row.evidenceSha256 === "string" && validKey(row.evidenceSha256)) &&
    new Set(value.map(row => row.nodeIndex)).size === value.length;
}
function signingKey(create: boolean): Buffer | null {
  const target = path.join(root(), ".signing-key");
  try {
    const bytes = fs.readFileSync(target);
    return bytes.length === 32 ? bytes : null;
  } catch (error) {
    if (!create || (error as NodeJS.ErrnoException).code !== "ENOENT") return null;
  }
  fs.mkdirSync(root(), { recursive: true });
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, crypto.randomBytes(32), { flag: "wx", mode: 0o600 });
    // Publish a fully written key exclusively. Competing processes read the
    // winner; none can observe a partially written key or replace it.
    try { fs.linkSync(temporary, target); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  } finally { fs.rmSync(temporary, { force: true }); }
  return signingKey(false);
}
function payload(id: string, key: string, at: string, readinessBindingKey?: string, printWarnings?: SuccessfulImageAuditPrintWarning[]) {
  return JSON.stringify({ version: VERSION, scope: scope(id), key, at,
    ...(readinessBindingKey ? { readinessBindingKey } : {}), ...(printWarnings?.length ? {printWarnings} : {}) });
}
function readVerifiedReceipt(id: string): { key: string; readinessBindingKey?: string; printWarnings?: SuccessfulImageAuditPrintWarning[] } | null {
  try {
    const target = file(id);
    if (fs.statSync(target).size > 24 * 1024) return null;
    const row = JSON.parse(fs.readFileSync(target, "utf8"));
    const secret = signingKey(false);
    if (!secret || row.version !== VERSION || row.scope !== scope(id) || !validKey(row.key) ||
        (row.readinessBindingKey !== undefined && !validKey(row.readinessBindingKey)) ||
        (row.printWarnings !== undefined && !validPrintWarnings(row.printWarnings)) ||
        typeof row.at !== "string" || !Number.isFinite(Date.parse(row.at)) ||
        typeof row.signature !== "string" || !/^[a-f0-9]{64}$/.test(row.signature)) return null;
    const expected = crypto.createHmac("sha256", secret).update(payload(id, row.key, row.at, row.readinessBindingKey, row.printWarnings)).digest();
    return crypto.timingSafeEqual(expected, Buffer.from(row.signature, "hex"))
      ? { key: row.key, ...(row.readinessBindingKey ? { readinessBindingKey: row.readinessBindingKey } : {}),
        ...(row.printWarnings ? {printWarnings:row.printWarnings} : {}) } : null;
  } catch { return null; }
}
export function readSuccessfulImageAuditReceipt(id: string, key: string): boolean {
  return validKey(key) && readVerifiedReceipt(id)?.key === key;
}
export function readSuccessfulImageAuditReceiptDetails(id: string, key: string): {printWarnings?:SuccessfulImageAuditPrintWarning[]} | null {
  const row=validKey(key)?readVerifiedReceipt(id):null;
  return row?.key===key ? {...(row.printWarnings?{printWarnings:row.printWarnings}:{})} : null;
}
/** A historical successful review is not ready until its exact saved material
 * was bound by the approval preflight. Both bindings share the same HMAC. */
export function readSuccessfulImageAuditReadinessBinding(id: string, readinessBindingKey: string): boolean {
  return validKey(readinessBindingKey) && readVerifiedReceipt(id)?.readinessBindingKey === readinessBindingKey;
}
/** Optimization hint only: callers must verify the CURRENT readiness binding
 * before showing any warning. This never authorizes approval or generation. */
export function hasSignedImageAuditPrintWarnings(id: string): boolean {
  return Boolean(readVerifiedReceipt(id)?.printWarnings?.length);
}
export function readSuccessfulImageAuditReadinessWarnings(id: string, readinessBindingKey: string): SuccessfulImageAuditPrintWarning[] | null {
  const row = validKey(readinessBindingKey) ? readVerifiedReceipt(id) : null;
  return row?.readinessBindingKey === readinessBindingKey ? (row.printWarnings || []).map(warning => ({ ...warning })) : null;
}
export function writeSuccessfulImageAuditReceipt(id: string, key: string, readinessBindingKey?: string, printWarnings?: SuccessfulImageAuditPrintWarning[]): void {
  if (!validKey(key)) throw new Error("IMAGE_AUDIT_RECEIPT_INVALID_KEY");
  if (readinessBindingKey !== undefined && !validKey(readinessBindingKey)) throw new Error("IMAGE_AUDIT_RECEIPT_INVALID_BINDING");
  if (printWarnings !== undefined && !validPrintWarnings(printWarnings)) throw new Error("IMAGE_AUDIT_RECEIPT_INVALID_PRINT_WARNINGS");
  scope(id);
  const secret = signingKey(true);
  if (!secret) throw new Error("IMAGE_AUDIT_RECEIPT_KEY_INVALID");
  const at = new Date().toISOString();
  const serialized = payload(id, key, at, readinessBindingKey, printWarnings);
  atomicWriteTextFile(file(id), JSON.stringify({ ...JSON.parse(serialized),
    signature: crypto.createHmac("sha256", secret).update(serialized).digest("hex") }));
}
export function invalidateSuccessfulImageAuditReceipt(id: string): void {
  fs.rmSync(file(id), { force: true });
}

/** Serialize the whole audit and ledger update using an OS-owned listener.
 * Windows named pipes disappear on process termination: no partially written
 * lock file, stale-owner deletion race or stranded reaper can block recovery.
 * Other platforms use a loopback-only port. Hash collisions only serialize
 * unrelated audits; they cannot permit concurrent owners for the same key.
 */
export async function withSuccessfulImageAuditLock<T>(id: string, operation: () => Promise<T>): Promise<T> {
  const directory = path.resolve(root());
  const identity = crypto.createHash("sha256").update(process.platform === "win32" ? directory.toLowerCase() : directory).update(scope(id)).digest("hex");
  const endpoint = process.platform === "win32"
    ? { path: `\\\\.\\pipe\\blogautomcp-image-audit-${identity}` }
    : { host: "127.0.0.1", port: 32768 + Number.parseInt(identity.slice(0, 4), 16) % 28000, exclusive: true };
  const deadline = Date.now() + 10 * 60_000;
  let owner: net.Server;
  while (true) {
    const candidate = net.createServer(socket => socket.destroy());
    const acquired = await new Promise<boolean>((resolve, reject) => {
      candidate.once("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE") resolve(false);
        else reject(error);
      });
      candidate.listen(endpoint, () => resolve(true));
    });
    if (acquired) { owner = candidate; break; }
    if (Date.now() >= deadline) throw new Error("IMAGE_AUDIT_BUSY: 최종 이미지 검사가 이미 진행 중입니다.");
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  try { return await operation(); }
  finally { await new Promise<void>((resolve, reject) => owner.close(error => error ? reject(error) : resolve())); }
}
