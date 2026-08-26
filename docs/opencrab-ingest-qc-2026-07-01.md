# OpenCrab Ingest QC - Naver BrandConnect SEO - 2026-07-01

## Scope

QC target: Naver BrandConnect SEO ontology pack and workflow for product-level Naver Blog top-3 competitor evidence.

Project:
- project_id: `ce86789f-c294-449f-9add-61de752e810b`
- name: `Naver BrandConnect SEO Intelligence`

Primary SaaS package:
- package_id: `cfe1fd01-a052-4ec0-a97b-b7f45cd92b9d`
- title: `naver-brandconnect-seo-ontology-2026-07-01`
- current_version_after_repair: `1.0.95`
- latest_snapshot: `documents=96`, `chunks=179`, `nodes=1248`, `edges=1152`

Workflow:
- workflow_id: `d4032b9b-d616-483a-8361-851f360472fe`
- name: `Naver BrandConnect SEO Posting Workflow`
- updated_at: `2026-07-01T16:08:00.635Z`
- retrieval priority: canonical v2 `ANCHOR|CRAB_MICRO_TOP3|pid=<product_id>|priority=1` solo anchor -> legacy `CRAB_MICRO_TOP3` -> `ATOMIC_ROW` -> `CRAB_COMPACT_TOP3` -> aggregate SEO rules
- runtime condition: use `top_k_per_node >= 40` for product-level QC/writing runs after pack version `1.0.65`
- required solo anchor format: `ANCHOR|CRAB_MICRO_TOP3|pid=<product_id>|priority=1`
- duplicate pid rule: if legacy/compact evidence scores higher but canonical v2 is present, the workflow must select canonical v2 as final evidence
- top-k note: `top_k_per_node=12` can miss canonical solo anchors as the pack grows; this was observed on `food_supplement` representative pid `f1ea0243-3271-4c96-8f02-f59cdfa2dc56`, while `top_k_per_node=40` passed

## Repair History

1. Initial SaaS ingest was too shallow for product-level QC.
   - The first package mainly exposed aggregate SEO patterns.
   - It did not reliably expose exact product top-3 URLs, titles, images, body length, headings, keyword-density facts, or writing deltas.

2. Dreame L10s Ultra Gen3 was repaired first.
   - Version `1.0.1`: product-level top-3 evidence.
   - Version `1.0.2`: atomic top-3 rows.
   - Direct QC can retrieve rank 1-3 and writing delta for this product.

3. Category compact evidence was staged into the SaaS package.
   - Version `1.0.3`: `home_appliance`
   - Version `1.0.4`: `digital_it`
   - Version `1.0.5`: `beauty_body`
   - Version `1.0.6`: `living_health`
   - Version `1.0.7`: `food_supplement`
   - Version `1.0.8`: `sports_leisure`
   - Version `1.0.9`: `fashion_goods`
   - Version `1.0.10`: `baby_pet`

4. Product-level micro-index sources were generated locally.
   - generator: `scripts/generate-opencrab-saas-micro-repair.mjs`
   - output_dir: `docs/opencrab-saas-micro-repair-2026-07-01`
   - category files: 8
   - products covered: 80
   - slot_size: `900`
   - max_micro_doc_chars: `814`
   - all_micro_docs_fit_slot: `true`
   - format: `CRAB_MICRO_TOP3 pid=<product_id>` with one `P` row, three `R` rows, and one `D` row per product.

5. Representative SaaS micro-index rows were staged into the package.
   - Version `1.0.11`
   - event_id: `9c47abb5-08de-4a31-a4ed-508c451f12c4`
   - document_id: `30873532-17c1-4ca3-b567-215ee6fa16d3`
   - ingested representative products: 7
   - added_chunks: 7
   - added_nodes: 13
   - added_edges: 12

6. Solo beauty pid anchor was staged after workflow retrieval still preferred compact evidence.
   - Version `1.0.12`
   - event_id: `fe848c78-5bdc-407a-9d0d-34a649679a63`
   - document_id: `0fdd9934-1fbf-4c68-92c4-425b85b15a02`
   - product_id: `02954d99-0510-481e-b099-77cc8d2af88f`
   - added_chunks: 2
   - added_nodes: 13
   - added_edges: 12
   - purpose: add a single-pid `CRAB_MICRO_TOP3` anchor that outranks compact evidence for workflow retrieval.

7. Workflow instructions were updated.
   - Competitor analysis now prioritizes `CRAB_MICRO_TOP3 pid=<product_id>`.
   - `ATOMIC_ROW rank=1..3` is fallback evidence.
   - `CRAB_COMPACT_TOP3` and aggregate SEO rules are supporting context only.
   - Missing fields must be marked as missing instead of inferred.
   - `D` rows are used for title, heading, keyword, image, thumbnail, and publishing QA decisions.
   - Product-level workflow runs initially used `top_k_per_node >= 12`; after version `1.0.65`, use `top_k_per_node >= 40`.

8. A full `home_appliance` category micro batch was tested and rejected as the production repair path.
   - Version `1.0.13`
   - event_id: `7cd08dcf-f32f-42c2-96dc-043b7e27a9d5`
   - document_id: `390323d3-f8c7-46f8-b794-b45a3743d9bc`
   - snapshot: `documents=14`, `chunks=97`, `nodes=182`, `edges=168`
   - issue: the 10-product category file produced only `8` added chunks.
   - failed probe: pid `413765d6-98b0-442f-b777-b9db583e2e6a` was still not retrievable even at `top_k=80`.
   - conclusion: category-level micro batches are not reliable for full product coverage through the SaaS update path.

