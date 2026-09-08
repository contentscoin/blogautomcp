# 글작성 템플릿 구조 리포트

> **2026-09-08 개정.** 감사 리포트의 항목 재번호(H18→H21, H30→H36)와 고지 인덱스 결함의 성격 정정을 반영했다.

> 작성일 2026-09-07 · 대상 저장소 `blogautomcp` · 모든 줄 번호는 이 날짜의 작업 트리 실측값

## 이 문서를 읽는 법

이 문서는 **새 포스트 템플릿을 추가하기 위해 알아야 할 최소 지식**을 한 곳에 모은 것이다. 코드베이스 전체를 읽지 않고도 "어느 파일의 어느 심볼을 어떤 순서로 고쳐야 하는가"에 답할 수 있게 쓰였다. 읽는 순서는 목적에 따라 다르다. **처음 읽는다면 §1을 반드시 먼저 읽어라** — 이 저장소에는 서로 이름이 비슷하고 서로를 폐기하지 않은 템플릿 체계가 셋 있고, 어느 것을 고칠지 정하지 않은 채 파일을 열면 아무 효과 없는 수정에 하루를 쓰게 된다. 그다음은 자기가 고칠 체계의 상세(브랜드커넥트 섹션 스펙은 §2~§5, 출하 프롬프트는 §6, 주제글은 §7)로 가고, 실제 작업은 §13 체크리스트를 따라간다. §12 환경 토글 표는 "코드는 고쳤는데 결과가 안 바뀐다"의 원인 대부분을 담고 있으니 착수 전에 한 번, 검증이 안 맞을 때 다시 한 번 본다. §14는 구조상 문제·중복·문서와 코드의 불일치를 모아 둔 곳으로, 결함으로 접수된 항목은 `docs/full-code-audit-2026-09-07.md`의 항목 번호를 함께 적어 두었다.

---

## 1. 먼저 확정할 것 — 이 저장소에는 템플릿 시스템이 셋이다

| # | 시스템 | 무엇을 결정하나 | 진입점 | 언제 도는가 | 새 템플릿을 넣으려면 여는 파일 |
|---|---|---|---|---|---|
| **A** | spec-first 섹션 스펙 | 브랜드커넥트 글의 섹션 역할·제목·형식·근거·이미지 슬롯 | `scripts/lib/post-spec/index.ts:141 buildPostSpec` | `simple-agent.ts:4670-4676` 게이트를 통과할 때만 (`AI_PROVIDER === "openai"` 필요) | `post-spec/types.ts` + `section-library.ts` (§2~§5, §13 Case A) |
| **B** | 출하 프롬프트 조립 | 실제로 모델에 전달되는 systemPrompt / userPrompt 텍스트 전체 | `scripts/simple-agent.ts:4588 step2_generatePost` | 게이트를 통과하지 못하는 모든 경우 — **출하 기본 설정이 여기다** | `editorial-templates.ts` + `writing-prompt-contract.ts` + `simple-agent.ts:4856/4903` (§6, §13 Case D) |
| **C** | 주제글(topic) | 주제글 본문의 소제목·요약·불릿·문단과 섹션 개수(4 고정) | `src/services/topic-task-pipeline.ts:4486 prepareTopicTask` | 주제글 태스크 전부. 브랜드커넥트와 타입·게이트를 하나도 공유하지 않는다 | `src/lib/topic-workflow.ts` + `src/services/topic-task-pipeline.ts` (§7, §13 Case E) |

부수 축이 둘 더 있다. **썸네일 카피/프롬프트**(§10)는 이미지 안에 그려질 한글 문구와 생성 프롬프트를 별도 템플릿 엔진으로 만든다. **제휴 고지**(§11)는 섹션이 아니라 `PostSpec`의 독립 필드이며 섹션 수 밖에 있으면서 발행을 하드 차단한다.

### 1.1 여기는 템플릿이 사는 곳이 아니다 — `scripts/lib/templates/**`

`scripts/lib/templates/`(`product-review.ts` / `travel.ts` / `golf.ts` / `knowledge.ts` / `index.ts` / `types.ts`)는 이름 때문에 가장 먼저 열게 되는 디렉터리지만, **어느 발행 파이프라인도 이 파일들의 구조 정보를 읽지 않는다.**

- 실제 소비는 두 줄뿐이다: `scripts/topic-agent.ts:1878`의 `getTemplate(args.type).seoKeywords`와 `:1897`의 `categoryNames[args.type]`.
- 그 유일한 소비자인 `topic-agent.ts`조차 레거시 브라우저 경로여서 `ALLOW_CHATGPT_BROWSER_MODE`가 아니면 앞단에서 예외로 끝난다.
- `promptTemplate` / `sections` / `minLength` / `maxLength` / `hashtagCount` / `generatePrompt` / `get*Prompt`는 호출자가 0건이다. `knowledgeTemplate.sections`에 "인트로 / 개념 설명 / 상세 정보 1 / 상세 정보 2 / 실제 사례 / 주의사항 / 요약" 7섹션이 적혀 있지만 파이프라인은 이 배열을 읽지 않고 **무조건 4섹션**을 만든다(§7).
- `getTypeFromArgs`도 호출자가 없어 `productReviewTemplate`은 CLI로 도달 불가다.

**주제글 템플릿의 실체는 `src/lib/topic-workflow.ts`와 `src/services/topic-task-pipeline.ts`다.** `scripts/lib/templates/`에 파일을 추가하는 것은 아무 효과가 없다.

---

## 2. 전체 구조도 — 시스템 A(spec-first)

```
┌─ [입력] ────────────────────────────────────────────────────────────────────┐
│ SpecFirstPipelineInput  (scripts/lib/post-spec/index.ts:44-62)              │
│   kind: "SHOPPING" | "TRAVEL"                                              │
│   product: SpecFirstProductInput  (name/description/features/price/…)      │
│   imageCandidates: ImageCandidateInput[]  (hero/source/crop/card)          │
│   brief: OpenCrabSeoBrief | null,  memo,  extraSystemRules,  tempDir       │
│   options: maxRepairRounds=2, allowLocalFallback=true,                     │
│            quotationHeaders=false, requireRepresentativeImage=true          │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
┌─ [브리프/리서치] ─────────────▼──────────────────────────────────────────────┐
│ product-editorial-plan.ts:buildProductEditorialPlan(targetSectionCount:9)   │
│   → verifiedFactLines["상품명: …","설명: …","상세 근거: …","가격: …"]        │
│   → blockedClaimRules[7조],  reviewAnalysis(evidenceLevel rich|usable|sparse)│
│ travel-content.ts:extractTravelProductFacts  → TravelProductFacts           │
│   (duration / destinations≤8 / highlights≤12 / conditions≤10)              │
│ opencrab-seo-brief.ts:buildOpenCrabSeoBrief → searchQueries·hashtags        │
│   (titleCandidates·recommendedSectionTitles·mediaTargetImageCount는 미소비) │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │  ※ 여기까지 모델 호출 0회
┌─ [이미지 풀 확정 → 섹션 수 파생] ▼───────────────────────────────────────────┐
│ image-plan.ts:prepareImagePool  (sharp 실측 · BAD_NAME 필터 · 부족분 보강)   │
│   minBody = TRAVEL 5 / SHOPPING 4     targetBody = TRAVEL 10 / SHOPPING 8   │
│   부족 시  TRAVEL → fetchStockImages(스톡)   SHOPPING → buildCollageImage    │
│                       ↓ resolved = pool.body.length                        │
│ index.ts:buildPostSpec  섹션 수 역산                                        │
│   SHOPPING : resolved>=7 → 10 / >=5 → 9 / else 8                           │
│   TRAVEL   : dayCourses = min(clamp(highlights,1,3), max(1, resolved-3))    │
│              sectionCount = clamp(9 + dayCourses, 10, 12)                   │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
┌─ [템플릿 선택] ───────────────▼──────────────────────────────────────────────┐
│ section-library.ts:buildSectionTemplates(ctx, count) → SectionTemplate[]     │
│   SHOPPING : 고정 10칸 → hasReviewProof로 proof/comparison 택1              │
│              → dropOrder ["proof","comparison","offer-check"]로 축소         │
│   TRAVEL   : 고정 9칸 + dayCourseTemplate × dayCount(1~3)                    │
│ editorial-templates.ts:selectEditorialTemplate → 문체 6종 중 1개(정규식 결정) │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
┌─ [PostSpec 생성] ─────────────▼──────────────────────────────────────────────┐
│ evidence-ledger.ts:buildEvidenceLedger → 섹션별 exclusive/shared 근거 배정   │
│ index.ts:sectionSpecFromTemplate  = SectionTemplate + SHAPE_RULES[shape]     │
│                                     + ledger.exclusive(→mustUseEvidence)    │
│ image-plan.ts:assignImageSlots → ImageSlot id "s03-a" · 파일 경로까지 확정   │
│ seo(제목 25~35자·해시태그 5개) / geo(3·4·3·3) / totalChars / generation.chunks│
│ index.ts:265 disclosure = SHOPPING_DISCLOSURE | TRAVEL_DISCLOSURE (§11)      │
│                    ⇒ PostSpec  (모델은 이 스펙의 lines만 채운다)            │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
┌─ [생성] ──────────────────────▼──────────────────────────────────────────────┐
│ generate.ts:renderSystemPrompt + renderSectionInstruction                   │
│ schema.ts:buildDraftJsonSchema  ← 고정 키 객체 s00,s01,… (strict)           │
│ llm-client.ts:generateStructured   maxOutputTokens 8192 / temperature 0.7   │
│   실패 → local-template.ts:buildLocalDraft (fallbackLines 그대로, 수리 없음) │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
┌─ [검증 / 리페어] ─────────────▼──────────────────────────────────────────────┐
│ assemble.ts:normalizeDraft → render.ts:normalizeLines (접두사·58자 분할)     │
│ validate.ts:validateDraft → ValidationReport                                 │
│   score = 품질×0.6 + specScore×0.4,  specScore = 100 - fail×15 - warn×4      │
│   P0 → BLOCKED / P1·품질fail·warn≥5 → NEEDS_REVIEW / else READY             │
│ repair.ts:repairDraft  ← repairableTargets (P2와 IMAGE_SHORTFALL 제외)       │
│   최대 2라운드, 점수가 나빠지면 원본 유지                                    │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
┌─ [조립] ──────────────────────▼──────────────────────────────────────────────┐
│ assemble.ts:assemblePost → AssembledPost                                     │
│   sections: string[] (:104에서 마지막 원소로 disclosure push)               │
│   composition: PostCompositionContract  (헤더·이미지·구분선)                 │
│   sectionPlan: CompositionSectionPlan[] (earlyConnectCard 위치 포함)         │
│   uploadImagePaths = [hero, ...slots]  중복 제거                             │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
┌─ [QC 게이트] ─────────────────▼──────────────────────────────────────────────┐
│ ① src/lib/post-composition-contract.ts:resolvePostDocument → renderNodes     │
│    :608 고지 분리 → :611-613 contentSections → :614-615 플랜 채택 판정       │
│    buildPostQualityReport  (PREMIUM=blocker / STANDARD=warning only)         │
│    score = 100 - blockers×22 - warnings×6                                    │
│ ② brandlink-content-readiness.ts:getBrandLinkContentReadiness                │
│    blockers(safety 6 + structure 7) + quality 6카테고리 100점, 통과선 70      │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
┌─ [발행] ──────────────────────▼──────────────────────────────────────────────┐
│ brand-post-package/v2 manifest.json 저장 (approvedAt = null)                 │
│ → approveBrandPostPackage (AI 생성 + 이미지 슬롯 충족 + PREMIUM 품질 통과)   │
│ → BRANDLINK_PREPARED_POST_MANIFEST 재주입 → STEP3~7 (에디터 → renderNodes)   │
└─────────────────────────────────────────────────────────────────────────────┘
```

**이 그림은 게이트를 통과했을 때의 그림이다.** 출하 기본 설정에서 실제로 도는 경로는 §6이다.

---

## 3. 레이어별 상세

### 3.0 레이어 소유 범위 한눈에

| 레이어 | 파일 | 소유하는 것 | 소비자 |
|---|---|---|---|
| A 타입 | `post-spec/types.ts` | 역할·형식·이미지 전략 어휘 | 전 레이어 |
| B 템플릿 정의 | `post-spec/section-library.ts` | 섹션 제목·순서·역할·이미지 의도·폴백 문장 | index / generate / validate |
| C 근거 배정 | `post-spec/evidence-ledger.ts` | 섹션별 전용·공용 근거 | index / generate |
| D 스펙 조립 | `post-spec/index.ts` | 섹션 수·SEO·GEO·분량·고지·수리 루프 | 전 레이어 |
| E 프롬프트 | `post-spec/generate.ts` · `schema.ts` · `llm-client.ts` | 시스템/섹션 지시문, 출력 스키마 | 생성 |
| F 검증 | `post-spec/validate.ts` | 신호 코드·우선순위·점수 | 수리 / 조립 / 패키지 |
| G 수리 | `post-spec/repair.ts` | 재생성 대상 선별 | index |
| H 조립 | `post-spec/assemble.ts` | 최종 섹션 문자열·플랜·업로드 목록 | 렌더 / 발행 |
| I 렌더/QC | `src/lib/post-composition-contract.ts` | 노드 순서·이미지 배분·품질 리포트 | 발행 |
| **J 출하 프롬프트** | `scripts/simple-agent.ts` + `writing-prompt-contract.ts` + `editorial-templates.ts` | 실제 전달 프롬프트 텍스트 | §6 |
| **K 주제글** | `src/lib/topic-workflow.ts` + `src/services/topic-task-pipeline.ts` | 주제글 소제목·본문·섹션 수 | §7 |
| **L 썸네일 카피** | `scripts/lib/thumbnail-gen/**` + `thumbnail-layout-v2.ts` | 썸네일 문구·생성 프롬프트·QC 배점 | §10 |
| **M 고지** | `post-spec/index.ts:69,74` | 고지 문안 | §11 |

J·K·L·M은 각각 §6·§7·§10·§11에서 따로 다룬다. 아래는 A~I 상세다.

### A. 타입 계층 — `scripts/lib/post-spec/types.ts`

이 파일이 템플릿 시스템의 **어휘 사전**이다. 새 섹션 역할·이미지 전략·헤더 형식은 전부 여기 유니온에 먼저 추가해야 컴파일이 통과한다.

| 심볼 | 위치 | 값 / 필드 |
|---|---|---|
| `ConnectKind` | `:12` | `"SHOPPING" \| "TRAVEL"` — 최상위 분기 스위치 |
| `HeaderFormat` | `:13` | `"quotation" \| "sectionTitle" \| "none"` |
| `SectionShape` | `:14` | `"prose" \| "lines-3" \| "facts-list" \| "qa-3" \| "checklist"` |
| `SectionRole` | `:16-36` | 17종 (§5 참조) |
| `ImageStrategy` | `:38` | `"hero" \| "source" \| "crop" \| "card" \| "stock" \| "collage"` |
| `ImageSlot` | `:47-55` | `{ id, sectionIndex(-1=hero), intent, strategy, path, score }` |
| `ImagePlan` | `:57-69` | `{ policy, hero, slots[], targetBody, resolvedBody, minBody, shortfall, shrinkApplied, notes[] }` |
| `SectionSpec` | `:71-94` | `{ index, role, title, headerFormat, shape, purpose, evidenceRule, evidence[], mustUseEvidence[], requiredKeywords[], minChars, maxChars, minLines, maxLines, imageSlotIds[], imageIntent, imageCount?, hints[] }` |
| `SeoTargets` | `:96-109` | `{ primaryKeyword, secondaryKeywords[], title{minChars,maxChars,keywordFirst,mustIncludeTokens}, firstSentenceMustInclude, keywordMentionsPer1000, hashtags{count,required,banned} }` |
| `GeoTargets` | `:111-117` | `{ summaryLines, factsMinLines, faqCount, checklistMin, sourceLine }` |
| `EvidenceLedgerEntry` | `:119-127` | `{ sectionIndex, role, exclusive[], shared[] }` |
| `PostSpec` | `:129-154` | 파이프라인 중심 객체. 모델 호출 전 완전 확정, 이후 전 단계가 읽기 전용 참조. `disclosure`(`:147`)는 `sections`와 **나란한 별도 필드**(§11) |
| `ValidationReport` | `:200-217` | `{ canPublish, status, score, quality, signals[], metrics, repair{strategy,maxAttempts,targets[]}, summary }` |
| `AssembledPost` | `:236-252` | 최종 산출물 |
| `CompositionSectionPlan` | `:254-262` | `{ role, imagePaths[], imageIntent, imageMin, imageMax, headingStyle, earlyConnectCard? }` |

**소유 범위**: 섹션 역할 어휘, 검증 신호 형태, 최종 산출물 형태. 여기에 필드를 추가하면 `sectionSpecFromTemplate`·`validate.ts`·`assemble.ts` 세 곳의 하위호환 방어(`|| []`, `imageCount?`)를 함께 봐야 한다.

### B. 템플릿 정의 계층 — `scripts/lib/post-spec/section-library.ts`

**시스템 A에 섹션을 추가할 때 실제로 코드를 쓰는 파일이 여기다.** 외부로 나가는 것은 `buildSectionTemplates` 하나뿐이고, 나머지(`shoppingTemplates:119`, `travelTemplates:337`, `dayCourseTemplate:549`)는 모듈 내부다.

```ts
// :37-49  — 11개 필드 전부 필수, 옵셔널 없음
interface SectionTemplate {
  role: SectionRole;
  title: string;
  headerFormat: HeaderFormat;
  shape: SectionShape;
  purpose: string;          // 프롬프트의 "- 역할:" 줄
  evidenceRule: string;     // 프롬프트의 "- 근거 규칙:" 줄
  imageIntent: string;
  imageCount: [number, number];
  requiredKeywords: string[];  // validate가 MISSING_KEYWORD로 검사
  hints: string[];             // 프롬프트 말미 자유 지시 (강제 아님)
  fallbackLines: string[];     // 로컬 폴백 본문
}

// :51-58  — 분량 제약의 단일 출처
interface ShapeRule {
  minLines; maxLines; minChars; maxChars;
  formatHint: string;        // 프롬프트의 "- 형식:" 줄
  linePrefix: string | null; // ※ 정의만 되고 소비되지 않음 (§14.2 D2)
}
```

`LibraryContext`(`:22`)가 템플릿 문자열 보간의 **유일한 입력**이다:
`{ kind, productName, shortName, price, factLines[], travel: TravelProductFacts|null, primaryKeyword, destination, duration, highlights[], hasReviewProof, collectedAt }`

**소유 범위**: 섹션 제목·순서·역할·형식·이미지 의도·폴백 문장. 길이 수치는 소유하지 않는다(`SHAPE_RULES`가 소유).

### C. 근거 배정 계층 — `scripts/lib/post-spec/evidence-ledger.ts`

`buildEvidenceLedger(:272)`가 `templates` 배열과 1:1 인덱스로 묶인 `EvidenceLedgerEntry[]`를 만든다.

