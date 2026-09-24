/**
 * 직접 체험 메모 — 사용자가 실제로 써보거나 다녀온 사실을 상품 단위로 저장한다.
 * 메모가 있으면 원고를 1인칭 체험형으로 쓰되, 메모에 있는 사실만 체험으로 표현한다.
 * 메모가 없으면 정보형으로 쓰고 허위 체험 차단을 유지한다(공정위 추천·보증 심사지침).
 */

export const MIN_EXPERIENCE_NOTES_CHARS = 20;
export const MAX_EXPERIENCE_NOTES_CHARS = 4000;

export interface ExperienceField {
  key: string;
  label: string;
  placeholder: string;
}

export const EXPERIENCE_FIELDS: Record<"SHOPPING" | "TRAVEL", ExperienceField[]> = {
  SHOPPING: [
    { key: "period", label: "사용 기간·횟수", placeholder: "예: 3주 동안 주 4회, 아침 러닝할 때" },
    { key: "good", label: "좋았던 점", placeholder: "예: 땀이 차도 등판이 금방 말랐어요. 120g이라 흔들림이 거의 없었어요." },
    { key: "bad", label: "아쉬운 점", placeholder: "예: 주머니가 작아서 큰 휴대폰은 안 들어가요." },
    { key: "environment", label: "사용 환경", placeholder: "예: 여름 한낮 한강 10km, 체형 175cm/68kg에 M 사이즈" },
    { key: "extra", label: "기타 확인한 사실", placeholder: "예: 세탁망에 넣어 5번 세탁해도 늘어나지 않았어요." },
  ],
  TRAVEL: [
    { key: "when", label: "방문 시기", placeholder: "예: 2026년 5월 둘째 주, 2박 3일" },
    { key: "companions", label: "동행", placeholder: "예: 60대 부모님과 3명" },
    { key: "route", label: "실제 동선", placeholder: "예: 첫날 히타카츠 → 미우다 해변, 둘째 날 이즈하라 시내" },
    { key: "tips", label: "현장 꿀팁", placeholder: "예: 미우다 해변은 오후 4시 이후 역광이라 오전 방문이 사진이 잘 나와요." },
    { key: "bad", label: "아쉬웠던 점", placeholder: "예: 배 멀미가 심해서 멀미약을 꼭 챙겨야 했어요." },
  ],
};

/** 구조화 입력을 "항목: 값" 줄 텍스트로 합친다(원고 프롬프트에 그대로 들어간다). */
export function composeExperienceNotes(kind: "SHOPPING" | "TRAVEL", values: Record<string, string>): string {
  return EXPERIENCE_FIELDS[kind]
    .map((field) => [field.label, (values[field.key] || "").replace(/\s+/gu, " ").trim()] as const)
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n")
    .slice(0, MAX_EXPERIENCE_NOTES_CHARS);
}

/** 저장된 텍스트를 구조화 입력으로 되돌린다. 항목에 없는 줄은 "기타"/마지막 항목에 모은다. */
export function parseExperienceNotes(kind: "SHOPPING" | "TRAVEL", text: string | null | undefined): Record<string, string> {
  const fields = EXPERIENCE_FIELDS[kind];
  const values: Record<string, string> = {};
  const extras: string[] = [];
  for (const line of String(text || "").split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const field = fields.find((candidate) => trimmed.startsWith(`${candidate.label}:`));
    if (field) values[field.key] = trimmed.slice(field.label.length + 1).trim();
    else extras.push(trimmed);
  }
  if (extras.length) {
    const last = fields[fields.length - 1]!;
    values[last.key] = [values[last.key], ...extras].filter(Boolean).join(" ");
  }
  return values;
}

export function normalizeExperienceNotesInput(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().slice(0, MAX_EXPERIENCE_NOTES_CHARS);
  return trimmed || null;
}

/**
 * 원고 작성에 쓸 저장된 체험 메모. 주제 글은 원본 상품의 메모와 자기 메모를 함께 쓴다.
 */
export async function resolveStoredExperienceNotes(
  link: { experienceNotes: string | null; parentBrandLinkId: string | null },
  loadParent: (id: string) => Promise<{ experienceNotes: string | null } | null>,
): Promise<string> {
  const own = link.experienceNotes?.trim() || "";
  const parent = link.parentBrandLinkId ? (await loadParent(link.parentBrandLinkId).catch(() => null))?.experienceNotes?.trim() || "" : "";
  return [parent, own].filter(Boolean).join("\n").slice(0, MAX_EXPERIENCE_NOTES_CHARS);
}

export type DraftExperienceMode = "AI_ASSISTED_INFORMATION" | "VERIFIED_EXPERIENCE";

/**
 * 원고 작성 모드 결정. 요청이 모드를 명시하면 그대로 쓰고, 없으면 저장된 메모 길이로 정한다.
 * 요청 메모가 있으면 저장 메모보다 우선한다. 체험 모드인데 메모가 짧으면 오류.
 */
export function resolveDraftExperience(input: {
  requestedMode: unknown;
  requestedNotes: unknown;
  storedNotes: string;
}): { mode: DraftExperienceMode; notes: string } | { error: string } {
  const explicit: DraftExperienceMode | null = input.requestedMode === "verified_experience"
    ? "VERIFIED_EXPERIENCE"
    : input.requestedMode === "ai_assisted_information"
      ? "AI_ASSISTED_INFORMATION"
      : null;
  const requested = typeof input.requestedNotes === "string" ? input.requestedNotes.trim() : "";
  const notes = (requested || input.storedNotes.trim()).slice(0, MAX_EXPERIENCE_NOTES_CHARS);
  const mode = explicit ?? (notes.length >= MIN_EXPERIENCE_NOTES_CHARS ? "VERIFIED_EXPERIENCE" : "AI_ASSISTED_INFORMATION");
  if (mode === "VERIFIED_EXPERIENCE" && notes.length < MIN_EXPERIENCE_NOTES_CHARS) {
    return { error: "실제 체험형 문체를 사용하려면 구체적인 체험 사실 메모가 필요합니다." };
  }
  return { mode, notes: mode === "VERIFIED_EXPERIENCE" ? notes : "" };
}
