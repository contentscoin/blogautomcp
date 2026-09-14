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
  if (/제목.{0,40}(?:유지|그대로|변경\s*금지|변경하지|수정하지|바꾸지|고치지)/u.test(instructions)) return false;
  return /제목.{0,40}(?:수정|변경|보강|포함|반영|추가|교정|바꿔|바꾸|고쳐|고치|넣)|(?:수정|변경|보강|교정).{0,12}제목/u.test(instructions);
}

/** Apply bounded text edits; section identities, headings, order and image meaning are immutable. */
export function applyFreeformDraftRevision(
  draft: FreeformDraftText,
  response: string,
  requestedIndexes: number[] = [],
  options: { allowTitleChange?: boolean } = {},
): FreeformDraftText {
  const { sections } = draft;
  const text = response.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parsed = JSON.parse(text) as { title?: unknown; updates?: Array<{ index?: unknown; body?: unknown }> };
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('수정 응답 형식이 잘못되었습니다. 기존 원고를 유지합니다.');
  let title = draft.title;
  if (parsed.title !== undefined) {
    if (!options.allowTitleChange) throw new Error('제목 수정이 요청되지 않았습니다. 기존 원고를 유지합니다.');
    if (typeof parsed.title !== 'string' || !parsed.title.trim() || /[\r\n]/u.test(parsed.title) || parsed.title.trim().length > 200) throw new Error('수정 제목이 잘못되었습니다. 기존 원고를 유지합니다.');
    title = parsed.title.trim();
  }
  const updates = parsed.updates ?? (parsed.title !== undefined ? [] : undefined);
  if (!Array.isArray(updates) || (updates.length === 0 && title === draft.title)) throw new Error('수정된 문단 응답이 없습니다. 기존 원고를 유지합니다.');
  const allowed = new Set(requestedIndexes.length ? requestedIndexes : sections.map((_, index) => index));
  const updated = [...sections];
  const seen = new Set<number>();
  for (const item of updates) {
    if (!item || typeof item.index !== 'number' || !Number.isInteger(item.index) || !allowed.has(item.index) || !sections[item.index] || seen.has(item.index) || typeof item.body !== 'string' || !item.body.trim()) throw new Error('수정 문단 식별자가 잘못되었습니다. 기존 원고를 유지합니다.');
    if (/^\s*#{1,6}\s/m.test(item.body)) throw new Error('수정 응답은 문단 본문만 포함해야 합니다.');
    seen.add(item.index);
    const heading = sections[item.index].split(/\r?\n/, 1)[0];
    const separator = /^.*\r?\n\s*\r?\n/u.test(sections[item.index]) ? '\n\n' : '\n';
    updated[item.index] = `${heading}${separator}${item.body.trim()}`;
  }
  return { title, sections: updated };
}

/** Backward-compatible body-only revision API. */
export function applyFreeformSectionRevision(sections: string[], response: string, requestedIndexes: number[] = []): string[] {
  return applyFreeformDraftRevision({ title: '', sections }, response, requestedIndexes).sections;
}
