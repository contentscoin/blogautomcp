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
    simpleAgentSource.includes("const productEditorialPlan = isTravel\n    ? null"),
    true,
    "여행 원고 경로에서 쇼핑 제품 하네스를 생성하면 안 됩니다."
  );
  assert.equal(
    simpleAgentSource.includes('guidanceContext.connectKind === "TRAVEL"') &&
      simpleAgentSource.includes("쇼핑용 Custom GPT를 건너뛰고"),
    true,
    "여행 Browser GPT 경로가 쇼핑 전용 다단계 GPT를 타면 안 됩니다."
  );
  assert.equal(
    simpleAgentSource.includes("제품리뷰 실제 사용기"),
    false,
    "검증되지 않은 실사용 제목을 자동 생성하면 안 됩니다."
  );
  assert.equal(
    simpleAgentSource.includes("코스 장단점과 예약 판단"),
    true,
    "여행 제목은 체험을 꾸미지 않는 코스 판단형이어야 합니다."
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
    simpleAgentSource.includes('BRANDLINK_GENERATED_DRAFT_PATH\n      ? readMcpGeneratedDraft') &&
      simpleAgentSource.includes('!BRANDLINK_GENERATED_DRAFT_PATH &&'),
    true,
    "ChatGPT 제출 원고는 API 생성 및 API 기반 재작성 경로를 건너뛰어야 합니다.",
  );
  assert.equal(
    sitesMcpSource.includes("name: 'post_submit_draft'") &&
      sitesMcpSource.includes("post_create_draft: 'POST_PREPARE_DRAFT'") &&
      sitesMcpSource.includes("post_submit_draft: 'POST_SUBMIT_DRAFT'"),
    true,
    "Sites MCP가 2단계 ChatGPT 원고 계약을 광고하고 큐에 전달해야 합니다.",
  );
  assert.equal(
    draftRouteSource.includes('code: "CHATGPT_MCP_DRAFT_REQUIRED"') &&
      draftRouteSource.includes("buildChatGptDraftHandoff"),
    true,
    "API 키가 없을 때 오류 문장만 반환하지 말고 상품별 ChatGPT 핸드오프를 제공해야 합니다.",
  );
  assert.equal(
    dashboardSource.includes('response.status === 409') &&
      dashboardSource.includes('"1. ChatGPT로 글 만들기"') &&
      dashboardSource.includes("setChatGptDraftHandoff(handoff)"),
    true,
    "데스크톱 UI는 API 키 없음 응답을 실패 알림이 아닌 ChatGPT 핸드오프 화면으로 처리해야 합니다.",
  );
  assert.equal(
    draftRouteSource.includes('code: "CHATGPT_BROWSER_LOGIN_REQUIRED"') &&
      draftRouteSource.includes('code: "CHATGPT_BROWSER_FALLBACK_REQUIRED"') &&
      draftRouteSource.includes("buildChatGptBrowserAutomationEnv(useBrowserChatGpt)"),
    true,
    "API 키가 없을 때 로그인된 ChatGPT 웹 자동작성과 안전한 핸드오프 폴백을 모두 지원해야 합니다.",
  );
  assert.equal(
    dashboardSource.includes('"1. ChatGPT 자동작성"') &&
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
  assert.ok(store.packagePreview(store.approveBrandPostPackage(id)).markdown.includes("승인 전에는"));
  assert.ok(store.readBrandPostPackage(id)?.approvedAt);

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
  assert.throws(() => store.getBrandPostPackageDir("../../escape"));
  console.log(JSON.stringify({ ok: true, approved: true, v2QualityGate: true, pathTraversalBlocked: true }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
