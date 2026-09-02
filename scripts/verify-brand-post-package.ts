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
    draftRouteSource.includes("readPrepareFailure(logPath"),
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
  assert.throws(() => store.getBrandPostPackageDir("../../escape"));

  // v2 패키지(Spec-first): 섹션 문자열·검증 요약을 미리보기에서 읽을 수 있어야 한다.
  const id2 = "fixture-brand-link-002";
  const dir2 = store.getBrandPostPackageDir(id2);
  fs.mkdirSync(dir2, { recursive: true });
  fs.writeFileSync(path.join(dir2, "post.md"), "# v2 초안\n\n## 한눈에 보기\n\n요약", "utf8");
  fs.writeFileSync(store.getBrandPostPackageManifestPath(id2), JSON.stringify({
    version: "brand-post-package/v2",
    brandLinkId: id2,
    connectKind: "TRAVEL",
    title: "v2 초안",
    markdownPath: path.join(dir2, "post.md"),
    heroImagePath,
    bodyImagePaths,
    hashtags: ["대만패키지"],
    imagePolicy: "TRAVEL_EDITORIAL",
    createdAt: new Date().toISOString(),
    approvedAt: null,
    sections: ["한눈에 보기\n\n결론부터 말하면 좋은 구성이에요.\n", "마무리\n\n아래 링크에서 확인하세요.\n", "\n고지\n"],
    composition: { version: "post-composition/v1", kind: "TRAVEL", sections: [], connectCard: "EXTERNAL_LINK" },
    spec: { version: "post-spec/v1" },
    draft: { title: "v2 초안", sections: [], hashtags: [], source: "openai", model: "gpt-4o-mini", attempts: 1 },
    readiness: { status: "READY", score: 92, summary: "발행 준비 완료", signals: [], repairTargets: [], generationSource: "openai", attempts: 1 },
  }, null, 2));
  const preview2 = store.packagePreview(store.readBrandPostPackage(id2)!);
  assert.equal(preview2.readiness?.status, "READY");
  assert.equal(preview2.sectionOutline?.length, 3);
  assert.equal(preview2.imageCount, 5);
  assert.ok(!("spec" in preview2), "미리보기에는 스펙 원본을 싣지 않는다");
  fs.writeFileSync(store.getBrandPostPackageResultPath(id2), JSON.stringify({ ok: false, code: "CONTENT_BLOCKED", message: "이미지 부족" }));
  assert.equal(store.readBrandPostPackageResult(id2)?.code, "CONTENT_BLOCKED");
  console.log(JSON.stringify({ ok: true, approved: true, pathTraversalBlocked: true, v2Preview: true }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