9. The failed home-appliance pid was repaired with a product-level solo anchor.
   - Version `1.0.14`
   - event_id: `d4e135c8-9ff5-4e6e-951b-67d7525d9435`
   - document_id: `af2910f6-ffd4-4b17-8fbb-d1db24db8dfa`
   - added_chunks: `1`
   - direct project QC: `P`, `R1`, `R2`, `R3`, and `D` present.
   - workflow QC issue: the workflow still preferred the older beauty solo anchor because the first home solo anchor used a weak `A|solo=Y` signal.

10. The same pid was repaired again with a stronger compact anchor.
   - Version `1.0.15`
   - event_id: `f07252fb-8a5e-415e-b86c-2dad38e956af`
   - document_id: `e135855d-c5be-463e-a572-aa081c802bf7`
   - added_chunks: `1`
   - anchor line: `ANCHOR|CRAB_MICRO_TOP3|pid=413765d6-98b0-442f-b777-b9db583e2e6a|priority=1`
   - workflow QC with `top_k_per_node=12`: all workflow steps returned `P`, `R1`, `R2`, `R3`, and `D` present from the correct solo source.

11. The full `baby_pet` category was ingested as strengthened product-level solo anchors.
   - Versions: `1.0.16` through `1.0.25`
   - products: 10
   - expected rows per product: `ANCHOR`, `P`, `R1`, `R2`, `R3`, `D`
   - observed ingest result: every product update added exactly `1` chunk, `13` nodes, and `12` edges.
   - final batch snapshot: `documents=26`, `chunks=109`, `nodes=338`, `edges=312`
   - direct project QC for pid `181e8f0e-4380-4926-bc7e-bd64d54fb8d7`: `ANCHOR/P/R1/R2/R3/D` present.
   - workflow QC with `top_k_per_node=12`: all workflow steps confirmed `ANCHOR/P/R1/R2/R3/D` present from the strengthened solo source.

12. The full `beauty_body` category was ingested as strengthened product-level solo anchors.
   - Versions: `1.0.26` through `1.0.35`
   - products: 10
   - expected rows per product: `ANCHOR`, `P`, `R1`, `R2`, `R3`, `D`
   - observed ingest result: every product update added exactly `1` chunk, `13` nodes, and `12` edges.
   - final batch snapshot: `documents=36`, `chunks=119`, `nodes=468`, `edges=432`
   - direct project QC for pid `02954d99-0510-481e-b099-77cc8d2af88f`: `ANCHOR/P/R1/R2/R3/D` present.
   - workflow QC before workflow rule update: canonical v2 was retrieved, but legacy `solo beauty pid exact anchor` ranked above it.
   - workflow was updated to select canonical v2 when duplicate pid evidence exists, even if legacy/compact evidence has a higher vector score.
   - workflow QC after update with `top_k_per_node=12`: all workflow steps selected canonical v2 `solo beauty_body pid 02954d99-0510-481e-b099-77cc8d2af88f`.
   - data quality note: pid `0d4f0c07-4a81-4887-aa8f-558c950fc808` is queued under `beauty_body`, but product/query terms indicate a pet-food taxonomy mismatch.

13. The full `digital_it` category was ingested as strengthened product-level solo anchors.
   - Versions: `1.0.36` through `1.0.45`
   - products: 10
   - expected rows per product: `ANCHOR`, `P`, `R1`, `R2`, `R3`, `D`
   - observed ingest result: every product update added exactly `1` chunk, `13` nodes, and `12` edges.
   - final batch snapshot: `documents=46`, `chunks=129`, `nodes=598`, `edges=552`
   - direct project QC for pid `23ff46db-0f93-4cf8-ba47-e87ac7ae789a`: `ANCHOR/P/R1/R2/R3/D` present.
   - workflow QC with `top_k_per_node=12`: all workflow steps selected canonical v2 `solo digital_it pid 23ff46db-0f93-4cf8-ba47-e87ac7ae789a`, even though compact evidence ranked higher by vector score.

14. The full `fashion_goods` category was ingested as strengthened product-level solo anchors.
   - Versions: `1.0.46` through `1.0.55`
   - products: 10
   - expected rows per product: `ANCHOR`, `P`, `R1`, `R2`, `R3`, `D`
   - observed ingest result: every product update added exactly `1` chunk, `13` nodes, and `12` edges.
   - final batch snapshot: `documents=56`, `chunks=139`, `nodes=728`, `edges=672`
   - direct project QC for pid `52c82315-45b4-4b46-bcde-60790aa010a0`: `ANCHOR/P/R1/R2/R3/D` present.
   - direct project QC retrieved compact `fashion_goods` evidence above canonical solo evidence, confirming again that vector score order alone is not sufficient.
   - workflow QC with `top_k_per_node=12`: all workflow steps selected canonical v2 `solo fashion_goods pid 52c82315-45b4-4b46-bcde-60790aa010a0`.
   - data quality note: pid `da968cae-fd23-47d1-b57a-3a1141abb574` has `D|img=355` in source evidence; preserve it as evidence, but treat it as an outlier rather than an image-count writing baseline.

15. The full `food_supplement` category was ingested as strengthened product-level solo anchors.
   - Versions: `1.0.56` through `1.0.65`
   - products: 10
   - expected rows per product: `ANCHOR`, `P`, `R1`, `R2`, `R3`, `D`
   - observed ingest result: every product update added exactly `1` chunk, `13` nodes, and `12` edges.
   - final batch snapshot: `documents=66`, `chunks=149`, `nodes=858`, `edges=792`
   - direct project QC for pid `f1ea0243-3271-4c96-8f02-f59cdfa2dc56`: canonical v2 solo source was retrieved and `ANCHOR/P/R1/R2/R3/D` were present.
   - workflow QC with `top_k_per_node=12`: failed; canonical v2 was not retrieved and compact/aggregate evidence dominated.
   - workflow QC with `top_k_per_node=40`: passed; canonical v2 `solo food_supplement pid f1ea0243-3271-4c96-8f02-f59cdfa2dc56` was selected in all workflow steps.
   - workflow description and local workflow metadata were updated to recommend `top_k_per_node >= 40` after pack version `1.0.65`.
   - data quality notes: pid `56bdcdea-8bac-43b2-9b05-91029548d4e1` appears to be a coffee grinder despite the `food_supplement` queue; pid `25a3e33f-8fb0-458e-84de-d466653bc949` appears to be skincare retinol despite the `food_supplement` queue; pid `d891dda1-0c2e-4d03-a382-e608f8ae8a12` has a very low R1 body/image record in source evidence.

