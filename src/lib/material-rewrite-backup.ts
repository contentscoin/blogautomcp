import fs from "node:fs";
import path from "node:path";
import { getAppDataDir } from "../../scripts/lib/app-paths";
import { getBrandPostPackageDir } from "./brand-post-package";

/** Preserve the full local package before a new writer can overwrite its files. */
export function backupMaterialBeforeRewrite(productId: string, jobId: string): string | null {
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(productId) || !/^[a-f0-9-]{36}$/.test(jobId)) throw new Error("잘못된 재작성 백업 ID입니다.");
  const source = getBrandPostPackageDir(productId);
  if (!fs.existsSync(source)) return null;
  const target = path.join(getAppDataDir(), "material-rewrite-backups", jobId, productId);
  // Never replace a snapshot on a repeated callback or an uncertain mutation.
  if (fs.existsSync(target)) throw Object.assign(new Error("같은 작업의 원고 백업이 이미 있습니다. 재작성 결과를 확인하세요."), { code: "REWRITE_BACKUP_EXISTS" });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, errorOnExist: true, force: false });
  return target;
}
