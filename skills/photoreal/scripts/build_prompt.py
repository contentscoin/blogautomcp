#!/usr/bin/env python3
"""실사 사진 프롬프트 조립기.

SKILL.md 의 다섯 개 층을 조합해 프롬프트를 만든다.
--n 을 주면 층 안의 세부(광원, 기울기, 순간, 시선, 화질 결함, 비대칭 방향)를
서로 다르게 조합한 N개를 만들어 병렬 생성에 바로 쓸 수 있게 한다.

사용 예:
    python3 build_prompt.py --subject "20대 후반 한국인 여성" --scene cafe --n 4
    python3 build_prompt.py --subject "30대 일본인 남성" --scene commute --level full --lang both
    python3 build_prompt.py --subject "20대 미국인 여성" --scene custom \
        --situation "빨래를 개다 말고 고개를 든" --n 3 --emit-batch ./out
"""

import argparse
import shlex
import sys

# --- 장면 프리셋 -----------------------------------------------------------
# moments / lights 는 --n 만큼 순환하며 서로 다른 조합을 만든다.
SCENES = {
    "cafe": {
        "place_ko": "카페 창가 자리",
        "place_en": "at a window seat in a cafe",
        "lights_ko": [
            "늦은 오후 창으로 들어오는 자연광만으로 촬영",
            "흐린 날 창가의 부드러운 확산광, 실내등이 약하게 섞임",
            "해질 무렵 창으로 낮게 드는 빛이 한쪽 뺨에만 걸림",
        ],
        "lights_en": [
            "lit only by late-afternoon light through the window",
            "soft diffused light from an overcast window, weak indoor lamps mixed in",
            "low evening light through the glass catching only one cheek",
        ],
        "moments_ko": [
            "컵을 내려놓다 말고 창밖을 보는 순간",
            "책장을 넘기다 잠깐 손을 멈춘 순간",
            "맞은편 사람 말을 듣다 웃음이 번지기 직전",
            "빨대를 물다 말고 시선이 딴 데로 간 순간",
        ],
        "moments_en": [
            "caught mid-motion setting a cup down, looking out the window",
            "hand paused mid page-turn",
            "listening to someone across the table, just before a smile forms",
            "about to sip, attention drifting somewhere off-frame",
        ],
    },
    "home": {
        "place_ko": "자취방",
        "place_en": "in a small apartment",
        "lights_ko": [
            "커튼 사이로 들어오는 아침 빛만으로 촬영",
            "책상 스탠드 하나만 켜진 방, 나머지는 어둑함",
            "창가에서 들어온 빛이 바닥에 반사돼 얼굴 아래쪽을 약하게 밝힘",
        ],
        "lights_en": [
            "morning light through a gap in the curtains, nothing else",
            "a single desk lamp on, the rest of the room dim",
            "window light bouncing off the floor, faintly lifting the underside of the face",
        ],
        "moments_ko": [
            "머리를 넘기다 만 순간",
            "이불 위에 앉아 폰을 보다 고개를 든 순간",
            "부엌에서 물을 마시다 뒤를 돌아본 순간",
            "빨래를 개다 말고 손을 멈춘 순간",
        ],
        "moments_en": [
            "hand still in her hair, mid-motion",
            "sitting on the bed, looking up from a phone",
            "turning around mid-drink in the kitchen",
            "hands paused over half-folded laundry",
        ],
    },
    "street": {
        "place_ko": "저녁 골목길",
        "place_en": "on a narrow street at dusk",
        "lights_ko": [
            "간판 불빛과 가로등이 섞인 잡광만으로 촬영",
            "해가 막 진 뒤 푸른 하늘빛과 노란 상가 조명이 섞임",
            "편의점 창에서 새어 나온 흰 빛이 옆얼굴에 걸림",
        ],
        "lights_en": [
            "mixed light from shop signs and street lamps, nothing else",
            "blue post-sunset sky mixing with warm shopfront light",
            "cold white light from a convenience store window catching the side of the face",
        ],
        "moments_ko": [
            "걷다 말고 뒤를 돌아본 순간",
            "신호를 기다리며 다른 데를 보는 순간",
            "가방을 고쳐 메다 만 순간",
            "바람에 머리가 얼굴을 스치는 순간",
        ],
        "moments_en": [
            "stopping mid-stride to look back",
            "waiting at a crossing, attention elsewhere",
            "mid-shrug, adjusting a bag strap",
            "hair blowing across the face in a gust",
        ],
    },
    "commute": {
        "place_ko": "지하철 안",
        "place_en": "inside a subway car",
        "lights_ko": [
            "차내 형광등만으로 촬영, 창밖은 어두움",
            "터널을 벗어나며 들어온 바깥 빛이 순간적으로 섞임",
            "천장 조명이 정수리에 떨어져 눈 아래에 옅은 그림자",
        ],
        "lights_en": [
            "only the carriage fluorescents, darkness outside",
            "outside light flooding in as the train leaves a tunnel",
            "overhead light landing on the crown of the head, faint shadow under the eyes",
        ],
        "moments_ko": [
            "창밖을 보다 시선이 흐려진 순간",
            "이어폰을 고쳐 끼다 만 순간",
            "졸다 깨서 눈을 뜬 직후",
            "손잡이를 잡고 몸이 흔들리는 순간",
        ],
        "moments_en": [
            "staring out the window, focus gone soft",
            "mid-adjustment of an earbud",
            "just waking from a doze",
            "body swaying while holding a strap",
        ],
    },
    "park": {
        "place_ko": "공원",
        "place_en": "in a park",
        "lights_ko": [
            "나뭇잎 사이로 새는 햇빛이 얼굴에 얼룩덜룩하게 떨어짐",
            "구름 낀 날의 평평한 자연광",
            "낮은 해가 뒤에서 들어와 머리카락 가장자리만 빛남",
        ],
        "lights_en": [
            "dappled sunlight through leaves falling unevenly across the face",
            "flat natural light on an overcast day",
            "low sun from behind, rimming only the edge of the hair",
        ],
        "moments_ko": [
            "벤치에 앉아 고개를 살짝 든 순간",
            "바람에 머리가 얼굴을 스치는 순간",
            "걷다 말고 신발을 내려다보는 순간",
            "누군가를 기다리며 다른 데를 보는 순간",
        ],
        "moments_en": [
            "on a bench, chin just lifted",
            "hair blown across the face",
            "stopped mid-walk, looking down at her shoes",
            "waiting for someone, looking off to the side",
        ],
    },
    "restaurant": {
        "place_ko": "식당 테이블",
        "place_en": "at a restaurant table",
        "lights_ko": [
            "천장의 따뜻한 등 하나가 테이블 위로 떨어짐",
            "옆 테이블 조명과 주방 빛이 섞인 잡광",
            "창가 자리라 바깥의 푸른 빛과 실내 노란 빛이 얼굴 양쪽에 따로 걸림",
        ],
        "lights_en": [
            "one warm ceiling lamp dropping onto the table",
            "mixed light from the next table and the kitchen",
            "a window seat, cool daylight on one side of the face and warm interior light on the other",
        ],
        "moments_ko": [
            "말하다 웃음이 터지기 직전",
            "젓가락을 들다 말고 상대를 보는 순간",
            "잔을 내려놓으며 고개를 돌린 순간",
            "메뉴를 보다 고개를 든 순간",
        ],
        "moments_en": [
            "mid-sentence, just before laughing",
            "chopsticks half-raised, looking at the person opposite",
            "setting a glass down while turning her head",
            "looking up from a menu",
        ],
    },
    "office": {
        "place_ko": "사무실 책상",
        "place_en": "at an office desk",
        "lights_ko": [
            "천장 형광등과 모니터 빛이 섞임",
            "블라인드 사이로 들어온 낮 빛이 책상에 줄무늬로 떨어짐",
            "모니터 빛만 얼굴 정면에 약하게 닿고 주변은 어둑함",
        ],
        "lights_en": [
            "ceiling fluorescents mixed with monitor glow",
            "daylight through blinds striping the desk",
            "only monitor light on the face, the surroundings dim",
        ],
        "moments_ko": [
            "모니터를 보다 옆을 본 순간",
            "머그를 들다 말고 손을 멈춘 순간",
            "의자에 기대 천장 쪽으로 시선을 올린 순간",
            "누가 부르는 쪽으로 고개를 돌리는 중",
        ],
        "moments_en": [
            "eyes moving from the monitor to the side",
            "hand paused halfway to a mug",
            "leaning back, gaze drifting up",
            "turning toward someone calling her name",
        ],
    },
    "night": {
        "place_ko": "밤의 실내 창가",
        "place_en": "by a window at night",
        "lights_ko": [
            "방 안의 등 하나와 창밖 도시 불빛만으로 촬영",
            "폰 화면 빛이 아래에서 얼굴을 약하게 비춤",
            "옆방에서 새어 들어온 빛이 얼굴 절반만 밝힘",
        ],
        "lights_en": [
            "one lamp in the room plus city light through the glass",
            "phone screen lighting the face weakly from below",
            "light spilling from the next room, catching only half the face",
        ],
        "moments_ko": [
            "폰을 보다 고개를 든 순간",
            "창에 이마를 살짝 기댄 순간",
            "불을 끄려다 손을 멈춘 순간",
            "하품 직후 눈가가 아직 풀린 순간",
        ],
        "moments_en": [
            "looking up from a phone",
            "forehead resting lightly against the window",
            "hand stopped on the way to the light switch",
            "just after a yawn, eyes still soft",
        ],
    },
}