16. The full `home_appliance` category was ingested as strengthened product-level solo anchors.
   - Versions: `1.0.66` through `1.0.75`
   - products: 10
   - expected rows per product: `ANCHOR`, `P`, `R1`, `R2`, `R3`, `D`
   - observed ingest result: every product update added exactly `1` chunk, `13` nodes, and `12` edges.
   - final batch snapshot: `documents=76`, `chunks=159`, `nodes=988`, `edges=912`
   - direct project QC for pid `413765d6-98b0-442f-b777-b9db583e2e6a`: canonical v2 was retrieved and `ANCHOR/P/R1/R2/R3/D` were present, but legacy duplicate home anchors can rank above the newest canonical source.
   - workflow QC with `top_k_per_node=40`: passed; literal `ANCHOR|CRAB_MICRO_TOP3|pid=<product_id>|priority=1` evidence was selected and `ANCHOR/P/R1/R2/R3/D` were present.
   - data quality notes: pid `2e375065-a495-4fba-85a8-a12582c66178` appears to contain a fan-like R3 result while the target is a vacuum; pid `b12bd043-e807-4e98-9918-737650942261` has a very low R2 body/image record; pid `47a107e6-c564-4311-a045-5caa29bd98b5` has a very low R1 body/image record.

17. The full `living_health` category was ingested as strengthened product-level solo anchors.
   - Versions: `1.0.76` through `1.0.85`
   - products: 10
   - expected rows per product: `ANCHOR`, `P`, `R1`, `R2`, `R3`, `D`
   - observed ingest result: every product update added exactly `1` chunk, `13` nodes, and `12` edges.
   - final batch snapshot: `documents=86`, `chunks=169`, `nodes=1118`, `edges=1032`
   - direct project QC for pid `4965c80b-e6e0-43a3-9698-7cb8a341c9da`: canonical v2 was retrieved and `ANCHOR/P/R1/R2/R3/D` were present, but compact `living_health` evidence ranked higher in the direct evidence list.
   - workflow QC with `top_k_per_node=40`: passed; canonical v2 `solo living_health pid 4965c80b-e6e0-43a3-9698-7cb8a341c9da` was selected first and `ANCHOR/P/R1/R2/R3/D` were present.
   - pack QA after `1.0.85`: grade `B`, score `85`, release_ready `true`; structural warning is low chunk density, not missing product rows.
   - data quality notes: pid `ce4dc698-467a-4251-8020-808c35ae20a2` has an empty R2 keyword field; pid `cfb945c2-85b7-4493-a166-889e5e1b19a9` has a low R3 image/body record; pid `ccfc8961-ae2f-4959-8e6b-7d0131e891d9` has a low R1 image/body record; several Hetras diffuser variants share overlapping competitor rows and require exact product/capacity/set-quantity disambiguation in production writing.

18. The full `sports_leisure` category was ingested as strengthened product-level solo anchors.
   - Versions: `1.0.86` through `1.0.95`
   - products: 10
   - expected rows per product: `ANCHOR`, `P`, `R1`, `R2`, `R3`, `D`
   - observed ingest result: every product update added exactly `1` chunk, `13` nodes, and `12` edges.
   - final batch snapshot: `documents=96`, `chunks=179`, `nodes=1248`, `edges=1152`
   - direct project QC for pid `8d6491ab-dcfa-4385-949d-f638a4ff75b7`: canonical v2 was retrieved and `ANCHOR/P/R1/R2/R3/D` were present, but compact `sports_leisure` evidence ranked higher in the direct evidence list.
   - workflow QC with `top_k_per_node=40`: passed; canonical v2 `solo sports_leisure pid 8d6491ab-dcfa-4385-949d-f638a4ff75b7` was selected first and `ANCHOR/P/R1/R2/R3/D` were present.
   - final pack QA after `1.0.95`: grade `B`, score `85`, release_ready `true`; structural warning remains low chunk density because the SaaS fallback path uses many one-chunk solo documents.
   - data quality notes: pid `8d6491ab-dcfa-4385-949d-f638a4ff75b7` has a low R2 image-count record; pid `62149951-4368-48f6-9841-9d50a9d69a95` has an empty R2 keyword field; pid `e7bb0d5e-1cd8-4d0b-916a-6a38765e278a` has a low R3 image/body record; pid `97241bd4-8d13-4b80-99e2-7ba1946f042b` has a very low R3 body-length record.

## Local Source QC

Local canonical full-evidence pack is internally clean:
- path: `opencrab-projects/naver-brandconnect-seo-canonical`
- zip: `opencrab-projects/naver-brandconnect-seo-canonical/dist/naver-brandconnect-seo-canonical-full-evidence-2026-07-01.zip`
- pack_id: `naver-brandconnect-seo-canonical-full-evidence-2026-07-01`
- documents: 2
- evidence chunks: 321
- nodes: 1032
- edges: 9770
- invalid nodes: 0
- invalid edges: 0
- broken edges: 0
- missing evidence refs: 0
- edge evidence coverage: 1.0
- relationship evidence coverage: 1.0
- graph reference integrity: 1.0

Local compact SaaS repair sources pass row-level checks:
- source_dir: `docs/opencrab-saas-compact-repair-2026-07-01`
- category batches: 8
- products covered: 80
- expected per product: 3 `R` rows + 1 `D` row
- local parser result: `products=80`, `bad=0`

