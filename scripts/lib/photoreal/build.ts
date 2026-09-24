/**
 * photoreal 프롬프트 조립기 — 원본 build_prompt.py build() 의 층 순서를 그대로 따른다.
 *   장면(피사체·장소·순간) → L1 출처 → 그룹/셀카 → L2 빛·화질 결함·보정 금지
 *   → L3 프레이밍·시선(standard/full) → L4 해부학(full) → 나이 고정 → L5(항상 마지막)
 * 사람이 없는 컷(people=false)은 L1~L3 만 쓰고 시선·해부학·얼굴 문장을 넣지 않는다.
 */
import {
  AGE_LOCK, AMBIENT_LIGHT, ASYM, DEFECT, DEFECT_OBJECT, FRAMING, FRAMING_OBJECT, GAZE, GROUP,
  HANDS, HANDS_ACTION, INCIDENTAL_PEOPLE, L1, L2_TAIL, L4, L5, SELFIE, pick,
  type PhotorealCharm, type PhotorealLang,
} from "./layers";
import { PHOTOREAL_SCENES } from "./scenes";

export type PhotorealLevel = "light" | "standard" | "full";

export interface PhotorealPromptOptions {
  /** 누가/무엇이 찍히는가. 예: "20대 후반 한국인 여성", "욕실 선반 위 빈 자리" */
  subject: string;
  /** PHOTOREAL_SCENES 키. 없으면 situation 과 기본 현장광을 쓴다(원본 --scene custom). */
  scene?: string;
  situation?: string;
  /** 변형 번호. 순간·조명·결함·프레이밍·시선을 함께 돌린다. */
  variantIndex?: number;
  level?: PhotorealLevel;
  shot?: "other" | "selfie";
  group?: number;
  charm?: PhotorealCharm;
  /** 기본: level 이 full 이면 켬(원본과 같음). */
  ageLock?: boolean;
  /** 기본: 장면 설정. 사람이 없는 컷이면 false. */
  people?: boolean;
  /** 사람이 없는 컷에 멀리 작은 행인이 있을 수 있는지(여행 풍경). */
  incidentalPeople?: boolean;
  lang?: PhotorealLang;
}

export function buildPhotorealParts(options: PhotorealPromptOptions): string[] {
  const lang = options.lang ?? "ko";
  const idx = Math.max(0, Math.floor(options.variantIndex ?? 0));
  const level = options.level ?? "standard";
  const shot = options.shot ?? "other";
  const group = options.group ?? 0;
  const scene = options.scene ? PHOTOREAL_SCENES[options.scene] : undefined;
  const people = options.people ?? scene?.people ?? true;
  const charm: PhotorealCharm = people ? options.charm ?? "plain" : "none";
  const ageLock = people && (options.ageLock ?? level === "full");
  const parts: string[] = [];

  let light: string;
  if (scene) {
    const moment = pick(scene.moments[lang], idx);
    parts.push(lang === "ko"
      ? `${options.subject}, ${scene.place.ko}에서 ${moment}`
      : `${options.subject}, ${scene.place.en}, ${moment}`);
    light = pick(scene.lights[lang], idx);
  } else {
    parts.push(`${options.subject}, ${options.situation ?? ""}`);
    light = AMBIENT_LIGHT[lang];
  }

  parts.push(L1[lang]);
  if (people && group >= 2) parts.push(GROUP[lang]);
  if (people && shot === "selfie") parts.push(SELFIE[lang]);
  if (!people && options.incidentalPeople) parts.push(INCIDENTAL_PEOPLE[lang]);

  parts.push(light);
  parts.push(pick((people ? DEFECT : DEFECT_OBJECT)[lang], idx));
  parts.push(L2_TAIL[lang]);

  if (level === "standard" || level === "full") {
    if (shot !== "selfie" || !people) parts.push(pick((people ? FRAMING : FRAMING_OBJECT)[lang], idx));
    if (people && group < 2) parts.push(pick(GAZE[lang], idx));
  }

  if (people && level === "full") {
    parts.push(...L4[lang]);
    parts.push(pick(ASYM[lang], idx));
    parts.push(HANDS[lang], HANDS_ACTION[lang]);
  }

  if (ageLock) parts.push(AGE_LOCK[lang]);
  parts.push(L5[charm][lang]);
  return parts;
}

