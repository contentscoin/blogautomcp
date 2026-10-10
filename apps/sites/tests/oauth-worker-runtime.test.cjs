const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

const clientId = 'https://chatgpt.com/oauth/client.json';
const redirectUri = 'https://chatgpt.com/connector_platform_oauth_redirect';
const metadata = {
  client_id: clientId,
  redirect_uris: [redirectUri],
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  token_endpoint_auth_method: 'private_key_jwt',
  token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'],
};

function validatorWorker() {
  const filename = path.resolve(__dirname, '../lib/oauth.ts');
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  // Execute the real validator in workerd; persistence and token helpers must
  // remain unused. CommonJS exports stay inside this wrapper because Worker
  // module exports are reserved for handlers and entrypoint classes.
  return `
    const oauth = (() => {
      const module = { exports: {} };
      const exports = module.exports;
      const unused = () => { throw new Error('Unexpected persistence or token helper'); };
      const mocks = {
        '@/db/init': { ensureDatabase: unused },
        '@/db': { getD1: unused },
        '@/lib/crypto': { hashToken: unused, randomToken: unused, safeEqualText: unused },
      };
      const require = name => {
        if (!(name in mocks)) throw new Error('Unexpected dependency: ' + name);
        return mocks[name];
      };
      ${compiled}
      return module.exports;
    })();
    export default {
      async fetch(request, env) {
        const valid = await oauth.validateChatGPTClientMetadata();
        const counts = await (await env.FIXTURE.fetch('https://fixture.invalid/counts')).json();
        return Response.json({ valid, ...counts });
      },
    };
  `;
}

function outboundWorker(mode) {
  const document = mode === 'invalid-client'
    ? { ...metadata, client_id: 'https://untrusted.invalid/client.json' }
    : metadata;
  return `
    let metadataRequests = 0;
    let redirectTargetRequests = 0;
    let unexpectedRequests = 0;
    export default {
      async fetch(request) {
        const url = new URL(request.url);
        if (url.href === 'https://fixture.invalid/counts') {
          return Response.json({ metadataRequests, redirectTargetRequests, unexpectedRequests });
        }
        if (url.href === ${JSON.stringify(clientId)}) {
          metadataRequests++;
          if (${JSON.stringify(mode)} === 'redirect') {
            return new Response(null, { status: 302, headers: { location: 'https://untrusted.invalid/client.json' } });
          }
          return Response.json(${JSON.stringify(document)});
        }
        if (url.href === 'https://untrusted.invalid/client.json') {
          redirectTargetRequests++;
          // A followed redirect must fail the test even if the target supplies
          // an otherwise valid document: only the exact metadata URL is trusted.
          return Response.json(${JSON.stringify(metadata)});
        }
        unexpectedRequests++;
        return new Response(null, { status: 500 });
      },
    };
  `;
}

test('the actual CIMD validator works in workerd and never follows metadata redirects', async t => {
  const script = validatorWorker();
  const modes = ['valid', 'redirect', 'invalid-client'];
  const workers = modes.flatMap(mode => {
    const fixtureName = `fixture-${mode}`;
    return [
      {
        name: `validator-${mode}`,
        script,
        modules: true,
        compatibilityDate: '2026-08-26',
        compatibilityFlags: ['nodejs_compat'],
        // Every outbound request is handled by another in-memory Worker.
        // No live network, account, database or application server is used.
        outboundService: fixtureName,
        serviceBindings: { FIXTURE: fixtureName },
      },
      { name: fixtureName, script: outboundWorker(mode), modules: true, compatibilityDate: '2026-08-26' },
    ];
  });
  const runtime = new Miniflare(convertV4MiniflareOptions({ workers }));
  try {
    for (const mode of modes) {
      await t.test(mode, async () => {
        const worker = await runtime.getWorker(`validator-${mode}`);
        const response = await worker.fetch('https://validator.invalid/');
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
          valid: mode === 'valid',
          metadataRequests: 1,
          redirectTargetRequests: 0,
          unexpectedRequests: 0,
        });
      });
    }
  } finally {
    await runtime.dispose();
  }
});