- `SHARED_LABELS`(`:46`) = `/^(?:상품명|가격|원가|할인율|쿠폰\/혜택|배송|리뷰 수|평점):/u` → 이 라벨로 시작하는 factLine만 **shared**(여러 섹션 참조 가능), 나머지(`설명:`, `상세 근거:`, `구매후기 원문 근거:`)는 **exclusive** 풀.
- `Pool` 클래스(`:59`)가 소비 큐 역할 — 한 번 꺼낸 줄은 다른 섹션이 못 쓴다.
- `isMeasured`(`:42`) = `/\d[\d,.]*\s*(?:mAh|m|cm|mm|kg|g|W|V|시간|분|단|도|개|엽|%|원|ml|L|인치)/iu` → `product-reveal`은 비수치 줄, `benefit`/`proof`는 수치 줄을 우선 가져간다.
- 마지막에 **전역 중복 제거**(`:274-283`): 같은 exclusive 줄이 두 섹션에 배정되면 뒤엣것 제거.
- `otherSectionsEvidence(:288)`가 프롬프트의 "다른 섹션 전용 근거(여기서는 쓰지 않기)" 목록(최대 6개)을 만든다.

**주의**: 쇼핑 원장(`buildShoppingLedger:96`)의 `byRole`은 `entries.find`로 **첫 번째 항목만** 찾는다(`:129`). 여행 원장(`:235`)은 `filter`를 쓴다. 쇼핑에 같은 role을 두 번 쓰는 템플릿을 추가하면 두 번째 섹션은 근거를 못 받고 조용히 `EVIDENCE_UNUSED`로 떨어진다.

### D. 스펙 조립 계층 — `scripts/lib/post-spec/index.ts`

`buildPostSpec(:141)`가 전 레이어를 합친다. 모델 호출 없이 여기까지 끝난다.

- `:159-160` 이미지 하한/목표: `minBody = kind === "TRAVEL" ? 5 : 4`, `targetBody = kind === "TRAVEL" ? 10 : 8`
- `:176-183` 섹션 수 파생 (§2 그림 참조)
- `:199-202` **imageCount 정규화** — `imageCount[1] > 0 ? Math.max(1, imageCount[0]) : imageCount[0]`. `[0,1]`로 선언한 템플릿이 실제로는 `[1,1]`이 된다.
- `:212-217` `legacyEvidence` 특례 — role이 `key-facts`/`offer-check`/`inclusions`일 때만 `verifiedFactLines` 전체를 evidence에 추가 병합
- `:249-256` SEO 목표 — 제목 25~35자, `keywordFirst: true`, `keywordMentionsPer1000: [1, 8]`, `hashtags.count: 5`, `banned = GENERIC_HASHTAGS`(22종, `:64-67`)
- `:257-263` GEO 목표 — `summaryLines: 3`, `factsMinLines: 4`, `faqCount: 3`, `checklistMin: 3`, `sourceLine`
- `:264` 전체 분량 — TRAVEL `[2200, 3600]`, SHOPPING `[1300, 2400]`
- `:265` 고지 확정 — `kind === "TRAVEL" ? TRAVEL_DISCLOSURE : SHOPPING_DISCLOSURE` (§11)
- `:266` 생성 — TRAVEL은 `mode: "chunked"` + chunks 2분할, SHOPPING은 `single`, `maxOutputTokens: 8192`, `temperature: 0.7`
- `:306-318` 수리 루프 — `draft.source === "openai"`일 때만, 최대 2라운드, `nextReport.score >= report.score`일 때만 채택

### E. 프롬프트 계층 — `generate.ts` + `schema.ts` + `llm-client.ts`

`renderSystemPrompt(:24-54)` 블록 순서:
1. 역할 문장 (여행 = "여행 판단을 돕는 블로거, 직접 다녀온 경험 금지" / 쇼핑 = "검토형" 구매 판단 글)
2. `buildHumanMobileStyleGuide()` — `scripts/lib/blog-writing-style.ts`
3. `HUMANIZE_RULES` — `scripts/lib/humanize-korean.ts:21`
4. `NAVER_SEO_TITLE_RULES` — `blog-writing-style.ts:93`
5. `formatWritingStructureGuide(connectKind)` — `writing-structure-guide.ts:6`
6. `formatEditorialTemplate(connectKind, spec.editorial?.id)` — `editorial-templates.ts:73`
7. **고정 규칙 7줄** (`:38`) — 제목 그대로 사용 / 형식 정확 준수 / 존댓말 / URL·내부지침·JSON 키 노출 금지 / 전용 근거 1개 이상 / 반복 금지 / 확인 안내 문장 섹션당 1개
8. `formatOpenCrabSeoBriefForPrompt(brief)` → 9. `formatTravelFactsForPrompt` → 10. `[금지 주장]` → 11. `extraSystemRules`

5·6번 두 줄이 시스템 A와 시스템 B가 **공유하는 유일한 프롬프트 텍스트**다(§6.4).

`renderSectionInstruction(:78-109)`가 섹션마다 만드는 지시:
```
### s{NN} · 제목: "…" (그대로 사용)
- 역할: purpose
- 근거 규칙: evidenceRule
- 형식: SHAPE_RULES[shape].formatHint
- 분량: {minLines}~{maxLines}줄, 공백 제외 {minChars}~{maxChars}자
- 반드시 포함: requiredKeywords
- 이 섹션 전용 근거: mustUseEvidence (" / " 결합)
- 함께 참조할 수 있는 공용 근거: evidence − mustUseEvidence
- 다른 섹션 전용 근거 (여기서는 쓰지 않기): …최대 6개
- 이미지 안내 / hints[]
```
TRAVEL + `role === "day-course"`이면 `:103-105`에서 **조사형 강제 문장**이 추가된다: "실제 방문 경험을 만들지 말고 '찾아보니 ~라고 해요' 식으로."

`schema.ts:buildDraftJsonSchema(:26-45)` — 배열이 아니라 **고정 키 객체**(`s00`, `s01`, …)를 쓴다. strict 모드가 `minItems` 같은 배열 길이 키워드를 지원하지 않아 섹션 개수를 구조적으로 강제할 수 없기 때문이다. `role`은 `enum [해당 섹션 role 1개]`라 모델이 역할을 바꿀 수 없다.

### F. 검증 계층 — `scripts/lib/post-spec/validate.ts`

신호 키 네임스페이스: `gate:*`, `title-*`, `section:<i>:{length|shape|keywords|repeat|evidence|generic|ai-tell}`, `keyword-density`, `first-sentence`, `total-length`, `images`.

| 검사 | 임계값 | 코드 / 우선순위 |
|---|---|---|
| 안전 게이트 위임 | `getBrandLinkContentReadiness(mode:"editorial")`, 입력은 `:48`의 `[...sectionTexts, spec.disclosure]` | `FORBIDDEN_CLAIM` / `RAW_LINK` / `INTERNAL_LEAK` / `COMMISSION_RATE` / `CATEGORY_MISMATCH` / `TITLE_PRODUCT_TOKEN` — 전부 **P0** |
| 고지·해시태그 신호 | `:62-66`에서 fail이어도 **warn으로 강등** (조립 단계에서 코드가 확정하므로) | `gate:disclosure` / `gate:hashtags` |
| 제목 길이 | `seo.title` ±5자 밖이면 fail | `TITLE_LENGTH` P1 |
| 제목 키워드 위치 | `looseText` 기준 12자 이내 | `TITLE_KEYWORD` P1 |
| 제목 정제 | 낚시성 제거 차이 또는 이모지 | `TITLE_CLEAN` P1 |
| 섹션 분량 | 0.6배 미만 / 1.5배 초과 → P1, 그 외 → **P2** | `LENGTH_OUT_OF_RANGE` |
| shape | `qa-3` = 6줄 + Q./A. 패리티, `lines-3` = 3줄 **만** 검사 | `SHAPE_VIOLATION` P1 |
| 필수 키워드 | `requiredKeywords` 미포함 | `MISSING_KEYWORD` P1 |
| 반복 | 정확 일치 + `tokenSimilarity >= 0.72` (`:30`) | `REPEATED_LINE` P1 |
| 전용 근거 | `mustUseEvidence` 미사용 | `EVIDENCE_UNUSED` P1 |
| 일반론 | 안내·일반론 2개 이상 AND 섹션 문장 절반 이상 | `GENERIC_GUIDANCE` P1 |
| AI 티 | `scanAiTells` 섹션 점수 `>= 8` (`:193`) | `AI_TELL` P1 |
| 키워드 밀도 | `per1000` 하한 미달 | `KEYWORD_DENSITY_LOW` **P2** |
| 이미지 | `spec.imagePlan.shortfall > 0` (`:220-222`) | `IMAGE_SHORTFALL` **P0, 수리 불가** |

점수(`:228-232`): `specScore = max(0, 100 - fails*15 - warns*4)`, `score = round(quality.score*0.6 + specScore*0.4)`.

이미지 검사는 **풀 단위 부족(`minBody` 미달)만** 본다. 섹션별 `imageCount[0]`의 합이 확보 장수를 넘는 경우는 어떤 신호도 만들지 않는다 — §14.1 T5.

### G. 수리 계층 — `scripts/lib/post-spec/repair.ts`

```ts
const UNREPAIRABLE = new Set(["IMAGE_SHORTFALL"]);            // :10
repairableTargets = targets.filter(t => !UNREPAIRABLE.has(t.code) && t.priority !== "P2");  // :13
```
- 제목 타깃(`sectionIndex === null`) → `TITLE_ONLY_SCHEMA`, `maxOutputTokens: 400`, `temperature: 0.6`
- 섹션 타깃 → `buildSingleSectionSchema`, `schemaName: "section_{index}"`, `maxOutputTokens: 1200`
- 섹션 수리 실패(throw)는 catch로 삼켜지고 **원본 섹션 유지**(`:87-89`)

### H. 조립 계층 — `scripts/lib/post-spec/assemble.ts`

- `:61` `earlyRole = spec.connectKind === "TRAVEL" ? "itinerary-overview" : "key-facts"` — **커넥트 카드 앵커**. 이 role을 가진 섹션이 없으면 early 카드가 사라지고 발행 단계의 `connectCardCount < 2` 검사에서 실패한다.
- `:65` `headingStyle` = `quotation && options.quotationHeaders ? "quotation" : headerFormat === "none" ? "plain" : "sectionTitle"`
- `:66-71` `imageMin`/`imageMax` — 주석에 "확보된 장수가 하한보다 적어도 플랜은 하한을 그대로 알려 준다(품질 리포트가 부족을 표시하도록)"라고 **의도가 명시**돼 있다. 여기는 버그가 아니다(§14.1 T5).
- `:86` 조립 시에도 `quotationHeaders`가 꺼져 있으면 quotation → sectionTitle 강등 (기본 `false`, `NAVER_EDITOR_QUOTATION_ENABLED`로 뒤집힘 — §12)
- `:101` `role === "fit-checklist"` 섹션에만 `spec.geo.sourceLine`을 마지막 줄로 추가
- `:104` `sections.push(spec.disclosure)` — 고지문이 배열에 합류하는 두 지점 중 하나(§11)
- `buildHashtags` — required 먼저 → 모델 태그 → `banned`·중복 제거 → `slice(0, 5)`
- `renderSectionText` = `` `${title}\n\n${lines.join("\n")}\n` ``

### I. 렌더/QC 계층 — `src/lib/post-composition-contract.ts`

`resolvePostDocument(:590~)`가 `sectionPlan`을 받아 `renderNodes`(divider → heading → paragraph → image → connectCard → hashtags → disclosure)로 평탄화한다.

- `:608` 모든 섹션에 `splitAffiliateDisclosure(:438)` 적용 → `:609-610` 고지 문장 분리 → `:611-613` `contentSections` 확정
- `:614-615` `options.sectionPlan.length === contentSections.length`일 때만 플랜 채택. 하나라도 어긋나면 **조용히 무시**되고 고정 팔레트(`SHOPPING_POST_CONTRACT_V1` 11섹션 / `TRAVEL_POST_CONTRACT_V1` 13섹션)로 폴백한다.
- `:620` `contentSections.map((_, index) => options.sectionImagePaths?.[index])` — **고지 제거 후 인덱스**로 이미지를 조회한다(§11의 경고).
- `buildPostQualityReport` — `score = max(0, 100 - blockers*22 - warnings*6)`. PREMIUM에서만 blocker가 생기고 STANDARD는 전부 warning이라 `canAutoPublish`가 항상 true다.
- 계약 수치: SHOPPING `targetCharacters {1200,2800}` / `targetImages {5,8,14}` / `targetSections {5,10}` / `earlyConnectAfterSectionId "shopping-summary"`, TRAVEL `{1750,3600}` / `{7,10,18}` / `{7,12}` / `"travel-highlights"`. 양쪽 다 `finalConnectBeforeDisclosure: true`(`:398`, `:409`).

---

## 4. 템플릿 카탈로그

### 구성표 (kind별)

| 템플릿 | 파일 | 적용 대상 | 섹션 구성 | 제약 |
|---|---|---|---|---|
| **SHOPPING 구성표** | `section-library.ts:576-597` | `ctx.kind === "SHOPPING"` | summary-glance → hook-problem → product-reveal → key-facts → benefit → use-case → **proof \| comparison** → offer-check → faq → fit-checklist | `target = clamp(count, 8, 10)`. full 배열 길이 10 고정. `hasReviewProof`로 proof/comparison 택1. 초과 시 `dropOrder = ["proof","comparison","offer-check"]` 순 제거. 8섹션 = summary/hook/reveal/key-facts/benefit/use-case/faq/fit-checklist |
| **TRAVEL 구성표** | `section-library.ts:599-634` | `ctx.kind !== "SHOPPING"` | summary-glance → key-facts → itinerary-overview → **day-course × 1~3** → inclusions → reasons-3 → booking-check → faq → fit-checklist → closing | `target = clamp(count, 10, 12)`, `dayCount = clamp(target - 9, 1, 3)`. 고정 9칸 + dayCount. highlights가 부족하면 빈 문자열 패딩 → 제목 "코스 포인트 N · 주요 방문지", `requiredKeywords = []` |

### 쇼핑 섹션 템플릿 (11종 사전, `shoppingTemplates:119`)

| 템플릿 | 파일 | 적용 대상 | 섹션 구성 | 제약 |
|---|---|---|---|---|
| `summary-glance` | `:128` | 항상 index 0 | 무엇인지 / 누구에게 / 가격 조건 | quotation·lines-3·이미지 `[0,0]`·`requiredKeywords=[shortName]`·제목 `{primaryKeyword} 한눈에 보기` |
| `hook-problem` | `:145` | 고정 2번째 | 선택 기준 → 공감 → 예고 → 정보 범위 | sectionTitle·prose·`[0,0]`·"구매·사용 경험 만들지 않기"·인사말 금지 |
| `product-reveal` | `:163` | 고정 3번째 | 기본 구성 / 특징1 / 특징2 / 옵션 차이 | prose·`[1,2]`·`[shortName]` 필수·확인된 구성만 |
| `key-facts` | `:181` | 고정 4번째 · **쇼핑 early 커넥트 앵커** | `• 상품명` `• 가격` `• 특징`(≤3) `• 배송` | facts-list·`[1,1]`·미확인 항목 "판매 페이지 확인"·`legacyEvidence` 대상 |
| `benefit` | `:199` | 고정 5번째 · 키워드 밀도 보강 1순위 | 기능→편의 / 판단 기준 / 추가 기능 / 체감 차이 | prose·`[1,2]`·성능 과장 금지·조건형 표현 |
| `use-case` | `:217` | 고정 6번째 · 보강 2순위 | 사용 장면 / 이동·크기 / 선물 / 덜 맞는 경우 | prose·`[1,2]`·"직접 써봤다" 금지 |
| `proof` | `:235` | `hasReviewProof === true`. dropOrder 1순위 | 스펙 표 순서 / 항목 확인 / 리뷰 수 / 옵션 재확인 | prose·`[1,1]`·수치는 제공값 있을 때만 |
| `comparison` | `:255` | `hasReviewProof === false`. dropOrder 2순위 | 비교 항목 3 / 가격 차이 원인 / 기준 축 / 다른 상품이 나은 상황 | prose·`[0,1]` → **`[1,1]`로 승격**·우열 단정 금지 |
| `offer-check` | `:273` | dropOrder 3순위(8섹션이면 탈락) | `• 표시 가격` `• 할인` `• 쿠폰/혜택` `• 배송` `• 확인 시점` | facts-list·`[0,1]`→`[1,1]`·"최저가·1위" 금지·`legacyEvidence` 대상 |
| `faq` | `:292` | 끝에서 2번째. 드롭 안 됨 | Q.용도/A. · Q.옵션/A. · Q.배송·교환/A. | qa-3 정확히 6줄·`[0,0]`·`geo.faqCount = 3` |
| `fit-checklist` | `:312` | 마지막 · **`geo.sourceLine` 부착 지점** | `▸ 기능 필요` `▸ 처음 고르는` `▸ 가격 확인 후` `▸ 링크 확인` | checklist·`[0,1]`→`[1,1]`·강매/품절 임박 금지 |

### 여행 섹션 템플릿 (10종 사전 `travelTemplates:337` + `dayCourseTemplate:549` 특화 오버라이드)

| 템플릿 | 파일 | 적용 대상 | 섹션 구성 | 제약 |
|---|---|---|---|---|
| `summary-glance` | `:357` | 항상 index 0 | 결론 / 대상 / 확인 조건 | quotation·lines-3·`[0,0]`·`[destination]`·제목 `{destination} {duration} 여행, 결론부터` |
| `key-facts` | `:374` | 고정 2번째 | `• 상품명` `• 여행 기간` `• 주요 방문지`(≤4) `• 확인 조건` `• 표시 가격` | facts-list·**`[0,0]`**(쇼핑 key-facts와 다름)·미확인은 "예약 페이지 확인" |
| `itinerary-overview` | `:393` | 고정 3번째 · **여행 early 커넥트 앵커** · card 이미지 우선 배정 대상 | 코스 도입 / 배경지식 0~2줄 / 방문 순서 / 일정표 기준 | prose·`[1,1]`·날짜별 순서 임의 추가 금지·잔여 지식 최대 2줄 |
| `day-course`(베이스) | `:411` | dayCount(1~3)개 반복 | 장소 소개 / (배경지식) / 풍경 / 팁 + 위치 | **quotation**·prose·`[1,2]`·운영시간·입장료는 "출발 전 확인"·방문 단정 금지 |
| `day-course`(특화) | `dayCourseTemplate:549` | highlight마다 5개 필드 덮어쓰기 | `courseLines[0]` → knowledge.line → `courseLines[1..3]` | 제목 `코스 포인트 {n} · {highlight}`·`requiredKeywords=[highlight]`·imageIntent `{place}와 연결되는 실제 여행지 사진`·문장은 `travel-knowledge.ts:buildHighlightCourseLines`의 12종 HighlightKind별 세트에서 선택 |
| `inclusions` | `:424` | day-course 다음 | `• 표시 가격` `• 포함` `• 불포함` `• 변동 요소` `• 조건 메모` | facts-list·`[1,1]`·`legacyEvidence` 대상 |
| `reasons-3` | `:443` | inclusions 다음 | `▸ 효율 동선` `▸ 조건 확인` `▸ 준비 부담` | checklist·`[0,0]`·hints는 "정확히 3줄"을 요구하지만 shape는 3~5줄 허용(**강제 아님**) |
| `booking-check` | `:460` | reasons-3 다음 | `▸ 입국 서류` `▸ 날씨·옷차림` `▸ 환전·결제` `▸ 취소·변경` | checklist·`[0,0]`·변동 제도는 "출발 전 확인" |
| `faq` | `:478` | GEO Q&A | Q.최소 출발 인원 / Q.자유시간 / Q.추가 비용 | qa-3 정확히 6줄·`[0,0]`·`travel.departureConfirmed`로 답변 분기 |
| `fit-checklist` | `:500` | closing 직전 · **`sourceLine` 부착 지점** | `▸` 핵심 명소 / 예약 시간 / 가족 동반 / 반대로 자유여행 | checklist·`[0,0]`·마지막 줄은 자유여행이 맞는 경우 |
| `closing` | `:518` | 마지막(쇼핑에는 대응 없음) | 한 줄 정리 / 추천 대상 / 링크 안내 / 댓글 유도 | prose·`[0,1]`→`[1,1]`·본문에 URL 금지(`RAW_LINK` P0) |