Local micro SaaS repair sources pass slot-level checks:
- source_dir: `docs/opencrab-saas-micro-repair-2026-07-01`
- category batches: 8
- products covered: 80
- expected per product: 1 `P` row + 3 `R` rows + 1 `D` row
- each micro-doc fits within a 900-character slot
- generated Korean fields render correctly in local UTF-8 files

Local solo SaaS payload sources pass product-level checks:
- generator: `scripts/generate-opencrab-saas-solo-payloads.mjs`
- source_dir: `docs/opencrab-saas-solo-payloads-2026-07-01`
- jsonl_queue: `docs/opencrab-saas-solo-payloads-2026-07-01/solo-payloads.jsonl`
- product markdown files: 80
- category count: 8
- suggested SaaS update versions after original `1.0.15`: `1.0.16` through `1.0.95`
- completed SaaS solo-anchor range: `1.0.16` through `1.0.95` (`baby_pet`, `beauty_body`, `digital_it`, `fashion_goods`, `food_supplement`, `home_appliance`, `living_health`, `sports_leisure`, 80 products)
- remaining SaaS solo-anchor range: none (0 products)
- max_solo_doc_chars: `890`
- all_solo_docs_fit_900_chars: `true`
- required rows per product: `ANCHOR`, `P`, `R1`, `R2`, `R3`, `D`
- required anchor format: `ANCHOR|CRAB_MICRO_TOP3|pid=<product_id>|priority=1`

## OpenCrab SaaS QC

Package search confirmed the latest SaaS state:
- version: `1.0.95`
- documents: 96
- chunks: 179
- nodes: 1248
- edges: 1152

OpenCrab `pack_qa` structural assessment before micro-index repair:
- grade: `A`
- score: `100`
- release_ready: `true`
- sampled_chunks: 80
- average_chunk_chars: 892
- vector_coverage_sample: 0.9
- evidence_document_chunk_coverage_sample: 1
- graph_density_edges_per_node: 0.923
- reported gaps: none

OpenCrab `pack_qa` structural assessment after version `1.0.12`:
- grade: `A`
- score: `100`
- release_ready: `true`
- sampled_chunks: 89
- average_chunk_chars: 884
- vector_coverage_sample: 0.91
- evidence_document_chunk_coverage_sample: 1
- graph_density_edges_per_node: 0.923
- reported gaps: none

OpenCrab `pack_qa` final structural assessment after version `1.0.15`:
- grade: `A`
- score: `100`
- release_ready: `true`
- sampled_chunks: 99
- average_chunk_chars: 884
- vector_coverage_sample: 0.919
- evidence_document_chunk_coverage_sample: 1
- graph_density_edges_per_node: 0.923
- reported gaps: none

OpenCrab `pack_qa` final structural assessment after version `1.0.25`:
- grade: `A`
- score: `100`
- release_ready: `true`
- sampled_chunks: 109
- average_chunk_chars: 879
- vector_coverage_sample: 0.927
- evidence_document_chunk_coverage_sample: 1
- graph_density_edges_per_node: 0.923
- reported gaps: none

OpenCrab `pack_qa` structural assessment after version `1.0.35` and workflow canonical v2 update:
- grade: `A`
- score: `92`
- release_ready: `true`
- sampled_chunks: 119
- average_chunk_chars: 875
- vector_coverage_sample: 0.933
- evidence_document_chunk_coverage_sample: 1
- graph_density_edges_per_node: 0.923
- reported gap: chunk density is workable but still shallow for detailed QA

OpenCrab `pack_qa` structural assessment after version `1.0.45`:
- grade: `A`
- score: `92`
- release_ready: `true`
- sampled_chunks: 129
- average_chunk_chars: 873
- vector_coverage_sample: 0.938
- evidence_document_chunk_coverage_sample: 1
- graph_density_edges_per_node: 0.923
- reported gap: chunk density is workable but still shallow for detailed QA

OpenCrab `pack_qa` structural assessment after version `1.0.55`:
- grade: `A`
- score: `92`
- release_ready: `true`
- sampled_chunks: 139
- average_chunk_chars: 869
- vector_coverage_sample: 0.942
- evidence_document_chunk_coverage_sample: 1
- graph_density_edges_per_node: 0.923
- reported gap: chunk density is workable but still shallow for detailed QA

OpenCrab `pack_qa` structural assessment after version `1.0.65`:
- grade: `A`
- score: `92`
- release_ready: `true`
- sampled_chunks: 149
- average_chunk_chars: 865
- vector_coverage_sample: 0.946
- evidence_document_chunk_coverage_sample: 1
- graph_density_edges_per_node: 0.923
- reported gap: chunk density is workable but still shallow for detailed QA

OpenCrab `pack_qa` structural assessment after version `1.0.75`:
- grade: `A`
- score: `92`
- release_ready: `true`
- indexed_documents: 76
- selected_document_ids: 76
- selected_node_ids: 988
- selected_edge_ids: 912
- sampled_chunks: 159
- chunks_per_document: 2.09
- average_chunk_chars: 864
- vector_coverage_sample: 0.95
- evidence_document_chunk_coverage_sample: 1
- graph_density_edges_per_node: 0.923
- reported gap: chunk density is workable but still shallow for detailed QA

OpenCrab `pack_qa` structural assessment after version `1.0.85`:
- grade: `B`
- score: `85`
- release_ready: `true`
- indexed_documents: 86
- selected_document_ids: 86
- selected_node_ids: 1118
- selected_edge_ids: 1032
- sampled_chunks: 169
- chunks_per_document: 1.97
- average_chunk_chars: 863
- vector_coverage_sample: 0.953
- evidence_document_chunk_coverage_sample: 1
- graph_density_edges_per_node: 0.923
- reported gap: chunk density is too low for reliable grounded answers
- interpretation: structural grade dropped because the SaaS fallback path adds many one-chunk solo documents; product-level workflow QC still passed for the representative pid.

