# Naver BrandConnect SEO v2 Implementation Report

작성일: 2026-07-02

## Completed

8개 카테고리별 블로그 초안을 역분석해 글쓰기 로직, 카테고리 스타일, QC 룰, OpenCrab workflow v2.4.2, CrabAgent control pack, exact-token retrieval index, dense solo evidence layer, exact pid guard, answer contract, section-density retrieval index를 만들었다.

## Local Artifacts

| Artifact | Path | Role |
| --- | --- | --- |
| SEO Writing Logic v2 | `docs/naver-brandconnect-seo-writing-logic-v2-2026-07-02.md` | 제목/본문/사진/썸네일/Evidence Note 기본 생성 로직 |
| Category Style Guide v2 | `docs/naver-brandconnect-category-style-guide-v2-2026-07-02.md` | 8개 카테고리별 문체, 사진, 금칙 표현, 썸네일 룰 |
| QC Rules v2 | `docs/naver-brandconnect-qc-rules-v2-2026-07-02.md` | 필수 섹션, evidence gate, 금칙 표현, release gate |
| Workflow v2.4.2 JSON | `opencrab-projects/naver-brandconnect-seo/workflows/naver-brandconnect-seo-posting-workflow-v2.json` | OpenCrab 워크플로우 로컬 미러 |
| CrabAgent Control Pack v2.2 | `opencrab-projects/naver-brandconnect-seo/reports/naver-brandconnect-seo-crabagent-v2.2-control-pack-2026-07-02.md` | source-section coverage, ontology nodes/edges, evidence chunks |
| CrabAgent Retrieval Index v2.2.1 | `opencrab-projects/naver-brandconnect-seo/reports/naver-brandconnect-seo-crabagent-v2.2.1-retrieval-index-2026-07-02.md` | exact-token 검색 안정화 색인 |
| Draft Index | `docs/naver-blog-drafts/README-2026-07-02.md` | 8개 초안과 QC 결과 인덱스 |

## OpenCrab Workflow

- workflow name: `Naver BrandConnect SEO Posting Workflow v2`
- workflow id: `eb11f8fa-e868-4bb7-96a2-69ed3798e9c4`
- local workflow mirror: `2.4.2`
- OpenCrab workflow agent updated_at: `2026-07-02T12:36:47.606+00:00`
- status: `active`
- package id: `cfe1fd01-a052-4ec0-a97b-b7f45cd92b9d`
- package version after final event: `1.0.105`
- node count: 10
- edge count: 9

## OpenCrab Pack Updates

| Version | Event | Document | Purpose | Resulting snapshot |
| --- | --- | --- | --- | --- |
| `1.0.96` | `e8fa98e3-369f-4059-a3e9-2a49e81a20ef` | `a57f151f-c655-48b7-9ba5-8051a16368b2` | v2.1 source-lock workflow release | 97 documents, 183 chunks, 1261 nodes, 1164 edges |
| `1.0.97` | `6cf102ab-36d7-457c-aaeb-fbfb1e2db2c2` | `b30b74af-b181-4d67-8685-19a12e254151` | CrabAgent v2.2 source-section control pack | 98 documents, 191 chunks, 1274 nodes, 1176 edges |
| `1.0.98` | `0b87e846-d196-4692-9b0e-18c6c8e6d76c` | `32db0b62-0770-4af6-b36b-8318c6e475a7` | v2.2.1 exact-token retrieval index | 99 documents, 195 chunks, 1287 nodes, 1188 edges |
| `1.0.99` | `e563d215-b472-4cf4-b098-bdf5dcf112a4` | `8feba1fd-081c-4a89-a137-f03cef7ef3a0` | CrabAgent v2.3 dense solo evidence mini index | 100 documents, 203 chunks, 1300 nodes, 1200 edges |
| `1.0.100` | `8cf484cd-13a6-4e40-9e0c-c6050c4b618c` | `9b62c846-5a20-4f90-8361-19afd8507a61` | CrabAgent v2.3.1 exact pid guard | 101 documents, 205 chunks, 1313 nodes, 1212 edges |
| `1.0.101` | `2aa2cd39-339f-4993-9ebf-65702fca4b5f` | `7d490877-5d9b-4e7e-ade9-90816cc5a6a6` | CrabAgent v2.3.2 exact guard answer contract | 102 documents, 209 chunks, 1326 nodes, 1224 edges |
| `1.0.102` | `84b53244-5ae3-4282-af40-df3cfe00cab1` | `ec35c730-5720-41a8-9d98-c2435e59fbbb` | CrabAgent v2.3.2 QC receipt workflow dry-run pass | 103 documents, 212 chunks, 1339 nodes, 1236 edges |
| `1.0.103` | `ba17c8bb-e812-4d9d-8ac9-3bfaff797b41` | `d2a5f217-136a-4f56-8cc0-ffc4aee1c9f6` | CrabAgent v2.4 section-density index | 104 documents, 220 chunks, 1352 nodes, 1248 edges |
| `1.0.104` | `7d50d584-7d56-418c-8fad-ae0c3abc11f8` | `d0795307-58ba-460e-a6db-971d942fb4a9` | CrabAgent v2.4.1 workflow sync and section-density metadata correction | 105 documents, 223 chunks, 1365 nodes, 1260 edges |
| `1.0.105` | `7ee051f5-e968-4be8-a56c-12d3effe6588` | `868d21cd-d186-4ddf-bfb5-60e0b1c15745` | CrabAgent v2.4.2 split-run timeout hardening | 106 documents, 227 chunks, 1378 nodes, 1272 edges |