### 문체 템플릿 (`scripts/lib/editorial-templates.ts`, 6종) — 시스템 A·B 공용

| 템플릿 | 파일 | 적용 대상(정규식 매칭) | 섹션 구성(flow) | 제약 |
|---|---|---|---|---|
| `shopping-problem` | `:3` | SHOPPING 기본 폴백(`matchedSelection:30-34`) | 불편·사용 조건 → 기능 근거 → 한계·맞는 사용자 | `layouts.image "after-lead"`, 문단 1문장, palette `#00554c` (`color`는 `#365744`, 미소비) |
| `shopping-comparison` | `:4` | `/(?:옵션\|규격\|구성)[^\n]{0,30}(?:\d\|차이\|선택)/u` | 선택 기준 → 차이·공통점 → 조건별 판단 | `after-body`, 2문장, palette `#003960` (color `#334B70`) |
| `shopping-detail` | `:5` | `/소재\|작동\|구조\|관리\|세척/u` | 핵심 구성 → 사양·사용 조건 → 관리·제약 | `after-lead`, 2문장, palette `#823f00` (color `#664B38`) |
| `travel-itinerary` | `:6` | `/\d+\s*일차/u` (TRAVEL 최우선) | 일정 개요 → 원본 일차·순서 → 이동·체류 제약 | `before-body`, 2문장, palette `#004e82` (color `#315E68`) |
| `travel-scenic` | `:7` | TRAVEL 기본 폴백(`:29`) | 장소 특징 → 볼거리 근거 → 여행 선택 판단 | `before-heading`, 1문장, palette `#245b12` (color `#526044`) |
| `travel-conditions` | `:8` | `/불포함\|호텔\s*미확정\|취소\s*(?:수수료\|규정)\|선택관광\|동반자\|어린이\s*요금/u` | 동반자·선택 조건 → 포함·불포함 → 숙박·예약 제약 | `after-body`, 1문장, palette `#4f0041` (color `#655078`) |

공통: 나눔고딕, 왼쪽 정렬, 소제목 19px, 본문 16px `#333333`, 캡션 13px `#555555`, 줄간격 180%. **"고정 섹션 ID·제목·순서·분량과 QC가 템플릿보다 우선"** — 문체 템플릿은 톤만 바꾸고 섹션 구조는 못 바꾼다.

매칭은 `matchedSelection(:21)`이 `[product.description, ...(product.features || [])]`를 개행으로 이은 텍스트에 정규식을 **순서대로** 적용한다. 랜덤 요소는 없고, `product.name`은 보지 않는다. 정규식이 겹치면 앞선 분기가 이긴다(§14.5 R12).

### 스키마·폴백 템플릿

| 템플릿 | 파일 | 적용 대상 | 구성 | 제약 |
|---|---|---|---|---|
| 본문 청크 스키마 | `schema.ts:26-45` | 각 chunk. `includeMeta`는 chunkIndex 0만 | `sections{s00,s01,…}` 각각 `{role, title, lines[]}` + (meta) `title`, `hashtags[]` | strict, `additionalProperties:false`, 전 키 required, `role`은 단일값 enum, schemaName `blog_post_{kind}_{i}` |
| 수리 스키마 | `schema.ts:47-61` | `repairDraft` | `{section:{role,title,lines[]}}` / `{title}` | 섹션 1200토큰·제목 400토큰, temperature 0.6 |
| 로컬 폴백 | `local-template.ts:10-37` | 키 없음·`forceLocal`·생성 예외 | 제목 = `{keyword} {shortName} 일정과 포함사항`(여행) / `… 구성과 가격 확인`(쇼핑), 본문 = `fallbackLines` | 구조 동일. `source="local-template"`이면 **수리 루프가 한 번도 안 돎**(`index.ts:307`) |

---

## 5. 섹션 라이브러리 — 전체 역할 분류

### SectionRole 17종 (`types.ts:16-36`)

| 그룹 | role | shape | headerFormat | imageCount | kind |
|---|---|---|---|---|---|
| **공통 GEO** | `summary-glance` | `lines-3` | quotation | `[0,0]` | 양쪽 |
| | `key-facts` | `facts-list` | sectionTitle | 쇼핑 `[1,1]` / 여행 `[0,0]` | 양쪽 |
| | `faq` | `qa-3` | sectionTitle | `[0,0]` | 양쪽 |
| | `fit-checklist` | `checklist` | sectionTitle | 쇼핑 `[0,1]` / 여행 `[0,0]` | 양쪽 |
| **쇼핑** | `hook-problem` | `prose` | sectionTitle | `[0,0]` | SHOPPING |
| | `product-reveal` | `prose` | sectionTitle | `[1,2]` | SHOPPING |
| | `benefit` | `prose` | sectionTitle | `[1,2]` | SHOPPING |
| | `proof` | `prose` | sectionTitle | `[1,1]` | SHOPPING |
| | `use-case` | `prose` | sectionTitle | `[1,2]` | SHOPPING |
| | `comparison` | `prose` | sectionTitle | `[0,1]` | SHOPPING |
| | `offer-check` | `facts-list` | sectionTitle | `[0,1]` | SHOPPING |
| **여행** | `itinerary-overview` | `prose` | sectionTitle | `[1,1]` | TRAVEL |
| | `day-course` | `prose` | **quotation** | `[1,2]` | TRAVEL |
| | `inclusions` | `facts-list` | sectionTitle | `[1,1]` | TRAVEL |
| | `reasons-3` | `checklist` | sectionTitle | `[0,0]` | TRAVEL |
| | `booking-check` | `checklist` | sectionTitle | `[0,0]` | TRAVEL |
| | `closing` | `prose` | sectionTitle | `[0,1]` | TRAVEL |

### SHAPE_RULES — 형식별 수치 계약 (`section-library.ts:63-104`)

| shape | 줄 수 | 글자 수(공백 제외) | linePrefix | formatHint | validate 검사 |
|---|---|---|---|---|---|
| `prose` | 4~6 | 110~340 | `null` | 문장 4~6개, 한 문장 25~45자, 문장마다 줄바꿈 | **길이만** |
| `lines-3` | **정확히 3** | 60~180 | `null` | 1줄 무엇인지 / 2줄 누구에게 / 3줄 핵심 조건 | 길이 + **줄 수 정확** |
| `facts-list` | 4~7 | 60~300 | `"• "` (FACT_PREFIX `:60`) | `• 항목: 값`, 모르면 "예약/판매 페이지 확인" | **길이만** |
| `qa-3` | **정확히 6** | 150~420 | `null` | 정확히 3쌍, `Q.` 다음 `A.` | 길이 + **줄 수 + Q./A. 패리티** |
| `checklist` | 3~5 | 60~260 | `"▸ "` (CHECK_PREFIX `:61`) | `▸ 항목` 3~5줄, 조건형, 체험 단정 금지 | **길이만** |

### 순서 규칙

1. **순서는 코드가 소유한다.** `buildSectionTemplates`의 배열 리터럴 순서가 곧 본문 순서이고, 모델은 바꿀 수 없다(출력 스키마의 `role`이 단일값 enum).
2. **`summary-glance`는 항상 index 0**이며 대표 이미지(썸네일)가 그 앞에 온다.
3. **GEO 블록 4종의 위치**: `summary-glance`(맨 앞) → `key-facts`(앞쪽) → … → `faq`(끝에서 2~3번째) → `fit-checklist`(마지막 또는 closing 직전).
4. **커넥트 카드 앵커**: SHOPPING `key-facts` 뒤 / TRAVEL `itinerary-overview` 뒤 (`assemble.ts:61`). 이 role이 사라지면 발행이 실패한다.
5. **`sourceLine` 부착**: `role === "fit-checklist"` 섹션 끝에만 (`assemble.ts:101`).
6. **`disclosure`**: `sections` 배열 **마지막 원소**로 항상 push되고 **섹션 카운트에는 포함되지 않는다**(`assemble.ts:104`, `validate.ts:48`). 위치나 문안을 건드리면 이미지 인덱스와 섹션 플랜이 조용히 어긋난다 — **작업 전 §11을 반드시 읽어라.**
7. **축소 규칙**: SHOPPING은 `dropOrder`로 뒤에서 뺀 뒤 `slice(0, target)`, TRAVEL은 `slice(0, target)`만 — 여행은 섹션을 추가하면 **`closing`이 잘려나간다**.

### 필수 필드 (SectionTemplate 11개, 전부 required)

`role` · `title` · `headerFormat` · `shape` · `purpose` · `evidenceRule` · `imageIntent` · `imageCount` · `requiredKeywords` · `hints` · `fallbackLines`

---

## 6. 출하 프롬프트 조립 경로 — `scripts/simple-agent.ts`

> 이 절은 **실제로 모델에 전달되는 프롬프트**를 만드는 곳이다. §2~§5(spec-first)를 아무리 고쳐도 게이트를 통과하지 못하면 원고는 여기서 만들어진다. 출하 기본 설정이 바로 그 경우다.

### 6.1 발송 디스패처 — 세 갈래

`generateWithAI(:4541)`가 최종 발송을 담당하고 세 갈래로 나뉜다.

| 분기 | 위치 | 조건 | 동작 |
|---|---|---|---|
| 브라우저 | `:4547-4558` | `BROWSER_GPT_MODE`(= `BROWSER_GPT_MODE && ALLOW_CHATGPT_BROWSER_MODE`) | `chatgptContext`가 없으면 예외. 있으면 `runChatGPTBrowserDirect`. 실패 시 폴백 없이 재던짐 |
| Codex | `:4560-4579` | `AI_PROVIDER === "codex"` | `:4562 runCodexDraft({systemPrompt, userPrompt, imagePaths, timeoutMs: CODEX_DRAFT_TIMEOUT_MS, model: CODEX_DRAFT_MODEL, reasoningEffort: CODEX_DRAFT_REASONING_EFFORT, researchMode: connectKind === "TRAVEL" ? "cached" : "disabled"})` |
| API | `:4582` | 그 외 | `runOpenAiApi(systemPrompt, userPrompt)` |

**`CODEX_BROWSER_FALLBACK` 체인**(`:4574`): Codex 분기가 실패했을 때 `CODEX_BROWSER_FALLBACK_ENABLED && ALLOW_CHATGPT_BROWSER_MODE && chatgptContext` **세 조건이 모두 참일 때만** `runChatGPTBrowserDirect`로 전환한다(로그 `⚠️ Codex 작성 실패, ChatGPT 웹 자동작성으로 전환`). `CODEX_BROWSER_FALLBACK_ENABLED` 기본값이 `"false"`(`:215-216`)이므로 **기본 설정에서는 폴백이 없고** `Codex 작성 실패: <이유>`로 STEP 2가 끝난다.

Codex 경로의 최종 입력은 `scripts/lib/codex-draft-provider.ts`(133줄)가 만든다.
- `:41 buildWritingPrompt(systemPrompt, userPrompt, researchMode)` — 고정 서두 5줄(개발 절차·스킬 배제, `researchMode`에 따른 도구 사용 제한) + `[시스템 지시사항]\n<systemPrompt>` + `[사용자 요청]\n<userPrompt>`. **두 프롬프트를 한 문자열로 합친다.**
- `:22 readableImages` — detail 파일명 우선으로 **최대 4장** 첨부
- `:65 runCodexDraft` 실행 설정(`:74-94`): `project_doc_max_bytes: 0`, `sandboxMode: "read-only"`, `approvalPolicy: "never"`, `networkAccessEnabled: false`, `webSearchMode = researchMode`, 외부 스킬 `enabled:false`

### 6.2 spec-first 게이트 — `:4669-4676`

```
POST_SPEC_PIPELINE_ENABLED && specInput && !BROWSER_GPT_MODE
  && AI_PROVIDER === "openai"
  && !BRANDLINK_GENERATED_DRAFT_PATH && !BRANDLINK_DRAFT_CONTEXT_OUTPUT
```
통과하면 `runSpecFirstPipeline` 결과를 만들고 **`:4726`에서 즉시 return**한다. 즉 통과 시 `:4856 systemPrompt`와 `:4903 userPrompt`는 **아예 만들어지지 않는다**.

문제는 `AI_PROVIDER`다. `:206-207`이 `process.env.AI_PROVIDER || draftRuntimePolicy.AI_PROVIDER`를 읽는데, `scripts/lib/draft-runtime-policy.json`이 이 값을 `"codex"`로 고정하고 `docs/fixed-draft-settings.md:3`이 "선택 UI 제거"로 못박았다. **따라서 설치본 기본값에서는 게이트가 항상 탈락하고 아래 §6.3 경로가 돈다.** 환경변수로 `AI_PROVIDER=openai`를 주입한 실행에서만 §2의 spec-first 그림이 성립한다.

### 6.3 조립 순서 — 각 헬퍼가 프롬프트에 무엇을 넣는가

`step2_generatePost(:4588)` 한 함수 안에서 아래 순서로 문자열이 쌓인다.

| # | 지점 | 심볼 / 위치 | 프롬프트 기여분 |
|---|---|---|---|
| 1 | 사실 절단 | `:4600-4611` | `name` 300자, `description` 12_000자, `features` 각 500자·중복 제거 후 12개. **이 절단본이 이후 모든 블록의 입력** |
| 2 | 렌더 계약 조회 | `getPostCompositionContract` (`post-composition-contract.ts:413`) — `:4624` | 텍스트 없음. `targetCharacters`/`targetImages`/`targetSections` + 역할 팔레트 SHOPPING 11 / TRAVEL 13 |
| 3 | 적응형 프로필 조회 | `getAdaptiveEditorialProfile` (`adaptive-editorial-harness.ts:99`) — `:4625` | 텍스트 없음. `sectionRange {min, preferred, max}` |
| 4 | 섹션 수 파생 | `:4626-4637` | `minimum = max(contract.min, profile.min)`, `maximum = min(contract.max, profile.max)`, `bodySectionCount = clamp(preferred)` → 실측 **SHOPPING 5/7/10, TRAVEL 7/9/12** |
| 5 | 렌더 계약 블록 | `formatPostContractForPrompt` (`:801`) — `:4638` | systemPrompt에 `[유연한 렌더링 계약 post-composition-contract/v1]` + 권장 범위 줄(섹션 5~10개, 본문 1200~2800자, 이미지 최소 5·권장 8·상한 14) + `N. 역할=<id> | 목적=… | 근거=… | 이미지=…` 11/13줄 |
| 6 | 하네스 블록 | `formatAdaptiveEditorialHarnessForPrompt` (`:103`) — `:4639` | systemPrompt에 `[분석 우선 자유 생성 하네스 v1 · <팩 id>]` + 표본 수·수집일 + 관측 분포(본문 자수·이미지 장수 사분위) + 판단 질문 8/7줄 + 선택 전개 4줄 + 문체 힌트 5줄 + 금지 7/8줄 |
| 7 | 공유 계약 생성 | `createWritingPromptContract` (`writing-prompt-contract.ts:56`) — `:4640-4650` | 텍스트 없음. **여기서 `editorialTemplateId = selectEditorialTemplate(kind, product)`로 문체 6종 중 1개가 확정된다.** `hashtagCount`는 `NAVER_BLOG_HASHTAG_COUNT`, `draftMemo`는 `specInput?.memo ?? BRANDLINK_DRAFT_MEMO`, `verifiedExperienceNotes`는 `BRANDLINK_EXPERIENCE_MODE === "VERIFIED_EXPERIENCE"`일 때만 |
| 8 | 공유 계약 렌더 | `formatWritingPromptContract` (`:108`) — `:4651`, userPrompt 최하단(`:4995`)에 부착 | `[공유 필수 작성 계약 · writing-prompt-contract/v1]` + 제목 25~35자 + sections 5~10개 + 최소 1200자·권장 상한 2800자 + 섹션당 소제목·빈 줄·4~6문장 + 체험 금지 + evidenceFacts 규칙 + 해시태그 5개 + `title/evidenceFacts/sections/hashtags` JSON 하나만 출력 |
| 8a | ↳ 구조 가이드 | `formatWritingStructureGuide` (`writing-structure-guide.ts:6`) — 계약 내부 `:126` | `[자연스러운 구성 · 최초 작성과 수정에 공통 적용]` 4줄 + `[쇼핑 전개 선택]` 2줄 또는 `[여행 전개 선택]` 4줄 + 도입·첫 문장·모바일 줄바꿈·확인 사실 4줄 |
| 8b | ↳ **문체 템플릿** | `formatEditorialTemplate` (`editorial-templates.ts:73`) — 계약 내부 `:127` | `[선택 편집 템플릿: <id>]` + 관점 / 전개 / 말투 / 편집 의도 4줄. **새 문체 템플릿이 자동으로 프롬프트에 반영되는 유일한 지점** |
| 8c | ↳ 메모 규칙 | `formatDraftMemoRequirements` (`:30`) — 계약 내부 `:128` **그리고** systemPrompt `:4876` | `[사용자 초안 메모 · 최초 작성과 모든 수정에서 유지]` + 메모 원문 + `requestedTitle` 고정 지시. **같은 텍스트가 프롬프트에 두 번 들어간다** |
| 8d | ↳ 출력 예시 | `getWritingOutputExample` (`:94`) — 계약 내부 `:130` | `sentences.min`개(SHOPPING 4 / TRAVEL 5) 문장 + `hashtagCount`개 태그의 JSON 예시 |
| 9 | 체험 모드 | `:4652-4655` | systemPrompt에 `[검증된 실제 체험 메모]` + 노트, 또는 `[작성 모드: AI 정보 정리]` 2줄. `VERIFIED_EXPERIENCE`인데 노트가 20자 미만이면 `:4608`에서 예외로 **실행 자체가 중단** |
| 10 | SEO 브리프 생성 | `buildOpenCrabSeoBrief` (`opencrab-seo-brief.ts:644`) — `:4656-4663` | 텍스트 없음. `OPENCRAB_SEO_BRIEF_ENABLED=false`이거나 리서치 JSON이 없으면 **null** |
| 11 | SEO 브리프 렌더 | `formatOpenCrabSeoBriefForPrompt` (`:737`) — `:4664` | systemPrompt에 `[내부 SEO 참고자료]` + 기준일·매칭/confidence·워크플로우/팩 버전·상품 ID·가드 상태·카테고리·추천 검색어 + `참고 글 흐름:` + `제목 후보:` + `본문 섹션 후보:` + 이미지 목표 + 작성 규칙 + 발행 QA + 본문 금지 표현. **브리프가 null이면 이 블록이 통째로 사라지고 로그 한 줄만 남는다** |
| 12 | **spec-first 게이트** | `:4669-4676` → 통과 시 `:4726` return | 통과하면 이하 13~20은 실행되지 않는다 (§6.2, §12) |
| 13 | 상품 편집 플랜 | `buildProductEditorialPlan` (`product-editorial-plan.ts:563`) — `:4727-4741` | 텍스트 없음. `isTravel`이면 null. framework `source-backed-product-review-v3`, `blockedClaimRules` 7줄, `sections`는 **언제나 `SECTION_LIBRARY` 12개 전부** |
| 14 | 상품 플랜 렌더 | `formatProductEditorialPlanForPrompt` (`:583`) — `:4743` | **userPrompt §4**에 `[근거 기반 상품 리뷰 하네스 v3 · 문장 생성 금지 데이터]` 5줄 + `- 렌즈 <role> | 목적: … | 근거: … | 이미지 역할: …` 12줄 + `[제품 해석 데이터]` + `[사용 가능한 확인 사실]` + `[금지 주장]` 7줄. systemPrompt에는 안 들어간다 |
| 15 | 여행 4블록 | `formatTravelPageResearchForPrompt` / `formatTravelFactsForPrompt` / `formatTravelReviewAnalysisForPrompt` / `formatTravelEditorialPlanForPrompt` — `:4746-4761` → systemPrompt `:4866-4869` | `isTravel`일 때만, 각각 독립 블록으로 삽입 |
| 16 | 자체 품질검사 | `qualityEvidenceAnchors` `:4770-4794` → `qualitySelfReviewPromptBlock` `:4795-4813` | systemPrompt에 `[제출 전 내부 품질검사 · 본문에 체크리스트를 노출하지 않기]` 9줄. 앵커 최대 14개를 `" / "`로 인라인, 비면 "상품명과 수집 상세정보"로 대체 |
| 17 | 톤 힌트 | `randomIntro` `:4820-4837` / `randomEnding` `:4854` | userPrompt `## 이번 글의 톤`에 인트로·마무리 힌트 2줄. 여행 5개·쇼핑 5개 중 `Math.random()` 선택 — **프롬프트 조립 전체에서 유일한 비결정 요소** |
| 18 | **systemPrompt** | `:4856-4876` | 순서: 고정 1줄 → `buildHumanMobileStyleGuide(kind별 확장)` → 고정 5줄 → `NAVER_SEO_TITLE_RULES` → `HUMANIZE_RULES` → `openCrabPromptBlock` → 여행 4블록 → `adaptiveEditorialPromptBlock` → `qualitySelfReviewPromptBlock` → `compositionPromptBlock` → 고정 1줄 → `experiencePromptBlock` → `formatDraftMemoRequirements` |
| 19 | **userPrompt** | `:4903-4995` (사실 블록 `:4899-4901`, 여행 렌즈 `:4878-4897`) | 헤더 1줄 → `## 상품 정보` → (여행+메모면 원문 JSON) → `## 이번 글의 톤` → `## 작성 규칙` 1.제목 2.본문(`bodySectionCount`를 "중앙 참고값"으로 명시) 3.섹션 구조 4.렌즈 5.SEO 키워드 6.분석 기준 7.해시태그 8.AI 티 금지 → 맨 끝에 `mandatoryWritingPromptBlock`(=8) |
| 20 | 발송 | `:5126-5136` → `generateWithAI(:4541)` | `BRANDLINK_GENERATED_DRAFT_PATH`가 있으면 `readMcpGeneratedDraft`로 파일을 읽고 **모델 호출 자체를 생략** |

