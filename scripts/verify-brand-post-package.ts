import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { preserveProductPhotoSource } from "./lib/product-photo-provenance";
let fixtureRoot: string | undefined;

async function main() {
  const projectRoot = process.cwd();
  const draftRouteSource = fs.readFileSync(
    path.join(projectRoot, "src", "app", "api", "brandlinks", "[id]", "draft", "route.ts"),
    "utf8"
  );
  const publishRouteSource = fs.readFileSync(
    path.join(projectRoot, "src", "app", "api", "brandlinks", "[id]", "publish", "route.ts"),
    "utf8",
  );
  const draftImageRouteSource = fs.readFileSync(
    path.join(projectRoot, "src", "app", "api", "brandlinks", "[id]", "draft", "images", "route.ts"),
    "utf8",
  );
  const draftImageGenerationSource = fs.readFileSync(
    path.join(projectRoot, "src", "lib", "brand-post-image-generation.ts"),
    "utf8",
  );
  const simpleAgentSource = fs.readFileSync(path.join(projectRoot, "scripts", "simple-agent.ts"), "utf8");
  const dashboardSource = fs.readFileSync(path.join(projectRoot, "src", "app", "page.tsx"), "utf8");
  const materialLibrarySource = fs.readFileSync(path.join(projectRoot, "src", "components", "MaterialLibrary.tsx"), "utf8");
  const electronSource = fs.readFileSync(path.join(projectRoot, "scripts", "electron", "main.cjs"), "utf8");
  const sitesMcpSource = fs.readFileSync(
    path.join(projectRoot, "apps", "sites", "app", "api", "mcp", "[credential]", "route.ts"),
    "utf8",
  );
  assert.equal(
    draftRouteSource.includes('PRODUCT_POST_LOCAL_FALLBACK_ENABLED: "true"'),
    false,
    "데스크톱 초안 경로가 완성 문장형 로컬 폴백을 다시 켜면 안 됩니다."
  );
  assert.equal(
    simpleAgentSource.includes("하네스 문장을 원고로 복사하는 로컬 폴백은 품질 보호를 위해 차단했습니다"),
    true,
    "AI 생성 실패를 저품질 로컬 원고로 숨기지 않아야 합니다."
  );
  assert.equal(simpleAgentSource.includes("buildLocalTravelPostJson"), false);
  assert.equal(simpleAgentSource.includes("buildLocalProductReviewSections"), false);
  assert.equal(simpleAgentSource.includes("폴백 섹션으로 보완합니다"), false);
  assert.equal(
    /(?:const|let) productEditorialPlan = isTravel\r?\n\s+\? null/u.test(simpleAgentSource),
    true,
    "여행 원고 경로에서 쇼핑 제품 하네스를 생성하면 안 됩니다."
  );
  assert.equal(
    simpleAgentSource.includes("일반 ChatGPT 단일 프롬프트로 생성합니다."),
    true,
    "Browser ChatGPT 경로는 계정 종속 전용 GPT 없이 단일 프롬프트를 사용해야 합니다."
  );
  assert.equal(/https:\/\/chatgpt\.com\/g\//u.test(simpleAgentSource), false);
  assert.equal(
    simpleAgentSource.includes("제품리뷰 실제 사용기"),
    false,
    "검증되지 않은 실사용 제목을 자동 생성하면 안 됩니다."
  );
  assert.equal(
    simpleAgentSource.includes("장소의 배경, 실제 풍경과 분위기") &&
      simpleAgentSource.includes("여행지 브이로그"),
    true,
    "여행 제목과 본문은 체험을 꾸미지 않는 여행지 브이로그형이어야 합니다."
  );
  assert.equal(
    simpleAgentSource.includes("구매후기 근거:") &&
      simpleAgentSource.includes("reviewHighlights"),
    true,
    "쇼핑 상품의 실제 구매후기 원문을 수집해 하네스 근거로 전달해야 합니다.",
  );
  assert.equal(
    simpleAgentSource.includes("상세페이지 낭독문이 아니라 제품 분석 리뷰"),
    true,
    "쇼핑 원고는 상세페이지 낭독형이 아니라 기능·사용법 중심 제품 분석형이어야 합니다.",
  );
  assert.ok(
    simpleAgentSource.indexOf("const preparedPostOverride = loadPreparedBrandLinkPostOverride()") <
      simpleAgentSource.indexOf('setStage("브라우저 시작")'),
    "승인된 초안은 상품 상세페이지 브라우저를 열기 전에 먼저 불러와야 합니다.",
  );
  assert.equal(
    simpleAgentSource.includes("const needsLiveRefresh = !preparedPostOverride && !submittedSnapshot && ("),
    true,
    "승인된 초안 발행과 고정 스냅샷 제출은 상품 상세페이지 재수집을 건너뛰어야 합니다.",
  );
  assert.equal(
    simpleAgentSource.includes('manifest.generationSource !== "AI" && manifest.generationSource !== "PREPARED_APPROVED"'),
    true,
    "명시적으로 승인한 레거시 초안은 PREPARED_APPROVED 출처로 발행할 수 있어야 합니다.",
  );
  assert.equal(
    publishRouteSource.includes('preparedPackage.generationSource !== "PREPARED_APPROVED"'),
    true,
    "출처가 확인되지 않은 초안은 상품 브라우저를 띄우기 전에 API에서 차단해야 합니다.",
  );
  assert.equal(
    draftRouteSource.includes("readPrepareFailure(logPath)"),
    true,
    "초안 실패 시 실제 원인을 화면에 전달해야 합니다."
  );
  assert.equal(
    simpleAgentSource.includes("process.exitCode = 1"),
    true,
    "초안 생성 실패는 성공 종료 코드로 숨겨지면 안 됩니다."
  );
  assert.equal(
    draftRouteSource.includes('action: "prepare_context"') || draftRouteSource.includes('body.action === "prepare_context"'),
    true,
    "MCP는 모델 호출 전에 PC 상품 근거 컨텍스트를 준비해야 합니다.",
  );
  assert.equal(
    draftRouteSource.includes('BRANDLINK_GENERATED_DRAFT_PATH: action === "submit_generated"') &&
      draftRouteSource.includes('{ OPENAI_API_KEY: "" }'),
    true,
    "MCP 제출 원고 패키징은 PC의 OpenAI API 키를 사용하면 안 됩니다.",
  );
  assert.equal(
    draftRouteSource.includes('status: link.status === "FAILED" ? "READY" : link.status') &&
      draftRouteSource.includes("errorMessage: null"),
    true,
    "FAILED 상품도 초안 근거 준비에 성공하면 READY로 복구되어야 합니다.",
  );
  assert.equal(
    simpleAgentSource.includes("text = BRANDLINK_GENERATED_DRAFT_PATH") &&
      simpleAgentSource.includes("readMcpGeneratedDraft(BRANDLINK_GENERATED_DRAFT_PATH)") &&
      simpleAgentSource.includes("!BRANDLINK_GENERATED_DRAFT_PATH"),
    true,
    "ChatGPT 제출 원고는 API 생성 및 API 기반 재작성 경로를 건너뛰어야 합니다.",
  );
  assert.equal(
    sitesMcpSource.includes("name: 'post_prepare_draft'") &&
      sitesMcpSource.includes("name: 'post_submit_draft'") &&
      sitesMcpSource.includes("jobType: 'POST_PREPARE_DRAFT'") &&
      sitesMcpSource.includes("jobType: 'POST_SUBMIT_DRAFT'") &&
      sitesMcpSource.includes("jobType: 'POST_CREATE_DRAFT'"),
    true,
    "Sites MCP가 2단계 ChatGPT 원고 계약을 광고하고 큐에 전달해야 합니다.",
  );
  const createDraftTool = /name: 'post_create_draft',[\s\S]*?jobType: '([A-Z_]+)'/u.exec(sitesMcpSource);
  assert.equal(createDraftTool?.[1], "POST_PREPARE_DRAFT", "post_create_draft 는 컨텍스트 준비 전용 작업이어야 합니다(원고는 ChatGPT 가 쓴다).");
  const localGenerateTool = /name: 'post_generate_draft_local',[\s\S]*?jobType: '([A-Z_]+)'/u.exec(sitesMcpSource);
  assert.equal(localGenerateTool?.[1], "POST_CREATE_DRAFT", "PC 전량 생성은 post_generate_draft_local 로만 노출해야 합니다.");
  assert.equal(
    sitesMcpSource.includes("name: 'post_apply_section_image'") &&
      sitesMcpSource.includes("jobType: 'POST_APPLY_SECTION_IMAGE'") &&
      sitesMcpSource.includes("post_apply_section_image 로 붙이세요"),
    true,
    "Sites MCP는 ChatGPT 내장 이미지 생성 결과를 섹션에 붙이는 도구와 안내를 제공해야 합니다.",
  );
  const pollRouteSource = fs.readFileSync(path.join(projectRoot, "src", "app", "api", "remote-agent", "poll", "route.ts"), "utf8");
  assert.equal(
    pollRouteSource.includes('job.type === "POST_APPLY_SECTION_IMAGE"') &&
      pollRouteSource.includes('action: "apply_generated"') &&
      pollRouteSource.includes("readDraftProgress(watch.productId") &&
      pollRouteSource.includes("timeoutMs: DRAFT_GENERATE_WAIT_MS") &&
      pollRouteSource.includes("timeoutMs: DRAFT_PREPARE_WAIT_MS") &&
      pollRouteSource.includes("contentQuality: extra.contentQuality"),
    true,
    "데스크톱 실행기는 섹션 이미지 적용 작업, 진행률 파일 읽기, 초안 데드라인, contentQuality 봉투를 지원해야 합니다.",
  );
  const draftContextViewSource = fs.readFileSync(path.join(projectRoot, "src", "lib", "draft-context-view.ts"), "utf8");
  assert.equal(
    draftContextViewSource.includes("verifiedFacts") &&
      draftContextViewSource.includes("sourceImages") &&
      draftContextViewSource.includes("systemPrompt: generation.systemPrompt") &&
      pollRouteSource.includes("buildPreparedDraftView") &&
      pollRouteSource.includes("imagePrompt: productName && (title || intent)"),
    true,
    "초안 컨텍스트 결과는 verifiedFacts·sourceImages·systemPrompt 를 최상위로 올리고 슬롯마다 imagePrompt 를 제공해야 합니다.",
  );
  assert.equal(
    /const view: Record<string, unknown> = \{\s*\.\.\.data,/u.test(draftContextViewSource) &&
      !draftContextViewSource.includes("context: data"),
    true,
    "brand-draft-context/v2 는 최상위에 펼쳐야 합니다(context 아래로 내리면 제출이 PRODUCT_SNAPSHOT_CHANGED 로 막힙니다).",
  );
  assert.equal(
    simpleAgentSource.includes("createProductDetailImageSegments") &&
      simpleAgentSource.includes("상세 원문") &&
      simpleAgentSource.includes("상세 근거") &&
      simpleAgentSource.includes("evidenceFacts"),
    true,
    "긴 쇼핑 상세이미지를 분할 첨부하고 구조화 근거로 회수해야 합니다.",
  );
  assert.equal(
    !simpleAgentSource.includes("hasReviewEvidence || hasVisualReviewEvidence") &&
      simpleAgentSource.includes("const finalReviewEvidenceReady") &&
      simpleAgentSource.includes("!finalReviewEvidenceReady"),
    true,
    "검증된 OCR provenance가 없는 이미지 장수만으로 상품 텍스트 근거를 충족 처리하면 안 됩니다.",
  );
  assert.equal(
    sitesMcpSource.includes("evidenceFacts") && draftRouteSource.includes("evidenceFacts"),
    true,
    "MCP 제출 경로가 쇼핑 상세이미지 근거를 보존해야 합니다.",
  );
  assert.equal(
    draftRouteSource.includes('"CHATGPT_MCP_DRAFT_REQUIRED"') &&
      draftRouteSource.includes('"CODEX_LOGIN_REQUIRED"') &&
      draftRouteSource.includes("buildChatGptDraftHandoff"),
    true,
    "Codex/API 인증이 없을 때 연결 안내와 상품별 ChatGPT 핸드오프를 제공해야 합니다.",
  );
  assert.equal(
    dashboardSource.includes('response.status === 409') &&
      dashboardSource.includes('<MaterialLibrary connectKind={brandConnectKind}') &&
      materialLibrarySource.includes('/api/materials/prepare') &&
      dashboardSource.includes("setChatGptDraftHandoff(handoff)"),
    true,
    "데스크톱 UI는 GPT 자동작성과 ChatGPT 핸드오프를 모두 지원해야 합니다.",
  );
  assert.equal(
    draftRouteSource.includes('"CHATGPT_BROWSER_LOGIN_REQUIRED"') &&
      draftRouteSource.includes('"CHATGPT_BROWSER_FALLBACK_REQUIRED"') &&
      draftRouteSource.includes("isChatGptBrowserAuthenticationError") &&
      draftRouteSource.includes("buildChatGptBrowserAutomationEnv(useBrowserChatGpt)"),
    true,
    "API 키가 없을 때 로그인된 ChatGPT 웹 자동작성과 안전한 핸드오프 폴백을 모두 지원해야 합니다.",
  );
  assert.equal(
    dashboardSource.includes('<MaterialLibrary connectKind={brandConnectKind}') &&
      dashboardSource.includes('provider: "chatgpt", force: false') &&
      dashboardSource.includes("await requestDraft(false)"),
    true,
    "데스크톱 UI는 ChatGPT 로그인 완료 후 같은 초안 요청을 자동 재개해야 합니다.",
  );
  assert.equal(
    electronSource.includes("setWindowOpenHandler") &&
      electronSource.includes("shell.openExternal") &&
      electronSource.includes('return { action: "deny" }'),
    true,
    "ChatGPT 링크는 Electron 내부 팝업이 아니라 기본 브라우저에서 열려야 합니다.",
  );
  assert.equal(
    draftImageRouteSource.includes('["generate_missing", "generate_section", "regenerate", "apply_generated", "bind_sources"]') &&
      draftImageRouteSource.includes("repairBrandPostImages") &&
      draftImageRouteSource.includes("applyExternalGeneratedBrandPostImage") &&
      draftImageRouteSource.includes("sourceOnly: body.action === \"bind_sources\"") &&
      draftImageRouteSource.includes('"Cache-Control": "private, no-store, max-age=0"'),
    true,
    "초안 이미지는 필수 보충·원본 배정·파트 추가·개별 재생성·외부 생성 이미지 적용과 안전한 미리보기를 지원해야 합니다.",
  );
  assert.equal(
    !draftImageRouteSource.includes("if (!isChatGptBrowserAutomationEnabled()) {") &&
      draftImageRouteSource.includes('"CHATGPT_BROWSER_AUTOMATION_DISABLED"') &&
      draftImageRouteSource.indexOf("planSectionImageRequests") <
        draftImageRouteSource.indexOf("await repairBrandPostImages("),
    true,
    "이미지 API는 브라우저 상태와 무관하게 검증 원본 배정을 먼저 실행해야 합니다.",
  );
  assert.equal(
    draftImageGenerationSource.includes("if (!isChatGptBrowserAutomationEnabled()) {") &&
      draftImageGenerationSource.includes("BROWSER_IMAGE_AUTOMATION_DISABLED_MESSAGE") &&
      draftImageGenerationSource.indexOf("if (!isChatGptBrowserAutomationEnabled()) {") <
        draftImageGenerationSource.indexOf("child = spawn("),
    true,
    "이미지 배치 실행기는 spawn 전에 브라우저 자동화 게이트를 검사해야 합니다.",
  );
  assert.equal(
    draftImageGenerationSource.includes("Generate the environment only") &&
      draftImageGenerationSource.includes("createLockedProductEditorialScene") &&
      draftImageGenerationSource.includes("do not invent a named hotel"),
    true,
    "쇼핑은 상품을 다시 그리지 않고, 여행은 확인되지 않은 장소를 만들지 않아야 합니다.",
  );
  assert.equal(
    dashboardSource.includes("섹션별 이미지 자동 생성") &&
      dashboardSource.includes("handleRegenerateDraftImage") &&
      dashboardSource.includes("원고 보강 요청") &&
      dashboardSource.includes("handleRepairBrandDraft") &&
      dashboardSource.includes('body: JSON.stringify({ action: "revise", qualityConvergence: true, instructions })'),
    true,
    "데스크톱 미리보기에서 이미지 보충·개별 재생성·품질 보강을 실행할 수 있어야 합니다.",
  );
  assert.equal(
    simpleAgentSource.includes("reconcileBrandPostImageContinuity(params.preserveManifest, next)") &&
      simpleAgentSource.includes("previousPackage.sourceSnapshot?.snapshotId === submittedSnapshot?.snapshotId") &&
      simpleAgentSource.includes("sourceSnapshot: snapshot, preserveManifest: prepared.manifest"),
    true,
    "부분 보강과 같은 스냅샷 재제출은 기존 이미지·슬롯·생성 체크포인트를 승계해야 합니다.",
  );
  assert.equal(
    draftImageRouteSource.includes("planSectionImageRequests") &&
      draftImageRouteSource.includes('asset?.provenance === "ORIGINAL"') &&
      draftImageRouteSource.includes("replaceAssetKey"),
    true,
    "명시적 생성 요청은 원본 출처를 보존하며 꽉 찬 슬롯에서는 지정한 원본을 교체할 수 있어야 합니다.",
  );
  assert.equal(
    draftRouteSource.includes("scheduleSectionImageRepair") &&
      draftRouteSource.includes("void repairBrandPostImages({ brandLinkId: options.brandLinkId, productName: options.productName,") &&
      draftRouteSource.includes("sourceOnly: options.sourceOnly") &&
      !draftRouteSource.includes("await repairBrandPostImages(") &&
      !draftRouteSource.includes("autoRepairSectionImages"),
    true,
    "초안 응답은 섹션 이미지 배치를 기다리지 않아야 합니다(분리 실행).",
  );
  assert.equal(
    draftRouteSource.includes('draftRuntimePolicy.BRAND_POST_AUTO_SECTION_IMAGES === "true"') &&
      draftRouteSource.includes("if (!isAutoSectionImagesEnabled())") &&
      draftRouteSource.includes("canFillFromVerifiedShoppingSources") &&
      draftRouteSource.includes("!canFillFromVerifiedShoppingSources && !isChatGptBrowserAutomationEnabled()") &&
      draftRouteSource.indexOf("if (!canFillFromVerifiedShoppingSources") < draftRouteSource.indexOf("void repairBrandPostImages("),
    true,
    "쇼핑 원본 우선 배정은 브라우저 없이 예약하고, 실제 생성이 필요한 정책만 브라우저를 선검사해야 합니다.",
  );
  assert.equal(
    draftRouteSource.includes('manifest.connectKind !== "SHOPPING"') &&
      draftRouteSource.includes('sourceOnly: action === "submit_generated" || mcpOrigin'),
    true,
    "MCP 쇼핑 원고는 검증 원본만 자동 배정하고 PC 브라우저 이미지 생성은 시작하지 않아야 합니다.",
  );
  const batchSource = fs.readFileSync(path.join(projectRoot, "scripts", "chatgpt-generate-image-batch.ts"), "utf8");
  assert.equal(
    batchSource.includes("isBatchFailFastEnabled") &&
      batchSource.includes('(env.BRAND_POST_IMAGE_BATCH_FAIL_FAST || "true")') &&
      batchSource.includes("const sessionFailureKind = result.error ? classifySessionWideImageFailure(result.error) : null") &&
      batchSource.includes('sessionFailureKind && (failFast || sessionFailureKind === "unreachable")') &&
      batchSource.includes("if (typeof observed === \"number\" && observed === 0) {"),
    true,
    "이미지 배치는 세션 전체 오류만 연쇄 중단하고, 완료 이미지가 관측되지 않은 대기 종료는 실패로 취급해야 합니다.",
  );

  const handoffBuilder = await import("../src/lib/chatgpt-draft-handoff");
  const handoff = handoffBuilder.buildChatGptDraftHandoff({
    productId: "travel-product-123",
    productName: "타이페이\n단수이 4일",
    connectKind: "TRAVEL",
  });
  assert.equal(handoff.productLabel, "타이페이 단수이 4일");
  assert.equal(handoff.connectKind, "TRAVEL");
  assert.equal(handoff.chatgptUrl, "https://chatgpt.com/");
  assert.match(handoff.prompt, /post_create_draft/u);
  assert.match(handoff.prompt, /job_get/u);
  assert.match(handoff.prompt, /post_submit_draft/u);
  assert.match(handoff.prompt, /발행하거나 예약하지 마세요/u);
  assert.match(handoff.prompt, /신뢰되지 않은 참고 데이터/u);

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "brand-post-package-"));
  fixtureRoot = userData;
  process.env.DESKTOP_USER_DATA = userData;
  const store = await import("../src/lib/brand-post-package");
  const { planSectionImageRequests } = await import("../src/lib/brand-post-image-repair");
  const compositionContract = await import("../src/lib/post-composition-contract");
  const id = "fixture-brand-link-001";
  const dir = store.getBrandPostPackageDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const markdownPath = path.join(dir, "post.md");
  const heroImagePath = path.join(dir, "hero.png");
  const bodyImagePaths = [1, 2, 3, 4].map((n) => path.join(dir, `body-${n}.png`));
  fs.writeFileSync(markdownPath, "# 테스트 초안\n\n## 본문\n\n승인 전에는 발행하지 않습니다.", "utf8");
  fs.writeFileSync(heroImagePath, "hero");
  bodyImagePaths.forEach((file, index) => fs.writeFileSync(file, `body-${index}`));
  fs.writeFileSync(store.getBrandPostPackageManifestPath(id), JSON.stringify({
    version: "brand-post-package/v1",
    brandLinkId: id,
    connectKind: "SHOPPING",
    title: "테스트 초안",
    markdownPath,
    heroImagePath,
    bodyImagePaths,
    hashtags: ["테스트"],
    imagePolicy: "LOCKED_PRODUCT_OR_ORIGINAL",
    createdAt: new Date().toISOString(),
    approvedAt: null,
  }, null, 2));
  assert.equal(store.readBrandPostPackage(id)?.approvedAt, null);
  const approvedLegacy = store.approveBrandPostPackage(id);
  assert.ok(store.packagePreview(approvedLegacy).markdown.includes("승인 전에는"));
  assert.equal(approvedLegacy.generationSource, "PREPARED_APPROVED");
  assert.ok(store.readBrandPostPackage(id)?.approvedAt);
  assert.equal(store.readBrandPostPackage(id)?.generationSource, "PREPARED_APPROVED");
  const legacyManifestPath = store.getBrandPostPackageManifestPath(id);
  const alreadyApprovedLegacy = JSON.parse(fs.readFileSync(legacyManifestPath, "utf8"));
  delete alreadyApprovedLegacy.generationSource;
  fs.writeFileSync(legacyManifestPath, JSON.stringify(alreadyApprovedLegacy, null, 2), "utf8");
  assert.equal(
    store.readBrandPostPackage(id)?.generationSource,
    "PREPARED_APPROVED",
    "이미 승인된 v1 초안도 읽는 즉시 사용자 승인 출처로 마이그레이션해야 합니다.",
  );
  assert.equal(
    JSON.parse(fs.readFileSync(legacyManifestPath, "utf8")).generationSource,
    "PREPARED_APPROVED",
    "마이그레이션 결과는 실제 매니페스트에 저장돼 발행 자식 프로세스도 읽을 수 있어야 합니다.",
  );

  const v2Id = "fixture-brand-link-v2-001";
  const v2Dir = store.getBrandPostPackageDir(v2Id);
  fs.mkdirSync(v2Dir, { recursive: true });
  const v2MarkdownPath = path.join(v2Dir, "post.md");
  const v2HeroPath = path.join(v2Dir, "hero.png");
  fs.writeFileSync(v2MarkdownPath, "# V2 품질 게이트 테스트", "utf8");
  fs.writeFileSync(v2HeroPath, "hero-v2");
  const premiumComposition = compositionContract.resolvePostDocument({
    connectKind: "TRAVEL",
    title: "V2 여행 초안",
    sections: ["예약 전 핵심 확인\n\n일정과 포함 조건을 확인하세요."],
    hashtags: ["여행커넥트"],
    imagePaths: [v2HeroPath],
    connectUrl: "https://example.test/travel",
    qualityPreset: "PREMIUM",
  });
  const firstMappedImage = path.join(v2Dir, "first.jpg");
  const thirdMappedImage = path.join(v2Dir, "third.jpg");
  fs.writeFileSync(firstMappedImage, "first-original");
  fs.writeFileSync(thirdMappedImage, "third-original");
  const mappedComposition = compositionContract.resolvePostDocument({
    connectKind: "TRAVEL",
    title: "섹션 이미지 배치 테스트",
    sections: ["첫 섹션\n\n본문", "둘째 섹션\n\n본문", "셋째 섹션\n\n본문"],
    hashtags: [],
    imagePaths: [v2HeroPath, firstMappedImage, thirdMappedImage],
    sectionImageBindings: {
      [compositionContract.stableFreeformSectionId("TRAVEL", "첫 섹션")]: [firstMappedImage],
      [compositionContract.stableFreeformSectionId("TRAVEL", "셋째 섹션")]: [thirdMappedImage],
    },
    connectUrl: "https://example.test/travel",
    qualityPreset: "STANDARD",
  });
  assert.deepEqual(mappedComposition.sections.map((section) => section.imagePaths), [
    [firstMappedImage],
    [],
    [thirdMappedImage],
  ], "Spec-first의 섹션별 이미지 배치를 순차 재분배로 덮어쓰면 안 됩니다.");
  const v2Manifest = {
    version: "brand-post-package/v2" as const,
    contractVersion: "post-composition-contract/v1" as const,
    brandLinkId: v2Id,
    connectKind: "TRAVEL" as const,
    title: "V2 여행 초안",
    generationSource: "AI" as const,
    markdownPath: v2MarkdownPath,
    heroImagePath: v2HeroPath,
    bodyImagePaths: [],
    hashtags: ["여행커넥트"],
    imagePolicy: "TRAVEL_EDITORIAL" as const,
    createdAt: new Date().toISOString(),
    approvedAt: null,
    contentQuality: {
      canPublish: true, verdict: "pass" as const, code: "ok" as const, reason: null, score: 96, signals: [], summary: "검수 통과",
      sectionCount: 10, hashtagCount: 3, totalLength: 4000, coveredProductTokens: [], missingProductTokens: [], blockers: [],
      quality: { score: 96, passScore: 70, categories: [],
        repetition: { nearDuplicateCount: 0, exactDuplicateCount: 0, duplicateOpeningCount: 0, samples: [] },
        generic: { sentenceCount: 10, guidanceCount: 0, generalStatementCount: 0, guidanceRatio: 0, generalRatio: 0, threshold: 0.24 } },
    },
    composition: premiumComposition,
    thumbnailSpec: {
      version: "thumbnail-spec/v2" as const,
      canvas: { width: 1080, height: 1080, aspect: "1:1" as const },
      style: "travel-cinematic",
      sourcePolicy: "TRAVEL_EDITORIAL" as const,
      sourceImagePath: v2HeroPath,
    },
  };
  const mappedPreview = store.packagePreview({
    ...v2Manifest,
    bodyImagePaths: [firstMappedImage, thirdMappedImage],
    composition: mappedComposition,
    imageRequirements: { policy: "generated-required" },
    imageAssets: [v2HeroPath, firstMappedImage, thirdMappedImage].map((file, index) => {
      const section = mappedComposition.sections.find(candidate => candidate.imagePaths.includes(file));
      const ordinal = section ? section.imagePaths.indexOf(file) + 1 : 1;
      return {
        path: file,
        sourcePath: file,
        sha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
        role: index ? "body" as const : "hero" as const,
        sectionId: section?.id || null,
        imageIntent: section?.imageIntent,
        slotId: section ? `${section.id}:image:${ordinal}` : "hero:image:1",
        provenance: "ORIGINAL" as const,
        creationMethod: "source" as const,
        remoteGenerated: false,
      };
    }),
  });
  assert.equal(mappedPreview.imageSlots[0].originalCount, 1);
  assert.equal(mappedPreview.imageSlots[0].generatedCount, 0);
  assert.equal(mappedPreview.imageSlots[0].generationMissing, 1, "원본 이미지는 섹션 생성 이미지 충족으로 계산하면 안 됩니다.");

  // Offline release regression: neither default-off nor MCP execution creates
  // imageGeneration metadata. Explicit generated-required coverage must still
  // require actual remote-generated provenance; default originals pass in the integrity suite.
  for (const connectKind of ["TRAVEL", "SHOPPING"] as const) {
    for (const legacy of [false, true]) {
      const coverageId = `fixture-coverage-${connectKind}-${legacy ? "v139" : "current"}`;
      const coverageDir = store.getBrandPostPackageDir(coverageId);
      fs.mkdirSync(coverageDir, { recursive: true });
      const images = Array.from({ length: 11 }, (_, index) => path.join(coverageDir, `${index}.png`));
      images.forEach((file, index) => fs.writeFileSync(file, `offline-${coverageId}-${index}`));
      const coverageSections = Array.from({ length: 10 }, (_, index) =>
        `확인한 정보 ${index + 1}\n\n${"확인된 정보와 사용 조건을 구체적으로 연결해 선택에 필요한 차이를 설명합니다. ".repeat(10)}`);
      const coverageBindings = Object.fromEntries(coverageSections.map((section, index) => [
        compositionContract.stableFreeformSectionId(connectKind, section.split("\n")[0]),
        [images[index + 1]],
      ]));
      if (connectKind === "TRAVEL") {
        const detailed = compositionContract.stableFreeformSectionId(connectKind, "확인한 정보 3");
        const optional = compositionContract.stableFreeformSectionId(connectKind, "확인한 정보 10");
        coverageBindings[detailed].push(...coverageBindings[optional].splice(0, 1));
      }
      const composition = compositionContract.resolvePostDocument({
        connectKind,
        title: "오프라인 생성 이미지 승인 검사",
        sections: coverageSections,
        imagePaths: images,
        sectionImageBindings: coverageBindings,
        hashtags: ["정보", "조건", "선택"],
        connectUrl: "https://example.test/coverage",
        qualityPreset: "PREMIUM",
      });
      if (legacy) {
        // 1.3.9 freeform packages have neither explicit bounds nor postSpec.
        composition.sections.forEach((section) => { delete section.imageMin; delete section.imageMax; });
      }
      const originals = {
        ...v2Manifest,
        brandLinkId: coverageId,
        title: composition.title,
        imageRequirements: { policy: "generated-required" as const },
        connectKind,
        heroImagePath: images[0],
        bodyImagePaths: images.slice(1),
        composition,
      };
      store.writeBrandPostPackageManifest(originals);
      const loaded = store.readBrandPostPackage(coverageId)!;
      assert.equal(loaded.imageGeneration, undefined);
      assert.equal(loaded.version === "brand-post-package/v2" && loaded.composition.qualityReport.canAutoPublish, true,
        "Fixture must pass ordinary text/image-count quality so generation is the decisive gate");
      const slots = store.packagePreview(loaded).imageSlots;
      assert.equal(
        slots.reduce((sum, slot) => sum + slot.missing, 0),
        connectKind === "SHOPPING" ? 10 : 0,
        "unreviewed shopping originals are stale; travel originals still satisfy ordinary coverage",
      );
      const expectedGeneratedMinimum = slots.reduce((sum, slot) => sum + slot.minimum, 0);
      assert.equal(slots.reduce((sum, slot) => sum + slot.generationMissing, 0), expectedGeneratedMinimum);
      assert.throws(() => store.approveBrandPostPackage(coverageId), /이미지/u,
        `${coverageId}: originals without execution metadata must not be approved`);

      store.writeBrandPostPackageManifest({ ...originals, approvedAt: "2026-09-01T00:00:00.000Z" });
      assert.equal(store.readBrandPostPackage(coverageId)?.approvedAt, null,
        "Reading a previously approved package must revoke an approval that bypassed generated coverage");

      const generated = {
        ...originals,
        imageAssets: store.normalizePackageImageAssets(originals).map((asset, assetIndex) => {
          if (!asset.sectionId) return {
            ...asset,
            provenance: connectKind === "SHOPPING" ? "LOCKED_PRODUCT" as const : "GENERATED_BACKGROUND" as const,
            remoteGenerated: true,
            creationMethod: connectKind === "SHOPPING" ? "source-with-generated-background" as const : "remote-generated" as const,
            slotId: "hero:image:1",
          };
          const section = composition.sections.find(candidate => candidate.id === asset.sectionId)!;
          let sourceReview: import("../src/lib/brand-post-package").BrandPostPackageImageAsset["sourceReview"];
          if (connectKind === "SHOPPING") {
            const featureSource = path.join(coverageDir, `feature-source-${assetIndex}.png`);
            fs.writeFileSync(featureSource, `feature-source-${coverageId}-${assetIndex}`);
            const receipt = preserveProductPhotoSource({ sourcePath: featureSource, outputPath: asset.path, segmented: true });
            sourceReview = {
              version: "product-photo-source-review/v1",
              sourceSha256: receipt.sourceSha256,
              usage: "section-matched-product-evidence",
              sectionIntent: section.imageIntent,
              reviewClass: "feature-evidence",
              reason: "fixture feature evidence",
              reviewedAt: "2026-09-15T00:00:00.000Z",
            };
          }
          return {
            ...asset,
            provenance: connectKind === "SHOPPING" ? "LOCKED_PRODUCT" as const : "GENERATED_BACKGROUND" as const,
            remoteGenerated: true,
            creationMethod: connectKind === "SHOPPING" ? "source-with-generated-background" as const : "remote-generated" as const,
            imageIntent: section.imageIntent,
            slotId: `${section.id}:image:${section.imagePaths.findIndex(file => path.resolve(file) === path.resolve(asset.path)) + 1}`,
            sourceReview,
          };
        }),
      };
      store.writeBrandPostPackageManifest(generated);
      assert.equal(store.packagePreview(store.readBrandPostPackage(coverageId)!).imageSlots.every((slot) => slot.generationMissing === 0), true);
      assert.ok(store.approveBrandPostPackage(coverageId).approvedAt,
        `${coverageId}: fully generated coverage without execution metadata can be approved`);
      assert.ok(store.readBrandPostPackage(coverageId)?.approvedAt, "Valid approval survives read-time reconciliation");

      const repeatedHeroRender = structuredClone(generated);
      const renderedHero = repeatedHeroRender.composition.renderNodes.find(node =>
        node.kind === "image" && node.sectionId === null)!;
      repeatedHeroRender.composition.renderNodes.push({ ...renderedHero });
      const repeatedHeroReadiness = store.evaluateBrandPostPackageReadiness(repeatedHeroRender);
      assert.ok(repeatedHeroReadiness.blockers.some(blocker => blocker.code === "image-render-mismatch"),
        "the publish document must render exactly one hero image");
      assert.equal(
        repeatedHeroReadiness.composition!.qualityReport.actual.images,
        1 + repeatedHeroReadiness.imageSlots.reduce((sum, slot) => sum + slot.count, 0),
        "quality counts each accepted image SHA once even when a render node is duplicated",
      );

      if (connectKind === "SHOPPING") {
        const sourceReviewed = structuredClone(generated) as import("../src/lib/brand-post-package").BrandPostPackageManifestV2;
        sourceReviewed.imageRequirements = { policy: "verified-source-first" };
        sourceReviewed.imageAssets = sourceReviewed.imageAssets!.map(asset => {
          if (!asset.sectionId) return asset;
          const section = sourceReviewed.composition.sections.find(candidate => candidate.id === asset.sectionId)!;
          if (section.imageIntent.includes("AI 연출 이미지")) return asset;
          return {
            ...asset,
            provenance: "ORIGINAL" as const,
            remoteGenerated: false,
            creationMethod: "source" as const,
            sourceReview: {
              version: "product-photo-source-review/v1" as const,
              sourceSha256: asset.sha256,
              usage: "section-matched-product-evidence" as const,
              sectionIntent: section.imageIntent,
              reviewClass: "feature-evidence" as const,
              reason: "fixture semantic match",
              reviewedAt: "2026-09-15T00:00:00.000Z",
            },
          };
        });
        assert.equal(store.evaluateBrandPostPackageReadiness(sourceReviewed).canApprove, true,
          "reviewed evidence originals plus locked lifestyle scenes satisfy the mixed contract");
        const unreviewed = structuredClone(sourceReviewed);
        const unreviewedAsset = unreviewed.imageAssets!.find(asset => asset.sectionId && asset.creationMethod === "source")!;
        delete unreviewedAsset.sourceReview;
        const unreviewedReadiness = store.evaluateBrandPostPackageReadiness(unreviewed);
        assert.equal(unreviewedReadiness.canApprove, false);
        assert.ok(unreviewedReadiness.blockers.some(blocker => blocker.code === "image-source-review-missing"),
          "a generic or unreviewed original cannot satisfy a semantic section slot");

        const overviewProductPhoto = structuredClone(sourceReviewed);
        const overviewSection = overviewProductPhoto.composition.sections[1];
        const overviewAsset = overviewProductPhoto.imageAssets!.find(asset => asset.sectionId === overviewSection.id)!;
        assert.ok(overviewAsset.sourceReview);
        overviewAsset.sourceReview.reviewClass = "product-photo";
        assert.equal(store.evaluateBrandPostPackageReadiness(overviewProductPhoto).canApprove, true,
          "a generic product photo remains valid for the overview slot only");

        const featureProductPhoto = structuredClone(sourceReviewed);
        const featureSection = featureProductPhoto.composition.sections[2];
        const featureAsset = featureProductPhoto.imageAssets!.find(asset => asset.sectionId === featureSection.id)!;
        assert.ok(featureAsset.sourceReview);
        featureAsset.sourceReview.reviewClass = "product-photo";
        const featureReadiness = store.evaluateBrandPostPackageReadiness(featureProductPhoto);
        assert.equal(featureReadiness.canApprove, false);
        assert.ok(featureReadiness.blockers.some(blocker =>
          blocker.code === "image-source-review-missing" && blocker.sectionId === featureSection.id),
        "a packshot cannot masquerade as feature evidence");

        const staleReview = structuredClone(sourceReviewed);
        const staleReviewAsset = staleReview.imageAssets!.find(asset => asset.sectionId === featureSection.id)!;
        staleReviewAsset.sourceReview!.sectionIntent = "구형 파트 목적";
        assert.ok(store.evaluateBrandPostPackageReadiness(staleReview).blockers.some(blocker =>
          blocker.code === "image-source-review-missing" && blocker.sectionId === featureSection.id),
        "a source review bound to an old section intent must be reviewed again");
        const staleReviewSlot = store.packagePreview(staleReview).imageSlots.find(slot => slot.sectionId === featureSection.id)!;
        const staleReviewRequest = planSectionImageRequests([staleReviewSlot]).find(request =>
          request.replaceAssetKey === staleReviewAsset.sha256)!;
        assert.ok(staleReviewRequest);
        store.writeBrandPostPackageManifest(staleReview);
        const reviewedReplacementPath = path.join(coverageDir, `review-replacement-${legacy ? "legacy" : "bounded"}.png`);
        fs.writeFileSync(reviewedReplacementPath, `review-replacement-${coverageId}`);
        const reviewedReplacement = store.applyGeneratedBrandPostImage({
          brandLinkId: coverageId,
          ...staleReviewRequest,
          generatedPath: reviewedReplacementPath,
          provenance: "LOCKED_PRODUCT",
          creationMethod: "source-with-generated-background",
          remoteGenerated: true,
          imageIntent: featureSection.imageIntent,
        });
        const replacedReviewAsset = reviewedReplacement.imageAssets!.find(asset =>
          asset.sectionId === featureSection.id && asset.slotId === staleReviewRequest.slotId)!;
        assert.equal(replacedReviewAsset.sourceReview, undefined,
          "a review signed for the replaced source bytes must not carry over to generated evidence");
        const unverifiedCompositeReadiness = store.evaluateBrandPostPackageReadiness(reviewedReplacement);
        assert.equal(unverifiedCompositeReadiness.canApprove, false);
        assert.ok(unverifiedCompositeReadiness.blockers.some(blocker =>
          blocker.code === "image-source-review-missing" && blocker.sectionId === featureSection.id),
        "a feature composite cannot pass without a receipt for its locked seller foreground");
        const replacementSource = path.join(coverageDir, `review-replacement-source-${legacy ? "legacy" : "bounded"}.png`);
        fs.writeFileSync(replacementSource, `review-replacement-source-${coverageId}`);
        const replacementReceipt = preserveProductPhotoSource({
          sourcePath: replacementSource,
          outputPath: replacedReviewAsset.path,
          segmented: true,
        });
        replacedReviewAsset.sourceReview = {
          version: "product-photo-source-review/v1",
          sourceSha256: replacementReceipt.sourceSha256,
          usage: "section-matched-product-evidence",
          sectionIntent: featureSection.imageIntent,
          reviewClass: "feature-evidence",
          reason: "fixture replacement feature evidence",
          reviewedAt: "2026-09-15T00:00:00.000Z",
        };
        assert.equal(store.evaluateBrandPostPackageReadiness(reviewedReplacement).canApprove, true,
          JSON.stringify(store.evaluateBrandPostPackageReadiness(reviewedReplacement).blockers));
        store.writeBrandPostPackageManifest(generated);
      }

      const staleGenerated = structuredClone(generated) as import("../src/lib/brand-post-package").BrandPostPackageManifestV2;
      const staleAsset = staleGenerated.imageAssets!.find(asset => asset.role === "body" && asset.sectionId)!;
      const staleSection = staleGenerated.composition.sections.find(section => section.id === staleAsset.sectionId)!;
      staleAsset.imageIntent = "구형 파트 목적";
      staleAsset.slotId = `${staleSection.id}:image:99`;
      const stalePreview = store.packagePreview(staleGenerated);
      const staleSlot = stalePreview.imageSlots.find(slot => slot.sectionId === staleSection.id)!;
      assert.ok(staleSlot.staleTargets.some(target =>
        target.code === "image-intent-stale" && target.assetKey === staleAsset.sha256),
      "a generated asset from an old intent/slot is a replaceable stale target");
      const stalePlan = planSectionImageRequests(stalePreview.imageSlots);
      const replacementRequest = stalePlan.find(request => request.replaceAssetKey === staleAsset.sha256)!;
      assert.ok(replacementRequest);
      assert.equal(replacementRequest.slotId, `${staleSection.id}:image:1`);
      store.writeBrandPostPackageManifest(staleGenerated);
      const replacementPath = path.join(coverageDir, `stale-replacement-${connectKind.toLowerCase()}-${legacy ? "legacy" : "bounded"}.png`);
      fs.writeFileSync(replacementPath, `stale-replacement-${coverageId}`);
      if (connectKind === "SHOPPING") preserveProductPhotoSource({
        sourcePath: generated.heroImagePath, outputPath: replacementPath, segmented: true,
      });
      const staleRepaired = store.applyGeneratedBrandPostImage({
        brandLinkId: coverageId,
        ...replacementRequest,
        generatedPath: replacementPath,
        provenance: connectKind === "SHOPPING" ? "LOCKED_PRODUCT" : "GENERATED_BACKGROUND",
        creationMethod: connectKind === "SHOPPING" ? "source-with-generated-background" : "remote-generated",
        remoteGenerated: true,
        imageIntent: staleSection.imageIntent,
      });
      const repairedSlot = store.packagePreview(staleRepaired).imageSlots.find(slot => slot.sectionId === staleSection.id)!;
      assert.equal(repairedSlot.staleTargets.length, 0);
      assert.equal(repairedSlot.missing, 0);
      assert.equal(repairedSlot.generationMissing, 0);
      assert.ok(!staleRepaired.imageAssets!.some(asset => asset.sha256 === staleAsset.sha256),
        "automatic stale repair replaces the old asset instead of appending past the slot maximum");
      store.writeBrandPostPackageManifest(generated);

      if (connectKind === "SHOPPING" && legacy) {
        const legacyIntentManifest = structuredClone(generated) as import("../src/lib/brand-post-package").BrandPostPackageManifestV2;
        const legacyFeature = legacyIntentManifest.composition.sections[2];
        const currentIntent = legacyFeature.imageIntent;
        const oldIntent = `${legacyFeature.title}: 구성품·패키지 원본 사진`;
        legacyFeature.imageIntent = oldIntent;
        legacyIntentManifest.composition.renderNodes = legacyIntentManifest.composition.renderNodes.map(node =>
          node.kind === "image" && node.sectionId === legacyFeature.id
            ? { ...node, altText: `${legacyFeature.title} - ${oldIntent}` }
            : node);
        const legacyFeatureAsset = legacyIntentManifest.imageAssets!.find(asset => asset.sectionId === legacyFeature.id)!;
        legacyFeatureAsset.imageIntent = oldIntent;
        legacyIntentManifest.approvedAt = "2026-09-01T00:00:00.000Z";
        // postSpec packages also need the role-scoped intent migration on read.
        legacyIntentManifest.postSpec = { version: "fixture/spec-first" };
        store.writeBrandPostPackageManifest(legacyIntentManifest);
        const migratedIntent = store.readBrandPostPackage(coverageId)! as import("../src/lib/brand-post-package").BrandPostPackageManifestV2;
        assert.equal(migratedIntent.composition.sections[2].imageIntent, currentIntent);
        assert.equal(migratedIntent.approvedAt, null,
          "intent migration revokes approval until the old generated visual is replaced");
        const migratedSlot = store.packagePreview(migratedIntent).imageSlots.find(slot => slot.sectionId === legacyFeature.id)!;
        assert.ok(migratedSlot.staleTargets.some(target => target.code === "image-intent-stale"));
        assert.ok(planSectionImageRequests([migratedSlot]).some(request =>
          request.replaceAssetKey === legacyFeatureAsset.sha256 && request.slotId === `${legacyFeature.id}:image:1`),
        "read-time intent migration feeds the stale asset into automatic replacement planning");
        store.writeBrandPostPackageManifest(generated);
      }

      const badBinding = structuredClone(generated);
      const badBindingAsset = badBinding.imageAssets!.find(asset => asset.role === "body" && asset.sectionId)!;
      const badBindingSectionId = badBindingAsset.sectionId!;
      badBindingAsset.role = "hero";
      badBindingAsset.sectionId = null;
      const bindingReadiness = store.evaluateBrandPostPackageReadiness(badBinding);
      assert.ok(bindingReadiness.blockers.some(blocker =>
        blocker.code === "image-asset-binding" && blocker.sectionId === badBindingSectionId),
      "body usage requires an exact body-role and section binding");

      const incoherent = structuredClone(generated);
      const incoherentAsset = incoherent.imageAssets!.find(asset => asset.role === "body" && asset.sectionId)!;
      incoherentAsset.remoteGenerated = false;
      const incoherentReadiness = store.evaluateBrandPostPackageReadiness(incoherent);
      assert.ok(incoherentReadiness.blockers.some(blocker => blocker.code === "image-provenance-invalid"),
        "contradictory provenance, creationMethod and remoteGenerated claims are rejected");

      const duplicateFinal = structuredClone(generated);
      const sectionAssets = duplicateFinal.imageAssets!.filter(asset => asset.sectionId);
      assert.ok(sectionAssets.length >= 2, "fixture needs two section assets for duplicate-output validation");
      const duplicateSource = sectionAssets[0];
      const duplicateTarget = sectionAssets[1];
      const duplicatePath = path.join(coverageDir, `duplicate-final-${connectKind.toLowerCase()}.png`);
      fs.copyFileSync(duplicateSource.path, duplicatePath);
      duplicateFinal.bodyImagePaths = duplicateFinal.bodyImagePaths.map(file =>
        path.resolve(file) === path.resolve(duplicateTarget.path) ? duplicatePath : file);
      duplicateFinal.composition.sections = duplicateFinal.composition.sections.map(section => ({
        ...section,
        imagePaths: section.imagePaths.map(file =>
          path.resolve(file) === path.resolve(duplicateTarget.path) ? duplicatePath : file),
      }));
      duplicateFinal.composition.renderNodes = duplicateFinal.composition.renderNodes.map(node =>
        node.kind === "image" && path.resolve(node.assetPath) === path.resolve(duplicateTarget.path)
          ? { ...node, assetPath: duplicatePath }
          : node);
      duplicateFinal.imageAssets = duplicateFinal.imageAssets!.map(asset => asset === duplicateTarget ? {
        ...asset,
        path: duplicatePath,
        sourcePath: duplicatePath,
        sha256: duplicateSource.sha256,
      } : asset);
      const duplicateReadiness = store.evaluateBrandPostPackageReadiness(duplicateFinal);
      assert.ok(duplicateReadiness.blockers.some(blocker => blocker.code === "image-output-duplicate"),
        `${coverageId}: byte-identical section images are rejected regardless of provenance`);

      const heroDuplicate = structuredClone(generated);
      const heroAsset = heroDuplicate.imageAssets!.find(asset => asset.role === "hero")!;
      const heroDuplicateTarget = heroDuplicate.imageAssets!.find(asset => asset.role === "body" && asset.sectionId)!;
      const heroDuplicatePath = path.join(coverageDir, `duplicate-hero-${connectKind.toLowerCase()}.png`);
      fs.copyFileSync(heroAsset.path, heroDuplicatePath);
      if (connectKind === "SHOPPING") preserveProductPhotoSource({
        sourcePath: heroAsset.path, outputPath: heroDuplicatePath, segmented: true,
      });
      heroDuplicate.bodyImagePaths = heroDuplicate.bodyImagePaths.map(file =>
        path.resolve(file) === path.resolve(heroDuplicateTarget.path) ? heroDuplicatePath : file);
      heroDuplicate.composition.sections = heroDuplicate.composition.sections.map(section => ({
        ...section,
        imagePaths: section.imagePaths.map(file =>
          path.resolve(file) === path.resolve(heroDuplicateTarget.path) ? heroDuplicatePath : file),
      }));
      heroDuplicate.composition.renderNodes = heroDuplicate.composition.renderNodes.map(node =>
        node.kind === "image" && path.resolve(node.assetPath) === path.resolve(heroDuplicateTarget.path)
          ? { ...node, assetPath: heroDuplicatePath }
          : node);
      heroDuplicate.imageAssets = heroDuplicate.imageAssets!.map(asset => asset === heroDuplicateTarget ? {
        ...asset,
        path: heroDuplicatePath,
        sourcePath: heroDuplicatePath,
        sha256: heroAsset.sha256,
      } : asset);
      const heroDuplicateReadiness = store.evaluateBrandPostPackageReadiness(heroDuplicate);
      assert.ok(heroDuplicateReadiness.blockers.some(blocker => blocker.code === "image-output-duplicate"),
        `${coverageId}: a body slot cannot count the byte-identical hero again`);
      const heroDuplicateSlot = store.packagePreview(heroDuplicate).imageSlots.find(slot =>
        slot.sectionId === heroDuplicateTarget.sectionId)!;
      const heroDuplicateStale = heroDuplicateSlot.staleTargets.find(target => target.code === "image-output-duplicate")!;
      assert.equal(heroDuplicateStale.assetKey, undefined,
        "a duplicate SHA is ambiguous and must not be replaced through the SHA-only asset key");
      const heroDuplicateRequest = planSectionImageRequests([heroDuplicateSlot]).find(request =>
        request.slotId === heroDuplicateStale.slotId)!;
      assert.ok(heroDuplicateRequest);
      assert.equal(heroDuplicateRequest.replaceAssetKey, undefined);
      store.writeBrandPostPackageManifest(heroDuplicate);
      const duplicateRepairPath = path.join(coverageDir, `duplicate-hero-repair-${connectKind.toLowerCase()}.png`);
      fs.writeFileSync(duplicateRepairPath, `duplicate-hero-repair-${coverageId}`);
      if (connectKind === "SHOPPING") preserveProductPhotoSource({
        sourcePath: heroAsset.path, outputPath: duplicateRepairPath, segmented: true,
      });
      const heroDuplicateRepaired = store.applyGeneratedBrandPostImage({
        brandLinkId: coverageId,
        ...heroDuplicateRequest,
        generatedPath: duplicateRepairPath,
        provenance: connectKind === "SHOPPING" ? "LOCKED_PRODUCT" : "GENERATED_BACKGROUND",
        creationMethod: connectKind === "SHOPPING" ? "source-with-generated-background" : "remote-generated",
        remoteGenerated: true,
        imageIntent: heroDuplicate.composition.sections.find(section => section.id === heroDuplicateTarget.sectionId)!.imageIntent,
      });
      assert.equal(heroDuplicateRepaired.heroImagePath, heroDuplicate.heroImagePath,
        "repairing a duplicate body slot must never overwrite its same-SHA hero");
      assert.equal(store.packagePreview(heroDuplicateRepaired).imageSlots.find(slot =>
        slot.sectionId === heroDuplicateTarget.sectionId)!.staleTargets.length, 0);
      store.writeBrandPostPackageManifest(generated);

      const unsafe = {
        ...generated,
        approvedAt: "2026-09-01T00:00:00.000Z",
        contentQuality: {
          canPublish: false, verdict: "blocked" as const, code: "unsupported-experience-claim" as const,
          reason: "허위 체험 표현", score: 100, sectionCount: 10, hashtagCount: 3, totalLength: 4000,
          coveredProductTokens: [], missingProductTokens: [], signals: [], summary: "안전성 차단",
          blockers: [{ code: "unsupported-experience-claim" as const, tier: "safety" as const, reason: "허위 체험 표현" }],
          quality: {
            score: 100, passScore: 70, categories: [],
            repetition: { nearDuplicateCount: 0, exactDuplicateCount: 0, duplicateOpeningCount: 0, samples: [] },
            generic: { sentenceCount: 10, guidanceCount: 0, generalStatementCount: 0, guidanceRatio: 0, generalRatio: 0, threshold: 0.24 },
          },
        },
      };
      store.writeBrandPostPackageManifest(unsafe);
      const unsafeRead = store.readBrandPostPackage(coverageId)!;
      assert.equal(unsafeRead.approvedAt, null);
      assert.equal(unsafeRead.contentQuality?.code, "unsupported-experience-claim");
      assert.throws(() => store.approveBrandPostPackage(coverageId), /허위 체험 표현/u,
        "Complete generated coverage cannot clear a safety failure");
      store.writeBrandPostPackageManifest({ ...generated, generationSource: undefined });
      assert.throws(() => store.approveBrandPostPackage(coverageId), /AI 원고 출처/u);

      for (const status of ["complete", "incomplete", "running"] as const) {
        const imageGeneration = { status, requested: 10, applied: 10, remaining: 0, errors: [], updatedAt: "2026-09-03" };
        store.writeBrandPostPackageManifest({ ...originals, imageGeneration });
        const originalReadiness = store.evaluateBrandPostPackageReadiness(store.readBrandPostPackage(coverageId)!);
        assert.equal(originalReadiness.canApprove, false,
          `${coverageId}/${status}: execution counters cannot replace generated asset evidence: ${JSON.stringify(originalReadiness.blockers)}`);
        store.writeBrandPostPackageManifest({ ...generated, imageGeneration });
        if (status === "running") {
          assert.throws(() => store.approveBrandPostPackage(coverageId), /이미지/u);
        } else {
          assert.ok(store.approveBrandPostPackage(coverageId).approvedAt, "Finished assets determine coverage, not stale counters");
        }
      }

      const loadedGenerated = store.readBrandPostPackage(coverageId)! as import("../src/lib/brand-post-package").BrandPostPackageManifestV2;
      const { imageGeneration: _completedGeneration, ...generatedWithoutCounter } = loadedGenerated;
      const lastRequiredSection = [...generatedWithoutCounter.composition.sections].reverse().find(section => (section.imageMin || 0) > 0)!;
      const lastRequiredPath = lastRequiredSection.imagePaths.at(-1)!;
      const partial = { ...generatedWithoutCounter, imageAssets: generatedWithoutCounter.imageAssets!.map((asset) => {
        if (path.resolve(asset.path) !== path.resolve(lastRequiredPath)) return asset;
        return {
          ...asset,
          provenance: "ORIGINAL" as const,
          remoteGenerated: false,
          creationMethod: "source" as const,
          ...(connectKind === "SHOPPING" ? {
            sourceReview: {
              version: "product-photo-source-review/v1" as const,
              sourceSha256: asset.sha256,
              usage: "section-matched-product-evidence" as const,
              sectionIntent: lastRequiredSection.imageIntent,
              reviewClass: "feature-evidence" as const,
              reason: "fixture semantic match",
              reviewedAt: "2026-09-15T00:00:00.000Z",
            },
          } : {}),
        };
      }) };
      store.writeBrandPostPackageManifest(partial);
      const partialSlots = store.packagePreview(partial).imageSlots;
      assert.equal(partialSlots.find(slot => slot.sectionId === lastRequiredSection.id)?.generationMissing, 1);
      assert.throws(() => store.approveBrandPostPackage(coverageId), /이미지/u,
        "The last required generated section must also be enforced");

      const extraPath = path.join(coverageDir, "extra.png");
      fs.writeFileSync(extraPath, `extra-original-${coverageId}`);
      const twoRequired = structuredClone(generated);
      const firstSection = twoRequired.composition.sections[0];
      firstSection.imageMin = firstSection.imageMax = 2;
      firstSection.imagePaths.push(extraPath);
      twoRequired.bodyImagePaths.push(extraPath);
      const firstImageNode = twoRequired.composition.renderNodes.find((node) => node.kind === "image" && node.sectionId === firstSection.id);
      assert.ok(firstImageNode?.kind === "image");
      twoRequired.composition.renderNodes.push({ ...firstImageNode, assetPath: extraPath });
      const extraAsset = {
        ...store.normalizePackageImageAssets(originals)[1], path: extraPath, sourcePath: extraPath,
        sha256: crypto.createHash("sha256").update(fs.readFileSync(extraPath)).digest("hex"),
        role: "body" as const,
        sectionId: firstSection.id,
        imageIntent: firstSection.imageIntent,
        slotId: `${firstSection.id}:image:2`,
        provenance: "ORIGINAL" as const,
        remoteGenerated: false,
        creationMethod: "source" as const,
        ...(connectKind === "SHOPPING" ? {
          sourceReview: {
            version: "product-photo-source-review/v1" as const,
            sourceSha256: crypto.createHash("sha256").update(fs.readFileSync(extraPath)).digest("hex"),
            usage: "section-matched-product-evidence" as const,
            sectionIntent: firstSection.imageIntent,
            reviewClass: "feature-evidence" as const,
            reason: "fixture semantic match",
            reviewedAt: "2026-09-15T00:00:00.000Z",
          },
        } : {}),
      };
      store.writeBrandPostPackageManifest({ ...twoRequired, imageAssets: [...twoRequired.imageAssets, extraAsset] });
      const twoSlots = store.packagePreview(store.readBrandPostPackage(coverageId)!).imageSlots;
      assert.equal(twoSlots[0].missing, 0);
      assert.equal(twoSlots[0].generationMissing, 1);
      assert.throws(() => store.approveBrandPostPackage(coverageId), /이미지/u,
        "An original cannot fill the second required generated slot");
      if (connectKind === "SHOPPING") preserveProductPhotoSource({
        sourcePath: generated.heroImagePath, outputPath: extraPath, segmented: true,
      });
      store.writeBrandPostPackageManifest({
        ...twoRequired, imageAssets: [...twoRequired.imageAssets, {
          ...extraAsset,
          provenance: connectKind === "SHOPPING" ? "LOCKED_PRODUCT" : "GENERATED_BACKGROUND",
          remoteGenerated: true,
          creationMethod: connectKind === "SHOPPING" ? "source-with-generated-background" : "remote-generated",
          sourceReview: undefined,
        }],
      });
      assert.ok(store.approveBrandPostPackage(coverageId).approvedAt, "Both required generated slots are now filled");
    }
  }
  fs.writeFileSync(store.getBrandPostPackageManifestPath(v2Id), JSON.stringify(v2Manifest, null, 2));
  assert.throws(
    () => store.approveBrandPostPackage(v2Id),
    /이미지/u,
    "프리미엄 V2 초안은 품질 미달 상태에서 승인되면 안 됩니다.",
  );
  const standardComposition = compositionContract.resolvePostDocument({
    connectKind: "TRAVEL",
    title: "V2 여행 초안",
    sections: ["예약 전 핵심 확인\n\n일정과 포함 조건을 확인하세요."],
    hashtags: ["여행커넥트"],
    imagePaths: [v2HeroPath],
    connectUrl: "https://example.test/travel",
    qualityPreset: "STANDARD",
  });
  fs.writeFileSync(
    store.getBrandPostPackageManifestPath(v2Id),
    JSON.stringify({ ...v2Manifest, composition: standardComposition }, null, 2),
  );
  assert.throws(() => store.approveBrandPostPackage(v2Id), /이미지/u,
    "STANDARD still enforces its illustrated section contract");
  for (const postSpec of [undefined, { fixture: "explicit-text-only" }]) {
    const textOnlyId = `fixture-text-only-${postSpec ? "spec" : "freeform"}`;
    store.writeBrandPostPackageManifest({
      ...v2Manifest,
      brandLinkId: textOnlyId,
      postSpec,
      composition: {
        ...standardComposition,
        sections: standardComposition.sections.map((section) => ({ ...section, imageMin: 0, imageMax: 0 })),
      },
    });
    const textOnly = store.readBrandPostPackage(textOnlyId)!;
    assert.equal(textOnly.imageGeneration, undefined);
    assert.equal(store.packagePreview(textOnly).imageSlots.every((slot) => slot.missing === 0 && slot.generationMissing === 0), true);
    assert.ok(store.approveBrandPostPackage(textOnlyId).approvedAt, "An explicit no-generation plan remains approvable");
    assert.ok(store.readBrandPostPackage(textOnlyId)?.approvedAt);
  }
  assert.match(store.packagePreview(store.readBrandPostPackage(v2Id)!).heroPreviewDataUrl || "", /^data:image\/png;base64,/u);

  const staleFlowId = "fixture-brand-link-v2-stale-flow";
  const staleFlowDir = store.getBrandPostPackageDir(staleFlowId);
  fs.mkdirSync(staleFlowDir, { recursive: true });
  const staleFlowMarkdown = path.join(staleFlowDir, "post.md");
  fs.writeFileSync(staleFlowMarkdown, "# 자연어 판정 복구 테스트", "utf8");
  const naturalSections = [
    "작은 공간에 두는 클립형 바람\n\n이 제품이에요. 클립과 받침대를 함께 쓰는 구조입니다. 배치 자유도가 핵심입니다.",
    "무선 구조가 줄여주는 불편\n\n전원선 동선을 줄여 주는 장점이 살아나요. 콘센트가 먼 곳에서 유용합니다.",
    "처음부터 제대로 쓰는 방법\n\n고정력을 확인해 설치하고 충전한 뒤 사용합니다. 사용 후에는 먼지를 닦아 보관합니다.",
    "책상용으로 볼 때의 장단점\n\n공간 활용은 좋지만 배터리 시간은 제약입니다. 강한 바람이 필요하면 한계가 있습니다.",
    "어떤 사람에게 더 맞을까\n\n위치를 자주 바꾸는 사람에게 잘 맞고 강풍이 필요하면 큰 제품이 낫습니다.",
    "가격보다 먼저 볼 선택 기준\n\n사용 위치와 고정할 프레임을 따져보면 선택이 쉬워집니다. 조건이 맞으면 실용적인 후보입니다.",
  ];
  const staleCompositionBase = compositionContract.resolvePostDocument({
    connectKind: "SHOPPING",
    title: "클립형선풍기 자연어 판정 복구",
    sections: naturalSections,
    hashtags: ["클립형선풍기", "무선선풍기", "캠핑선풍기"],
    imagePaths: [heroImagePath, ...bodyImagePaths],
    connectUrl: "https://example.test/shopping",
    qualityPreset: "STANDARD",
  });
  const staleComposition = {
    ...staleCompositionBase,
    qualityPreset: "PREMIUM" as const,
    qualityReport: {
      ...staleCompositionBase.qualityReport,
      preset: "PREMIUM" as const,
      canAutoPublish: true,
      blockers: [],
    },
  };
  const qualitySignals = [
    { key: "editorial-flow", label: "제품정체-기능원리-사용법-장단점-결론 흐름", status: "fail" },
    { key: "review-substance", label: "제품 특장점·활용법·후기 근거 리뷰", status: "pass" },
    { key: "composition-quality", label: "포스트 계약 품질", status: "pass" },
  ];
  fs.writeFileSync(store.getBrandPostPackageManifestPath(staleFlowId), JSON.stringify({
    ...v2Manifest,
    brandLinkId: staleFlowId,
    connectKind: "SHOPPING",
    title: "클립형선풍기 자연어 판정 복구",
    markdownPath: staleFlowMarkdown,
    heroImagePath,
    bodyImagePaths,
    imagePolicy: "LOCKED_PRODUCT_OR_ORIGINAL",
    composition: staleComposition,
    contentQuality: {
      canPublish: false,
      code: "missing-review-substance",
      reason: "상품 고유 리뷰 요소가 부족합니다.",
      score: 82,
      sectionCount: naturalSections.length,
      hashtagCount: 3,
      totalLength: naturalSections.join("\n").length,
      coveredProductTokens: ["클립형선풍기"],
      missingProductTokens: [],
      signals: qualitySignals,
      summary: "커넥트 글 발행 보류",
    },
    thumbnailSpec: {
      ...v2Manifest.thumbnailSpec,
      sourcePolicy: "LOCKED_PRODUCT_OR_ORIGINAL",
      sourceImagePath: heroImagePath,
    },
  }, null, 2));
  const refreshedStaleFlow = store.readBrandPostPackage(staleFlowId);
  const preMigration = JSON.parse(fs.readFileSync(`${store.getBrandPostPackageManifestPath(staleFlowId)}.pre-qc-v139.bak`, "utf8"));
  assert.equal(preMigration.contentQuality.signals[0].status, "fail", "Backup precedes even earlier text migrations");
  assert.equal(preMigration.contentQuality.score, 82);
  assert.equal(refreshedStaleFlow?.contentQuality?.signals.find((signal) => signal.key === "editorial-flow")?.status, "pass");
  assert.equal(refreshedStaleFlow?.contentQuality?.canPublish, false, "Text recovery must not trust a forged passing composition report for a short, under-illustrated fixture");
  assert.equal(refreshedStaleFlow?.contentQuality?.code, "composition-quality");
  assert.throws(() => store.approveBrandPostPackage(staleFlowId), /이미지/u);

  const limitationFalsePositiveId = "fixture-brand-link-v2-limitation-false-positive";
  const limitationFalsePositiveDir = store.getBrandPostPackageDir(limitationFalsePositiveId);
  fs.mkdirSync(limitationFalsePositiveDir, { recursive: true });
  const limitationMarkdown = path.join(limitationFalsePositiveDir, "post.md");
  fs.writeFileSync(limitationMarkdown, "# 제품 제약 의미 판정 복구 테스트", "utf8");
  const limitationSections = naturalSections.map((section, index) =>
    index === 3
      ? "사용 조건에 따른 차이\n\n향은 건조 환경과 취향에 따라 체감이 달라질 수 있습니다. 반대로 처음 접하는 향이라면 3개 구성이 부담이 될 수 있어요. 객관적인 성능 수치는 확인되지 않았습니다."
      : section,
  );
  const limitationComposition = {
    ...staleComposition,
    sections: staleComposition.sections.map((section, index) => ({
      ...section,
      title: limitationSections[index]?.split("\n")[0] || section.title,
      body: [limitationSections[index]?.split("\n\n").slice(1).join("\n\n") || section.body.join("\n")],
    })),
  };
  fs.writeFileSync(store.getBrandPostPackageManifestPath(limitationFalsePositiveId), JSON.stringify({
    ...v2Manifest,
    brandLinkId: limitationFalsePositiveId,
    connectKind: "SHOPPING",
    title: "제품 제약 의미 판정 복구",
    markdownPath: limitationMarkdown,
    composition: limitationComposition,
    contentQuality: {
      canPublish: false,
      verdict: "quality",
      code: "missing-review-substance",
      reason: "상품 고유 리뷰 요소가 부족합니다: 제품 자체의 단점·제약",
      score: 96,
      sectionCount: limitationSections.length,
      hashtagCount: 3,
      totalLength: limitationSections.join("\n").length,
      coveredProductTokens: ["섬유유연제"],
      missingProductTokens: [],
      signals: [
        { key: "review-substance", label: "제품 특장점·활용법·후기 근거 리뷰", status: "fail" },
        { key: "editorial-flow", label: "제품정체-기능원리-사용법-장단점-결론 흐름", status: "pass" },
      ],
      summary: "커넥트 글 품질 미달",
      blockers: [],
      quality: {
        score: 96,
        passScore: 70,
        categories: [
          { key: "usefulness", label: "구매 판단에 필요한 요소", maxScore: 15, score: 11, status: "fail", notes: ["제품 자체의 단점·제약"] },
        ],
        repetition: { nearDuplicateCount: 0, exactDuplicateCount: 0, duplicateOpeningCount: 0, samples: [] },
        generic: { sentenceCount: 20, guidanceCount: 0, generalStatementCount: 0, guidanceRatio: 0, generalRatio: 0, threshold: 0.24 },
      },
    },
  }, null, 2));
  const refreshedLimitationFalsePositive = store.readBrandPostPackage(limitationFalsePositiveId);
  assert.equal(refreshedLimitationFalsePositive?.contentQuality?.canPublish, false);
  assert.equal(refreshedLimitationFalsePositive?.contentQuality?.code, "composition-quality");
  assert.equal(refreshedLimitationFalsePositive?.contentQuality?.score, 100);
  assert.equal(refreshedLimitationFalsePositive?.contentQuality?.signals[0]?.status, "pass");
  assert.throws(() => store.approveBrandPostPackage(limitationFalsePositiveId), /이미지/u);

  const generatedBodyPath = path.join(userData, "generated-body.png");
  fs.writeFileSync(generatedBodyPath, "generated-body-v1");
  const withGeneratedBody = store.applyGeneratedBrandPostImage({
    brandLinkId: v2Id,
    generatedPath: generatedBodyPath,
    sectionId: standardComposition.sections[0].id,
    provenance: "GENERATED_BACKGROUND",
    creationMethod: "remote-generated",
    remoteGenerated: true,
    slotId: `${standardComposition.sections[0].id}:image:1`,
    imageIntent: standardComposition.sections[0].imageIntent,
  });
  assert.equal(withGeneratedBody.approvedAt, null, "이미지를 바꾸면 기존 승인을 해제해야 합니다.");
  assert.equal(withGeneratedBody.bodyImagePaths.length, 1);
  assert.equal(withGeneratedBody.composition.qualityReport.actual.images, 2);
  const generatedPreview = store.packagePreview(withGeneratedBody);
  const generatedAsset = generatedPreview.imageAssets.find((asset) => asset.role === "body");
  assert.ok(generatedAsset?.previewUrl.includes("/draft/images?asset="));
  assert.equal(generatedPreview.imageSlots[0].count, 1);
  assert.equal(generatedPreview.imageSlots[0].missing, 0);

  const regeneratedBodyPath = path.join(userData, "generated-body-v2.png");
  fs.writeFileSync(regeneratedBodyPath, "generated-body-v2-different");
  const regenerated = store.applyGeneratedBrandPostImage({
    brandLinkId: v2Id,
    generatedPath: regeneratedBodyPath,
    replaceAssetKey: generatedAsset!.assetKey,
    provenance: "GENERATED_BACKGROUND",
    creationMethod: "remote-generated",
    remoteGenerated: true,
    slotId: `${standardComposition.sections[0].id}:image:1`,
    imageIntent: standardComposition.sections[0].imageIntent,
  });
  const regeneratedPreview = store.packagePreview(regenerated);
  assert.equal(regeneratedPreview.imageAssets.length, generatedPreview.imageAssets.length);
  assert.notEqual(
    regeneratedPreview.imageAssets.find((asset) => asset.role === "body")?.assetKey,
    generatedAsset!.assetKey,
    "개별 재생성은 해당 이미지 키를 새 파일로 교체해야 합니다.",
  );
  assert.throws(() => store.getBrandPostPackageDir("../../escape"));

  // 초안 프로세스 결과 파일(result.json): 라우트가 로그 정규식 대신 코드/메시지를 읽는다.
  fs.writeFileSync(store.getBrandPostPackageResultPath(v2Id), JSON.stringify({ ok: false, code: "CONTENT_BLOCKED", message: "이미지 부족" }));
  assert.equal(store.readBrandPostPackageResult(v2Id)?.code, "CONTENT_BLOCKED");
  const previewWithOutline = store.packagePreview(regenerated);
  assert.ok(Array.isArray(previewWithOutline.sectionOutline) && previewWithOutline.sectionOutline.length > 0, "v2 미리보기는 섹션 아웃라인을 제공한다");
  assert.ok(previewWithOutline.readiness && typeof previewWithOutline.readiness.status === "string", "v2 미리보기는 readiness 요약을 제공한다");
  console.log(JSON.stringify({ ok: true, approved: true, v2QualityGate: true, generatedCoverageWithoutMetadata: true, legacyGeneratedCoverage: true, staleApprovalRevoked: true, textOnlyPlans: true, imagePreviewAndRegeneration: true, pathTraversalBlocked: true, resultFile: true }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  if (!fixtureRoot) return;
  const resolved = path.resolve(fixtureRoot);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert.ok(path.basename(resolved).startsWith("brand-post-package-"));
  fs.rmSync(resolved, { recursive: true, force: true });
});
