import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { publicationImageContext, rejectedPublicationImageHashes } from "../../scripts/lib/publish-image-rejections";
import { findingKey, readPhotoDescriptionFindings, type PhotoDescriptionFinding } from "../../scripts/lib/photo-description-finding";
import type { BrandPostPackageManifestV2 } from "./brand-post-package";
import { refreshPostDocumentQuality } from "./post-composition-contract";

const reject = (): never => { throw Object.assign(new Error("사진 묘사의 정확한 검사 근거·현재 원문을 확인하지 못해 기존 원고와 이미지를 보존했습니다."), { code: "PHOTO_DESCRIPTION_REPAIR_REQUIRED" }); };
const nonWhitespaceText = (parts: readonly string[]): string => parts.join("").replace(/\s/gu, "");

/** Delete only an exact audit-grounded false photo assertion. No generated
 * replacement, imagined appearance, whole-section edit, or image mutation. */
export function planPhotoDescriptionRepair(manifest: BrandPostPackageManifestV2, markdown: string,
  findings: readonly PhotoDescriptionFinding[]): { manifest: BrandPostPackageManifestV2; markdown: string } {
  if (!findings.length || findings.length > 3 || new Set(findings.map(findingKey)).size !== findings.length ||
      new Set(findings.map(finding => finding.sectionId)).size !== findings.length) return reject();
  let composition = manifest.composition;
  let editedMarkdown = markdown;
  for (const finding of findings) {
    const node = manifest.composition.renderNodes[finding.nodeIndex];
    const section = composition.sections.find(item => item.id === finding.sectionId);
    if (finding.category !== "photo-description-mismatch" || !section || node?.kind !== "image" ||
        node.sectionId !== finding.sectionId || path.resolve(node.assetPath) !== path.resolve(finding.assetPath) ||
        publicationImageContext(composition, finding.sectionId) !== finding.context ||
        manifest.imageAssets?.filter(asset => path.resolve(asset.path) === path.resolve(finding.assetPath) && asset.sha256 === finding.sha256).length !== 1 ||
        crypto.createHash("sha256").update(fs.readFileSync(finding.assetPath)).digest("hex") !== finding.sha256) return reject();
    const matchingBody = section.body.filter(text => text.includes(finding.literalClaim));
    const matchingNodes = composition.renderNodes.filter(item => item.kind === "paragraph" && item.sectionId === section.id && item.text.includes(finding.literalClaim));
    const renderedBody = composition.renderNodes.filter(item => item.kind === "paragraph" && item.sectionId === section.id)
      .map(item => item.kind === "paragraph" ? item.text : "");
    if (matchingBody.length !== 1 || matchingNodes.length !== 1 || matchingBody[0].split(finding.literalClaim).length !== 2 ||
        nonWhitespaceText(renderedBody) !== nonWhitespaceText(section.body) ||
        matchingNodes[0].kind !== "paragraph" || matchingNodes[0].text.split(finding.literalClaim).length !== 2 ||
        editedMarkdown.split(finding.literalClaim).length !== 2) return reject();
    const replacementBody = matchingBody[0].replace(finding.literalClaim, "").trim();
    const replacementRender = matchingNodes[0].text.replace(finding.literalClaim, "").trim();
    const body = section.body.flatMap(text => text === matchingBody[0] ? replacementBody ? [replacementBody] : [] : [text]);
    // Removing a description must not erase a whole useful section.
    if (body.join("").length < 80 || finding.literalClaim.length > section.body.join("").length * 0.4) return reject();
    composition = { ...composition,
      sections: composition.sections.map(item => item.id === section.id ? { ...item, body, characterCount: body.join("").length } : item),
      renderNodes: composition.renderNodes.flatMap(item => item === matchingNodes[0] ? replacementRender ? [{ ...item, text: replacementRender }] : [] : [item]),
    };
    const editedRenderBody = composition.renderNodes.filter(item => item.kind === "paragraph" && item.sectionId === section.id)
      .map(item => item.kind === "paragraph" ? item.text : "");
    if (nonWhitespaceText(editedRenderBody) !== nonWhitespaceText(body)) return reject();
    editedMarkdown = editedMarkdown.replace(finding.literalClaim, "");
  }
  return { manifest: { ...manifest, composition: refreshPostDocumentQuality(composition), approvedAt: null,
    // A later spec-based manual revision must not resurrect the old body from
    // its derived generation cache. Keep the source-fact postSpec unchanged.
    specDraft: null, specValidation: null, markdownSha256: crypto.createHash("sha256").update(editedMarkdown).digest("hex") }, markdown: editedMarkdown };
}

export function serverPhotoDescriptionFindings(manifest: BrandPostPackageManifestV2, requestedKeys: unknown): PhotoDescriptionFinding[] {
  if (!Array.isArray(requestedKeys) || !requestedKeys.length || requestedKeys.length > 3 ||
      requestedKeys.some(key => typeof key !== "string" || !/^[a-f0-9]{64}$/u.test(key)) || new Set(requestedKeys).size !== requestedKeys.length) return reject();
  const saved = readPhotoDescriptionFindings(manifest.brandLinkId);
  const matches = requestedKeys.map(key => saved.find(finding => findingKey(finding) === key));
  if (matches.some(finding => !finding || !rejectedPublicationImageHashes(manifest.brandLinkId, manifest.composition, finding.sectionId).includes(finding.sha256))) return reject();
  return matches as PhotoDescriptionFinding[];
}
