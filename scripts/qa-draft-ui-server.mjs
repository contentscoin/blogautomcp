// Starts an isolated preview of saved drafts. No login data or remote activation is copied.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
const require = createRequire(import.meta.url);
const source = process.argv[2];
if (!source || !fs.existsSync(path.join(source, 'data', 'blogautomcp.db'))) throw new Error('Pass desktop user-data directory');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blogautomcp-ui-qa-'));
fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
fs.copyFileSync(path.join(source, 'data', 'blogautomcp.db'), path.join(dir, 'data', 'blogautomcp.db'));
for (const id of ['7d2d9f50-029a-4de7-bc28-8b93b6325f8b', 'ec1ed7fa-79ff-4974-b9df-36c06286b2bc']) {
  const src = path.join(source, 'data', 'prepared-brand-posts', id);
  const dst = path.join(dir, 'data', 'prepared-brand-posts', id);
  fs.mkdirSync(dst, { recursive: true });
  for (const name of ['manifest.json', 'post.md']) fs.copyFileSync(path.join(src, name), path.join(dst, name));
  if (fs.existsSync(path.join(src, 'mcp-draft-context.json'))) fs.copyFileSync(path.join(src, 'mcp-draft-context.json'), path.join(dst, 'mcp-draft-context.json'));
  const target = path.join(dst, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(target, 'utf8'));
  manifest.markdownPath = path.join(dst, 'post.md');
  fs.writeFileSync(target, JSON.stringify(manifest, null, 2));
}
const mock = createServer((_request, response) => {
  response.writeHead(200, {'content-type':'application/json'});
  response.end(JSON.stringify({success:true,data:null}));
});
await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
const env = { ...process.env, DESKTOP_USER_DATA: dir, SESSION_STORAGE_DIR: path.join(dir,'sessions'),
  DATABASE_URL: `file:${path.join(dir,'data','blogautomcp.db').replaceAll('\\','/')}`,
  REMOTE_SITE_URL:`http://127.0.0.1:${mock.address().port}`, REMOTE_DEVICE_ID:'qa-device', REMOTE_DEVICE_TOKEN:'qa-fixture-not-a-real-token', ADMIN_API_KEY:'', LOCAL_APP_ORIGIN:'http://127.0.0.1:43128' };
console.log(JSON.stringify({ userData: dir, url: env.LOCAL_APP_ORIGIN, isolated: true }));
const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', '43128'], { env, stdio: 'inherit', windowsHide: true });
process.on('SIGINT', () => child.kill());
process.on('SIGTERM', () => child.kill());
child.on('exit', code => { mock.close(); process.exitCode = code || 0; });