## Pack QA After Final Update

- grade: `A`
- score: `92`
- release_ready: `true`
- indexed documents: 106
- sampled chunks: 227
- vector coverage sample: 0.965
- evidence document chunk coverage sample: 1
- graph density edges per node: 0.923
- remaining gap: chunk density is workable but still shallow for detailed QA

Interpretation: v2.3/v2.3.1/v2.3.2/v2.4/v2.4.1 improved the pack from B/85 to A/92 while keeping release readiness. v2.4 raised the section-density layer, and v2.4.1 corrected the metadata receipt and synced the workflow to pack 1.0.104. The v2.4.1 snapshot was 105 documents and 223 chunks with vector coverage 0.964. v2.4.2 adds split-run timeout hardening and raises the snapshot to 106 documents and 227 chunks. The remaining gap is not a release blocker; it is a recommendation to keep expanding section-level chunks for detailed QA.

## Important Fix

Initial workflow-run smoke test failed to retrieve the exact product solo chunk. It returned aggregate/general evidence first and reported:

- exact_anchor_present: no
- P/R1/R2/R3/D present: no
- image target: missing
- source-lock rule: missing

Direct project query for the same pid had already proven the canonical chunk existed, so the issue was workflow-run retrieval drift, not pack ingestion failure.

v2.1 fix:

1. Run direct OpenCrab project query first.
2. Extract the exact canonical chunk containing `ANCHOR|CRAB_MICRO_TOP3|pid=<product_id>|priority=1`.
3. Inject the raw chunk into the workflow task as `RAW_CANONICAL_CHUNK`.
4. The workflow parses `RAW_CANONICAL_CHUNK` as source of truth and treats workflow-retrieved evidence as validation context only.

## CrabAgent v2.2 Upgrade

v2.2 converted the v2 writing logic from a summary release note into an operational control layer:

- source docs: 5
- source sections: 42
- ontology nodes: 14
- ontology edges: 17
- evidence chunks: 19
- workflow steps: 10
- quality gate: `CRAB_AGENT_V2_2_QA`

## CrabAgent v2.2.1 Retrieval Fix

After v2.2 ingest, OpenCrab QA passed, but exact-token query did not reliably return `CHUNK_OPERATING_RULE` and `QUALITY_GATE|id=CRAB_AGENT_V2_2_QA` because those identifiers lived near lower chunk boundaries. v2.2.1 adds a short retrieval index so the operational identifiers appear in the first evidence window.

Post-fix exact-token retrieval test passed:

- package version: `1.0.98`
- retrieval index document_id: `32db0b62-0770-4af6-b36b-8318c6e475a7`
- `CHUNK_OPERATING_RULE`: retrievable
- `QUALITY_GATE|id=CRAB_AGENT_V2_2_QA`: retrievable
- first evidence window: pass

## CrabAgent v2.3 Dense Solo Evidence

v2.3 built a local OpenCrab Pack v1 dense solo evidence layer from the 80 canonical solo markdown files.

- source files: 80
- local dense pack evidence chunks: 81
- local dense pack nodes: 254
- local dense pack edges: 323
- local dense pack QC: pass
- local dense bundle: `opencrab-projects/naver-brandconnect-seo/reports/naver-brandconnect-seo-dense-solo-evidence-bundle-v2.3-2026-07-02.md`
- local dense pack folder: `opencrab-projects/naver-brandconnect-seo-dense-solo-v2.3`
- local dense pack ZIP: `opencrab-projects/naver-brandconnect-seo/dist/naver-brandconnect-seo-dense-solo-evidence-v2.3.zip`

CrabAgent ZIP upload sessions were attempted after schema and ZIP compatibility fixes, but the SaaS upload validator returned `Uploaded ZIP is not an OpenCrab cloud pack`. The local pack remains preserved, and the main SaaS package was updated through pack_update instead.

## CrabAgent v2.3.1 Exact PID Guard

v2.3.1 added `CRAB_AGENT_V2_3_1_EXACT_PID_GUARD` after a query for pid `8d6491ab-dcfa-4385-949d-f638a4ff75b7` showed that answer generation could substitute a nearby sports/leisure pid when exact evidence ranked lower. The new rule is:

`requested_pid` must equal both `ANCHOR.pid` and `P.pid`; otherwise return `FAIL_PID_MISMATCH` and continue retrieval.

Post-guard retrieval test passed:

- source_path returned: `docs/opencrab-saas-solo-payloads-2026-07-01/sports_leisure/8d6491ab-dcfa-4385-949d-f638a4ff75b7.md`
- anchor returned: `ANCHOR|CRAB_MICRO_TOP3|pid=8d6491ab-dcfa-4385-949d-f638a4ff75b7|priority=1`
- P.pid returned: `8d6491ab-dcfa-4385-949d-f638a4ff75b7`
- mismatch rule returned: pass

## CrabAgent v2.3.2 Answer Contract

v2.3.2 added `CRAB_AGENT_V2_3_2_ANSWER_CONTRACT` after final QC showed that the evidence object contained the exact pid guard but the natural-language answer could still say mismatch handling was none because the pids matched.

The new answer contract is:

- exact pid match success does not suppress the guard rule
- preflight output must include `source_path`, `requested_pid`, `ANCHOR.pid`, `P.pid`, `guard_rule`, and `guard_status`
- if `guard_rule` is absent, return `FAIL_GUARD_RULE_MISSING` even when pids match
- evidence object text overrides natural-language summary when the two conflict

Post-contract retrieval test passed:

- source_path returned: `docs/opencrab-saas-solo-payloads-2026-07-01/sports_leisure/8d6491ab-dcfa-4385-949d-f638a4ff75b7.md`
- requested_pid returned: `8d6491ab-dcfa-4385-949d-f638a4ff75b7`
- ANCHOR.pid returned: `8d6491ab-dcfa-4385-949d-f638a4ff75b7`
- P.pid returned: `8d6491ab-dcfa-4385-949d-f638a4ff75b7`
- guard_rule returned: `RULE_NO_SIMILAR_PID_SUBSTITUTION_V2_3_2`
- guard_status returned: `pass`

## CrabAgent v2.3.2 QC Receipt

v1.0.102 records the post-update CrabAgent QC receipt after pack QA, exact-pid query, workflow-contract query, and workflow dry-run all passed.

