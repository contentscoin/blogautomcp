import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { parsePreparedBrandPostSections, readPreparedCompositionSections } from "./lib/prepared-post-markdown";
import type { ResolvedPostDocumentV1 } from "../src/lib/post-composition-contract";

const source = ts.createSourceFile("simple-agent.ts", fs.readFileSync("scripts/simple-agent.ts", "utf8"), ts.ScriptTarget.Latest, true);
const nodes = source.statements.filter(node => ts.isFunctionDeclaration(node) && node.name && ["resolvePreparedOverridePath", "loadPreparedBrandLinkPostOverride"].includes(node.name.text));
assert.equal(nodes.length, 2);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "prepared-loader-"));
const manifestPath = path.join(root, "manifest.json");
const context = vm.createContext({ fs, path, process: { env: { BRANDLINK_PREPARED_POST_MANIFEST: manifestPath } }, parsePreparedBrandPostSections, readPreparedCompositionSections, readProductSnapshot: (value: unknown) => value });
vm.runInContext(ts.transpileModule(nodes.map(node => node.getText(source)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
const load = context.loadPreparedBrandLinkPostOverride as () => { post: { title: string; sections: string[]; composition: ResolvedPostDocumentV1 }; composition: ResolvedPostDocumentV1 };
try {
  const sections = Array.from({ length: 8 }, (_, i) => ({ id: `section-${i}`, title: `승인 제목 ${i}`, body: [`metadata body ${i}`] }));
  const renderNodes = sections.flatMap(section => [
    { kind: "heading", sectionId: section.id, text: section.title },
    { kind: "paragraph", sectionId: section.id, text: `실제 발행 본문 ${section.id}` },
  ]).concat([{ kind: "disclosure", sectionId: null, text: "이 포스팅은 네이버 쇼핑 커넥트 활동의 일환으로, 판매 발생 시 수수료를 제공받습니다." }] as never);
  const composition = { version: "resolved-post-document/v1", title: "승인 제목", sections, renderNodes };
  const markdown = "# 옛 제목\n\n" + sections.map(section => `${section.title}\n\n${section.body.join("\n")}`).join("\n\n");
  fs.writeFileSync(path.join(root, "post.md"), markdown);
  fs.writeFileSync(path.join(root, "hero.png"), "path existence fixture");
  const manifest = { version: "brand-post-package/v2", approvedAt: "2026-09-21T12:00:00Z", generationSource: "AI", markdownPath: "post.md", heroImagePath: "hero.png", bodyImagePaths: [], composition };
  const write = (value: unknown) => fs.writeFileSync(manifestPath, JSON.stringify(value));
  assert.equal(parsePreparedBrandPostSections(markdown).length, 1, "reproduce old failure");
  write(manifest);
  const result = load();
  assert.equal(result.post.sections.length, 9);
  assert.equal(result.post.title, "승인 제목");
  assert.equal(result.post.sections[0], "승인 제목 0\n\n실제 발행 본문 section-0");
  assert.equal(JSON.stringify(result.composition), JSON.stringify(composition), "approved rendering is not rewritten");
  write({ ...manifest, composition: { ...composition, sections: sections.slice(0, 4), renderNodes: renderNodes.filter(node => node.sectionId === null || sections.slice(0, 4).some(s => s.id === node.sectionId)) } });
  assert.throws(load, /본문 섹션이 부족.*4개/);
  write({ ...manifest, composition: { ...composition, renderNodes: renderNodes.filter(node => node.kind !== "paragraph") } });
  assert.throws(load, /렌더 본문이 누락/);
  write({ ...manifest, composition: null });
  assert.throws(load, /v2 원고/);
  write({ ...manifest, approvedAt: null });
  assert.throws(load, /승인 완료/);
  write({ ...manifest, version: "brand-post-package/v1", composition: undefined });
  assert.throws(load, /본문 섹션이 부족.*1개/);
  fs.writeFileSync(path.join(root, "post.md"), "# Legacy\n\n" + sections.map(s => `## ${s.title}\n\n본문`).join("\n\n"));
  assert.equal(load().post.sections.length, 8, "legacy headed Markdown remains supported");
  console.log("prepared override: heading-free v2, rendered text/title, unchanged composition, five-section gate, missing render body, approval and legacy verified");
  const actual = process.env.VERIFY_PREPARED_MANIFEST;
  if (actual) {
    context.process.env.BRANDLINK_PREPARED_POST_MANIFEST = actual;
    const before = fs.readFileSync(actual, "utf8");
    const live = load();
    assert.equal(fs.readFileSync(actual, "utf8"), before);
    console.log(`actual saved manifest: ${live.composition.sections.length} editorial sections + ${live.post.sections.length - live.composition.sections.length} disclosure; loader PASS, no writes`);
  }
} finally { fs.rmSync(root, { recursive: true, force: true }); }
