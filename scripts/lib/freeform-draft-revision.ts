import { createHash } from "node:crypto";

interface FreeformDraftText {
  title: string;
  sections: string[];
}

function sectionHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Fail closed if a model or alternate revision engine changed text outside its declared scope. */
export function assertUntargetedSectionHashesUnchanged(
  before: string[],
  after: string[],
  targetedIndexes: number[],
): void {
  if (before.length !== after.length) {
    throw new Error("수정 범위 밖의 문단 구조가 변경되었습니다. 기존 원고를 유지합니다.");
  }
  const targeted = new Set(targetedIndexes);
  before.forEach((section, index) => {
    if (!targeted.has(index) && sectionHash(section) !== sectionHash(after[index])) {
      throw new Error(`수정 대상이 아닌 ${index + 1}번 문단이 변경되었습니다. 기존 원고를 유지합니다.`);
    }
  });
}

/** Only an explicit title-edit request may change the post title. */
export function requestsFreeformTitleRevision(instructions: string): boolean {
  const postInstructions = instructions.replace(/소제목|(?:섹션|문단)\s*(?:제목|헤딩)/gu, "");
  const clauses = postInstructions.split(/[,，;\n()（）]|(?:하고|하며|하되)|\.(?=\s*[가-힣])/u);
  if (clauses.some(clause => /제목.{0,40}(?:유지|그대로|변경\s*금지|변경하지|수정하지|바꾸지|고치지)/u.test(clause))) return false;
  return clauses.some(clause => /제목.{0,40}(?:수정|변경|보강|포함|반영|추가|교정|바꿔|바꾸|고쳐|고치|넣)|(?:수정|변경|보강|교정).{0,12}제목/u.test(clause));
}

/** Section-heading authority is separate from permission to edit the post title. */
export function requestsFreeformSectionHeadingRevision(instructions: string): boolean {
  const heading = "(?:소제목|(?:섹션|문단)\\s*(?:제목|헤딩))";
  const clauses = instructions.split(/[,，;\n()（）]|(?:하고|하며|하되)|\.(?=\s*[가-힣])/u)
    .filter(clause => !new RegExp(`(?:나머지|다른|그\\s*외|비대상).{0,50}${heading}`, "u").test(clause));
  if (clauses.some(clause => new RegExp(`${heading}.{0,40}(?:유지|그대로|변경\\s*금지|변경하지|수정하지|바꾸지|고치지)`, "u").test(clause))) return false;
  return clauses.some(clause => new RegExp(`${heading}.{0,120}(?:수정|변경|교정|바꿔|바꾸|바꿉|고쳐|고치|고칩)|(?:수정|변경|교정).{0,12}${heading}`, "u").test(clause));
}

/** Apply bounded text edits; section identities, order and image meaning are immutable. */
export function applyFreeformDraftRevision(
  draft: FreeformDraftText,
  response: string,
  requestedIndexes: number[] = [],
  options: { allowTitleChange?: boolean; allowEmptyBodyScope?: boolean; allowSectionHeadingChange?: boolean;
    bodyParagraphs?: readonly (readonly string[])[] } = {},
): FreeformDraftText {
  const { sections } = draft;
  const text = response.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parsed = JSON.parse(text) as { title?: unknown; updates?: Array<{ index?: unknown; body?: unknown; paragraphs?: unknown; heading?: unknown }> };
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('수정 응답 형식이 잘못되었습니다. 기존 원고를 유지합니다.');
  let title = draft.title;
  if (parsed.title !== undefined) {
    if (!options.allowTitleChange) throw new Error('제목 수정이 요청되지 않았습니다. 기존 원고를 유지합니다.');
    if (typeof parsed.title !== 'string' || !parsed.title.trim() || /[\r\n]/u.test(parsed.title) || parsed.title.trim().length > 200) throw new Error('수정 제목이 잘못되었습니다. 기존 원고를 유지합니다.');
    title = parsed.title.trim();
  }
  const updates = parsed.updates ?? (parsed.title !== undefined ? [] : undefined);
  if (!Array.isArray(updates) || (updates.length === 0 && title === draft.title)) throw new Error('수정된 문단 응답이 없습니다. 기존 원고를 유지합니다.');
  const allowed = new Set(requestedIndexes.length || options.allowEmptyBodyScope
    ? requestedIndexes : sections.map((_, index) => index));
  const updated = [...sections];
  const seen = new Set<number>();
  for (const item of updates) {
    if (!item || typeof item.index !== 'number' || !Number.isInteger(item.index) || !allowed.has(item.index) || !sections[item.index] || seen.has(item.index)) throw new Error('수정 문단 식별자가 잘못되었습니다. 기존 원고를 유지합니다.');
    if (item.body !== undefined && item.paragraphs !== undefined) throw new Error('본문 body와 paragraphs를 동시에 지정할 수 없습니다. 기존 원고를 유지합니다.');
    seen.add(item.index);
    const heading = sections[item.index].split(/\r?\n/, 1)[0];
    let nextHeading = heading;
    if (item.heading !== undefined) {
      if (!options.allowSectionHeadingChange) throw new Error('소제목 수정이 요청되지 않았습니다. 기존 원고를 유지합니다.');
      if (typeof item.heading !== 'string' || !item.heading.trim() || /[\r\n]/u.test(item.heading) || item.heading.trim().length > 200 || /^\s*#{1,6}\s/u.test(item.heading)) throw new Error('수정 소제목이 잘못되었습니다. 기존 원고를 유지합니다.');
      nextHeading = item.heading.trim();
    }
    let body: string | undefined;
    if (item.paragraphs !== undefined) {
      const original = options.bodyParagraphs?.[item.index];
      if (!original || !Array.isArray(item.paragraphs) || item.paragraphs.length !== original.length || !original.length ||
          item.paragraphs.some(paragraph => typeof paragraph !== 'string' || !paragraph.trim() || /[\r\n]/u.test(paragraph))) {
        throw new Error('수정 paragraphs는 저장된 본문과 같은 개수의 한 줄 문단이어야 합니다. 기존 원고를 유지합니다.');
      }
      body = (item.paragraphs as string[]).map(paragraph => paragraph.trim()).join('\n\n');
    } else if (item.body !== undefined) {
      if (typeof item.body !== 'string' || !item.body.trim()) throw new Error('수정 본문이 비어 있습니다. 기존 원고를 유지합니다.');
      body = item.body.trim();
    }
    if (body === undefined) {
      if (nextHeading === heading) throw new Error('수정된 문단 응답이 없습니다. 기존 원고를 유지합니다.');
      updated[item.index] = nextHeading + sections[item.index].slice(heading.length);
      continue;
    }
    if (/^\s*#{1,6}\s/m.test(body)) throw new Error('수정 응답은 문단 본문만 포함해야 합니다.');
    const separator = /^.*\r?\n\s*\r?\n/u.test(sections[item.index]) ? '\n\n' : '\n';
    updated[item.index] = `${nextHeading}${separator}${body}`;
  }
  return { title, sections: updated };
}

/** Backward-compatible body-only revision API. */
export function applyFreeformSectionRevision(sections: string[], response: string, requestedIndexes: number[] = []): string[] {
  return applyFreeformDraftRevision({ title: '', sections }, response, requestedIndexes).sections;
}