# --- 층별 문장 -------------------------------------------------------------
FRAMING_KO = [
    "수평이 1~2도 기울고 인물이 프레임 왼쪽으로 치우친 프레이밍",
    "머리 위 여백이 조금 넉넉하고 인물이 오른쪽 아래로 내려앉은 프레이밍",
    "인물이 프레임을 살짝 벗어나 어깨 한쪽이 잘린 프레이밍",
    "수평이 오른쪽으로 기울고 아래쪽 여백이 좁은 프레이밍",
]
FRAMING_EN = [
    "framing tilted a degree or two, the subject sitting left of center",
    "a little too much headroom, the subject settled toward the lower right",
    "the subject slightly out of frame, one shoulder cropped",
    "horizon tipped to the right, very little room at the bottom",
]

GAZE_KO = [
    "카메라를 정면으로 보지 않고 살짝 비낀 시선",
    "카메라 옆의 다른 사람 쪽을 보는 시선",
    "시선이 아래로 내려가 눈꺼풀이 홍채를 조금 덮음",
    "먼 데를 보느라 초점이 살짝 풀린 눈",
]
GAZE_EN = [
    "eyes slightly off the lens, not locked on camera",
    "looking at someone standing beside the camera",
    "gaze dropped, eyelids covering part of the iris",
    "focus soft, looking at something far away",
]