OpenCrab `pack_qa` final structural assessment after version `1.0.95`:
- grade: `B`
- score: `85`
- release_ready: `true`
- indexed_documents: 96
- selected_document_ids: 96
- selected_node_ids: 1248
- selected_edge_ids: 1152
- sampled_chunks: 179
- chunks_per_document: 1.86
- average_chunk_chars: 861
- vector_coverage_sample: 0.955
- evidence_document_chunk_coverage_sample: 1
- graph_density_edges_per_node: 0.923
- reported gap: chunk density is too low for reliable grounded answers
- interpretation: all 80 product solo anchors are present, but structural QA still prefers a future full Desktop-built pack or richer semantic chunking over the one-chunk-per-product SaaS fallback.

Important interpretation: structural pack QA can pass while exact product-answerability still fails. The product-level probes below are therefore the release-critical gate for this SEO workflow.

## Product-Level Retrieval Spot Check

Representative pid set:
- `home_appliance`: `f1187508-de13-4923-8573-e1be2602ac83`
- `digital_it`: `23ff46db-0f93-4cf8-ba47-e87ac7ae789a`
- `beauty_body`: `02954d99-0510-481e-b099-77cc8d2af88f`
- `living_health`: `4965c80b-e6e0-43a3-9698-7cb8a341c9da`
- `food_supplement`: `f1ea0243-3271-4c96-8f02-f59cdfa2dc56`
- `sports_leisure`: `8d6491ab-dcfa-4385-949d-f638a4ff75b7`
- `fashion_goods`: `52c82315-45b4-4b46-bcde-60790aa010a0`
- `baby_pet`: `181e8f0e-4380-4926-bc7e-bd64d54fb8d7`

Pre-micro observed result:
- Dreame / `home_appliance` passed because it has extra atomic repair rows.
- Other representative pids retrieved correct category evidence chunks, but answer synthesis often marked rank 3 or `D` rows as missing.
- A single-pid retest for `digital_it` still missed rank 3 and `D`, even though the local compact source contains them.

Pre-micro root cause:
- Compact category documents are indexed, but long product blocks are split around the 892-character evidence chunk boundary.
- The first retrieved chunk often stops in the middle of rank 2; rank 3 and `D` can land in continuation chunks that are not reliably pulled into the final answer.

Post-micro observed result at version `1.0.11`:
- Single-pid queries that explicitly ask for `CRAB_MICRO_TOP3 pid=<product_id>` retrieve the full `P/R1/R2/R3/D` micro row for staged representative products.
- Verified individual passes: `digital_it`, `beauty_body`, `living_health`, `food_supplement`, `sports_leisure`, `fashion_goods`, `baby_pet`.
- Multi-pid aggregate queries still sometimes prefer older compact chunks unless the prompt explicitly prioritizes `CRAB_MICRO_TOP3`.

Post-solo-anchor observed result at version `1.0.12`:
- Direct project query for beauty pid `02954d99-0510-481e-b099-77cc8d2af88f` retrieved source `2026-07-01 micro-index repair: solo beauty pid exact anchor`.
- Direct project query confirmed `P`, `R1`, `R2`, `R3`, and `D` are present.
- Workflow run with `top_k_per_node=12` returned `P/R1/R2/R3/D`, no missing rows, and used `CRAB_MICRO_TOP3` evidence.
- Workflow run with `top_k_per_node=4` is still risky because compact evidence can rank above micro evidence.

Category-batch observed result at version `1.0.13`:
- Full `home_appliance` micro category batch was ingested.
- The update added only `8` chunks for `10` products.
- Exact pid `413765d6-98b0-442f-b777-b9db583e2e6a` still failed retrieval at `top_k=80`.
- This proves slot-aligned category documents are not a sufficient repair path in the current SaaS update interface.

Home solo-anchor observed result at versions `1.0.14` and `1.0.15`:
- Version `1.0.14` direct project query retrieved the failed home pid and confirmed `P/R1/R2/R3/D`.
- Version `1.0.14` workflow run still preferred the older beauty solo anchor when the home anchor used only `A|solo=Y|qc=anchor`.
- Version `1.0.15` replaced the weak anchor with `ANCHOR|CRAB_MICRO_TOP3|pid=<product_id>|priority=1`.
- Version `1.0.15` workflow run with `top_k_per_node=12` retrieved the correct home pid source first.
- Final workflow QC result: all steps confirmed `P`, `R1`, `R2`, `R3`, and `D` present for pid `413765d6-98b0-442f-b777-b9db583e2e6a`.

Baby/pet solo-anchor observed result at versions `1.0.16` through `1.0.25`:
- All 10 `baby_pet` products were ingested as one product-level solo document per update.
- Each update added exactly one evidence chunk.
- Direct project QC for representative pid `181e8f0e-4380-4926-bc7e-bd64d54fb8d7` returned `ANCHOR/P/R1/R2/R3/D` present.
- Workflow QC with `top_k_per_node=12` returned `ANCHOR/P/R1/R2/R3/D` present in all workflow steps.
- The first workflow evidence source for the representative pid was the strengthened solo source, not the older compact batch.

Beauty/body solo-anchor observed result at versions `1.0.26` through `1.0.35`:
- All 10 `beauty_body` products were ingested as one product-level solo document per update.
- Each update added exactly one evidence chunk.
- Direct project QC for representative pid `02954d99-0510-481e-b099-77cc8d2af88f` returned `ANCHOR/P/R1/R2/R3/D` present.
- Workflow QC before workflow update retrieved the canonical v2 source, but legacy `solo beauty pid exact anchor` ranked above it.
- Workflow instructions were updated to choose canonical v2 `ANCHOR|CRAB_MICRO_TOP3|pid=<product_id>|priority=1` when duplicate pid evidence appears.
- Workflow QC after update selected canonical v2 as final evidence in all workflow steps.
- One queued item, pid `0d4f0c07-4a81-4887-aa8f-558c950fc808`, should be reviewed before production writing because the product/query text appears to be pet-food related despite the `beauty_body` queue/category.