/** 원본과 같은 이음: 한국어는 ". ", 영어는 ", " 로 잇고 마침표로 끝낸다. */
export function buildPhotorealPrompt(options: PhotorealPromptOptions): string {
  const parts = buildPhotorealParts(options);
  return (options.lang ?? "ko") === "ko" ? `${parts.join(". ")}.` : `${parts.join(", ")}.`;
}

// --- 블로그 컷 장면 선택 ------------------------------------------------------

const SHOPPING_SCENE_RULES: Array<[string, RegExp]> = [
  ["bathroom-shelf", /욕실|샤워|세면|bath/iu],
  ["vanity", /화장대|메이크업|스킨케어|제형|텍스처|뷰티|vanity/iu],
  ["kids-room", /아이방|아기|유아|키즈|반려|강아지|고양이|펫/iu],
  ["kitchen", /주방|식탁|조리|요리|싱크|먹는|식사|간식|kitchen/iu],
  ["desk", /책상|작업|노트북|모니터|키보드|사무|desk/iu],
  ["outdoor-gear", /야외|운동|캠핑|러닝|등산|골프|코스|자전거|outdoor/iu],
  ["living", /거실|소파|생활\s*공간|집에서|living/iu],
];

const TOPIC_DEFAULT_SCENE: Record<string, string> = {
  beauty_body: "vanity",
  home_appliance: "living",
  digital_it: "desk",
  food_supplement: "kitchen",
  living_health: "living",
  fashion_goods: "living",
  baby_pet: "kids-room",
  sports_leisure: "outdoor-gear",
};

/** 여행 장소 유형(travel-knowledge.ts HighlightKind 와 같은 신호) → 장면. */
const TRAVEL_SCENE_RULES: Array<[string, RegExp]> = [
  ["hotel-room", /호텔|리조트|객실|숙소|숙박|체크인|룸/iu],
  ["transit", /공항|탑승|비행|이동|교통|열차|기차|버스|픽업|환승|출국|입국/iu],
  ["harbor", /항구|항만|부두|선착장|페리|여객선|터미널|크루즈|유람선/iu],
  ["beach", /비치|해변|해수욕|스노클|호핑|바다|섬/iu],
  ["night-city", /야경|야시장|나이트|루프탑|밤|등불|소원등/iu],
  ["market", /시장|마켓|먹거리|맛집|식사|디너|뷔페|레스토랑|카페|디저트/iu],
  // "청수사·금각사"처럼 "~사"로 끝나는 절 이름도 사원으로 본다(여행사는 제외).
  ["temple", /사원|사찰|성당|궁|고성|유적|박물관|신사|성곽|사당|교회|모스크|왕궁|불상|대불|석탑|(?<![가-힣])(?!여행)[가-힣]{1,3}사(?![가-힣])/iu],
];

export function selectPhotorealScene(input: {
  connectKind: "SHOPPING" | "TRAVEL";
  stagingRecipe?: string;
  imageIntent?: string;
  sectionTitle?: string;
  topicTemplateId?: string;
}): string {
  const text = [input.stagingRecipe, input.imageIntent, input.sectionTitle].filter(Boolean).join(" ");
  const rules = input.connectKind === "SHOPPING" ? SHOPPING_SCENE_RULES : TRAVEL_SCENE_RULES;
  for (const [scene, pattern] of rules) if (pattern.test(text)) return scene;
  if (input.connectKind === "SHOPPING") return TOPIC_DEFAULT_SCENE[input.topicTemplateId || ""] || "living";
  return "street-day";
}

/**
 * 블로그 이미지용 photoreal 지시 블록(영어, 기존 이미지 프롬프트와 같은 언어).
 * 쇼핑은 상품 없는 배경, 여행은 풍경이라 사람이 주인공이 아니다 → L1~L3 만 들어간다.
 */
export function buildBlogPhotorealDirection(input: {
  connectKind: "SHOPPING" | "TRAVEL";
  role: "hero" | "body";
  variantIndex: number;
  stagingRecipe?: string;
  imageIntent?: string;
  sectionTitle?: string;
  topicTemplateId?: string;
}): { scene: string; text: string } {
  const scene = selectPhotorealScene(input);
  const subject = input.connectKind === "SHOPPING"
    ? "an everyday spot with a clear empty area where a product will later be placed"
    : "the place described in this section";
  const text = buildPhotorealPrompt({
    subject,
    scene,
    variantIndex: input.variantIndex,
    level: "standard",
    people: false,
    incidentalPeople: input.connectKind === "TRAVEL",
    lang: "en",
  });
  return { scene, text };
}
