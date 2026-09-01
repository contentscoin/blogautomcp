import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getBundledCodexEntrypoint, getBundledCodexExecutable, readCodexLocalStatus } from "../src/lib/codex-local";

const root = process.cwd();
const providerSource = fs.readFileSync(path.join(root, "scripts/lib/codex-draft-provider.ts"), "utf8");
const agentSource = fs.readFileSync(path.join(root, "scripts/simple-agent.ts"), "utf8");
const routeSource = fs.readFileSync(path.join(root, "src/app/api/brandlinks/[id]/draft/route.ts"), "utf8");
const settingsSource = fs.readFileSync(path.join(root, "src/app/api/settings/route.ts"), "utf8");
const electronSource = fs.readFileSync(path.join(root, "scripts/electron/main.cjs"), "utf8");

assert.ok(getBundledCodexEntrypoint(), "bundled Codex entrypoint must resolve");
assert.ok(getBundledCodexExecutable(), "bundled native Codex executable must resolve");
assert.equal(readCodexLocalStatus().installed, true, "bundled Codex runtime must be installed");
assert.match(providerSource, /sandboxMode:\s*"read-only"/u);
assert.match(providerSource, /networkAccessEnabled:\s*false/u);
assert.match(providerSource, /webSearchMode:\s*"disabled"/u);
assert.match(providerSource, /approvalPolicy:\s*"never"/u);
assert.match(providerSource, /local_image/u);
assert.match(providerSource, /runStreamed/u);
assert.match(agentSource, /AI_PROVIDER === "codex"/u);
assert.match(agentSource, /CODEX_BROWSER_FALLBACK_ENABLED/u);
assert.match(routeSource, /const useCodex/u);
assert.match(routeSource, /AI_PROVIDER: useCodex \? "codex" : provider/u);
assert.match(settingsSource, /draftCreationMode: codexDraftEnabled && codexDraft\.authenticated/u);
assert.match(electronSource, /process\.env\.CODEX_DRAFT_ENABLED = process\.env\.CODEX_DRAFT_ENABLED \|\| "true"/u);

console.log(JSON.stringify({
  ok: true,
  bundledCodex: getBundledCodexEntrypoint(),
  bundledNativeCodex: getBundledCodexExecutable(),
  localStatus: readCodexLocalStatus(),
  safety: ["read-only", "network-disabled", "web-search-disabled", "approval-never"],
}, null, 2));
