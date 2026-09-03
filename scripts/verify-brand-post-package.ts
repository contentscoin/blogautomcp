import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
    simpleAgentSource.includes("hasSufficientVisualDraftEvidence") &&
      simpleAgentSource.includes("hasReviewEvidence || hasVisualReviewEvidence"),
    true,
    "텍스트 근거가 부족해도 충분한 쇼핑 원본 이미지는 GPT 시각 분석 단계로 전달해야 합니다.",
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
      dashboardSource.includes('"1. GPT로 글 만들기"') &&
      dashboardSource.includes('"1. ChatGPT로 글 만들기"') &&
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
    dashboardSource.includes('"1. 웹 GPT 자동작성"') &&
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
    draftImageRouteSource.includes('["generate_missing", "generate_section", "regenerate", "apply_generated"]') &&
      draftImageRouteSource.includes("repairBrandPostImages") &&
      draftImageRouteSource.includes("applyExternalGeneratedBrandPostImage") &&
      draftImageRouteSource.includes('"Cache-Control": "private, no-store, max-age=0"'),
    true,
    "초안 이미지는 필수 보충·파트 추가·개별 재생성·외부 생성 이미지 적용과 안전한 미리보기를 지원해야 합니다.",
  );
  assert.equal(
    draftImageRouteSource.includes("if (!isChatGptBrowserAutomationEnabled()) {") &&
      draftImageRouteSource.includes('"CHATGPT_BROWSER_AUTOMATION_DISABLED"') &&
      draftImageRouteSource.indexOf("if (!isChatGptBrowserAutomationEnabled()) {") <
        draftImageRouteSource.indexOf("await repairBrandPostImages("),
    true,
    "브라우저 자동화가 꺼져 있으면 이미지 배치를 계획하기 전에 거부해 Chrome 을 열지 않아야 합니다.",
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
      dashboardSource.includes("품질 자동 보강"),
    true,
    "데스크톱 미리보기에서 이미지 보충·개별 재생성·품질 보강을 실행할 수 있어야 합니다.",
  );
  assert.equal(
    draftImageRouteSource.includes("planSectionImageRequests") &&
      draftImageRouteSource.includes('asset?.provenance === "ORIGINAL"') &&
      draftImageRouteSource.includes("replaceAssetKey"),
    true,
    "원본 이미지는 생성 완료로 계산하지 않고, 꽉 찬 슬롯에서는 원본을 생성 이미지로 교체해야 합니다.",
  );
  assert.equal(
    draftRouteSource.includes("scheduleSectionImageRepair") &&
      draftRouteSource.includes("void repairBrandPostImages({ brandLinkId: options.brandLinkId, productName: options.productName })") &&
      !draftRouteSource.includes("await repairBrandPostImages(") &&
      !draftRouteSource.includes("autoRepairSectionImages"),
    true,
    "초안 응답은 섹션 이미지 배치를 기다리지 않아야 합니다(분리 실행).",
  );
  assert.equal(
    /process\.env\.BRAND_POST_AUTO_SECTION_IMAGES \?\? process\.env\.TRAVEL_AUTO_IMAGE_QC_REPAIR \?\? "false"/u.test(draftRouteSource) &&
      draftRouteSource.includes("if (!isAutoSectionImagesEnabled())") &&
      draftRouteSource.includes("if (!isChatGptBrowserAutomationEnabled())") &&
      draftRouteSource.indexOf("if (!isChatGptBrowserAutomationEnabled())") < draftRouteSource.indexOf("void repairBrandPostImages("),
    true,
    "섹션 이미지 자동 생성은 기본 꺼짐이고, 켜져 있어도 ChatGPT 웹 자동화가 꺼져 있으면 실행하지 않아야 합니다.",
  );
  assert.equal(
    draftRouteSource.includes('skip: action === "submit_generated" || mcpOrigin'),
    true,
    "MCP 제출 원고는 PC 이미지 배치를 예약하지 않아야 합니다(ChatGPT 내장 이미지 생성 + post_apply_section_image).",
  );
  const batchSource = fs.readFileSync(path.join(projectRoot, "scripts", "chatgpt-generate-image-batch.ts"), "utf8");
  assert.equal(
    batchSource.includes("isBatchFailFastEnabled") &&
      batchSource.includes('(env.BRAND_POST_IMAGE_BATCH_FAIL_FAST || "true")') &&
      batchSource.includes("fail-fast: 앞선 이미지 생성 실패로 중단했습니다") &&
      batchSource.includes("if (typeof observed === \"number\" && observed === 0) {"),
    true,
    "이미지 배치는 첫 실패 뒤 남은 작업을 중단하고, 이미지가 관측되지 않은 대기 종료를 실패로 취급해야 합니다.",
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
  process.env.DESKTOP_USER_DATA = userData;
  const store = await import("../src/lib/brand-post-package");
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
    sectionImagePaths: [[firstMappedImage], [], [thirdMappedImage]],
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
  });
  assert.equal(mappedPreview.imageSlots[2].originalCount, 1);
  assert.equal(mappedPreview.imageSlots[2].generatedCount, 0);
  assert.equal(mappedPreview.imageSlots[2].generationMissing, 1, "원본 이미지는 섹션 생성 이미지 충족으로 계산하면 안 됩니다.");
  fs.writeFileSync(store.getBrandPostPackageManifestPath(v2Id), JSON.stringify(v2Manifest, null, 2));
  assert.throws(
    () => store.approveBrandPostPackage(v2Id),
    /프리미엄 초안 품질 게이트/u,
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
  assert.ok(store.approveBrandPostPackage(v2Id).approvedAt);
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
  assert.throws(() => store.approveBrandPostPackage(staleFlowId), /프리미엄 초안 품질 게이트/u);

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
  assert.throws(() => store.approveBrandPostPackage(limitationFalsePositiveId), /프리미엄 초안 품질 게이트/u);

  const generatedBodyPath = path.join(userData, "generated-body.png");
  fs.writeFileSync(generatedBodyPath, "generated-body-v1");
  const withGeneratedBody = store.applyGeneratedBrandPostImage({
    brandLinkId: v2Id,
    generatedPath: generatedBodyPath,
    sectionId: standardComposition.sections[0].id,
    provenance: "GENERATED_BACKGROUND",
    imageIntent: "여행지 본문 미리보기",
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
    imageIntent: "재생성된 여행지 본문 이미지",
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
  console.log(JSON.stringify({ ok: true, approved: true, v2QualityGate: true, imagePreviewAndRegeneration: true, pathTraversalBlocked: true, resultFile: true }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