부가 경로: `BRANDLINK_DRAFT_CONTEXT_OUTPUT`가 설정돼 있으면 `:5021-5119`에서 systemPrompt·userPrompt·writingContract·outputSchema·qualityChecklist를 `brand-draft-context/v2` JSON으로 파일에 쓰고 `:5112`에서 return한다(모델 호출 없음). `contextJson`이 `800*1024` 바이트를 넘으면 예외.

### 6.4 프롬프트 텍스트가 세 벌로 갈라져 있다

| 경로 | 프롬프트 출처 | 언제 |
|---|---|---|
| spec-first | `post-spec/generate.ts:24 renderSystemPrompt` + `renderSectionInstruction` | 게이트 통과 시 |
| 단발(Codex / API) | `simple-agent.ts:4856` systemPrompt + `:4903` userPrompt | 게이트 탈락 시 — **출하 기본** |
| 브라우저 | `simple-agent.ts:2958 buildDirectBrowserGptPrompt` | `BROWSER_GPT_MODE` |

브라우저 경로는 인자를 `_systemPrompt`, `_userPrompt`로 받아 **본문에서 한 번도 참조하지 않는다.** 대신 `chatgptContext`에서 productFacts(설명 2,250자 / 복구 1,350자, features 900자), editorialEvidence(2,900 / 1,500자), seoEvidence(650 / 350자), sectionIdeas(650자)를 잘라 prefix+evidence+suffix로 재조립하고 suffix 뒤에 `formatWritingPromptContract`를 붙인다. 총 예산은 `CHATGPT_DIRECT_PRIMARY_PROMPT_MAX_CHARS = 8_500`(복구 `5_500`)이고, 초과하면 `chatgpt-direct-prompt.ts:47`에서 "ChatGPT 고정 프롬프트가 예산을 초과했습니다"로 **던진다**. 다른 두 경로에는 예산 검사가 없어 증상이 한쪽에서만 나타난다.

**세 경로가 공유하는 것은 `formatWritingPromptContract` → `formatWritingStructureGuide` + `formatEditorialTemplate` 뿐이다.** 새 템플릿을 세 경로 모두에 확실히 태우려면 `editorial-templates.ts`를 고치는 것이 유일하게 안전한 지점이다. 반대로 `editorialPromptBlock`(`:4764-4768`)은 systemPrompt·userPrompt 어디에도 들어가지 않고 `chatgptContext`(`:5017`) 경유 **브라우저 전용**이므로, 여기에 블록을 추가해도 Codex/API 경로에는 반영되지 않는다.

---

## 7. 주제글(topic) 템플릿 체계

> **§1.1을 다시 확인하라.** 주제글 구조는 `scripts/lib/templates/**`에 없다. 그 디렉터리는 `seoKeywords`(`topic-agent.ts:1878`)와 `categoryNames`(`:1897`)만 공급한다. 주제글 템플릿을 고치려고 그 디렉터리를 열면 하루를 버린다.

### 7.1 두 축

| 축 | 파일 | 무엇을 결정 |
|---|---|---|
| 기획축 | `src/lib/topic-workflow.ts` | `TopicType`(`:4` `travel|golf|knowledge`) × `TopicSubtopicRole`(`:5` `hook|scene|mistake|comparison|proof|takeaway`) 문자열 행렬. 서브토픽(기획 소제목) 문장 |
| 발행축 | `src/services/topic-task-pipeline.ts` | 실제 발행되는 소제목·요약·불릿·문단, 그리고 **섹션 수 4** |

`TopicType`은 `mapTaskTypeToTopicType(:1388)` → `topicCraftCategory` → `inferTopicTypeFromText(:1381)` 순으로 결정되고, 이후 **모든 행렬의 1차 인덱스**가 된다.

### 7.2 템플릿 행렬 전수

| 행렬 | 위치 | 모양 / 개수 | 비고 |
|---|---|---|---|
| `SUBTOPIC_HINT_TEMPLATES` | `topic-workflow.ts:335-352` | `Record<TopicType, string[]>` — 3 × 3 = **9개**. 자리표시자 `{topic}` `{hint}` | `buildWeightedSubtopics(:755)` 전용. 힌트에 `/비교|차이|사례/`면 role=comparison, `/기준|우선순위/`면 takeaway, 그 외 proof로 강제(`:810-811`). **조사 교정(`repairKoreanParticles:477`)이 적용되지 않는다** |
| `SUBTOPIC_ROLE_TEMPLATES` | `topic-workflow.ts:359-456` | `Record<TopicType, Record<TopicSubtopicRole, string[]>>` — 3 × 6 × 3 = **54개**. 자리표시자 `{topic}` `{keyword}` | `buildRoleAwareSubtopic(:506)`이 `templates[variant % templates.length]`로 선택 → `formatSubtopicTemplate(:458)` 치환 → `repairKoreanParticles(:477)`로 받침 기준 조사 교정. 재사용 상한 `templateCap = ceil(requestedCount/2)`, 어근 반복 상한 `maxRootRepeat = ceil(requestedCount/3)`, 후보 상한 `requestedCount * 9` |
| `SUBTOPIC_FALLBACK_KEYWORDS` | `:323-327` | travel 14 / golf 14 / knowledge 12 | 리서치 시그널이 0일 때의 시드 |
| `SUBTOPIC_PERSONA_HINTS` | `:329-333` | 타입별 5개 | `uniqueText(..., 4)`로 최대 4개만 투입 |
| `SUBTOPIC_SUFFIX_BY_TYPE` | `:353-357` | 타입별 8개 | `diversifyKeyword(:658)`가 `index % 8`로 선택 |
| **`headingSets`** | `topic-task-pipeline.ts:615-651` (`buildSectionHeadingByType`) | `Record<TopicType, Record<SectionKind, string[]>>` — 3 × 6 × 2 = **36개**, 자리표시자 없음 | **실제 발행 소제목의 최종 공급원.** 조회는 `headingSets[topicType]?.[kind] || headingSets.knowledge[kind] || headingSets.knowledge.scene` → `selected[index % selected.length]` |
| `summaries` | `:683-717` (`buildSectionSummary`) | `Record<SectionKind, Record<TopicType, string>>` — 6 × 3 = **18개** (인덱스 순서가 뒤집혀 있음) | 소제목 밑 `<strong>` 한 줄 요약 |
| `defaults` | `:725-758` (`buildSectionBullets`) | 6 × 3 × 2 = **36개** | `comparison`/`proof`/`takeaway`에만 `.slice(0, 2)` 부착 |
| `paragraphsByKind` | `:1158-1243` (`buildDeterministicSectionBody`) | 6 × 3 셀 × 2문단 | 모델 없이 본문을 찍어내는 결정론적 생성기. 폴백 후보·폴백 정리본·서사 후보가 전부 이걸 쓴다 |
| `leadPatterns` / `fallbackPatterns` | `:513-582` (`buildPlayfulTitle`) | 타입별 lead 3 + fallback 4, `TITLE_FALLBACK_ENDINGS(:422)` 4개 | `safeLead` 활성 조건: 18자 이하 AND `GENERIC_TITLE_PATTERNS` 불일치 AND `/(포인트|기준)$/` 아님 |

### 7.3 흐름

`prepareTopicTask(:4486)` 한 함수에 직렬로 들어 있다(단계: RESEARCHING → CANDIDATES_READY → SELECTED → POLISHING → PREPARED, 잠금 `acquirePrepareLock(:3582)`, stale 20분).

1. TopicType 결정 → 2. 리서치 시그널 `.slice(0, 24)` → 3. 서사 브리프 3개(`buildNarrativeAngleBriefs:2023`, 역할 순서 3세트 하드코딩 `:2036-2043`) → 4. plan 풀(`buildFallbackCandidatePlans:1944`) → 5. 외부 후보 수집(`requestTopicCraftCandidates:2304`) → 6. 점수화(`scoreTopicCandidate:1659`) → 7. 선택(`decideSelectedCandidate:2783`, 1·2위 차 > 4면 모델 호출 없음) → 8. `polishTopicCandidate(:3319)` + `topic_polish_writer` 스키마 → 9. `runCodexEditorialPass(:2702)`(실패는 조용히 무시) → 10. **`finalizePolishedContent(:1252)`** → 11. 이미지 슬롯(`attachSectionImageSlots:3566`, `imageSlotId = section-${index}`) → 12. `renderTopicContentToHtml`(`topic-task-contract.ts:225`) / `preparedSectionsToPublishBlocks(:274)` → 13. `getTopicTaskContentReadiness`.

`finalizePolishedContent`는 소제목이 제목과 같거나, 42자 초과·5자 미만이거나, `isGenericHeading(:761)`(`/^핵심 정리$/` `/^실전 포인트$/` `/^마무리$/` `/^포인트 \d+$/` `/^정리 \d+$/`)에 걸리거나, 깨졌거나, 중복이면 `buildSectionHeadingByType`으로 교체한다(`:1293-1302`).

### 7.4 섹션 수 4가 6곳에 하드코딩돼 있다

| 위치 | 형태 |
|---|---|
| `topic-task-pipeline.ts:1267` | `const desiredCount = 4;` (`finalizePolishedContent`) |
| `:3050` | `sectionCount = 4` (`buildFallbackPolishedContent`) |
| `:3344` / `:3345` | 구조화 스키마 `sections.minItems: 4` / `maxItems: 4` (같은 스키마 `:3338`/`:3339`는 `highlights.minItems: 2` / `maxItems: 3`) |
| `:2951` | polish 프롬프트 문자열 "섹션은 반드시 4개다." |
| `:2735` | 교정 패스 규칙 "sections 4개" |
| `:1714` | 점수 `sectionShapeScore` — 4개면 **22점**, 5개 6, 3개 7, 6개 2, 그 외 0 |
| (게이트) `topic-task-content-readiness.ts:732` | `sections.length === 4`여야 "본문 구조" pass, 그 외 warn. `:543` 3개 미만이면 불합격 |

`normalizeSectionKind(:584)`와 `buildNarrativeRoleOrder(topic-workflow.ts:490)`는 1~5를 지원하지만(기본 배열 4→`[hook, scene, comparison, takeaway]`, 5→`[hook, scene, mistake, comparison, takeaway]`) **실제 경로는 4 외의 값을 만들 수 없다.** 하나만 바꾸면 점수·게이트·정규화가 서로 싸운다.

### 7.5 주제글에서 실제로 도는 것과 죽어 있는 것

- `SUBTOPIC_ROLE_TEMPLATES`(54개)와 `SUBTOPIC_HINT_TEMPLATES`(9개)는 **기본 설정에서 실행되지 않는다.** 유일한 도달 경로인 `planSubtopics`(`topic-workflow.ts:1478-1490`) 호출이 `topic-task-pipeline.ts:1950-1951`에서 `TOPIC_EXPERIMENTAL_SUBTOPIC_PLANNER === "true"`로 막혀 있다.
- 켜더라도 `plannedLooksUsable(:1954-1966)` 검사가 "처음엔 별거 / 딱딱해지 / 밋밋해지" 같은 문자열이 있으면 계획을 통째로 버리는데, **`knowledge.hook` 템플릿 자체가 "처음엔 별거 아닌데"와 "딱딱해지는 건"을 포함**하고 있어 knowledge 타입에서 hook이 1번 자리에 오는 한 사실상 항상 거부된다.
- **실제로 발행되는 구조는 `headingSets` / `summaries` / `defaults` / `paragraphsByKind` 쪽이다.** 주제글 문구를 바꾸려면 `topic-task-pipeline.ts`를 고쳐야 한다.
- `runOpenAiStructured(:2573)`의 시그니처가 `_schema: Record<string, unknown>`로 스키마를 받기만 하고 쓰지 않는다. `topic_polish_writer`의 `minItems`/`maxItems`/`minLength`가 모델에 전달되지 않을 수 있고, 구조 보장은 프롬프트 문구와 `finalizePolishedContent`의 사후 정규화에 의존한다. **스키마 값만 바꾸면 아무 일도 안 일어날 수 있다.**

---

## 8. 프롬프트 / 스타일 계약

### 문체 규칙 — `scripts/lib/blog-writing-style.ts`

`buildHumanMobileStyleGuide(extra)` = `HUMAN_MOBILE_STYLE_GUIDE`(`:1`, 17줄) + `MOBILE_BODY_RULES`(`:21`, 5줄) + `HUMAN_REVIEW_SAFETY_RULES`(`:40`, 4줄) + kind별 확장. `BLOG_HUMANIZE_MOBILE_STYLE=false`면 한 줄로 축소된다.

**톤**
- 부드러운 `~요체` 기본, 같은 어미 반복 금지
- 한 문장 **25~45자**, 길면 두 문장으로 분할
- **1~2문장마다 줄바꿈** (`getMobileSectionLinePolicy`: preferred TRAVEL 5 / SHOPPING 4, hardMinimum 3)
- 문단 첫머리 "먼저/그리고/또/그래서" 반복 금지
- 인사말로 시작 금지

**금지 표현**
- 상투구: `결론적으로` `종합적으로` `본 포스팅에서는` `최적의 선택` `완벽한 제품`
- 단정형: `써보니 확실히` `무조건` `완벽하게` `검증된`
- 대조 구문 반복: `~이 아니라 ~이다`
- 은유: `여정` `~자리` `진짜 기준`
- 과잉 안심: `걱정 안 하셔도 돼요` `절대 ~하지 않아요`
- 제목·소제목 **이모지 금지**
- 낚시성 6종 정규식 (`:104-111`): `/완벽\s*가이드/` `/완전\s*정복/` `/총\s*정리/` `/핵\s*꿀팁/` `/꿀팁\s*(zip|집)/` `/역대급/`

**필수 요소**
- 아쉬움 / 참고할 점 **1개 이상**
- 구매 유도 문장은 **한 번만**
- 확인 안내·일반론 문장은 **섹션당 1개까지** (`generate.ts:38`)
- 섹션마다 전용 근거 **최소 1개**를 수치·이름 그대로 사용

**kind별 확장**
- `TRAVEL_VLOG_STYLE_GUIDE`(`:48`, 14줄): 주인공은 상품이 아니라 여행지 / 도착 장면 → 배경 → 활동 → 다음 장소 / 추정형(`보입니다` `~인 것 같아요` `판단됩니다`) 금지 / 거짓 1인칭(`제가 다녀왔어요` `묵어봤어요`) 금지 / 각 핵심 장소마다 배경지식1 + 장면1 + 즐길거리1 + 팁1
- `SHOPPING_EXPERT_REVIEW_STYLE_GUIDE`(`:66`, 11줄): 상세페이지 낭독 반복 금지 / 기능은 문제 → 작동 방식 → 사용 장면 변화 순서 / 스펙 직후 다음 문장에서 사용 장면 해석 / 구매후기 원문이 수집된 경우에만 반복 장점 요약 / `써보니` `받아보니` 금지 / 가격·할인·배송은 리뷰 종료 후 한두 문장

`NAVER_SEO_TITLE_RULES`(`:93`)는 `## 네이버 검색 제목 규칙 (필수)` 5줄로 **토글 없이 항상** 들어간다.

### 제목 계약
- `25~35자` (`seo.title.minChars/maxChars`, `writing-prompt-contract.ts`의 `title {min:25, max:35}`와 동일)
- 핵심 키워드 **앞배치** (`keywordFirst: true`, 검증은 12자 이내면 pass)
- `mustIncludeTokens` — TRAVEL은 `destinations[0]`, SHOPPING은 `getProductTokens[0]`
- 이모지·특수기호·낚시성 문구 금지
- `stripClickbaitFromTitle`은 제거 후 결과가 8자 미만이면 원본 유지