DEFECT_KO = [
    "가벼운 손떨림과 폰 카메라 특유의 노이즈가 약간 남음",
    "초점이 눈에 아슬아슬하게 맞고 귀 쪽은 살짝 흐림",
    "어두운 부분에 폰 카메라 노이즈가 끼고 해상감이 가볍게 뭉개짐",
    "빛이 강한 쪽이 아주 조금 날아가고 그림자 쪽 디테일이 뭉개짐",
]
DEFECT_EN = [
    "a little handshake blur and the usual phone-camera noise",
    "focus landing just barely on the eyes, the ears going soft",
    "noise in the shadows, resolution mildly mushy",
    "the bright side slightly blown, shadow detail muddied",
]

ASYM_KO = [
    "왼쪽 눈썹이 오른쪽보다 아주 조금 높고 입꼬리도 왼쪽이 더 올라감",
    "오른쪽 눈이 왼쪽보다 미세하게 작게 떠지고 입꼬리는 오른쪽이 더 올라감",
    "한쪽 눈가에만 옅은 주름이 잡히고 입술 라인이 좌우로 조금 다름",
]
ASYM_EN = [
    "left brow a touch higher than the right, left corner of the mouth lifting more",
    "right eye opening slightly less than the left, right corner of the mouth lifting more",
    "a faint crease at one eye only, the lip line a little different side to side",
]

