import { createHash } from 'node:crypto';
import http from 'node:http';

const port = Number.parseInt(process.env.FAKE_UPDATE_PORT || '43130', 10);
const token = process.env.FAKE_UPDATE_TOKEN || '';
const updateVersion = process.env.FAKE_UPDATE_VERSION || '1.1.1';
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('FAKE_UPDATE_PORT를 확인하세요.');
if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('FAKE_UPDATE_TOKEN을 확인하세요.');
if (!/^\d+\.\d+\.\d+$/.test(updateVersion)) throw new Error('FAKE_UPDATE_VERSION을 확인하세요.');

const installer = Buffer.from('packaged-updater-smoke');
const sha512 = createHash('sha512').update(installer).digest('base64');
const installerName = `BrandConnect-Automation-Setup-${updateVersion}.exe`;
const manifest = Buffer.from([
  `version: ${updateVersion}`,
  'files:',
  `  - url: ${installerName}`,
  `    sha512: ${sha512}`,
  `    size: ${installer.length}`,
  `path: ${installerName}`,
  `sha512: ${sha512}`,
  `releaseDate: '${new Date().toISOString()}'`,
  '',
].join('\n'));

function authorized(request) {
  return request.headers.authorization === `Bearer ${token}`;
}

function json(response, status, body) {
  const bytes = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': String(bytes.length),
    'cache-control': 'no-store',
  });
  response.end(bytes);
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url || '/', `http://127.0.0.1:${port}`);
  if (!authorized(request)) {
    console.log(`REQUEST ${request.method} ${url.pathname} auth=denied`);
    json(response, 401, { success: false, error: { message: 'unauthorized' } });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/agent/jobs/claim') {
    console.log('REQUEST POST /api/agent/jobs/claim auth=ok');
    request.resume();
    json(response, 200, { success: true, data: null });
    return;
  }

  if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/updates/windows/latest.yml') {
    console.log(`REQUEST ${request.method} /api/updates/windows/latest.yml auth=ok`);
    response.writeHead(200, {
      'content-type': 'application/yaml; charset=utf-8',
      'content-length': String(manifest.length),
      'cache-control': 'no-store',
    });
    response.end(request.method === 'HEAD' ? undefined : manifest);
    return;
  }

  console.log(`REQUEST ${request.method} ${url.pathname} auth=ok status=404`);
  json(response, 404, { success: false, error: { message: 'not found' } });
});

server.listen(port, '127.0.0.1', () => console.log(`READY ${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