### 해시태그 계약
- `count: 5`
- required 우선 — TRAVEL `[destination, "{destinations[0]}패키지", "패키지여행", ...brief.hashtags 2개]` / SHOPPING `[primaryKeyword, ...brief.hashtags 3개, productTokens 1개]`
- `banned = GENERIC_HASHTAGS` 22종: 추천/후기/리뷰/비교/순위/가격/장단점/일상/가성비/생활용품/쇼핑/쇼핑추천/구매전확인/상품정보/옵션확인/구성확인/가격비교/할인정보/실속쇼핑/네이버쇼핑/여행/여행스타그램
- `#` 없이 단어만 출력, 조립 시 정규화

### AI 티 스캐너 — `scripts/lib/humanize-korean.ts`

`scanAiTells`: `score = Σ (S1 ? 5 : 2) × min(count, 8)`

- **S1 7종**: D-1 종결 상투구 / D-2 과장 상투구 / D-4 hype 형용사(`혁신적인` `획기적인` `압도적` `폭발적`) / A-7 `가지고 있다` / A-8 이중 피동(`되어진다` `~지게 된다`) / C-5 이모지(threshold 4) / C-11 연결어미 뒤 쉼표(threshold 5)
- **S2 9종**: A-2 `~를 통해`(2) / A-1 `~에 대해`(2) / A-10 `~할 수 있다`(4) / I-1 `것이다·것입니다`(3) / D-2b `~라고 할 수 있다`(1) / C-1 첫째·둘째·셋째(2) / C-9 숫자 괄호 인덱싱(1) / H-1 문두 접속사(2) / F-1 정도부사 `매우·대단히·극히·굉장히`(3)

**임계값이 경로마다 다르다**: spec-first는 섹션별 `score >= 8`(`validate.ts:193`), 단발 경로는 본문 전체 `score >= BLOG_HUMANIZE_REWRITE_THRESHOLD`(기본 10). 임계를 넘으면 `simple-agent.ts:5206`이 `rewriteSectionsForHumanTone`에 `[formatEditorialTemplate(...), formatDraftMemoRequirements(...)]`를 넘겨 **템플릿 텍스트가 윤문 단계에도 다시 들어간다.**

### 품질 신호 — `scripts/lib/draft-quality-signals.ts`

- `GUIDANCE_SENTENCE_PATTERN`(`:33`): 확인해/살펴보/비교해보/체크해/참고하세요/판단하기 어렵/공개되지 않/권장해요 …
- `GENERAL_STATEMENT_PATTERN`(`:40`): 상황에 따라/사람마다/경우가 많/달라질 수 있/좋을 수 있/무난해요/기본적으로/일반적으로/대체로 …
- 일반론은 패턴에 걸리면서 **숫자도 evidenceToken도 없는** 문장만 집계
- 반복 판정 `similarityThreshold 0.72`, `minSentenceLength 12`, samples 최대 5

### 발행 품질 배점 — `scripts/lib/brandlink-content-readiness.ts`

| 카테고리 | 배점 | 임계 |
|---|---|---|
| `productEvidence` 상품/여행지 고유 근거 | 25 | — |
| `sceneLinkage` 기능→장면 연결 | 20 | — |
| `specificity` 사용법·낭독 비율 | 15 | 낭독 ≤ 0.15 |
| `diversity` 문단 다양성·반복 | 15 | 반복 ≤ 2 |
| `usefulness` 장점·제약·대상·결론 | 15 | — |
| `clarity` 확인 안내·일반론 비율 | 10 | TRAVEL 0.16 / SHOPPING 0.24 |

통과선 `BRANDLINK_QUALITY_PASS_SCORE = 70`. 한 카테고리라도 fail이면 총점과 무관하게 `verdict = "quality"`.

**하드 차단**: safety 6종(`link-in-body` `missing-disclosure` `unsupported-experience-claim` `commission-rate-exposed` `internal-guidance-leak` `category-mismatch`) + structure 7종(`non-generative-fallback` `missing-product-name` `too-few-sections` `too-short-content` `too-few-hashtags`(<3) `missing-representative-image` `composition-quality`). 블로커가 하나라도 있으면 `:470`에서 `canPublish = false` — 점수와 무관하다.

---

## 9. 이미지 슬롯 구조

### 슬롯이 섹션에 묶이는 순서

```
1. prepareImagePool (image-plan.ts)
   후보 중복 제거 → sharp probe(치수 실측)
   usable 판정:
     BAD_NAME  /banner|event|coupon|benefit|delivery|shipping|review|notice|guide/i
               (hero·card는 면제)
     card    : 600×600 이상
     TRAVEL  : isRepresentativeTravelImageDimension(640×420, 비율 0.72~2.15)
               || isUsableBlogProductImageDimension
     SHOPPING: 500×500 이상 && isUsableBlogProductImageDimension
   body 정렬 우선순위: card > source > crop > score 내림차순
   usable한 hero는 strategy를 "source"로 바꿔 body 맨 앞에 unshift
   spare = !usable && kind!==hero && 300×300 이상

2. 부족분 보강 (shortfall = max(0, minBody - body.length))
   TRAVEL   → fetchStockImages   키워드 = highlights 3 + destinations 2 + " travel"
                                 strategy "stock", score -100
                                 ※ 스톡 키가 없으면 조용히 부족 상태로 진행
   SHOPPING → buildCollageImage  재료 = spare + crop, 2장=좌우 / 3~4장=2×2 격자
                                 1080 정사각, gap 16, strategy "collage", score -50

3. 섹션 수 파생  (resolved = pool.body.length)

4. imageCount 정규화 (index.ts:199-202)
   imageCount[1] > 0  →  imageCount[0] = max(1, imageCount[0])
   ⇒ [0,1] 선언은 실제로 [1,1]이 된다

5. assignImageSlots
   (a) strategy "card" 이미지를 imageIntent가 /일정|overview/ 이거나
       section.index === 2 인 섹션에 우선 배정
   (b) 모든 섹션의 imageCount[0](하한)까지 큐에서 pop
   (c) 남으면 imageCount[1](상한)까지 재분배
   slot.id = `s{2자리 index}-{a|b|c}`,  hero는 id "hero" / sectionIndex -1

6. 슬롯 id를 SectionSpec.imageSlotIds에 역주입 (index.ts:225-228)

7. buildCompositionSectionPlan → CompositionSectionPlan[]
   { role, imagePaths[], imageIntent, imageMin, imageMax, headingStyle, earlyConnectCard }
   ※ imageMin은 확보 장수가 아니라 "선언된 하한"을 그대로 싣는다 (assemble.ts:66-71 의도 주석)

8. resolvePostDocument
   :608 고지 분리 → :611-613 contentSections
   :614-615 sectionPlan.length === contentSections.length 일 때만 채택
   :620 sectionImagePaths?.[index]  ← 고지 제거 후 인덱스 (§11 경고)
   플랜 밖 이미지는 하한 미달 섹션 → 상한 여유 섹션 → 마지막 허용 섹션 순으로 얹힘
   imagePaths[0] → role "thumbnail" 노드
   이미지 노드 위치는 editorial.policy.layout.image
     ("before-heading" | "before-body" | "after-lead"(기본) | "after-body")
   imagePaths.length > 1 → layout "sequence"
```

### 썸네일 규칙

- **대표 이미지 = 본문 앞 hero 슬롯**(`sectionIndex: -1`). `summary-glance`가 `imageCount [0,0]`인 이유는 그 앞에 hero가 오기 때문이다.
- `uploadImagePaths = [heroOverridePath ?? imagePlan.hero.path, ...slots.map(path)]` — `path.resolve` 기준 중복 제거. **첫 장이 반드시 hero**여야 한다.
- 생성 썸네일이 있으면 `AssembleOptions.heroOverridePath`로 갈아끼운다.
- 저장된 썸네일 재사용 조건: 1080×1080 정사각. 구형 16:9 결과물은 버려진다.
- 생성형 썸네일의 카피·프롬프트·QC는 §10.

### QC / 교정 루프

| 단계 | 검사 | 실패 시 |
|---|---|---|
| spec 검증 | `spec.imagePlan.shortfall > 0` (`validate.ts:220-222`) | **P0 `IMAGE_SHORTFALL`** → `status = "BLOCKED"`, `canPublish = false`. `UNREPAIRABLE` 집합에 있어 **재생성으로 절대 해소되지 않는다** |
| spec 검증 | `shrinkApplied` | warn |
| 렌더 QC | 섹션별 `sectionImageBounds().min` 미달 | PREMIUM → blocker(−22점) / STANDARD → warning(−6점) |
| 발행 게이트 | 대표 이미지 없음 | structure 차단 `missing-representative-image` (단, `mode:"editorial"`이면 제외) |
| 수리 루프 | 초안 패키지 빈 슬롯 | `planSectionImageRequests`가 `max(missing, generationMissing)`만큼 재요청 → 성공 1건마다 즉시 커밋 → `imageGeneration.status` = running/complete/incomplete |

**주의**: 이미지 하한 수치가 4곳에서 독립 관리된다 — spec `minBody`(SHOPPING 4 / TRAVEL 5), 렌더 계약 `targetImages.min`(5 / 7), 기술 게이트(720×480), `isRepresentativeTravelImageDimension`(640×420).

---

## 10. 썸네일 카피 / 프롬프트 레이어

### 10.1 구조

이미지 안에 그려질 **한글 문구는 코드가 만든다**. SHOPPING은 `scripts/lib/product-thumbnail.ts`의 `buildProductThumbnailCopy`(`THUMBNAIL_THEMES` 키워드 정규식 → headline/subline/cta, 미매치 시 `DEFAULT_COPY`), TRAVEL은 `scripts/lib/travel-content.ts:606 buildTravelThumbnailCopy`, 또는 썸네일 스튜디오에서 사용자가 편집해 `Setting`에 저장한 값이다. `scripts/lib/thumbnail-gen/prompt.ts`는 그 한글 문자열을 큰따옴표로 감싸 "이 문자열들만, 글자 그대로 그려라"로 삽입하는 **프롬프트 조립기**다.

프롬프트 블록 순서는 항상 같다:
```
헤더 지시문 → 사실 블록(상품 또는 여행) → COMMON_LAYOUT(prompt.ts:59)
→ 가시 텍스트 목록 textLines(prompt.ts:49) → 포토리얼 장면(무드 또는 inferScenePrompt)
→ HARD_NEGATIVES(prompt.ts:72)
```
`buildShoppingThumbnailPrompt(:90)`와 `buildTravelThumbnailPrompt(:130)`가 이 골격을 공유하고 사실 블록과 장면 소스만 다르다.

| 구성 요소 | 위치 | 내용 |
|---|---|---|
| `ThumbnailCopy` | `prompt.ts:11` | `{ productNameLabel, headline, subline, badge, cta }` — **`cta`는 프롬프트에도 QC 기대값에도 전달되지 않는다**(§14.2 D9) |
| `ThumbnailMood` | `prompt.ts:19` | SHOPPING 5종(`auto`는 `scene`이 빈 문자열이라 항상 `inferScenePrompt` 폴백) / TRAVEL 4종(미매치 시 `TRAVEL_MOODS[0]`) |
| `COMMON_LAYOUT` | `prompt.ts:59` | 1:1 정사각 / "20% 크기에서 읽혀야 함" / 사방 10% 세이프존 / 상단 약 40% 헤드라인·하단 약 60% 실사 장면 / **텍스트 요소 최대 3개** / 텍스트가 피사체를 덮지 않을 것 / 한글은 글자 그대로 렌더·번역·축약·추가 금지 |
| `textLines` | `prompt.ts:49` | headline + subline + productNameLabel + badge = **최대 4줄**. 양쪽 빌더가 `includeBadge=true` 고정이라 `COMMON_LAYOUT`의 "최대 3개"와 충돌한다 |
| `HARD_NEGATIVES` | `prompt.ts:72` | 오탈자·깨진 한글·추가 캡션·잘린 텍스트 / 수수료·최저가·1위·워터마크·가짜 로고 / 플랫 벡터·아이콘·카툰 / 폰·노트북 목업 |
| `LIMITS` / `BLOCKED_COPY` | `product-thumbnail-settings.ts:20, :28` | `{productNameLabel: 36, headline: 24, subline: 44, badge: 16, cta: 20}` / `/(?:직접\s*(?:써|사용|구매)|인생템|최저가|품절\s*임박|무조건\s*추천|No\.?\s*1|1위)/iu` — 사용자 편집 카피의 유일한 하드 검증(초과·위반 시 throw) |

### 10.2 QC → 교정 루프

- 배점 `QC_MAX`(`qc.ts:51`): `productName 25 / fidelity 20 / korean 15 / readability 15 / photoreal 15 / layout 5 / forbidden 5` = 100. 채점 프롬프트(`:129-153`)가 이 상수를 문자열 보간으로 직접 박아 넣으므로 **배점만 바꾸면 프롬프트 문구까지 자동 반영**된다.
- 합격선 `qcMinScore()` 기본 **95점**(`PRODUCT_THUMBNAIL_QC_MIN_SCORE`, 50~100만 허용).
- `AUTO_FAIL` 6종(`qc.ts:63`): `productDistorted` `productNameMissing` `koreanTypo` `textCut` `forbiddenInfo` `mockup` — **점수와 무관하게 즉시 불합격**. 나머지 4종(`productSmall` `notPhotoreal` `lowContrast` `extraText`)은 감점만.
- 불합격이면 `corrective.ts:7 CORRECTIONS`(`Record<QcFailureCode, string>` — 코드 추가 시 컴파일 에러로 누락을 잡아준다)에서 교정문을 뽑아 `buildCorrectivePrompt`가 원본 프롬프트 뒤에 `Corrections required (attempt N)` 블록으로 붙인다. 실패 코드 없이 점수만 미달이면 `QC_MAX[key] - value`가 가장 큰 항목의 교정문을 대신 붙인다(`:22-33`).
- 최대 시도 `maxThumbnailAttempts()` 기본 **4회**(`PRODUCT_THUMBNAIL_MAX_ATTEMPTS`, 1~6). 통과하면 `<basename>.qc.json`을 남기고, 못 넘기면 `null`을 반환해 호출자가 로컬 합성으로 강등한다(`simple-agent.ts:1067`, `thumbnail/route.ts:198`). 생성 자체가 실패하면 재시도 없이 즉시 중단(`generate.ts:71`).

### 10.3 로컬 합성 템플릿 — `scripts/lib/thumbnail-layout-v2.ts`

생성형과 별개인 결정적 SVG 합성 경로다(`product-image-lock.ts`, `travel-thumbnail.ts`가 소비).

- 캔버스 `THUMBNAIL_V2_WIDTH/HEIGHT` = **1080×1080**, Pretendard-ExtraBold를 base64로 인라인
- `fitThumbnailHeadline`이 sharp `.trim()` 실측 폭으로 폰트 크기를 이분 탐색해 최대 2줄에 맞춘다. `lineHeight = round(fontSize * 1.14)`
- 고정 수치: headline `maxHeight 286`, `minFontSize 58`, `maxFontSize 112`(full)/`96`(side); `textBox` full `{x:64, width:780}` vs side `{x:62, width:500}`; `headlineY` `700`(full)/`310`(side); eyebrow `maxHeight 40` / 24~30pt / 1줄; subline `maxHeight 45` / 24~32pt / 1줄
- `ThumbnailV2Style` 6종(`:8`)이 background/accent/text/eyebrow/panel 5색을 결정하고 `travel-` 접두사로 그라디언트 방향과 `subjectSide` 기본값이 갈린다
- `generateThumbnailCropPreviews`는 540×540, 540×405, 540×304, 120×120 크롭을 뽑는다(120px이 "20%에서 읽히는가" 육안 확인용)

### 10.4 `skills/product-photo-thumbnail-copywriting/` 판정 — 코드는 이 디렉터리를 참조하지 않는다

**결론: 코드 참조 0건. 문서 아티팩트다. 이 문서를 고쳐도 썸네일은 달라지지 않는다.**

근거:
1. 저장소 전체(`node_modules` 제외)에서 문자열 `product-photo-thumbnail-copywriting`이 나타나는 위치는 **그 디렉터리 자신의 두 곳뿐**이다 — `skills/product-photo-thumbnail-copywriting/SKILL.md:2`의 frontmatter `name`과 `agents/openai.yaml:5`의 `default_prompt`. 자기 참조 외에는 어떤 참조도 없다.
2. `.ts`/`.tsx`에서 `skills`를 경로로 쓰는 유일한 코드는 `scripts/lib/codex-draft-provider.ts:79`인데, 그것은 `$CODEX_HOME/skills/opus-fable/SKILL.md`라는 **사용자 홈 경로**이지 이 디렉터리가 아니다(게다가 그 스킬은 `enabled:false`로 꺼져 있다).
3. `package.json`의 electron-builder `files`(`scripts/**/*`, `.next/**/*`, `public/**/*`, `src/**/*`, `prisma/**/*` 등)와 `extraResources` 어디에도 `skills/`가 없어 **설치본에 패키징조차 되지 않는다.**

이 디렉터리는 외부 에이전트용 지침 문서이며, 코드가 이미 구현한 규칙을 사람이 읽을 수 있게 서술한 병렬 사본이다. 문제는 **수치가 코드와 다르다**는 점이다(§14.4 X13). 캔버스는 `references/copy-and-layout-rules.md`가 1600×900, `SKILL.md`가 1024×1024, 코드는 1080×1080(로컬 합성) / 1024×1024(생성 API); 헤드라인 한도는 문서 12자·"약 10자" vs `condenseHeadline(headline, 12)` vs `LIMITS.headline 24`; 여백은 문서 56px 절대값 vs `COMMON_LAYOUT` 10% 상대값; 재시도는 `ProductThumbnail.md §11` "기본 최대 5회" vs `maxThumbnailAttempts()` 기본 4. **코드가 유일한 진실이며, 이 문서들을 근거로 상수를 고치면 안 된다.**

---

## 11. 제휴 고지(disclosure) 레이어

### 11.1 어디에 사는가

고지문은 섹션이 아니라 **`PostSpec`의 별도 필드**다.

| 지점 | 위치 | 내용 |
|---|---|---|
| 상수 | `scripts/lib/post-spec/index.ts:69 SHOPPING_DISCLOSURE` / `:74 TRAVEL_DISCLOSURE` | 선행 빈 줄 2개 + `이 포스팅은 네이버 {쇼핑\|여행} 커넥트 활동의 일환으로, 판매 발생 시 수수료를 제공받습니다.` + 빈 줄 + `자세한 {상품 정보\|일정과 예약 정보}는 아래 {쇼핑\|여행}커넥트에서 확인해보세요.` |
| 확정 | `index.ts:265` | `disclosure: kind === "TRAVEL" ? TRAVEL_DISCLOSURE : SHOPPING_DISCLOSURE` |
| 타입 | `post-spec/types.ts:147` | `disclosure: string` — `sections: SectionSpec[]`와 **나란한 필드** |
| 조립 합류 | `assemble.ts:104` | `sections.push(spec.disclosure)` — 배열 **마지막 원소** |
| 검증 합류 | `validate.ts:48` | `sections: [...sectionTexts, spec.disclosure]` (게이트 호출용 임시 결합) |

