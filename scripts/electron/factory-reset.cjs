/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const MARKER = '.factory-reset-request.json';
const TARGETS = ['data', 'playwright', 'logs', 'runtime', 'remote-agent-claims', 'remote-agent-completions',
  'generated-thumbnails', '.env', 'app.db', 'app.db-wal', 'app.db-shm', 'blogautomcp.db', 'blogautomcp.db-wal', 'blogautomcp.db-shm'];
function checkedRoot(root) {
  const resolved = path.resolve(root);
  if (resolved === path.parse(resolved).root || fs.lstatSync(resolved).isSymbolicLink() || fs.realpathSync(resolved).toLowerCase() !== resolved.toLowerCase())
    throw new Error('초기화 저장소 경로를 확인할 수 없습니다.');
  return resolved;
}
function validateTree(file) {
  if (!fs.existsSync(file)) return;
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink()) throw new Error('연결된 외부 폴더가 있어 초기화를 중단했습니다.');
  if (stat.isDirectory()) for (const entry of fs.readdirSync(file)) validateTree(path.join(file, entry));
}
function paths(root) {
  return TARGETS.map(name => {
    const target = path.resolve(root, name);
    if (path.dirname(target) !== root) throw new Error('초기화 범위를 벗어났습니다.');
    return target;
  });
}
function requestFactoryReset(root) {
  root = checkedRoot(root);
  paths(root).forEach(validateTree);
  fs.writeFileSync(path.join(root, MARKER), JSON.stringify({ version: 1, root, confirmed: true }), { flag: 'wx', mode: 0o600 });
}
async function completeFactoryReset(root, clearBrowserStorage) {
  root = checkedRoot(root);
  const marker = path.join(root, MARKER);
  if (!fs.existsSync(marker)) return false;
  validateTree(marker);
  const request = JSON.parse(fs.readFileSync(marker, 'utf8'));
  if (request.version !== 1 || request.root !== root || request.confirmed !== true) throw new Error('초기화 확인 기록이 손상되었습니다.');
  const targets = paths(root);
  targets.forEach(validateTree);
  await clearBrowserStorage();
  for (const target of targets) fs.rmSync(target, { recursive: true, force: true });
  fs.unlinkSync(marker);
  return true;
}
function cancelFactoryReset(root) {
  root = checkedRoot(root);
  const marker = path.join(root, MARKER);
  validateTree(marker);
  const request = JSON.parse(fs.readFileSync(marker, 'utf8'));
  if (request.version !== 1 || request.root !== root || request.confirmed !== true) throw new Error('초기화 확인 기록이 다릅니다.');
  fs.unlinkSync(marker);
}
module.exports = { requestFactoryReset, completeFactoryReset, cancelFactoryReset };
