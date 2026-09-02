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
assert.match(providerSource, /researchMode\?:\s*"disabled"\s*\|\s*"cached"\s*\|\s*"live"/u);
assert.match(providerSource, /webSearchMode:\s*researchMode/u);
assert.match(providerSource, /여행지 사실 확인에만 사용/u);
assert.match(providerSource, /approvalPolicy:\s*"never"/u);
assert.match(providerSource, /local_image/u);
assert.match(providerSource, /detailImages\.slice\(0, 2\)/u);
assert.match(providerSource, /regularImages\.slice\(0, 2\)/u);
assert.match(providerSource, /runStreamed/u);
assert.match(agentSource, /AI_PROVIDER === "codex"/u);
assert.match(agentSource, /CODEX_BROWSER_FALLBACK_ENABLED/u);
assert.match(agentSource, /CODEX_DRAFT_MODEL[^\n]+"gpt-5\.5"/u);
assert.match(agentSource, /처음부터 반드시 5~6개의 완결된 문장/u);
assert.match(routeSource, /const useCodex/u);
assert.match(routeSource, /AI_PROVIDER: useCodex \? "codex" : provider/u);
assert.match(settingsSource, /draftCreationMode: codexDraftEnabled && codexDraft\.authenticated/u);
// 기본 엔진은 OpenAI API 키(Spec-first). Codex 는 설정에서 켜는 선택 경로라 기본값이 false 다.
assert.match(electronSource, /process\.env\.CODEX_DRAFT_ENABLED = process\.env\.CODEX_DRAFT_ENABLED \|\| "false"/u);
assert.match(electronSource, /CODEX_DRAFT_MODEL[^\n]+"gpt-5\.5"/u);
assert.match(settingsSource, /defaultValue: "gpt-5\.5"/u);

console.log(JSON.stringify({
  ok: true,
  bundledCodex: getBundledCodexEntrypoint(),
  bundledNativeCodex: getBundledCodexExecutable(),
  localStatus: readCodexLocalStatus(),
  safety: ["read-only", "network-disabled", "travel-web-search-cached", "approval-never"],
}, null, 2));