**섹션 수 밖이다.** `minBody`(4/5), `targetBody`(8/10), `sectionCount`(8~12) 어디에도 포함되지 않고, 섹션 템플릿 배열에도 들어가지 않는다. 초안 단계 검증에서는 `validate.ts:62-66`이 `gate:disclosure`/`gate:hashtags` 신호를 fail이어도 **warn으로 강등**한다 — 조립 단계에서 코드가 확정하기 때문이다.

### 11.2 발행 준비도 게이트가 여기서 하드 차단한다

`scripts/lib/brandlink-content-readiness.ts`
- `:512` `bodySections = sections.slice(0, -1)`
- `:525` `mainSectionCount = sections.length - 1` → `contract.targetSections.min`(SHOPPING 5 / TRAVEL 7)과 비교
- `:526` `disclosureText = sections[sections.length - 1]`
- `:529-532` `(쇼핑|여행)\s*커넥트` AND `수수료` AND `제공` 세 정규식을 **모두** 만족해야 `hasDisclosure`
- `:762` 불만족이면 `{ code: "missing-disclosure", tier: "safety" }` 블로커 push → `:470`에서 `canPublish = false`. **점수와 무관한 하드 차단이다.**

세 계산이 모두 "마지막 원소는 고지문"을 무조건 전제한다. 고지 없이 `sections`를 넘기면 진짜 마지막 본문 섹션이 고지문으로 검사되어 `missing-disclosure`가 뜨고, **동시에** 본문 섹션 수가 1 적게 세어져 `too-few-sections`가 함께 뜬다. 하나의 원인이 서로 무관해 보이는 두 블로커로 나타난다.

### 11.3 ⚠️ 경고 — 고지 위치·문안을 건드리면 이미지 인덱스와 섹션 플랜이 조용히 어긋난다

`src/lib/post-composition-contract.ts`의 `resolvePostDocument`는 고지문을 본문에서 다시 떼어낸다.

```
:608  const separated = options.sections.map(splitAffiliateDisclosure);
:609  첫 고지 문장을 disclosureSection 으로 분리
:611-613  contentSections = 고지가 제거되고 남은 내용만
:614-615  plan = options.sectionPlan.length === contentSections.length ? options.sectionPlan : null
:620  contentSections.map((_, index) => options.sectionImagePaths?.[index])
```

`spec.disclosure`는 `splitAffiliateDisclosure(:438)`의 두 replace로 **완전히 비워져** `contentSections`에서 통째로 탈락한다. 그래서 지금은 `contentSections.length`가 본문 섹션 수와 정확히 같고, `simple-agent.ts:9387`이 넘기는 `sectionImagePaths`(본문 전용 순서)와 `sectionPlan`(본문 전용)이 **우연히 정렬된다.**

이 정렬은 세 조건 중 하나만 깨져도 무너진다:

1. **고지문을 마지막이 아닌 위치로 옮기는 경우**
2. **`SHOPPING_DISCLOSURE`/`TRAVEL_DISCLOSURE` 문안을 바꿔 `splitAffiliateDisclosure` 정규식과 어긋나게 하는 경우** — 첫 정규식은 `(이 글은|이 포스팅은|본 글은) … (쇼핑|여행) 커넥트 … 수수료`를, 두 번째는 `자세한 (일정과 예약|상품) 정보는 아래 (여행|쇼핑)커넥트에서 확인해보세요.`를 리터럴에 가깝게 매칭한다. "커넥트"와 "활동" 사이에 마침표를 넣거나 유도 문장의 어미만 바꿔도 어긋난다.
3. **어떤 본문 섹션이 split 후 빈 content가 되어 탈락하는 경우**

깨졌을 때 벌어지는 일:
- `:620`에서 그 지점 이후 **모든 섹션이 한 칸씩 당겨져 "다음 섹션의 이미지"를 받는다.** 예외도 에러도 로그도 없다.
- `:614-615`에서 `plan`이 조용히 `null`이 되어 `allocatePlannedImages` 대신 `allocateFreeformImages`가 돌고, 섹션 id도 플랜 기반이 아닌 계약 기본 id로 바뀐다. `imageIntent` · `headingStyle` · `imageMin`/`imageMax` · `earlyConnectCard` 배치가 **전부 사라지는데 어떤 경고도 나오지 않는다.**

`docs/full-code-audit-2026-09-07.md`의 **H21**(섹션 제거 시 위치 기반 인덱싱)이 같은 결함을 결함 관점에서 기록한 항목이다. **새 템플릿을 추가하면서 고지 위치나 문안을 건드릴 때는 반드시 이 절과 H21을 함께 본다.**

> **2026-09-08 정정.** 초판은 이 인덱스 밀림이 *현재 발현 중*이라고 적었으나 그것은 틀렸다. `assemble.ts:104`가 고지를 마지막에 append하고 `composition.sections`·`sectionPlan`은 고지를 포함하지 않으므로 현재 호출자에서는 발현하지 않는다. 실제 위험은 **`isDisclosureSection`(`post-composition-contract.ts:434,440`) 과대 매칭으로 본문 섹션이 고지로 오판되는 것**이다 — 여행 `closing` 섹션은 이미 `여행커넥트`를 담고 있고(`section-library.ts:532`) `취소 수수료`는 정상 어휘다. 새 섹션 문안에 그 두 표현이 함께 들어가지 않게 하라.

### 11.4 렌더 결과에서 유도 문장은 사라진다

`disclosureSection`은 `notices[0]`, 즉 **첫 문장만** 취한다. 두 번째 유도 문장("자세한 상품 정보는 아래 쇼핑커넥트에서 확인해보세요.")은 두 번째 replace로 제거된 뒤 `renderNodes` 어디에도 다시 나타나지 않는다. 초안 텍스트에는 있지만 최종 렌더 문서에는 없다. 렌더 노드 꼬리는 `finalConnectBeforeDisclosure`(SHOPPING/TRAVEL 모두 `true`)에 따라 항상 `connectCard(final) → hashtags → {kind:"disclosure", disclosureType:"affiliate", placement:"bottom"}` 순이고(`:716-734`), 본문에서 뽑아낸 문장이 없으면 하드코딩 폴백 문장이 쓰인다. 제목에 고지문이 섞여 들어오면 `stripAffiliateDisclosureFromTitle(:448)`이 잘라낸다.

---

## 12. 템플릿 동작을 뒤집는 환경 토글

### 12.1 필수 — 이 아홉 개가 "코드는 고쳤는데 결과가 안 바뀐다"의 원인이다

| 환경변수 | 정의 위치 | 기본값 | 무엇이 뒤집히나 |
|---|---|---|---|
| `POST_SPEC_PIPELINE_ENABLED` | `scripts/simple-agent.ts:390-391` | **true** (`"false"`일 때만 off) | false면 spec-first 게이트(`:4670`) 탈락 → §6 단발 경로. `post-spec/section-library.ts` 수정이 원고에 전혀 반영되지 않는다 |
| `AI_PROVIDER` | `scripts/simple-agent.ts:206-207` (미설정 시 `scripts/lib/draft-runtime-policy.json`의 값) | **정책 파일이 `"codex"`로 고정** | `"openai"`일 때만 게이트 통과. `"codex"`면 `generateWithAI`의 `:4560` 분기 → `:4562 runCodexDraft`, 프롬프트는 `:4856`/`:4903`. **출하 기본이 이쪽이다** |
| `BROWSER_GPT_MODE` | `:246-249` (`REQUESTED_BROWSER_GPT_MODE && ALLOW_CHATGPT_BROWSER_MODE`) | false | true면 게이트 탈락 + `:4547` 브라우저 분기. `buildDirectBrowserGptPrompt(:2958)`이 systemPrompt/userPrompt를 **버리고** `chatgptContext`로 8_500자(복구 5_500자) 예산 안에서 재조립 |
| `CODEX_BROWSER_FALLBACK_ENABLED` | `:215-216` | **false** | true + `ALLOW_CHATGPT_BROWSER_MODE` + `chatgptContext` 세 조건이 모두 참일 때만 Codex 실패 시 브라우저로 전환(`:4574`). 기본값에서는 폴백 없이 즉시 실패 |
| `BRANDLINK_GENERATED_DRAFT_PATH` | `:377` | `""` | 값이 있으면 게이트 탈락 + `:5129`에서 파일 원고를 읽고 **모델 호출 자체를 생략**. 템플릿이 결과에 아무 영향도 주지 않는다 |
| `BRANDLINK_DRAFT_CONTEXT_OUTPUT` | `:376` | `""` | 값이 있으면 게이트 탈락 + `:5021-5119`에서 프롬프트·계약·스키마를 `brand-draft-context/v2` JSON으로 쓰고 return. `800*1024` 바이트 초과 시 예외 |
| `BRANDLINK_EXPERIENCE_MODE` | `:367-368` | `AI_ASSISTED_INFORMATION` | `VERIFIED_EXPERIENCE`면 systemPrompt에 `[검증된 실제 체험 메모]` 블록 + 제목 규칙 분기(`:4920`) + 계약의 `verifiedExperienceNotes`. 이때 `BRANDLINK_EXPERIENCE_NOTES`가 20자 미만이면 `:4608`에서 **예외로 실행 중단** |
| `NAVER_EDITOR_QUOTATION_ENABLED` | `:393-394` | **false** | **true면 `headerFormat: "quotation"`이 실제 인용구로 살아남는다**(`assemble.ts:65`·`:86`, `buildCompositionSectionPlan`). 기본 false에서만 sectionTitle로 강등된다 — "항상 강등"이 아니다. 주입 지점은 `:4702`와 `:9373` 두 곳 |
| `PRODUCT_POST_LOCAL_FALLBACK_ENABLED` | `scripts/simple-agent.ts:386-387` (기본 **true**) / `src/app/api/brandlinks/[id]/draft/route.ts:392` (라우트 자체 기본 **false**, `:554`에서 자식 프로세스에 주입) | 경로에 따라 다름 | `allowLocalFallback`(`:4701`). 켜져 있으면 키 없음·생성 실패 시 `local-template.ts` 폴백 초안이 만들어지고 **수리 루프를 한 번도 못 받는다**(`index.ts:307`). UI 초안 경로는 라우트 기본값이 꺼져 있어 에이전트 단독 실행과 결과가 다르다 |

### 12.2 그 밖에 템플릿 결과를 바꾸는 토글

| 환경변수 | 정의 위치 | 기본값 | 영향 |
|---|---|---|---|
| `NAVER_BLOG_HASHTAG_COUNT` | `simple-agent.ts:276-278` | 5 (3~20으로 클램프) | 계약의 `hashtagCount`. **11 이상이면 `writing-prompt-contract.ts:74`가 3~10 밖이라고 throw해 STEP 2가 통째로 실패한다**(§14.5 R9) |
| `OPENCRAB_SEO_BRIEF_ENABLED` | `opencrab-seo-brief.ts` | 활성 | false거나 리서치 JSON이 없으면 `[내부 SEO 참고자료]` 블록 전체가 사라지고 로그 한 줄만 남는다 |
| `BLOG_HUMANIZE_MOBILE_STYLE` | `simple-agent.ts` | 활성 | 끄면 `buildHumanMobileStyleGuide`가 한 줄로 축소되고 `HUMANIZE_RULES`가 프롬프트에서 빠진다 |
| `TOPIC_EXPERIMENTAL_SUBTOPIC_PLANNER` | `topic-task-pipeline.ts:85-86` | false | true일 때만 `planSubtopics` → `SUBTOPIC_ROLE_TEMPLATES`/`SUBTOPIC_HINT_TEMPLATES`가 실행된다(§7.5) |
| `TOPIC_PIPELINE_CODEX_EDITOR` | `topic-task-pipeline.ts:84` | **true**(`"false"`일 때만 off) | 주제글 polish 결과에 교정 패스를 한 번 더 돌린다. 실패는 조용히 무시 |
| `TOPIC_PIPELINE_CODEX_FALLBACK` / `TOPIC_PIPELINE_BROWSER_FALLBACK` | `:82` / `:89` | false / false | polish 실패 시 대체 경로. 둘 다 꺼져 있으면 결정론적 4섹션 폴백(`:3037`) |
| `PRODUCT_THUMBNAIL_IMAGE_QC_ENABLED` | `thumbnail-gen/qc.ts:106` | **true** | false면 QC 없이 `checked:false / pass:true`로 통과(§14.3 V8) |
| `PRODUCT_THUMBNAIL_QC_MIN_SCORE` | `thumbnail-gen/qc.ts:54` | 95 (50~100) | 썸네일 합격선 |
| `PRODUCT_THUMBNAIL_MAX_ATTEMPTS` | `thumbnail-gen/generate.ts:44` | 4 (1~6) | 교정 재생성 횟수 |
| `BRANDLINK_QUALITY_PRESET` | 패키지 조립 | `PREMIUM` | `STANDARD`면 렌더 QC의 모든 실패가 warning이 되어 `canAutoPublish`가 항상 true(§14.5 R10) |

---

## 13. 새 템플릿 추가 체크리스트

> **가장 먼저: §1 표에서 어느 시스템을 고칠지 정한다.** 시스템을 잘못 고르면 아래 단계 전부가 무효다. 그다음 §12.1 표에서 현재 환경이 어느 경로를 도는지 확인한다.

### Case 0 — 착수 전 5분 점검 (모든 Case 공통)

1. `scripts/lib/draft-runtime-policy.json`의 `AI_PROVIDER` 값을 확인한다. `"codex"`면 **spec-first는 돌지 않는다** → Case D(§6)를 고쳐야 한다.
2. `POST_SPEC_PIPELINE_ENABLED` / `BROWSER_GPT_MODE` / `BRANDLINK_GENERATED_DRAFT_PATH` / `BRANDLINK_DRAFT_CONTEXT_OUTPUT`가 설정돼 있는지 확인한다(§12.1). 하나라도 걸려 있으면 §2의 그림은 성립하지 않는다.
3. 고지 문안·위치를 건드릴 계획이면 **§11.3을 먼저 읽는다.**

### Case A — 기존 kind에 섹션 하나 추가 (시스템 A)

1. **`scripts/lib/post-spec/types.ts:16-36`** — `SectionRole` 유니온에 리터럴 추가.
   → 여기만 컴파일 에러로 잡힌다. 이하 단계는 전부 조용히 실패한다.
2. **`scripts/lib/post-spec/section-library.ts`** — `shoppingTemplates`(`:119`) 또는 `travelTemplates`(`:337`) 사전에 `SectionTemplate` 정의 추가.
   - 11개 필드 전부 채운다.
   - `shape`는 기존 5종 중에서 고른다. 새 분량이 필요하면 **Case B**로.
   - `imageCount`에 `[0,1]`을 쓰면 `index.ts:199-202`가 `[1,1]`로 바꾼다는 점을 계산에 넣는다.
   - `fallbackLines`가 `SHAPE_RULES[shape]`의 **최소 줄 수를 충족**하는지 확인(로컬 폴백은 수리를 못 받는다).
3. **`section-library.ts:576-634`** — `buildSectionTemplates`의 순서 배열에 삽입.
   - SHOPPING: `full` 배열 + `dropOrder` + `Math.max(8, Math.min(10, count))` clamp 세 곳
   - TRAVEL: 반환 배열 + `dayCount = target - 9`의 **매직 넘버 9** + `slice(0, target)`
4. **`post-spec/index.ts:176-183`** — 섹션 수 파생식 수정.
   - SHOPPING `resolved >= 7 ? 10 : resolved >= 5 ? 9 : 8` / TRAVEL `Math.max(10, Math.min(12, 9 + dayCourses))`
   - **3번의 clamp와 값이 어긋나지 않는지 반드시 대조**한다(두 곳에 중복 계산이 있다 — §14.1 T4).
5. **`post-spec/evidence-ledger.ts`** — `buildShoppingLedger`(`:96`) 또는 `buildTravelLedger`(`:218`)의 role별 배정에 추가.
   - 누락하면 그 섹션은 근거 0개로 생성되고 `EVIDENCE_UNUSED`(P1)가 매번 뜬다.
   - 사실 나열형 role이면 `index.ts:214`의 `legacyEvidence` 목록(`key-facts` / `offer-check` / `inclusions`)에 넣을지 판단한다.
6. **`post-spec/assemble.ts:61`** — `earlyRole` 앵커가 여전히 존재하는지 확인. `key-facts`(쇼핑) / `itinerary-overview`(여행)를 제거·개명하면 커넥트 카드가 사라져 발행이 실패한다.
7. **`post-spec/index.ts:159-160`** — 이미지 하한 재검토. 새 섹션이 `imageCount[0] >= 1`이면 `minBody`를 올려야 할 수 있고, 반대로 잘못 올리면 글 품질과 무관하게 `IMAGE_SHORTFALL`로 전량 차단된다.
8. **`src/lib/post-composition-contract.ts:391-410`** — `targetSections` / `targetCharacters` / `targetImages` 범위 확인. spec의 섹션 수가 범위를 벗어나면 검증은 통과했는데 렌더 QC에서 blocker가 난다.
9. **`post-spec/image-plan.ts:assignImageSlots`** — card 우선 배정 휴리스틱 확인. `/일정|overview/u.test(imageIntent) || section.index === 2` — 앞에 섹션을 추가하면 index 2가 밀린다.
10. **고지 정합성 확인(§11.3)** — 섹션을 추가·삭제해도 `contentSections.length`가 `sectionPlan.length`와 같은지 확인한다. `assemble.ts:104`의 고지 push가 마지막인지, 문안을 건드리지 않았는지 함께 본다.
11. **`npm run test:post-spec`**(= `scripts/verify-post-spec.ts`) 실행. 키 없이 로컬 템플릿 경로로 돌며 쇼핑 8~10섹션·근거 중복 금지·FAQ 3문답·업로드 첫 장 hero를 단언한다.

### Case B — 새 SectionShape 추가

Case A에 더해:

12. **`post-spec/types.ts:14`** — `SectionShape` 유니온에 추가
13. **`section-library.ts:63-104`** — `SHAPE_RULES`에 `ShapeRule` 추가(`minLines`/`maxLines`/`minChars`/`maxChars`/`formatHint`/`linePrefix`)
14. **`post-spec/render.ts:normalizeLines`** — shape 분기 추가.
    ⚠️ `linePrefix`는 소비되지 않는다. `FACT_PREFIX`/`CHECK_PREFIX`를 직접 import한 하드코딩 분기라, **여기에 분기를 추가하지 않으면 접두사가 붙지 않는다.**
15. **`post-spec/validate.ts:135-141`** — shape 검사 추가(현재 `qa-3`·`lines-3`만 검사)

### Case C — 새 문체 템플릿 추가 (시스템 A·B 공통, 가장 파급이 큰 안전한 지점)

16. **`scripts/lib/editorial-templates.ts:2`** — `EDITORIAL_TEMPLATES`에 `<kind>-<slug>` 엔트리(`kind`/`persona`/`flow`/`color`)
17. **`:12`** — `layouts`에 같은 키로 `{image, sentences, tone}`. 비-export 테이블이라 빠뜨리면 `:78`의 `.tone`/`.sentences` 접근에서 **런타임 예외**가 난다.
18. **`:48`** — `editorialEditorPolicy` 내부 `palette`에 `headingColor` 추가. 키를 빠뜨리면 프롬프트 "편집 의도" 줄에 `undefined`가 그대로 출력된다.
    ⚠️ `EDITORIAL_TEMPLATES[].color`와 `palette`는 **서로 다른 값이고 color는 읽히지 않는다.** palette 쪽을 고쳐야 한다.