L1_KO = ("스마트폰으로 찍은 자연스러운 사진. 광고 촬영이 아니라 일반인이 일상 중에 찍어 "
         "SNS에 올릴 법한 한 장. 고성능 카메라가 아닌 폰 스냅의 질감")
L1_EN = ("a natural smartphone photo — not an ad shoot but a snapshot an ordinary person took "
         "during an ordinary day and would post to their feed, with the texture of a phone camera "
         "rather than a high-end one")

L2_TAIL_KO = "CG 같은 질감과 과한 보정, 부자연스러운 광택 없음"
L2_TAIL_EN = "no CG-like surface, no heavy retouching, no unnatural sheen"

L4_KO = [
    "윤곽과 이목구비의 배치가 현실적이고 조화로운 밸런스",
    "사람 크기의 동공, 흰자위가 자연스럽고 눈꺼풀에 두께가 있음",
    "입꼬리와 눈가만 미세하게 움직인, 거의 무표정에 가까운 표정",
    "모공과 잔털이 보이고 코 옆에 옅은 붉은 기가 남은 피부, 이마에 미세한 유분",
    "이마에 흘러내린 잔머리 몇 가닥과 정돈되지 않은 옆머리",
]
L4_EN = [
    "realistic, coherent proportions across the jawline, brow, eyes, nose, and lips",
    "human-sized pupils, natural sclera, eyelids with real thickness",
    "expression barely there — only a small movement at the mouth and eyes",
    "visible pores and fine hair, faint redness beside the nose, a little shine on the forehead",
    "a few loose strands across the forehead, side hair not tidied",
]

HANDS_KO = "손이 화면에 보인다면 손가락 개수와 관절, 쥐는 방식이 현실적일 것"
HANDS_EN = "if hands are visible, correct finger count, plausible joints, a realistic grip"

# L5 는 양쪽으로 실패한다 — 빼면 초라해지고 세게 쓰면 배우 얼굴이 된다.
# plain 이 기본값. 인물이 주인공인 컷에만 attractive, 노인·다큐·사물에는 none.
L5_KO = {
    "plain": ("호감 가는 인상은 유지하되 얼굴과 피부를 완벽하게 다듬지 말 것. "
              "완벽함보다 실존감·생활감·자연스러운 불완전함을 최우선으로"),
    "attractive": ("매력적이되 얼굴과 피부를 완벽하게 다듬지 말 것. 청결감과 친근함은 남기고, "
                   "완벽함보다 실존감·생활감·자연스러운 불완전함을 최우선으로"),
    "none": "완벽함보다 실존감·생활감·자연스러운 불완전함을 최우선으로",
}
L5_EN = {
    "plain": ("keep the subject likeable but do not perfect the face or skin; prioritize presence, "
              "lived-in texture, and natural imperfection over perfection"),
    "attractive": ("keep the subject genuinely attractive but do not perfect the face or skin; stay "
                   "clean and approachable, and prioritize presence, lived-in texture, and natural "
                   "imperfection over perfection"),
    "none": "prioritize presence, lived-in texture, and natural imperfection over perfection",
}

# L4 의 피부·주름 지시는 나이를 위로 민다. 실측에서 20대 중반→30대, 30대 후반→40대로 반복 관찰.
AGE_LOCK_KO = "지정한 나이대로 보일 것 — 피부 질감 지시가 실제 나이보다 들어 보이게 만들지 않도록"
AGE_LOCK_EN = ("read as the stated age — the skin-texture notes must not push the subject older "
               "than specified")

