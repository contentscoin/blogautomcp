/**
 * photoreal 스킬(skills/photoreal, 원본 build_prompt.py)의 층별 문장.
 * 인물 컷 문장은 원본과 글자 단위로 같아야 한다(scripts/verify-photoreal-prompts.ts가 원본 출력과 비교).
 * 사람이 없는 블로그 컷(쇼핑 배경·여행 풍경)용 문장만 이 저장소에서 추가했다.
 */

export type PhotorealLang = "ko" | "en";
export type PhotorealCharm = "plain" | "attractive" | "none";
export type Bilingual = Record<PhotorealLang, string>;
export type BilingualPool = Record<PhotorealLang, string[]>;

export const FRAMING: BilingualPool = {
  ko: [
    "수평이 1~2도 기울고 인물이 프레임 왼쪽으로 치우친 프레이밍",
    "머리 위 여백이 조금 넉넉하고 인물이 오른쪽 아래로 내려앉은 프레이밍",
    "인물이 프레임을 살짝 벗어나 어깨 한쪽이 잘린 프레이밍",
    "수평이 오른쪽으로 기울고 아래쪽 여백이 좁은 프레이밍",
  ],
  en: [
    "framing tilted a degree or two, the subject sitting left of center",
    "a little too much headroom, the subject settled toward the lower right",
    "the subject slightly out of frame, one shoulder cropped",
    "horizon tipped to the right, very little room at the bottom",
  ],
};

/** 사람이 없는 컷의 프레이밍. 주인공이 사물·장소라는 점만 다르고 치우침·기울기 원칙은 같다. */
export const FRAMING_OBJECT: BilingualPool = {
  ko: [
    "수평이 1~2도 기울고 주요 피사체가 프레임 왼쪽으로 치우친 프레이밍",
    "위쪽 여백이 조금 넉넉하고 주요 피사체가 오른쪽 아래로 내려앉은 프레이밍",
    "앞쪽 사물 가장자리가 프레임 한쪽에 살짝 걸린 프레이밍",
    "수평이 오른쪽으로 기울고 아래쪽 여백이 좁은 프레이밍",
  ],
  en: [
    "framing tilted a degree or two, the main subject sitting left of center",
    "a little extra room at the top, the main subject settled toward the lower right",
    "the edge of a nearby object slightly intruding on one side of the frame",
    "horizon tipped to the right, very little room at the bottom",
  ],
};

export const GAZE: BilingualPool = {
  ko: [
    "카메라를 정면으로 보지 않고 살짝 비낀 시선",
    "카메라 옆의 다른 사람 쪽을 보는 시선",
    "시선이 아래로 내려가 눈꺼풀이 홍채를 조금 덮음",
    "먼 데를 보느라 초점이 살짝 풀린 눈",
  ],
  en: [
    "eyes slightly off the lens, not locked on camera",
    "looking at someone standing beside the camera",
    "gaze dropped, eyelids covering part of the iris",
    "focus soft, looking at something far away",
  ],
};

export const DEFECT: BilingualPool = {
  ko: [
    "가벼운 손떨림과 폰 카메라 특유의 노이즈가 약간 남음",
    "초점이 눈에 아슬아슬하게 맞고 귀 쪽은 살짝 흐림",
    "어두운 부분에 폰 카메라 노이즈가 끼고 해상감이 가볍게 뭉개짐",
    "빛이 강한 쪽이 아주 조금 날아가고 그림자 쪽 디테일이 뭉개짐",
  ],
  en: [
    "a little handshake blur and the usual phone-camera noise",
    "focus landing just barely on the eyes, the ears going soft",
    "noise in the shadows, resolution mildly mushy",
    "the bright side slightly blown, shadow detail muddied",
  ],
};

/** 사람이 없는 컷의 화질 결함. 원본의 눈·귀 초점 문장만 사물 기준으로 바꿨다. */
export const DEFECT_OBJECT: BilingualPool = {
  ko: [
    "가벼운 손떨림과 폰 카메라 특유의 노이즈가 약간 남음",
    "초점이 앞쪽 사물에 맞고 먼 배경은 폰 카메라 수준으로만 살짝 흐림",
    "어두운 부분에 폰 카메라 노이즈가 끼고 해상감이 가볍게 뭉개짐",
    "빛이 강한 쪽이 아주 조금 날아가고 그림자 쪽 디테일이 뭉개짐",
  ],
  en: [
    "a little handshake blur and the usual phone-camera noise",
    "focus on the nearest objects, the far background only as soft as a phone camera allows",
    "noise in the shadows, resolution mildly mushy",
    "the bright side slightly blown, shadow detail muddied",
  ],
};

export const ASYM: BilingualPool = {
  ko: [
    "왼쪽 눈썹이 오른쪽보다 아주 조금 높고 입꼬리도 왼쪽이 더 올라감",
    "오른쪽 눈이 왼쪽보다 미세하게 작게 떠지고 입꼬리는 오른쪽이 더 올라감",
    "한쪽 눈가에만 옅은 주름이 잡히고 입술 라인이 좌우로 조금 다름",
  ],
  en: [
    "left brow a touch higher than the right, left corner of the mouth lifting more",
    "right eye opening slightly less than the left, right corner of the mouth lifting more",
    "a faint crease at one eye only, the lip line a little different side to side",
  ],
};

export const L1: Bilingual = {
  ko: "스마트폰으로 찍은 자연스러운 사진. 광고 촬영이 아니라 일반인이 일상 중에 찍어 "
    + "SNS에 올릴 법한 한 장. 고성능 카메라가 아닌 폰 스냅의 질감",
  en: "a natural smartphone photo — not an ad shoot but a snapshot an ordinary person took "
    + "during an ordinary day and would post to their feed, with the texture of a phone camera "
    + "rather than a high-end one",
};

