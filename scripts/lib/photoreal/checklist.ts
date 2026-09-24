/**
 * photoreal 생성 후 점검표(SKILL.md "생성 후 점검" 11항목)를 비전 QC 프롬프트로 바꾼다.
 * 걸린 항목만 긍정문으로 보강해 1회 재생성한다(스킬 규칙: 전체 프롬프트를 다시 쓰지 않는다).
 */

export interface PhotorealCheck {
  id: string;
  /** 인물 컷에서만 보는 항목인지 */
  peopleOnly: boolean;
  question: string;
  /** 걸렸을 때 프롬프트에 덧붙이는 긍정문 보강(영어, 이미지 프롬프트와 같은 언어) */
  reinforcement: string;
}

export const PHOTOREAL_CHECKS: PhotorealCheck[] = [
  { id: "hand-anatomy", peopleOnly: true, question: "Are finger count, joint direction and finger length realistic on every visible hand?",
    reinforcement: "Every visible hand has five fingers with natural joints and lengths." },
  { id: "hand-action", peopleOnly: true, question: "Could each hand actually perform the action it is shown doing?",
    reinforcement: "Each hand holds things with a grip that could really perform the action." },
  { id: "eye-highlights", peopleOnly: true, question: "Do the two eyes have slightly different catchlights (not pixel-identical)?",
    reinforcement: "The catchlights in the two eyes differ slightly in position and shape." },
  { id: "text", peopleOnly: false, question: "Is the image free of melted or garbled lettering on signs, cups, labels or clothing?",
    reinforcement: "Surfaces are plain: signs, cups, labels and clothing carry no lettering at all." },
  { id: "age", peopleOnly: true, question: "Does each person read as the stated age rather than older?",
    reinforcement: "The person reads clearly as the stated age." },
  { id: "skin-uniformity", peopleOnly: true, question: "Does skin texture vary across forehead, cheeks and around the nose?",
    reinforcement: "Skin tone and texture vary naturally between the forehead, cheeks and around the nose." },
  { id: "hair-edges", peopleOnly: true, question: "Do hair edges behind the ears and on the shoulders look like separate strands, not painted clumps?",
    reinforcement: "Hair edges break into separate fine strands behind the ears and over the shoulders." },
  { id: "background-people", peopleOnly: false, question: "Are faces and legs of any background people intact rather than melted?",
    reinforcement: "Any background people have intact faces and legs, or the background is empty of people." },
  { id: "shadow-direction", peopleOnly: false, question: "Can every shadow in the frame be explained by one consistent light source?",
    reinforcement: "All shadows fall in one direction consistent with a single light source." },
  { id: "phone-texture", peopleOnly: false, question: "Does the image look like a phone snapshot, with background blur no deeper than a phone camera allows?",
    reinforcement: "The background stays as sharp as a phone camera would keep it, like an everyday phone snapshot." },
  { id: "teeth", peopleOnly: true, question: "If someone smiles, are tooth count and spacing natural?",
    reinforcement: "Teeth are natural in count and spacing." },
];

export function photorealChecksFor(people: boolean): PhotorealCheck[] {
  return PHOTOREAL_CHECKS.filter((check) => people || !check.peopleOnly);
}

/** 비전 모델에게 줄 QC 지시. 응답은 JSON 한 줄. */
export function buildPhotorealQcPrompt(options: { people: boolean }): { systemPrompt: string; userPrompt: string } {
  const checks = photorealChecksFor(options.people);
  return {
    systemPrompt: [
      "You inspect one generated photo for tells that it is AI-generated rather than a real phone snapshot.",
      "Judge only what is visible. Be lenient: flag an item only when the defect is clearly visible at normal viewing size.",
      'Reply with one line of JSON only: {"failed":["<id>",...]} (an empty array when nothing is clearly wrong).',
    ].join("\n"),
    userPrompt: [
      "Checklist (id: question):",
      ...checks.map((check) => `- ${check.id}: ${check.question}`),
    ].join("\n"),
  };
}

/** QC 응답에서 걸린 항목 id 를 뽑는다. 읽을 수 없는 응답은 통과로 본다(검수가 생성을 막지 않게). */
export function parsePhotorealQc(text: string, options: { people: boolean }): string[] {
  const allowed = new Set(photorealChecksFor(options.people).map((check) => check.id));
  const match = /\{[\s\S]*\}/u.exec(text || "");
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]) as { failed?: unknown };
    if (!Array.isArray(parsed.failed)) return [];
    return [...new Set(parsed.failed.filter((id): id is string => typeof id === "string" && allowed.has(id)))];
  } catch {
    return [];
  }
}

/** 걸린 항목만 긍정문으로 덧붙인 재생성 프롬프트. */
export function reinforcePhotorealPrompt(prompt: string, failedIds: string[]): string {
  const lines = PHOTOREAL_CHECKS.filter((check) => failedIds.includes(check.id)).map((check) => check.reinforcement);
  return lines.length ? `${prompt}\nReinforce (previous attempt missed these): ${lines.join(" ")}` : prompt;
}
