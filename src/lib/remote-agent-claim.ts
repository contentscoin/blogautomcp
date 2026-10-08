import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

export type RemoteClaimIntent = {
  version: 1;
  requestId: string;
  protocol: "keyed" | "legacy";
  state: "pending" | "started";
  job?: { id: string; type: string };
};

/** Only the receipt is persisted; never a credential, job input or execution replay. */
export function remoteClaimStore(root: string, siteUrl: string, token: string) {
  const identity = createHash("sha256").update(`${siteUrl}\0${token}`).digest("hex");
  const file = path.join(root, "remote-agent-claims", `${identity}.json`);
  const read = (): RemoteClaimIntent | null => {
    try {
      if (fs.statSync(file).size > 2048) throw new Error("Claim receipt exceeds limit");
      const value = JSON.parse(fs.readFileSync(file, "utf8")) as RemoteClaimIntent;
      if (value?.version !== 1 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.requestId) ||
          !["keyed", "legacy"].includes(value.protocol) || !["pending", "started"].includes(value.state) ||
          (value.state === "started" && (!value.job || !/^job_[A-Za-z0-9_-]{1,80}$/.test(value.job.id) ||
            typeof value.job.type !== "string" || !value.job.type || value.job.type.length > 100))) {
        throw new Error("Invalid remote claim receipt");
      }
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  };
  const save = (value: RemoteClaimIntent) => {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      const descriptor = fs.openSync(temp, "wx", 0o600);
      try { fs.writeFileSync(descriptor, JSON.stringify(value)); fs.fsyncSync(descriptor); }
      finally { fs.closeSync(descriptor); }
      fs.renameSync(temp, file);
      // Do not run an operation when its receipt cannot be read back.
      if (read()?.requestId !== value.requestId || read()?.state !== value.state) throw new Error("Claim receipt was not persisted");
    } finally {
      try { fs.unlinkSync(temp); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
  };
  return {
    read,
    begin(protocol: RemoteClaimIntent["protocol"]): RemoteClaimIntent {
      const existing = read();
      if (existing) return existing;
      const value: RemoteClaimIntent = { version: 1, requestId: randomUUID(), protocol, state: "pending" };
      save(value);
      return value;
    },
    started(intent: RemoteClaimIntent, job: { id: string; type: string }) {
      const current = read();
      if (!current || current.requestId !== intent.requestId || current.state !== "pending") throw new Error("Claim receipt changed before execution");
      save({ ...current, state: "started", job: { id: job.id, type: job.type } });
    },
    clear(requestId: string) {
      const current = read();
      if (current && current.requestId !== requestId) throw new Error("Cannot clear a different claim receipt");
      try { fs.unlinkSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    },
  };
}