Digital/IT solo-anchor observed result at versions `1.0.36` through `1.0.45`:
- All 10 `digital_it` products were ingested as one product-level solo document per update.
- Each update added exactly one evidence chunk.
- Direct project QC for representative pid `23ff46db-0f93-4cf8-ba47-e87ac7ae789a` returned `ANCHOR/P/R1/R2/R3/D` present.
- Direct query still ranked compact `digital_it` evidence above canonical solo evidence, which confirms that score order alone is not sufficient.
- Workflow QC with canonical v2 priority selected the `solo digital_it pid 23ff46db-0f93-4cf8-ba47-e87ac7ae789a` source as final evidence in every workflow step.

Fashion/goods solo-anchor observed result at versions `1.0.46` through `1.0.55`:
- All 10 `fashion_goods` products were ingested as one product-level solo document per update.
- Each update added exactly one evidence chunk.
- Direct project QC for representative pid `52c82315-45b4-4b46-bcde-60790aa010a0` returned `ANCHOR/P/R1/R2/R3/D` present.
- Direct query still ranked compact `fashion_goods` evidence above canonical solo evidence, which confirms that score order alone is not sufficient.
- Workflow QC with canonical v2 priority selected the `solo fashion_goods pid 52c82315-45b4-4b46-bcde-60790aa010a0` source as final evidence in every workflow step.
- Outlier note: pid `da968cae-fd23-47d1-b57a-3a1141abb574` has `D|img=355`; writing logic should keep this as evidence but cap/interpret image targets through category medians, p75, and non-outlier competitor patterns.

Food/supplement solo-anchor observed result at versions `1.0.56` through `1.0.65`:
- All 10 `food_supplement` products were ingested as one product-level solo document per update.
- Each update added exactly one evidence chunk.
- Direct project QC for representative pid `f1ea0243-3271-4c96-8f02-f59cdfa2dc56` returned canonical v2 and `ANCHOR/P/R1/R2/R3/D` present.
- Workflow QC with `top_k_per_node=12` failed to retrieve canonical v2; compact/aggregate evidence and unrelated older repairs dominated.
- Workflow QC with `top_k_per_node=40` selected the canonical v2 source as evidence `[1]` in all workflow steps and confirmed `ANCHOR/P/R1/R2/R3/D` present.
- Operational change: use `top_k_per_node >= 40` for product-level writing/QC after pack version `1.0.65`.
- Category anomaly notes: pid `56bdcdea-8bac-43b2-9b05-91029548d4e1` has coffee-grinder terms; pid `25a3e33f-8fb0-458e-84de-d466653bc949` has skincare retinol terms; preserve source evidence and avoid relying only on queue category for writing.

Home/appliance solo-anchor observed result at versions `1.0.66` through `1.0.75`:
- All 10 `home_appliance` products were ingested as one product-level solo document per update.
- Each update added exactly one evidence chunk.
- Direct project QC for representative pid `413765d6-98b0-442f-b777-b9db583e2e6a` returned canonical v2 and `ANCHOR/P/R1/R2/R3/D` present.
- Direct query can still rank legacy duplicate home anchors above the newest canonical source, so rank order alone is not sufficient for evidence selection.
- Workflow QC with `top_k_per_node=40` selected literal `ANCHOR|CRAB_MICRO_TOP3|pid=<product_id>|priority=1` evidence and confirmed `ANCHOR/P/R1/R2/R3/D` present.
- Operational rule: for duplicate home pid evidence, use literal `ANCHOR` canonical v2 sources first; treat old `A|solo=Y` evidence as fallback only.
- Category anomaly notes: pid `2e375065-a495-4fba-85a8-a12582c66178` has a fan-like R3 result for a vacuum target; pid `b12bd043-e807-4e98-9918-737650942261` and pid `47a107e6-c564-4311-a045-5caa29bd98b5` have very low source-count rows that should be preserved but not overfit as writing baselines.

Living/health solo-anchor observed result at versions `1.0.76` through `1.0.85`:
- All 10 `living_health` products were ingested as one product-level solo document per update.
- Each update added exactly one evidence chunk.
- Direct project QC for representative pid `4965c80b-e6e0-43a3-9698-7cb8a341c9da` returned canonical v2 and `ANCHOR/P/R1/R2/R3/D` present.
- Direct query ranked compact `living_health` evidence above canonical v2, which confirms again that score order alone is not sufficient.
- Workflow QC with `top_k_per_node=40` selected canonical v2 first and confirmed `ANCHOR/P/R1/R2/R3/D` present.
- Operational rule: keep using exact pid + literal `ANCHOR` + `top_k_per_node >= 40`; for repeated Hetras diffuser variants, add explicit product-name/capacity/set-quantity constraints in the writing task.
- Category anomaly notes: empty keyword field on pid `ce4dc698-467a-4251-8020-808c35ae20a2` R2; low source-count rows on pid `cfb945c2-85b7-4493-a166-889e5e1b19a9` R3 and pid `ccfc8961-ae2f-4959-8e6b-7d0131e891d9` R1; preserve source evidence and avoid inventing missing keywords.