19. **`matchedSelection(:21-34)`** — 해당 kind 분기에 우선순위와 정규식 추가.
    16~18은 타입 오류로 잡히지만 **19를 빠뜨리면 조용히 "선택되지 않는 템플릿"이 된다.** 정규식은 순서 의존이고 겹치므로 **삽입 위치가 기존 템플릿 선택을 조용히 바꾼다.** 입력은 `description + features`뿐이라 상품명에만 신호가 있으면 항상 기본값으로 떨어진다.
20. 문구를 길게 쓰면 브라우저 경로의 고정 프롬프트 예산(8_500 / 5_500자)을 초과해 **그 경로만 예외로 죽는다**(§6.4). 추가 후 브라우저 경로도 한 번 돌려 본다.

### Case D — 출하 프롬프트(시스템 B)를 고쳐야 하는 경우

**`AI_PROVIDER`가 `"codex"`인 출하 기본 설정에서는 이쪽이 정답이다.** §6.3 표의 순서대로 손댈 파일을 고른다.

21. **`scripts/lib/editorial-templates.ts`** — 세 경로가 모두 태우는 유일한 지점(Case C). 여기부터 고려한다.
22. **`scripts/lib/writing-prompt-contract.ts:56 createWritingPromptContract` / `:108 formatWritingPromptContract`** — 제목·섹션 수·자수·문장 수·해시태그 개수의 공유 계약. `:74`의 해시태그 3~10 throw 범위를 넘기지 않는지 확인한다.
23. **`scripts/lib/writing-structure-guide.ts:6`** — kind별 전개 아웃라인. 주석의 "Keep this static and compact: no raw reference caches or runtime I/O" 원칙을 지킨다.
24. **`scripts/simple-agent.ts:4856-4876 systemPrompt`** — 블록 순서와 고정 규칙 줄. `formatDraftMemoRequirements`가 여기와 계약 블록에서 **두 번** 렌더된다는 점을 감안한다.
25. **`scripts/simple-agent.ts:4903-4995 userPrompt`** — `## 작성 규칙` 1~8과 §4 렌즈 목록. 마지막에 `mandatoryWritingPromptBlock`이 붙는다.
26. **`scripts/lib/product-editorial-plan.ts:98 SECTION_LIBRARY`** — userPrompt §4의 12개 렌즈 후보. `targetSectionCount`는 읽히지 않으므로 개수를 줄이려면 이 배열 자체를 고쳐야 한다.
27. **`scripts/lib/adaptive-editorial-harness.ts:16 ADAPTIVE_EDITORIAL_PROFILES`** — `sectionRange {min, preferred, max}`가 `bodySectionCount`를 결정한다(`:4626-4637`).
28. **`src/lib/post-composition-contract.ts:147-388` 역할 팔레트** — systemPrompt의 `N. 역할=<id> …` 줄이 여기서 나온다.
29. **브라우저 경로도 바꿔야 하면** `scripts/simple-agent.ts:2958 buildDirectBrowserGptPrompt`와 `chatgptContext`(`:5011-5019`)를 따로 고친다. 다른 두 경로의 수정은 여기에 반영되지 않는다.
30. **`scripts/lib/codex-draft-provider.ts:41 buildWritingPrompt`** — Codex 입력의 고정 서두 5줄과 이미지 4장 상한을 바꿔야 할 때.
31. 검증: `AI_PROVIDER`를 실제 출하값으로 두고 한 번, `AI_PROVIDER=openai`로 한 번 돌려 **두 경로의 결과를 모두 확인한다.**

### Case E — 주제글 템플릿을 고치는 경우 (시스템 C)

32. **`src/services/topic-task-pipeline.ts:615-651 headingSets`** — 발행 소제목을 바꾸려면 여기다. 셀당 배열이 2개뿐이라 `index % 2`로만 회전하므로 **3개 이상으로 늘리는 편이 안전하다**(중복 방지 로직이 같은 index/kind로 재호출해 같은 문자열을 돌려줄 수 있다).
33. **`:683-717 summaries` / `:725-758 defaults` / `:1158-1243 paragraphsByKind`** — 요약·불릿·본문 문단.
34. **`src/lib/topic-workflow.ts:335 SUBTOPIC_HINT_TEMPLATES` / `:359 SUBTOPIC_ROLE_TEMPLATES`** — 기획 단계 문장. **기본 설정에서는 실행되지 않는다**(`TOPIC_EXPERIMENTAL_SUBTOPIC_PLANNER`). 켤 계획이 없으면 여기만 고치는 것은 효과가 없다(§7.5).
35. **섹션 수를 바꾸려면 §7.4의 6곳을 전부** — `:1267 desiredCount` / `:3050 sectionCount` / `:3344`·`:3345` 스키마 / `:2951` 프롬프트 문구 / `:2735` 교정 규칙 / `:1714` 점수 — 그리고 `topic-task-content-readiness.ts:732` 게이트까지 함께 고친다. 하나만 바꾸면 점수·게이트·정규화가 서로 싸운다.
36. **새 `TopicType`을 추가하려면** `Record<TopicType, ...>` 행렬 **최소 12곳**을 전부 채운다(`topic-workflow.ts`의 5개 + `topic-task-pipeline.ts`의 `headingSets`/`summaries`/`defaults`/`paragraphsByKind`/`openingByType`/`fallbackRoles` 등). 빠뜨린 곳은 컴파일 에러가 아니라 `|| …knowledge` 폴백으로 **조용히 knowledge 문구가 나간다.**
37. **역할(kind)을 추가하려면** `topic-workflow.ts:5 TopicSubtopicRole`과 `src/lib/topic-task-contract.ts:1 PreparedTopicSectionKind` **두 파일을 동시에** 고친다(같은 집합이 따로 선언돼 있다).
38. 스키마(`:3330-3388`)만 바꾸는 것으로는 모델 동작이 안 바뀔 수 있다(`runOpenAiStructured(:2573)`의 `_schema` 미사용). 프롬프트 문구(`buildPolishPrompt:2882`)와 `finalizePolishedContent`를 함께 고친다.
39. **`scripts/lib/templates/**`는 건드리지 않는다** — 주제글 구조와 무관하다(§1.1).

### Case F — 새 ConnectKind 추가 (비용 최대)

40. `post-spec/types.ts:12` `ConnectKind` 유니온
41. `src/lib/brandconnect-kind.ts` `CONNECT_KINDS` / `CONNECT_KIND_LABELS` / `assertConnectUrlKind`
42. `src/lib/post-composition-contract.ts:getPostCompositionContract` — `connectKind === "TRAVEL" ? … : …` 삼항식을 분기로 확장 + 새 `PostCompositionContractV1` 상수
43. `scripts/simple-agent.ts` / `src/lib/brand-post-package.ts`에 흩어진 `connectKind === "SHOPPING" ? … : …` 삼항식 전수 검색(sourcePolicy·imagePolicy·thumbnailSpec.style)
44. `post-spec/index.ts` — `minBody`/`targetBody`/`totalChars`/**`disclosure` 상수 추가**/`generation.mode`/required 해시태그
45. `assemble.ts` — `earlyRole` / `connectCard` 종류
46. `image-plan.ts` — 부족분 보강 전략(스톡 vs 콜라주)
47. `brandlink-content-readiness.ts:529-532` — 고지 정규식이 새 kind의 문안을 인정하는지(현재 `(?:쇼핑|여행)\s*커넥트`) + `post-composition-contract.ts:438 splitAffiliateDisclosure` 정규식 확장(§11.3)
48. `thumbnail-gen/prompt.ts` — 새 kind의 프롬프트 빌더와 무드 프리셋(§10)

---

## 14. 구조상 문제 / 중복 / 문서-코드 불일치

> 결함으로 접수된 항목은 `docs/full-code-audit-2026-09-07.md`의 번호를 함께 적었다. **두 문서가 같은 결함을 다른 원인으로 기록한 사례가 있으므로(T5, T6) 한쪽만 읽고 고치면 엉뚱한 곳을 손대게 된다.**

### 14.1 치명 — 작업 전에 반드시 알아야 할 것

**T1. 문서화된 기본 파이프라인이 출하 설정에서 돌지 않는다.**
`docs/post-composition-harness.md:3`은 플래그를 `POST_SPEC_PIPELINE_ENABLED`(기본 true) 하나로만 적었지만, 실제 게이트(`simple-agent.ts:4670-4676`)는 `AI_PROVIDER === "openai"`도 요구한다. 그런데 `scripts/lib/draft-runtime-policy.json`이 이 값을 `"codex"`로 고정하고 `docs/fixed-draft-settings.md:3`이 "선택 UI 제거"로 못박았다. → **`section-library.ts`에 섹션을 추가해도 설치본 원고는 바뀌지 않는다.** 고쳐야 할 곳은 §6이다. 이 경로는 `docs/full-code-audit-2026-09-07.md`가 "출하 기본 경로가 감사에서 통째로 빠졌다"고 지적한 바로 그 지점이며, 이 문서의 §6이 그 구조적 대응물이다.

**T2. 프롬프트 텍스트가 세 벌로 갈라져 있다.**
`post-spec/generate.ts:24`(spec-first) / `simple-agent.ts:4856`·`:4903`(Codex·단발 API) / `simple-agent.ts:2958`(브라우저). 브라우저 빌더는 인자를 `_systemPrompt`, `_userPrompt`로 받아 **버린다.** 세 경로가 공유하는 것은 `formatWritingPromptContract → formatWritingStructureGuide + formatEditorialTemplate` 뿐이다(§6.4).

**T3. 섹션 수 규정이 3~4중이다.**
`docs/post-composition-harness.md:33,48`(쇼핑 8~10 / 여행 10~12, `index.ts:177,182`와 일치) vs `docs/adaptive-editorial-harness-guidance.md:112`(쇼핑 5~10 / 여행 7~12, `adaptive-editorial-harness.ts:23,66`과 일치) vs `src/lib/post-composition-contract.ts:396,407`(쇼핑 5~10 / 여행 7~12). 단발 경로는 `simple-agent.ts:4626-4637`에서 preferred를 그대로 써 **쇼핑 7 / 여행 9**로 고정한다.

**T4. 섹션 수 계산이 두 곳에 중복돼 있다.**
`index.ts:178-183`이 `sectionCount`를 구하고, `section-library.ts:576,599-601`이 다시 `clamp(count, 8, 10)` / `clamp(count, 10, 12)`와 `dayCount = clamp(target - 9, 1, 3)`으로 재계산한다. 여행은 `index.ts`가 `resolved - 3` 상한을, 라이브러리가 `target - 9`를 쓰는 **서로 다른 식**이라 이미지가 적을 때 어긋난다. **`9`가 상수화되어 있지 않아** 고정 섹션을 하나만 추가해도 조용히 깨진다.

**T5. `IMAGE_SHORTFALL` — 두 리포트가 같은 사건을 다른 원인으로 기록했다.** (`docs/full-code-audit-2026-09-07.md` **H36** 교차)
사실관계는 셋이다.
- `validate.ts:220-222`는 `spec.imagePlan.shortfall > 0`, 즉 **풀 단위 `minBody` 미달만** P0로 올린다. 섹션별 `imageCount[0]`의 **합**이 확보 장수를 넘는 경우는 어떤 신호도 만들지 않는다.
- `assemble.ts:66-71`의 `imageMin`은 버그가 아니다. "확보된 장수가 하한보다 적어도 플랜은 하한을 그대로 알려 준다(품질 리포트가 부족을 표시하도록)"는 **의도 주석**이 붙어 있다. 1차 감사가 진단 위치를 여기로 잡은 것은 코드 의도와 어긋났고, 2차 중재로 **H36 `image-plan.ts:281`**로 정정됐다(`assemble.ts:71`·`validate.ts`·`index.ts:199-202`는 모두 올바른 코드였다).
- `index.ts:199-202`가 `[0,1]` → `[1,1]`로 승격하면서 하한 합계가 조용히 늘어난다(T5b).
그리고 `IMAGE_SHORTFALL`은 `repair.ts:10 UNREPAIRABLE`에 있어 **재생성으로 절대 해소되지 않는다.** `minBody`(SHOPPING 4 / TRAVEL 5)에 못 미치면 글 품질과 무관하게 `BLOCKED`로 끝난다. 새 kind/템플릿에서 `minBody`를 잘못 잡으면 전량 차단.

**T5b. `imageCount` 최소값이 라이브러리 밖에서 조용히 바뀐다.**
영향받는 템플릿: `comparison`(`:255`), `offer-check`(`:273`), 쇼핑 `fit-checklist`(`:312`), 여행 `closing`(`:518`). "이미지 선택"이 "이미지 필수"로 뒤집히고, `assignImageSlots`의 하한 배정이 이미지를 먼저 가져가 앞 섹션이 굶을 수 있다.

**T6. 고지문 위치·문안이 이미지 인덱스와 섹션 플랜을 조용히 밀어낸다.** (`docs/full-code-audit-2026-09-07.md` **H21** 교차 · 상세는 §11.3)
`post-composition-contract.ts:620`이 `sectionImagePaths`를 **고지 제거 후 인덱스**로 조회하고, `:614-615`가 길이 불일치 시 `sectionPlan`을 **조용히 `null`로 만든다.** 지금 정렬이 맞는 것은 고지가 정확히 마지막이고 `splitAffiliateDisclosure`가 그것을 빈 문자열로 만들기 때문이다 — 우연에 가깝다. 로그도 경고도 없다.

**T7. 로컬 폴백 초안은 수리를 한 번도 못 받는다.**
`index.ts:307`의 루프 조건이 `draft.source === "openai"`다. 검증은 돌지만 결과는 리포트에만 남고 본문은 `fallbackLines` 그대로 조립된다. → 새 템플릿의 `fallbackLines`가 `SHAPE_RULES`를 어기면 조용히 `NEEDS_REVIEW`로 패키지가 만들어진다. `PRODUCT_POST_LOCAL_FALLBACK_ENABLED`의 기본값이 에이전트(true)와 초안 라우트(false)에서 다르다는 점도 함께 본다(§12.1).

**T8. 주제글은 섹션 수 4가 6곳에 하드코딩돼 있다.** (§7.4)
`desiredCount = 4`(`:1267`), `sectionCount = 4`(`:3050`), 스키마 `minItems`/`maxItems` 4(`:3344`/`:3345`), 프롬프트 "섹션은 반드시 4개다"(`:2951`), 교정 규칙(`:2735`), 점수 `sectionShapeScore` 4→22점(`:1714`), 그리고 게이트 `sections.length === 4`(`topic-task-content-readiness.ts:732`). 하나만 바꾸면 점수·게이트·정규화가 서로 싸운다. 브랜드커넥트와 타입·게이트를 전혀 공유하지 않으므로 **"새 포스트 템플릿 추가"가 어느 시스템을 뜻하는지 먼저 확정해야 한다.**

### 14.2 죽은 코드 / 미소비 필드

**D1. `PostSpec.generation.mode`는 읽히지 않는다.** `generateDraftWithOpenAi`는 `spec.generation.chunks` 배열 길이만 본다. 새 kind에서 `mode`만 바꾸고 `chunks`를 안 바꾸면 아무 효과가 없다.

**D2. `ShapeRule.linePrefix`도 정의만 되고 소비되지 않는다.** 접두사 부착은 `render.ts:normalizeLines`가 `FACT_PREFIX`/`CHECK_PREFIX`를 직접 import한 **하드코딩 shape 분기**로 한다.

**D3. `GeoTargets`는 값만 담기고 강제되지 않는다.** `summaryLines 3` / `factsMinLines 4` / `faqCount 3` / `checklistMin 3`은 실제로 `SHAPE_RULES`(lines-3=3, facts-list=4~7, qa-3=6, checklist=3~5)가 강제한다. 두 곳 숫자가 우연히 일치할 뿐 연결돼 있지 않아 **GeoTargets만 바꾸면 아무 일도 일어나지 않는다.** 실제 소비되는 것은 `sourceLine` 하나뿐.

**D4. `HeaderFormat: "none"`은 죽은 분기 — 그러나 `"quotation"`은 죽지 않았다.**
`"none"`은 `types.ts`에 정의되고 `assemble.ts:65,93`이 처리하지만 어떤 템플릿도 쓰지 않는다. `"quotation"`(`summary-glance`·`day-course`)은 **기본값에서만** sectionTitle로 강등되며, `NAVER_EDITOR_QUOTATION_ENABLED=true`면 실제 인용구 헤더로 살아난다(`simple-agent.ts:393-394`, `:4702`, `:9373`). "항상 강등"이 아니다.

**D5. `EDITORIAL_TEMPLATES[].color`는 읽히지 않는다.** 값도 `editorialEditorPolicy` 내부 palette와 전부 다르다(`#365744` vs `#00554c` 등). 색을 바꾸려는 사람이 잘못된 쪽을 고칠 위험이 크다(§13 Case C-18).

**D6. `OpenCrabSeoBrief`의 절반 이상이 프롬프트 텍스트 전용.** `titleCandidates` / `recommendedSectionTitles` / `thumbnailGuidance` / `qaChecklist` / `writingGuidance` / `mediaTargetImageCount`를 구조적으로 소비하는 코드가 없다. 실제 소비는 `searchQueries` / `categoryLabel` / `hashtags` 3개뿐(`index.ts:105, 233-234`).

**D7. `ProductEditorialPlanInput.targetSectionCount`는 필수 필드인데 어디서도 읽히지 않는다.** 호출자가 9(`post-spec/index.ts:150`), 11(readiness), `bodySectionCount`(단발 경로)로 제각각 넘기는데 결과는 항상 `SECTION_LIBRARY` 12개 전부다. userPrompt §4가 `bodySectionCount`(쇼핑 7)와 무관하게 12개 렌즈를 나열하고, 바로 아래 "본문 sections는 5~10개"와 숫자가 어긋난 채 전달된다.

**D8. `scripts/lib/templates/**` 전체가 사실상 죽은 체계 — 그리고 주제글 템플릿은 거기 없다.** (§1.1)
`promptTemplate` / `sections` / `minLength` / `maxLength` / `hashtagCount` / `generatePrompt` / `get*Prompt`를 호출하는 곳이 없다. 실제 소비는 `seoKeywords`(`topic-agent.ts:1879`)와 `categoryNames`(`:1897`)뿐이며 그 소비자도 레거시 브라우저 경로다. `getTypeFromArgs`도 호출자가 없어 `productReviewTemplate`은 CLI로 도달 불가. **주제글 템플릿의 실체는 §7이다.**

**D9. `ThumbnailCopy.cta`는 죽은 필드다.** 타입에 있고 기본값(`장단점 보기`)도 있고 `LIMITS.cta 20`자 검증도 받지만, `textLines`(`prompt.ts:49`)가 방출하지 않아 프롬프트에 들어가지 않고 `ThumbnailQcExpectation`(`qc.ts:42`)에도 없어 채점되지 않는다. 생성형 경로에서 CTA는 **그려지지도 검증되지도 않는다.** 반면 `ProductThumbnail.md §10/§11`은 여전히 "CTA 오탈자"를 자동 탈락 조건으로 적어 두고 있다.

