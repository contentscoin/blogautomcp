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
  assert.equal(
    draftRouteSource.includes('PRODUCT_POST_LOCAL_FALLBACK_ENABLED: "true"'),
    true,
    "API 키가 없는 데스크톱 초안은 로컬 생성기로 자동 전환해야 합니다."
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