Sports/leisure solo-anchor observed result at versions `1.0.86` through `1.0.95`:
- All 10 `sports_leisure` products were ingested as one product-level solo document per update.
- Each update added exactly one evidence chunk.
- Direct project QC for representative pid `8d6491ab-dcfa-4385-949d-f638a4ff75b7` returned canonical v2 and `ANCHOR/P/R1/R2/R3/D` present.
- Direct query ranked compact `sports_leisure` evidence above canonical v2, which confirms again that score order alone is not sufficient.
- Workflow QC with `top_k_per_node=40` selected canonical v2 first and confirmed `ANCHOR/P/R1/R2/R3/D` present.
- Operational rule: keep exact pid + literal `ANCHOR` + `top_k_per_node >= 40` for production writing; compact category evidence is supporting context, not final product evidence.
- Category anomaly notes: low source-count rows on pid `8d6491ab-dcfa-4385-949d-f638a4ff75b7` R2, pid `e7bb0d5e-1cd8-4d0b-916a-6a38765e278a` R3, and pid `97241bd4-8d13-4b80-99e2-7ba1946f042b` R3; empty keyword field on pid `62149951-4368-48f6-9841-9d50a9d69a95` R2.

Current interpretation:
- The local micro-index design fixes the chunk-boundary issue.
- The SaaS package currently contains representative micro rows, one legacy solo anchored beauty row, one tested category batch, older home repair anchors, and complete 10-product strengthened solo batches for all 8 categories: `baby_pet`, `beauty_body`, `digital_it`, `fashion_goods`, `food_supplement`, `home_appliance`, `living_health`, and `sports_leisure`.
- The workflow has been updated so future writing tasks explicitly retrieve canonical v2 `CRAB_MICRO_TOP3` first and run with `top_k_per_node >= 40`.
- For reliable workflow retrieval, solo rows must include `ANCHOR|CRAB_MICRO_TOP3|pid=<product_id>|priority=1`.

## Upload Blocker

CrabAgent SaaS upload still rejects locally built ZIPs with:

`Uploaded ZIP is not an OpenCrab cloud pack.`

Reproduced with:
- original local Pack v1 ZIP
- canonical grammar ZIP
- canonical ZIP after adding `cloud_pack_version=opencrab-cloud-pack-v1`
- canonical ZIP after fixing all edge evidence refs and quality coverage

The generated CrabAgent plan requires:

`OpenCrab-saas/scripts/opencrab_desktop_build_runner.py`

But the planned repository is not accessible from this environment:

`https://github.com/AlexAI-MCP/OpenCrab-saas.git`

Git result:

`Repository not found.`

Interpretation: the upload endpoint appears to require a private Desktop builder output or an additional server-side marker not documented in the public Pack v1 contract.

CrabAgent plan was regenerated for the strengthened solo payload folder:
- data_folder: `docs/opencrab-saas-solo-payloads-2026-07-01`
- pack_name: `naver-brandconnect-seo-solo-anchors-2026-07-01`
- upload_session_id: `720e817c-8675-4dd4-a10c-68a836bf0d3b`
- generated chunk target: `900`
- local runner required: `$HOME/.opencrab/OpenCrab-saas/scripts/opencrab_desktop_build_runner.py`
- local runner exists on this machine: `false`

Interpretation: CrabAgent can produce the correct build/upload plan and one-time SaaS upload session, but this workspace still cannot complete the Desktop cloud-pack build until the private runner is installed.

## Deep QC 2026-07-02

Additional CrabAgent/OpenCrab QC was run after the package reached `1.0.95`.

Pack-level QA:
- Package: `cfe1fd01-a052-4ec0-a97b-b7f45cd92b9d`
- Project: `ce86789f-c294-449f-9add-61de752e810b`
- Grade: `B`
- Score: `85`
- Release ready: `true`
- Snapshot: `documents=96`, `chunks=179`, `nodes=1248`, `edges=1152`
- Coverage: `indexed_documents=96`, `selected_document_ids=96`, `selected_node_ids=1248`, `selected_edge_ids=1152`
- Evidence metrics: `total_chunks_found=179`, `sampled_chunks=179`, `average_chunk_chars=861`, `low_text_chunk_ratio=0`, `vector_coverage_sample=0.955`, `evidence_document_chunk_coverage_sample=1`
- Remaining gap: `Chunk density is too low for reliable grounded answers.`

Interpretation:
- The pack is release-ready for the exact-pid workflow, but it is not an A-grade pack because the SaaS fallback uses one compact product-level chunk per solo anchor.
- This chunk-density warning is structural, not evidence-loss evidence: no low-text chunks were found and evidence document/chunk coverage is complete in the sampled QA.

Local solo payload structural audit:
- Files checked: `80`
- Categories checked: `8`
- Products per category: `10`
- Bad payload count: `0`
- Required markers checked per file: exact `ANCHOR|CRAB_MICRO_TOP3|pid=<product_id>|priority=1`, `P`, `R1`, `R2`, `R3`, and `D`
- Character range by category: `baby_pet=904-976`, `beauty_body=855-968`, `digital_it=925-977`, `fashion_goods=866-998`, `food_supplement=827-978`, `home_appliance=926-996`, `living_health=922-1005`, `sports_leisure=850-988`

Remote exact-pid probes:
- `baby_pet` representative pid `181e8f0e-4380-4926-bc7e-bd64d54fb8d7`: raw project query returned a false FAIL when judged from answer text, but the workflow runner with `top_k_per_node=40` returned PASS. Evidence document `d1bb5d03-0d6d-4a42-afcd-83d138c2dd68` contains the exact canonical anchor plus `P/R1/R2/R3/D`.
- `digital_it` representative pid `23ff46db-0f93-4cf8-ba47-e87ac7ae789a`: raw project query answer text returned FAIL, but the returned evidence array contained document `53855bc4-f278-42e4-9ce5-e893357d3690` with the exact canonical anchor plus `P/R1/R2/R3/D`.

QC conclusion:
- Do not use raw project-query natural-language answer text as a release gate.
- Use returned evidence objects and the workflow runner as the QC source of truth.
- For writing/QC after pack version `1.0.95`, run exact product tasks with the literal anchor and `top_k_per_node >= 40`.
- If canonical v2 and compact/legacy evidence both appear, select the canonical v2 `ANCHOR|CRAB_MICRO_TOP3|pid=<product_id>|priority=1` chunk even when vector ranking places compact evidence higher.

