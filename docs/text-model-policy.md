# Automated text and vision model policy

The existing `scripts/lib/draft-runtime-policy.json` is the source of the
`gpt-6-luna` model ID and the fixed `low` reasoning effort. `scripts/lib/text-model-policy.ts` applies it to API writing,
style analysis, reviews, image understanding/QC, structured PostSpec output,
humanizing, Codex SDK writing/photo review, and both topic candidate/editorial callers.
Legacy `OPENAI_MODEL`, `OPENAI_VISION_MODEL`, and `TOPIC_PIPELINE_OPENAI_MODEL`
environment values no longer change the model. Explicit conflicting model
arguments fail before provider execution. There is no smaller-model fallback.

## Request compatibility evidence (2026-09-24)

- The Codex CLI 0.156.1 model catalog (bundled in the `@openai/codex` linux-x64
  binary) lists `gpt-6-luna` ("GPT-6-Luna") with text/image input,
  `supported_in_api: true`, and reasoning levels `low`, `medium`, `high`,
  `xhigh`, `max`. There is no `none` level. The catalog's
  `minimal_client_version` is 0.155.0, so `@openai/codex-sdk` is pinned to
  `^0.156.1` (older bundled CLIs report `CODEX_MODEL_INCOMPATIBLE`).
- The installed `openai/resources/chat/completions/completions.d.ts` documents
  `max_completion_tokens` as including reasoning and visible tokens; `max_tokens`
  is deprecated. The installed Codex SDK declares a string `model` option and
  forwards it as CLI `--model`.
- API requests omit `temperature` and `max_tokens` and always send
  `reasoning_effort: low`. Small targets (up to 1024, including QC 600 and
  title 400) add 1024 reasoning tokens to the total cap; longer targets add
  4096, bounded by 128K. This is headroom, not a guarantee of visible output;
  truncated output is rejected.
- Codex SDK requests use the policy effort (`low`) by default. Unsupported SDK
  effort overrides fail before starting the provider.

## Browser and external generation boundaries

A ChatGPT browser session does not reliably attest the selected model. The
automated simple-agent and topic-agent writing calls now use the pinned Codex
provider; Codex errors do not fall back to browser writing. Topic structured
browser fallback executes on pinned Codex as well. The remote topic-craft text
candidate call, whose server model cannot be verified here, now produces the
same candidate envelope through pinned Codex using supplied source summaries.

Browser image generation and OpenAI image models are unchanged. Manual ChatGPT
handoffs, UI session status, and external user-written drafts cannot guarantee
GPT-6 Luna and are not covered by this automated request policy. Legacy browser
writing helpers remain in simple-agent but have no automatic writing callers.

Both former topic CLI callers now use the shared `runCodexDraft` SDK provider:
bundled runtime resolution, read-only sandbox, approval never, network disabled,
explicit model/effort, and bounded retries. Neither directly spawns `--full-auto`,
uses a macOS fallback executable, nor reads temporary output files. The candidate
route releases desktop activity in `finally`, including provider failures.
Provider timeouts follow the shared policy (currently a 60-second minimum).

Candidate envelopes accept raw or fenced JSON. Pipeline candidate normalization
retains content, subtopic subtitle/summary, hashtags and image prompt fields.
Non-object envelopes are rejected. The candidate route validates a nonempty
`topics` array and retains its explicitly labelled local-template fallback.
The optional editorial call retains its existing null-on-failure contract.
No paid generation, account-level model access, or actual response quality was
tested. A request pin does not prove account availability.

## Humanizing contract

The API requests `{ "sections": ["..."] }` and validates nonempty string items
and the exact section count. Malformed output preserves the original sections.
Existing AI-tell score acceptance remains unchanged.

## Offline verification

```powershell
node node_modules/ts-node/dist/bin.js --project tsconfig.scripts.json scripts/verify-text-model-policy.ts
node scripts/verify-codex-model-default.cjs
node node_modules/ts-node/dist/bin.js --project tsconfig.scripts.json scripts/verify-codex-draft-provider.ts
node node_modules/typescript/bin/tsc --project tsconfig.scripts.json --noEmit --pretty false
```

The first two tests mock network/SDK calls. The provider regression also checks
local CLI installation/login status without generating content. Proposed package
script for the coordinating owner: `verify:text-model-policy` using the first
command above. This slice does not edit `package.json`.