# 여러 명일 때는 시선을 사람 수만큼 나눠야 한다. 하나만 주면 전원이 같은 곳을 본다.
GROUP_KO = ("등장인물의 시선과 자세가 제각각이고 아무도 카메라를 보지 않음. "
            "뒤쪽 인물의 얼굴과 손도 또렷하게 그릴 것. "
            "옷차림의 색과 차림새에 편차가 있고 앉은 자세도 각자 다름")
GROUP_EN = ("each person looking somewhere different and nobody at the camera; "
            "faces and hands of the people further back rendered clearly; "
            "clothing colors and postures varying from person to person")

# 손은 해부학과 동작 논리가 별개다. 개수가 맞아도 동작이 틀리면 실패한다.
HANDS_ACTION_KO = "손이 무언가를 하고 있다면 그 동작을 실제로 할 수 있는 손 모양일 것"
HANDS_ACTION_EN = "if the hands are doing something, the grip must be one that actually performs it"

SELFIE_KO = ("팔 길이 거리에서 직접 든 셀카 — 얼굴이 가깝고 화면 위쪽에 치우치며 광각 왜곡으로 "
             "코가 조금 크고 가장자리가 늘어남. 한쪽 어깨가 뻗은 팔 쪽으로 기울고, 렌즈가 아니라 "
             "화면 속 자기 얼굴을 보고 있어 시선이 미세하게 어긋남")
SELFIE_EN = ("a selfie held at arm's length — the face close and high in the frame, wide-angle "
             "distortion enlarging the nose and stretching the edges, one shoulder tilted toward "
             "the extended arm, and the eyes on the screen rather than the lens so the gaze is "
             "slightly off")


def build(subject, scene_key, situation, idx, level, shot, lang,
          group=0, charm="plain", age_lock=False):
    scene = SCENES.get(scene_key)
    ko, en = [], []

    # 피사체 + 순간 + 장소
    if scene:
        moment_ko = scene["moments_ko"][idx % len(scene["moments_ko"])]
        moment_en = scene["moments_en"][idx % len(scene["moments_en"])]
        ko.append(f"{subject}, {scene['place_ko']}에서 {moment_ko}")
        en.append(f"{subject}, {scene['place_en']}, {moment_en}")
        light_ko = scene["lights_ko"][idx % len(scene["lights_ko"])]
        light_en = scene["lights_en"][idx % len(scene["lights_en"])]
    else:
        ko.append(f"{subject}, {situation}")
        en.append(f"{subject}, {situation}")
        light_ko = "그 자리에 원래 있는 빛만으로 촬영, 스튜디오 조명 없음"
        light_en = "lit only by whatever light is already there, no studio lighting"

    # L1 출처
    ko.append(L1_KO)
    en.append(L1_EN)

    if group >= 2:
        ko.append(GROUP_KO)
        en.append(GROUP_EN)

    if shot == "selfie":
        ko.append(SELFIE_KO)
        en.append(SELFIE_EN)

    # L2 빛 + 화질
    ko.append(light_ko)
    en.append(light_en)
    ko.append(DEFECT_KO[idx % len(DEFECT_KO)])
    en.append(DEFECT_EN[idx % len(DEFECT_EN)])
    ko.append(L2_TAIL_KO)
    en.append(L2_TAIL_EN)

    # L3 구도 + 시선
    if level in ("standard", "full"):
        if shot != "selfie":
            ko.append(FRAMING_KO[idx % len(FRAMING_KO)])
            en.append(FRAMING_EN[idx % len(FRAMING_EN)])
        if group < 2:  # 그룹은 GROUP_KO 가 시선을 이미 분배함
            ko.append(GAZE_KO[idx % len(GAZE_KO)])
            en.append(GAZE_EN[idx % len(GAZE_EN)])

    # L4 해부학
    if level == "full":
        ko.extend(L4_KO)
        en.extend(L4_EN)
        ko.append(ASYM_KO[idx % len(ASYM_KO)])
        en.append(ASYM_EN[idx % len(ASYM_EN)])
        ko.append(HANDS_KO)
        en.append(HANDS_EN)
        ko.append(HANDS_ACTION_KO)
        en.append(HANDS_ACTION_EN)

    if age_lock:
        ko.append(AGE_LOCK_KO)
        en.append(AGE_LOCK_EN)

    # L5 미의 상한선 — 항상 마지막. none 이어도 실존감 문장은 남긴다
    ko.append(L5_KO[charm])
    en.append(L5_EN[charm])

    out = {}
    if lang in ("ko", "both"):
        out["ko"] = ". ".join(ko) + "."
    if lang in ("en", "both"):
        out["en"] = ", ".join(en) + "."
    return out


