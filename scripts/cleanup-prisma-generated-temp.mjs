import { readdir, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generatedDirectory = path.resolve(projectRoot, 'src', 'generated', 'prisma');
const resolvedDirectory = await realpath(generatedDirectory);
if (resolvedDirectory !== generatedDirectory) {
  throw new Error(`Prisma 생성 폴더가 예상 경로와 다릅니다: ${resolvedDirectory}`);
}

const temporaryEngine = /^query_engine-windows\.dll\.node\.tmp\d+$/;
const entries = await readdir(resolvedDirectory, { withFileTypes: true });
const targets = entries.filter((entry) => entry.isFile() && temporaryEngine.test(entry.name));
for (const target of targets) {
  await unlink(path.join(resolvedDirectory, target.name));
}
if (targets.length > 0) {
  console.log(`Removed ${targets.length} stale Prisma engine temporary file(s).`);
}
