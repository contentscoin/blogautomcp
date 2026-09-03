import * as fs from "node:fs";
import * as path from "node:path";

/** Track files created by this run; upload lists alone never establish ownership. */
export function createPublishImageCleanup(tempRoot: string) {
  const tempPath = path.resolve(tempRoot);
  fs.mkdirSync(tempPath, { recursive: true });
  const realTempPath = fs.realpathSync(tempPath);
  const owned = new Set<string>();
  const track = (files: readonly string[]) => files.forEach((file) => owned.add(path.resolve(file)));

  function cleanup(imagePaths: readonly string[]): string[] {
    const removed: string[] = [];
    for (const candidate of new Set(imagePaths)) {
      try {
        if (!candidate.trim()) continue;
        const target = path.resolve(candidate);
        if (!owned.has(target)) continue;
        const relative = path.relative(tempPath, target);
        if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) continue;
        // Refuse redirected TEMP roots and links/junctions anywhere along the path.
        const rootStat = fs.lstatSync(tempPath);
        if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || fs.realpathSync(tempPath) !== realTempPath) continue;
        let current = tempPath;
        let regularFile = false;
        const parts = relative.split(path.sep);
        for (let index = 0; index < parts.length; index += 1) {
          current = path.join(current, parts[index]);
          const stat = fs.lstatSync(current);
          if (stat.isSymbolicLink()) break;
          if (index === parts.length - 1) regularFile = stat.isFile();
          else if (!stat.isDirectory()) break;
        }
        if (!regularFile) continue;
        const realRelative = path.relative(realTempPath, fs.realpathSync(target));
        if (!realRelative || realRelative === ".." || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) continue;
        fs.unlinkSync(target);
        owned.delete(target);
        removed.push(target);
      } catch {
        // Best effort: missing/locked/uncertain files are safer left untouched.
      }
    }
    return removed;
  }

  return { tempPath, track, cleanup };
}