export const L2_TAIL: Bilingual = {
  ko: "CG 같은 질감과 과한 보정, 부자연스러운 광택 없음",
  en: "no CG-like surface, no heavy retouching, no unnatural sheen",
};

/** 장면이 없을 때(custom) 쓰는 기본 현장광. */
export const AMBIENT_LIGHT: Bilingual = {
  ko: "그 자리에 원래 있는 빛만으로 촬영, 스튜디오 조명 없음",
  en: "lit only by whatever light is already there, no studio lighting",
};

export const L4: BilingualPool = {
  ko: [
    "윤곽과 이목구비의 배치가 현실적이고 조화로운 밸런스",
    "사람 크기의 동공, 흰자위가 자연스럽고 눈꺼풀에 두께가 있음",
    "입꼬리와 눈가만 미세하게 움직인, 거의 무표정에 가까운 표정",
    "모공과 잔털이 보이고 코 옆에 옅은 붉은 기가 남은 피부, 이마에 미세한 유분",
    "이마에 흘러내린 잔머리 몇 가닥과 정돈되지 않은 옆머리",
  ],
  en: [
    "realistic, coherent proportions across the jawline, brow, eyes, nose, and lips",
    "human-sized pupils, natural sclera, eyelids with real thickness",
    "expression barely there — only a small movement at the mouth and eyes",
    "visible pores and fine hair, faint redness beside the nose, a little shine on the forehead",
    "a few loose strands across the forehead, side hair not tidied",
  ],
};

export const HANDS: Bilingual = {
  ko: "손이 화면에 보인다면 손가락 개수와 관절, 쥐는 방식이 현실적일 것",
  en: "if hands are visible, correct finger count, plausible joints, a realistic grip",
};

export const HANDS_ACTION: Bilingual = {
  ko: "손이 무언가를 하고 있다면 그 동작을 실제로 할 수 있는 손 모양일 것",
  en: "if the hands are doing something, the grip must be one that actually performs it",
};

/** L5 는 양쪽으로 실패한다 — 빼면 초라해지고 세게 쓰면 배우 얼굴이 된다. plain 이 기본값. */
export const L5: Record<PhotorealCharm, Bilingual> = {
  plain: {
    ko: "호감 가는 인상은 유지하되 얼굴과 피부를 완벽하게 다듬지 말 것. "
      + "완벽함보다 실존감·생활감·자연스러운 불완전함을 최우선으로",
    en: "keep the subject likeable but do not perfect the face or skin; prioritize presence, "
      + "lived-in texture, and natural imperfection over perfection",
  },
  attractive: {
    ko: "매력적이되 얼굴과 피부를 완벽하게 다듬지 말 것. 청결감과 친근함은 남기고, "
      + "완벽함보다 실존감·생활감·자연스러운 불완전함을 최우선으로",
    en: "keep the subject genuinely attractive but do not perfect the face or skin; stay "
      + "clean and approachable, and prioritize presence, lived-in texture, and natural "
      + "imperfection over perfection",
  },
  none: {
    ko: "완벽함보다 실존감·생활감·자연스러운 불완전함을 최우선으로",
    en: "prioritize presence, lived-in texture, and natural imperfection over perfection",
  },
};

/** L4 의 피부·주름 지시는 나이를 위로 민다. full 레벨에서 기본으로 잠근다. */
export const AGE_LOCK: Bilingual = {
  ko: "지정한 나이대로 보일 것 — 피부 질감 지시가 실제 나이보다 들어 보이게 만들지 않도록",
  en: "read as the stated age — the skin-texture notes must not push the subject older "
    + "than specified",
};

/** 여러 명일 때는 시선을 사람 수만큼 나눠야 한다. */
export const GROUP: Bilingual = {
  ko: "등장인물의 시선과 자세가 제각각이고 아무도 카메라를 보지 않음. "
    + "뒤쪽 인물의 얼굴과 손도 또렷하게 그릴 것. "
    + "옷차림의 색과 차림새에 편차가 있고 앉은 자세도 각자 다름",
  en: "each person looking somewhere different and nobody at the camera; "
    + "faces and hands of the people further back rendered clearly; "
    + "clothing colors and postures varying from person to person",
};

export const SELFIE: Bilingual = {
  ko: "팔 길이 거리에서 직접 든 셀카 — 얼굴이 가깝고 화면 위쪽에 치우치며 광각 왜곡으로 "
    + "코가 조금 크고 가장자리가 늘어남. 한쪽 어깨가 뻗은 팔 쪽으로 기울고, 렌즈가 아니라 "
    + "화면 속 자기 얼굴을 보고 있어 시선이 미세하게 어긋남",
  en: "a selfie held at arm's length — the face close and high in the frame, wide-angle "
    + "distortion enlarging the nose and stretching the edges, one shoulder tilted toward "
    + "the extended arm, and the eyes on the screen rather than the lens so the gaze is "
    + "slightly off",
};

/** 사람이 작게 지나가는 풍경 컷. 배경 인물이 녹는 실패(점검표 8번)를 긍정문으로 막는다. */
export const INCIDENTAL_PEOPLE: Bilingual = {
  ko: "사람은 멀리 작게 지나가는 행인으로만 보이고, 그 얼굴과 다리도 형태가 온전함",
  en: "people appear only as small passers-by in the distance, their faces and legs still intact",
};

export function pick(pool: string[], index: number): string {
  return pool[((index % pool.length) + pool.length) % pool.length]!;
}
