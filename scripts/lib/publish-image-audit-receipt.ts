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
function payload(id: string, key: string, at: string) {
  return JSON.stringify({ version: VERSION, scope: scope(id), key, at });
}
export function readSuccessfulImageAuditReceipt(id: string, key: string): boolean {
  if (!validKey(key)) return false;
  try {
    const target = file(id);
    if (fs.statSync(target).size > 2048) return false;
    const row = JSON.parse(fs.readFileSync(target, "utf8"));
    const secret = signingKey(false);
    if (!secret || row.version !== VERSION || row.scope !== scope(id) || row.key !== key ||
        typeof row.at !== "string" || !Number.isFinite(Date.parse(row.at)) ||
        typeof row.signature !== "string" || !/^[a-f0-9]{64}$/.test(row.signature)) return false;
    const expected = crypto.createHmac("sha256", secret).update(payload(id, key, row.at)).digest();
    return crypto.timingSafeEqual(expected, Buffer.from(row.signature, "hex"));
  } catch { return false; }
}
export function writeSuccessfulImageAuditReceipt(id: string, key: string): void {
  if (!validKey(key)) throw new Error("IMAGE_AUDIT_RECEIPT_INVALID_KEY");
  scope(id);
  const secret = signingKey(true);
  if (!secret) throw new Error("IMAGE_AUDIT_RECEIPT_KEY_INVALID");
  const at = new Date().toISOString();
  const serialized = payload(id, key, at);
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
