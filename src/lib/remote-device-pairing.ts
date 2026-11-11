import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";

export const COMPLETED_PAIR_PROOF_TTL_MS = 10 * 60_000;
type Receipt = { token: string; completed?: { deviceId: string; tokenHash: string; at: number; proofAccepted: boolean } };
/** A PC retains its own high-entropy proof before sending a pairing request. */
export function devicePairingProof(root: string, siteUrl: string, intent: string) {
  const key = createHash("sha256").update(`${siteUrl}\0${intent}`).digest("hex");
  const file = path.join(root, "remote-device-pairing", `${key}.json`);
  const decode = (target: string): Receipt => {
    if (fs.lstatSync(target).isSymbolicLink() || fs.statSync(target).size > 512) throw new Error("Invalid pairing receipt file");
    const value = JSON.parse(fs.readFileSync(target, "utf8")) as Receipt;
    if (!value || typeof value.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value.token)) throw new Error("Invalid pairing proof");
    const done = value.completed;
    if (done && (!/^device_[A-Za-z0-9_-]{16}$/.test(done.deviceId) || !/^[a-f0-9]{64}$/.test(done.tokenHash) || !Number.isSafeInteger(done.at) || done.at < 1 || typeof done.proofAccepted !== "boolean")) throw new Error("Invalid completed pairing receipt");
    return value;
  };
  const read = (): Receipt | null => {
    try {
      const value = decode(file);
      if (value.completed && value.completed.at + COMPLETED_PAIR_PROOF_TTL_MS < Date.now()) { fs.unlinkSync(file); return null; }
      return value;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  };
  const cleanup = () => {
    try {
      // Bound each cleanup pass. Unknown requests never expire automatically.
      for (const name of fs.readdirSync(path.dirname(file)).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).slice(0, 100)) {
        if (name === path.basename(file)) continue;
        try { const target = path.join(path.dirname(file), name), value = decode(target);
          if (value.completed && value.completed.at + COMPLETED_PAIR_PROOF_TTL_MS < Date.now()) fs.unlinkSync(target);
        } catch { /* Other corrupt or unknown receipts are preserved. */ }
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  };
  const write = (value: Receipt, exclusive: boolean) => {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      const descriptor = fs.openSync(temp, "wx", 0o600);
      try { fs.writeFileSync(descriptor, JSON.stringify(value)); fs.fsyncSync(descriptor); }
      finally { fs.closeSync(descriptor); }
      if (exclusive) {
        try { fs.linkSync(temp, file); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      } else fs.renameSync(temp, file);
      const persisted = read();
      if (!persisted || (!exclusive && persisted.token !== value.token)) throw new Error("Pairing proof could not be persisted");
      return persisted;
    } finally { try { fs.unlinkSync(temp); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
  };
  return {
    get(): string {
      cleanup(); const existing = read(); if (existing) return existing.token;
      return write({ token: randomBytes(32).toString("base64url") }, true).token;
    },
    complete(deviceId: string, deviceToken: string) {
      const receipt = read();
      if (!receipt) throw new Error("Pairing receipt is missing");
      write({ ...receipt, completed: { deviceId, tokenHash: createHash("sha256").update(deviceToken).digest("hex"), at: Date.now(), proofAccepted: deviceToken === receipt.token } }, false);
    },
    completed(activation: { siteUrl: string; deviceId: string; deviceToken: string }) {
      const done = read()?.completed;
      return done && activation.siteUrl === siteUrl && activation.deviceId === done.deviceId && createHash("sha256").update(activation.deviceToken).digest("hex") === done.tokenHash ? done : null;
    },
    clear() { try { fs.unlinkSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } },
  };
}