- quality gate: `CRAB_AGENT_V2_3_2_QC_RECEIPT`
- event id: `84b53244-5ae3-4282-af40-df3cfe00cab1`
- document id: `ec35c730-5720-41a8-9d98-c2435e59fbbb`
- pack QA after receipt: `A / 92`, `release_ready=true`
- snapshot after receipt: 103 documents, 212 chunks, 1339 nodes, 1236 edges
- exact pid QC: source_path, ANCHOR.pid, P.pid, guard_rule, and guard_status all passed
- workflow contract QC: source-lock, RAW_CANONICAL_CHUNK, output contract, forbidden-claim QC, category style, image target, Evidence Note, exact pid guard, and answer contract all found
- workflow dry run: 10 steps checked, 10 steps passed, missing_contracts=none

CrabAgent v2.4 section-density sync:

- quality gate: `CRAB_AGENT_V2_4_SECTION_DENSITY_INDEX`
- event id: `ba17c8bb-e812-4d9d-8ac9-3bfaff797b41`
- document id: `d2a5f217-136a-4f56-8cc0-ffc4aee1c9f6`
- local payload: `opencrab-projects/naver-brandconnect-seo/reports/naver-brandconnect-seo-v2.4-section-density-payload-2026-07-02.md`
- source docs: 4
- section chunks: 52
- evidence chunks: 52
- missing sections: 0
- local payload bytes: 56840
- pack QA after update: `A / 92`, `release_ready=true`
- snapshot after update: 104 documents, 220 chunks, 1352 nodes, 1248 edges
- retrieval contracts found: title formula, release gate, QC receipt, and `SECTION_DENSITY_RETRIEVAL`
- SaaS workflow agent synced to v2.4.0 at `2026-07-02T11:45:13.305+00:00`

CrabAgent v2.4.1 correction receipt:

- quality gate: `CRAB_AGENT_V2_4_1_WORKFLOW_SYNC`
- event id: `7d50d584-7d56-418c-8fad-ae0c3abc11f8`
- document id: `d0795307-58ba-460e-a6db-971d942fb4a9`
- correction: `CRAB_AGENT_V2_4_SECTION_DENSITY` -> `CRAB_AGENT_V2_4_SECTION_DENSITY_INDEX`
- corrected local payload bytes: 56840
- final pack QA: `A / 92`, `release_ready=true`
- final snapshot: 105 documents, 223 chunks, 1365 nodes, 1260 edges
- SaaS workflow description synced to pack v1.0.104 at `2026-07-02T11:49:46.207+00:00`

CrabAgent v2.4.2 split-run hardening:

- quality gate: `CRAB_AGENT_V2_4_2_SPLIT_RUN_TIMEOUT_HARDENING`
- event id: `7ee051f5-e968-4be8-a56c-12d3effe6588`
- document id: `868d21cd-d186-4ddf-bfb5-60e0b1c15745`
- observed runtime: workflow runner HTTP 504 on long-form generation for pid `8d6491ab-dcfa-4385-949d-f638a4ff75b7`
- fallback draft: `docs/naver-blog-drafts/2026-07-02-strong-golf-umbrella-sports-leisure-v2.4.1.md`
- comparison: `docs/naver-blog-drafts/2026-07-02-strong-golf-umbrella-v2.4.1-diff.md`
- split stages: `preflight`, `outline`, `body`, `media_qc`, `assemble`
- final snapshot: 106 documents, 227 chunks, 1378 nodes, 1272 edges
- final pack QA: `A / 92`, `release_ready=true`, `vector_coverage_sample=0.965`, `chunks_per_document=2.14`
- SaaS workflow description synced to split-run v2.4.2 at `2026-07-02T12:36:47.606+00:00`

## Smoke Test

Test pid:

`8d6491ab-dcfa-4385-949d-f638a4ff75b7`

Result after RAW_CANONICAL_CHUNK source-lock fix:

- exact_anchor_present: true
- P/R1/R2/R3/D present: true
- image target: 11
- extracted pattern: `사용후기;장점;아쉬운점;추천대상;구매전체크`
- source-lock rule passed: true
- all workflow steps: pass

## Operating Rule

Never run the workflow as a blind generator. Always use this order:

1. Direct project query with exact anchor
2. Verify canonical raw chunk
3. Inject `RAW_CANONICAL_CHUNK`
4. Run workflow v2.4.2 split stages for long-form tasks
5. Run local or workflow QC
6. Save draft with Evidence Note