## Current Usable State

Local artifacts:
- Full 80-product canonical evidence exists locally and passes graph/evidence QC.
- Full 80-product micro-index source files exist locally and pass slot-level QC.
- Full 80-product solo payload queue exists locally and passes product-level QC.
- Use the local canonical pack and solo payload queue as the audit source of truth for Korean text inspection and retrieval debugging; the SaaS package now contains all 80 strengthened solo anchors.

SaaS package:
- Usable for aggregate SEO rules.
- Usable for Dreame L10s Ultra Gen3 exact product-level evidence.
- Usable for staged representative `CRAB_MICRO_TOP3` pids when the query explicitly names the marker and pid.
- Verified for beauty pid `02954d99-0510-481e-b099-77cc8d2af88f` through the workflow runner when `top_k_per_node=12`.
- Verified for home pid `413765d6-98b0-442f-b777-b9db583e2e6a` through the workflow runner when `top_k_per_node=12` and the strengthened `ANCHOR|CRAB_MICRO_TOP3|pid=<product_id>|priority=1` row is present.
- Verified for `baby_pet` representative pid `181e8f0e-4380-4926-bc7e-bd64d54fb8d7` through direct project query and workflow runner when `top_k_per_node=12`.
- Verified for `beauty_body` representative pid `02954d99-0510-481e-b099-77cc8d2af88f` through direct project query and workflow runner when `top_k_per_node=12`; after workflow update, canonical v2 is selected over legacy duplicate evidence.
- Verified for `digital_it` representative pid `23ff46db-0f93-4cf8-ba47-e87ac7ae789a` through direct project query and workflow runner when `top_k_per_node=12`; canonical v2 is selected over higher-scoring compact evidence.
- Verified for `fashion_goods` representative pid `52c82315-45b4-4b46-bcde-60790aa010a0` through direct project query and workflow runner when `top_k_per_node=12`; canonical v2 is selected over higher-scoring compact evidence.
- Verified for `food_supplement` representative pid `f1ea0243-3271-4c96-8f02-f59cdfa2dc56` through direct project query and workflow runner when `top_k_per_node=40`; `top_k_per_node=12` failed to retrieve canonical v2 after pack version `1.0.65`.
- Verified for `home_appliance` representative pid `413765d6-98b0-442f-b777-b9db583e2e6a` through direct project query and workflow runner when `top_k_per_node=40`; direct query can rank legacy duplicate home anchors above canonical v2, so the workflow must select the literal `ANCHOR` source.
- Verified for `living_health` representative pid `4965c80b-e6e0-43a3-9698-7cb8a341c9da` through direct project query and workflow runner when `top_k_per_node=40`; direct query can rank compact category evidence above canonical v2, while workflow priority selects canonical v2 first.
- Verified for `sports_leisure` representative pid `8d6491ab-dcfa-4385-949d-f638a4ff75b7` through direct project query and workflow runner when `top_k_per_node=40`; direct query can rank compact category evidence above canonical v2, while workflow priority selects canonical v2 first.
- Contains all 10 `baby_pet` strengthened solo anchors.
- Contains all 10 `beauty_body` strengthened solo anchors.
- Contains all 10 `digital_it` strengthened solo anchors.
- Contains all 10 `fashion_goods` strengthened solo anchors.
- Contains all 10 `food_supplement` strengthened solo anchors.
- Contains all 10 `home_appliance` strengthened solo anchors.
- Contains all 10 `living_health` strengthened solo anchors.
- Contains all 10 `sports_leisure` strengthened solo anchors.
- Contains all 8 category compact batches and all 80 products, but compact evidence remains brittle for exact rank 1-3 + `D` extraction.
- Category-level micro batch ingest is not reliable enough for exact product-level extraction.
- All 80 strengthened solo anchors are now ingested in SaaS; use the workflow with `top_k_per_node >= 40` and exact pid/literal `ANCHOR` to avoid compact evidence outranking canonical product evidence in raw vector order.

Workflow:
- Correctly instructs the agent to prefer canonical v2 `ANCHOR|CRAB_MICRO_TOP3|pid=<product_id>|priority=1`, then legacy `CRAB_MICRO_TOP3`, then `ATOMIC_ROW`, then compact/aggregate evidence.
- Correctly instructs the agent to mark missing fields instead of inventing.
- Correctly instructs the agent to select canonical v2 over legacy/compact duplicate pid evidence, even when vector score ranks legacy/compact higher.
- Requires `top_k_per_node >= 40` for product-level writing/QC after pack version `1.0.65`.
- For production writing, pass the exact `product_id` and `CRAB_MICRO_TOP3 pid=<product_id>` marker in the task.
- For production writing, pair the SaaS workflow with local canonical/solo evidence when auditing Korean source text or investigating retrieval anomalies.

## Recommended Repair

Preferred:
1. Run the private OpenCrab Desktop builder and upload the resulting cloud-pack ZIP through CrabAgent.
2. Re-run `pack_qa` and pid-level answerability probes.

SaaS fallback status:
1. Completed: all remaining product evidence was ingested as one product-level solo document per product rather than multi-product batches.
2. Completed: every solo payload uses the exact anchor line `ANCHOR|CRAB_MICRO_TOP3|pid=<product_id>|priority=1`.
3. Completed: each product's `P`, rank 1, rank 2, rank 3, and `D` rows are kept in the same evidence chunk.
4. Continue using UTF-8 local source files as the source of truth when inspecting Korean fields.
5. For production writing, re-run the target pid with exact pid/literal anchor and `top_k_per_node >= 40`; raw direct project query may still show compact evidence above canonical v2.