**D10. `skills/product-photo-thumbnail-copywriting/`는 코드 참조 0건이다.** (`docs/full-code-audit-2026-09-07.md`의 죽은 파일 정리 목록에 이 디렉터리가 없다 — 판정은 이 문서가 처음 내린다.) 자기 참조 2건(`SKILL.md:2` frontmatter `name`, `agents/openai.yaml:5` `default_prompt`) 외에는 저장소 어디에서도 참조되지 않고, electron-builder `files`/`extraResources`에도 없어 설치본에 패키징되지 않는다. **문서 아티팩트다**(§10.4). 죽은 파일로 지울지 외부 에이전트용 자산으로 남길지는 사람이 정할 일이지만, **코드 동작과는 무관하다.**

**D11. `SUBTOPIC_ROLE_TEMPLATES`(54개)와 `SUBTOPIC_HINT_TEMPLATES`(9개)는 기본 설정에서 실행되지 않는다.** `TOPIC_EXPERIMENTAL_SUBTOPIC_PLANNER`로 막혀 있고, 켜더라도 `plannedLooksUsable` 검사가 knowledge.hook 템플릿 자신의 문구("처음엔 별거", "딱딱해지")에 걸려 거부한다(§7.5).

**D12. `editorialPromptBlock`(`simple-agent.ts:4764-4768`)은 브라우저 전용이다.** systemPrompt·userPrompt 어디에도 들어가지 않고 `chatgptContext`(`:5017`)로만 흘러간다. 여기에 블록을 추가해도 Codex/API 경로에는 반영되지 않는다.

### 14.3 검증 구멍

**V1. shape 검사가 `qa-3`·`lines-3`만 본다.** `facts-list`·`checklist`는 형식 위반이 검사되지 않고 `LENGTH_OUT_OF_RANGE`로만 잡힌다. 게다가 `normalizeDraft`가 이미 접두사를 강제로 붙인 뒤 검증하므로 `qa-3`의 Q./A. 패리티 검사는 **사실상 항상 통과**하고 줄 수만 유효하다.

**V2. P2 타깃은 리포트에는 집계되지만 절대 고쳐지지 않는다.** `repairableTargets`가 P2를 거르는데 summary는 "수리 대상 N건"에 포함해 센다.

**V3. `hints`로만 표현된 제약은 강제되지 않는다.** `reasons-3`(`:443`)은 "정확히 3줄"을 요구하지만 `shape = checklist`라 3~5줄이 통과하고, "이유: 한 문장" 형식도 검사 대상이 아니다.

**V4. 전용 근거 독점 규칙에 구멍.** `evidence-ledger.ts:282`의 중복 제거는 **같은 entry 안에서만** shared∩exclusive를 거른다. `key-facts`가 shared로 담은 수치 상세 근거(`:146`)가 `benefit`/`proof`의 exclusive와 같은 줄일 수 있어, 동일 근거가 두 섹션 프롬프트에 동시 노출된다(`REPEATED_LINE` 위험).

**V5. 여행 원장은 prose 섹션에 전용 근거를 보장하지 않는다.** `buildTravelLedger`(`:218-269`)에서 `closing`은 shared만 받고, `itinerary-overview`는 `travel.highlights`가 비면 exclusive 0개가 된다. `verify-post-spec.ts:88-91`의 "prose/qa-3/checklist는 mustUseEvidence 1개 이상" 단언은 **SHOPPING에만 적용**되어 이 결손이 테스트로 잡히지 않는다.

**V6. `buildShoppingLedger.byRole`은 `entries.find`로 첫 항목만 찾는다**(`:129`). 쇼핑에 같은 role을 두 번 쓰는 템플릿을 추가하면 두 번째 섹션은 근거를 못 받는다.

**V7. `fallbackLines`가 shape 최소 줄 수를 못 채우는 경우가 있다.** 쇼핑 `key-facts`(`:181`)는 features가 비면 3줄(facts-list 최소 4줄 미달), 여행 `itinerary-overview`(`:393`)는 배경지식이 없으면 3줄(prose 최소 4줄 미달). `render.ts:splitLongLine`(58자 초과 분할)에 우연히 기대는 구조다.

**V8. 썸네일 QC는 세 경우에 "만점 통과"처럼 보인다.** `qcThumbnail`은 QC 비활성(`PRODUCT_THUMBNAIL_IMAGE_QC_ENABLED=false`), 키 부재, QC 호출 예외 셋 모두에서 `checked:false / pass:true / breakdown={...QC_MAX}`를 돌려준다(`qc.ts:160`). `.qc.json`과 API 응답의 `breakdown`만 보면 "만점 통과"와 "검사 안 함"을 구분할 수 없고 `checked`/`score`/`note`를 봐야 한다. 여기에 더해 (a) 교정 지시가 **누적되지 않는다** — `generate.ts:90`이 항상 원본 프롬프트에서 다시 시작하므로 3회차는 2회차 결과만 반영하고, 같은 오류가 번갈아 재발하면 4회를 다 쓰고도 수렴하지 않는다. (b) `COMMON_LAYOUT`의 10% 세이프존·40/60 분할·최대 3요소는 **코드 검증이 전혀 없고** 사후 QC의 layout(5점)·readability(15점)·`textCut`만이 사실상의 안전장치다.

**V9. 주제글 구조화 스키마가 모델에 전달되지 않을 수 있다.** `runOpenAiStructured(:2573)`의 시그니처가 `_schema`로 스키마를 받기만 하고 쓰지 않는다. `topic_polish_writer`의 `minItems`/`maxItems`/`minLength`는 강제력이 없을 수 있고, 실제 보장은 프롬프트 문구와 `finalizePolishedContent`의 사후 정규화가 한다.

**V10. 준비도 게이트의 "마지막 원소 = 고지문" 전제.** `brandlink-content-readiness.ts:512`·`:525`·`:526` 세 곳이 이를 무조건 전제한다. 전제가 깨지면 하나의 원인이 `missing-disclosure`와 `too-few-sections` **두 블로커로 동시에** 나타나 디버깅을 어렵게 한다(§11.2).

### 14.4 문서-코드 불일치

**X1. 구매 전 체크리스트 항목 수가 정면 충돌.** `docs/naver-brandconnect-qc-rules-v2-2026-07-02.md:69`·`seo-writing-logic:156`은 "7~8개"를 요구하는데 `SHAPE_RULES.checklist`는 3~5줄이다. **문서 기준은 구조적으로 통과 불가능.**

**X2. 추천 대상 bullet 수도 어긋난다.** 문서는 "4개 이상"인데 checklist 상한이 5라 실무상 4~5로만 성립.

**X3. 제목 후보 7개 규칙은 코드에 없다.** 문서(`qc-rules:48`, `seo-writing-logic:40`)는 후보 7개를 요구하지만 `index.ts:252`는 단일 제목만 정의하고 `validate.ts:102-116`도 `draft.title` 하나만 검사한다. `OpenCrabSeoBrief.titleCandidates`는 미소비.

**X4. `D|img=<n>` 이미지 목표가 실제 이미지 수를 결정하지 않는다.** 문서는 "그대로 따른다"(`seo-writing-logic:121`)고 못박지만 실제는 `index.ts:162-163`의 하드코딩 상수(4/8, 5/10). 문서가 기록한 이미지 목표(11~35장)와 실제 목표(8~10장)의 격차가 크다.

**X5. 5섹션 출력 계약(`## 1. 제목 후보` ~ `## 5. Evidence Note`)은 런타임 산출물과 무관하다.** 생성·검사하는 코드가 없고 실제 산출물은 `brand-post-package/v2` manifest다. 두 문서 어디에도 "사람이 손으로 쓰는 규격"이라는 명시가 없다.

**X6. Compliance QC 금칙 표현 27개(`치료됩니다` `완벽 제거됩니다` `완전 무소음입니다` 등)를 잡는 정규식이 코드에 없다.** 런타임 차단은 `unsupported-experience-claim`과 `forbiddenCategoryTerms` 둘뿐.

**X7. 8개 카테고리 스타일 가이드에 대응하는 코드 분기가 없다.** `product-editorial-plan.ts:230-237`의 `detectCategory`는 `fan` / `cooler-bag` / `seat-cushion` / `hair-care` / `generic` 5종뿐이고, `generic`의 `forbiddenCategoryTerms`는 빈 배열이라 새 카테고리에서 `category-mismatch` 차단이 무력화된다.

**X8. manifest 키 이름이 문서와 다르다.** `docs/post-composition-harness.md:83`은 `sections[]` / `spec` / `draft` / `readiness`라고 적었지만 실제는 `composition` / `postSpec` / `specDraft` / `contentQuality` / `specValidation`이며 최상위 `sections[]`와 `readiness`는 없다.

**X9. `OPENAI_MAX_OUTPUT_TOKENS`는 spec-first 생성에 영향을 주지 않는다.** spec-first는 `index.ts:266`의 하드코딩 `maxOutputTokens: 8192`를 쓴다. 환경변수는 단발 생성 경로에서만 읽힌다.

**X10. 온톨로지 문서의 노드 클래스 이름이 실제 팩에 없다.** `adaptive-editorial-harness-guidance.md:71-77`의 `SourcePost`/`EditorialPattern`/`TonePattern` 등 7종은 `nodes.jsonl`에 grep 0건이다. 실제는 `Agent`/`Project`/`Dataset`/`Document`/`TextUnit`/`Concept`/`Claim`/`Community`/`Lever`/`Policy`.

**X11. 여행 레퍼런스 샘플이 같은 문서의 문체 규칙을 위반한다.** `docs/post-composition-harness.md:48`이 지정한 `docs/naver-blog-drafts/2026-09-02-travel-reference-taiwan-modetour.md:1`은 제목 이모지와 인사말로 시작해, 같은 문서 `:71-72`의 금지 규칙과 `validate.ts:114-116`의 `TITLE_CLEAN`(P1)에 즉시 걸린다.

**X12. 세 세대의 템플릿 철학이 서로를 폐기하지 않고 공존한다.** `adaptive-editorial-harness-guidance.md:5`("같은 목차를 채우는 방식은 중단한다")와 사흘 뒤의 `post-composition-harness.md:31-64`(고정 제목·고정 role 구성표)가 둘 다 현행이고 상호 참조가 없다. 판단 근거는 런타임의 `AI_PROVIDER` 값뿐.

**X13. 썸네일 문서 3벌의 수치가 코드와 전부 다르다.** 캔버스 `copy-and-layout-rules.md` 1600×900 / `SKILL.md` 1024×1024 / `thumbnail-layout-v2.ts` 1080×1080 / 생성 API 1024×1024. 헤드라인 한도 문서 12자·"약 10자" / `condenseHeadline` 12 / `LIMITS.headline` 24. 여백 문서 56px 절대값 / `COMMON_LAYOUT` 10% 상대값. 재시도 `ProductThumbnail.md §11` "기본 최대 5회" / `maxThumbnailAttempts()` 4. **코드가 유일한 진실이다.**

**X14. 주제글 길이 제약이 계층마다 어긋난다.** `summary`는 스키마 `maxLength 32` / polish 프롬프트 "10~28자" / 교정 패스 "10~22자" 셋이 다르고, body 문단 수는 polish "정확히 2개" vs 교정 패스 "2~3개"로 상충한다. 결정론적 폴백은 항상 2문단이라 모델 경로와 폴백 경로의 결과물 모양이 미묘하게 다르다.

### 14.5 아키텍처 중복

**R1. 섹션 카탈로그가 3벌이다.** ① `post-spec/types.ts:16-36`의 `SectionRole` 17종(spec-first 실사용) · ② `src/lib/post-composition-contract.ts:147-388`의 `shopping-hook`…`shopping-verdict` 11개 + `travel-hook`…`travel-close` 13개(spec-first에서는 sections 배열이 죽지만 `targetSections`/`targetCharacters`는 계속 QC에 쓰이고, 단발 경로에서는 systemPrompt의 역할 팔레트로 그대로 나간다) · ③ `product-editorial-plan.ts:98-177`의 `review-hook`…`verdict` 12개 렌즈(userPrompt §4용). 커넥트 카드 앵커도 ②는 `"shopping-summary"`, `assemble.ts:61`은 `"key-facts"`로 이름이 다르다.

**R2. `post-composition-contract.ts`의 여행 섹션은 id와 title이 어긋나 있다.** `travel-lodging`(숙소)의 제목이 "첫 번째 명소에서 꼭 볼 것", `travel-route`(동선)가 "두 번째 명소에서 즐길 것", `travel-inclusions`(포함사항)가 "처음 가도 바로 쓰는 현지 팁". 상품형 팔레트를 여행지형으로 갈아끼우면서 제목만 바꾼 흔적이다.

**R3. `section-library.ts:625-626`이 `travelTemplates`를 두 번 호출한다.** 첫 호출(빈 Set)은 `day-course` base만 얻으려는 것이고 나머지 9개 템플릿과 `overviewKnowledge` 계산은 전부 버려진다. `usedKnowledge` Set을 변형하는 부작용이 시그니처에 드러나지 않는다.

**R4. 장소 지식 테이블이 두 벌이다.** `post-spec/travel-knowledge.ts`의 `DESTINATION_KNOWLEDGE`(45개, 로컬 폴백용)와 `travel-content.ts`의 `HIGHLIGHT_KNOWLEDGE`(23개, 프롬프트 시드용)가 호이안·다낭·오키나와 등을 중복 보유한다. 한쪽만 고치면 로컬 초안과 프롬프트가 서로 다른 지역 인식을 갖는다.

**R5. `extractTravelProductFacts`가 한 포스트에서 5회 이상 서로 다른 입력으로 중복 호출된다.** 특히 썸네일 카피(`buildTravelThumbnailCopy`)만 `productName` 단독 추출이라 features 기반 highlights가 빠져, 같은 글의 요약 카드와 썸네일이 다른 목적지 문자열을 보일 수 있다.

**R6. `sentences` 기준이 상수 두 개로 중복.** `writing-prompt-contract.ts:84`(`{min: TRAVEL?5:4, max:6}`)와 `blog-writing-style.ts:30`(`{preferred: TRAVEL?5:4, hardMinimum:3}`)이 서로를 참조하지 않는다.

**R7. 본문 글자 수 정의가 경로마다 다르다.** 공유 계약은 "공백 포함", spec-first(`SHAPE_RULES`, `countChars`)는 **"공백 제외"**. 같은 원고가 어느 경로로 갔는지에 따라 분량 게이트 결과가 달라진다.

**R8. `formatDraftMemoRequirements`가 같은 실행에서 두 번 렌더된다.** `writing-prompt-contract.ts:128`(계약 블록 안)과 `simple-agent.ts:4876`(systemPrompt 마지막). 메모가 길면 동일 텍스트가 토큰을 두 배로 쓴다.

**R9. 해시태그 개수 계약이 4곳에서 다르다.** readiness는 3~10 pass·3 미만 하드 차단, `post-spec/index.ts:255`는 `count: 5` 하드코딩, `simple-agent.ts:276-278`의 `NAVER_BLOG_HASHTAG_COUNT`는 3~20 허용, `writing-prompt-contract.ts:74`는 3~10 밖이면 **throw**한다 — 11 이상으로 두면 STEP 2가 런타임에 죽는다.

**R10. STANDARD 프리셋은 실질적으로 품질 게이트가 없다.** `register()`가 모든 실패를 warning으로만 넣어 blockers가 절대 생기지 않고 `canAutoPublish`가 항상 true이며, `approveBrandPostPackage`의 PREMIUM 조건문도 전부 건너뛴다.

**R11. `scripts/lib/review-prompt.ts`는 공유 계약과 정면 충돌하는 병렬 템플릿이다.** 계약은 제목 25~35자·이모지 금지·해시태그 3~10인데, `buildReviewPrompt`는 이모지 헤더 6개 강제, 해시태그 15~20개, 본문 2000자 이상, `키워드｜서브키워드 후기` 제목 형식을 요구한다. **새 템플릿을 추가할 때 이 파일을 참고하면 계약을 어기게 된다.**

**R12. 문체 템플릿 매칭 정규식이 순서 의존적이고 겹친다.** SHOPPING에서 "구성"과 "소재"가 함께 나오면 `shopping-comparison`이 먼저 평가되어 `shopping-detail`은 도달하지 못한다. TRAVEL은 "일차"가 하나라도 있으면 `travel-conditions` 신호(불포함·호텔 미확정 등)를 전부 무시하고 `travel-itinerary`가 된다. 새 분기의 삽입 위치가 기존 선택을 조용히 바꾼다.

**R13. 주제글에도 중복 선언이 있다.** `GENERIC_HEADING_PATTERNS`가 `topic-task-pipeline.ts:399`와 `topic-task-content-readiness.ts:28`에 각각 정의돼 있고, 섹션 역할 유니온도 `topic-workflow.ts:5 TopicSubtopicRole`과 `topic-task-contract.ts:1 PreparedTopicSectionKind`에 따로 선언돼 있다. 역할 하나를 추가하려면 두 파일을 동시에 고쳐야 한다.

**R14. 썸네일 캔버스 계열이 두 벌이다.** 생성형은 1024×1024, 로컬 합성은 1080×1080이며 저장 썸네일 재사용 조건은 1080×1080 정사각이다. 생성형 결과를 그대로 재사용 대상으로 삼으려면 어딘가에서 리사이즈가 필요하다. 또 로컬 합성은 `subjectSide="full"`에서 헤드라인 2줄이면 subline이 y 988에 놓여 `COMMON_LAYOUT`이 요구하는 10% 세이프존(하단 972)을 넘길 수 있다.

**R15. 프롬프트 내부 모순 — `COMMON_LAYOUT`은 "텍스트 요소 최대 3개"인데 `textLines`는 최대 4개를 요구한다.** 양쪽 빌더가 `includeBadge=true` 고정이라 badge를 끄는 스위치가 없다. 모델이 하나를 빼면 `productNameMissing`(자동 탈락), 넷 다 그리면 `extraText` 감점 쪽으로 기운다.

**R16. 무드 폴백이 비대칭이다.** SHOPPING은 `item.id === moodId && item.scene`으로 scene이 빈 `auto`를 걸러 `inferScenePrompt`로 폴백하지만(`prompt.ts:92-93`), TRAVEL은 scene 유무를 보지 않고 `TRAVEL_MOODS[0]`으로 폴백한다(`:133`). TRAVEL 무드에 scene이 빈 항목을 추가하면 프롬프트의 장면 줄이 `- `만 남는다.

**R17. `resolvePostDocument`는 `sectionPlan` 길이가 안 맞으면 조용히 무시하고 고정 팔레트로 폴백한다.** 스펙의 슬롯 배정이 통째로 버려지는데 로그도 신호도 없다(T6과 같은 지점).

**R18. `randomIntro`/`randomEnding`이 프롬프트를 비결정적으로 만든다.** `simple-agent.ts:4837`·`:4854`의 `Math.random()`은 고정할 env 토글이 없어, 템플릿 추가 후 A/B 비교나 회귀 검증에서 프롬프트를 재현할 수단이 없다.