def main():
    p = argparse.ArgumentParser(description="실사 사진 프롬프트 조립기")
    p.add_argument("--subject", required=True, help='예: "20대 후반 한국인 여성"')
    p.add_argument("--scene", default="cafe", choices=sorted(SCENES) + ["custom"])
    p.add_argument("--situation", action="append", default=[],
                   help="--scene custom 일 때 상황을 직접 서술. 반복하면 변형마다 돌아가며 쓴다")
    p.add_argument("--n", type=int, default=1, help="변형 개수")
    p.add_argument("--level", default="standard", choices=["light", "standard", "full"])
    p.add_argument("--shot", default="other", choices=["other", "selfie"])
    p.add_argument("--group", type=int, default=0, metavar="N",
                   help="N명이 등장하는 컷. 시선 분배·뒤쪽 인물·옷차림 편차를 넣는다")
    p.add_argument("--charm", default="plain", choices=["plain", "attractive", "none"],
                   help="L5 강도. 세게 쓰면 배우 얼굴로 돌아간다")
    p.add_argument("--age-lock", dest="age_lock", action="store_true", default=None,
                   help="나이 고정 문장 추가 (--level full 에서 기본 켜짐)")
    p.add_argument("--no-age-lock", dest="age_lock", action="store_false")
    p.add_argument("--lang", default="ko", choices=["ko", "en", "both"])
    p.add_argument("--emit-batch", metavar="DIR",
                   help="codex-image 배치 스크립트 명령줄까지 출력")
    p.add_argument("--prefix", default="photoreal", help="--emit-batch 시 출력 파일명 접두사")
    a = p.parse_args()

    if a.scene == "custom" and not a.situation:
        p.error("--scene custom 을 쓰면 --situation 이 필요합니다")

    # L4 의 피부 지시가 나이를 밀어 올리므로 full 에서는 기본으로 잠근다
    age_lock = a.age_lock if a.age_lock is not None else (a.level == "full")

    def situation_for(i):
        return a.situation[i % len(a.situation)] if a.situation else ""

    prompts = [build(a.subject, a.scene if a.scene != "custom" else None,
                     situation_for(i), i, a.level, a.shot, a.lang,
                     group=a.group, charm=a.charm, age_lock=age_lock)
               for i in range(a.n)]

    if a.scene == "custom" and 1 < a.n and len(a.situation) == 1:
        print("# 참고: --situation 이 하나뿐이라 변형이 조명·구도로만 갈립니다.", file=sys.stderr)
        print("#      --situation 을 여러 번 넘기면 상황 자체가 달라집니다.", file=sys.stderr)

    for i, pr in enumerate(prompts, 1):
        print(f"--- {i} ---")
        if "ko" in pr:
            print(pr["ko"])
        if "en" in pr:
            if "ko" in pr:
                print()
            print(pr["en"])
        print()

    if a.emit_batch:
        key = "en" if a.lang == "en" else "ko"
        args = " \\\n  ".join(
            shlex.quote(f"{pr[key]}::{a.prefix}-{i}.png")
            for i, pr in enumerate(prompts, 1))
        print("--- codex-image 배치 명령 ---")
        print(f"~/.claude/skills/codex-image/scripts/codex_imagegen_batch.sh "
              f"{shlex.quote(a.emit_batch)} \\\n  {args}")


if __name__ == "__main__":
    sys.exit(main())
