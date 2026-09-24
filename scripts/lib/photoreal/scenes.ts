/**
 * photoreal 장면 프리셋. ORIGINAL_SCENES 는 원본 build_prompt.py SCENES 를 그대로 옮긴 것이고(인물 컷),
 * BLOG_SCENES 는 쇼핑 배경·여행 풍경처럼 사람이 없는 블로그 컷을 위해 이 저장소에서 추가했다.
 * moments / lights 는 변형 인덱스만큼 순환해 같은 글의 이미지끼리 상황·조명이 겹치지 않게 한다.
 */
import type { Bilingual, BilingualPool } from "./layers";

export interface PhotorealScene {
  place: Bilingual;
  lights: BilingualPool;
  moments: BilingualPool;
  /** 사람이 주인공인 장면인지. false 면 인물 층(시선·L4·L5 얼굴 문장)을 넣지 않는다. */
  people: boolean;
}

type SceneData = Omit<PhotorealScene, "people">;
const withPeople = (people: boolean, scenes: Record<string, SceneData>): Record<string, PhotorealScene> =>
  Object.fromEntries(Object.entries(scenes).map(([key, scene]) => [key, { ...scene, people }]));

export const ORIGINAL_SCENES = withPeople(true, {
  "cafe": {
    "place": {
      "ko": "카페 창가 자리",
      "en": "at a window seat in a cafe"
    },
    "lights": {
      "ko": [
        "늦은 오후 창으로 들어오는 자연광만으로 촬영",
        "흐린 날 창가의 부드러운 확산광, 실내등이 약하게 섞임",
        "해질 무렵 창으로 낮게 드는 빛이 한쪽 뺨에만 걸림"
      ],
      "en": [
        "lit only by late-afternoon light through the window",
        "soft diffused light from an overcast window, weak indoor lamps mixed in",
        "low evening light through the glass catching only one cheek"
      ]
    },
    "moments": {
      "ko": [
        "컵을 내려놓다 말고 창밖을 보는 순간",
        "책장을 넘기다 잠깐 손을 멈춘 순간",
        "맞은편 사람 말을 듣다 웃음이 번지기 직전",
        "빨대를 물다 말고 시선이 딴 데로 간 순간"
      ],
      "en": [
        "caught mid-motion setting a cup down, looking out the window",
        "hand paused mid page-turn",
        "listening to someone across the table, just before a smile forms",
        "about to sip, attention drifting somewhere off-frame"
      ]
    }
  },
  "home": {
    "place": {
      "ko": "자취방",
      "en": "in a small apartment"
    },
    "lights": {
      "ko": [
        "커튼 사이로 들어오는 아침 빛만으로 촬영",
        "책상 스탠드 하나만 켜진 방, 나머지는 어둑함",
        "창가에서 들어온 빛이 바닥에 반사돼 얼굴 아래쪽을 약하게 밝힘"
      ],
      "en": [
        "morning light through a gap in the curtains, nothing else",
        "a single desk lamp on, the rest of the room dim",
        "window light bouncing off the floor, faintly lifting the underside of the face"
      ]
    },
    "moments": {
      "ko": [
        "머리를 넘기다 만 순간",
        "이불 위에 앉아 폰을 보다 고개를 든 순간",
        "부엌에서 물을 마시다 뒤를 돌아본 순간",
        "빨래를 개다 말고 손을 멈춘 순간"
      ],
      "en": [
        "hand still in her hair, mid-motion",
        "sitting on the bed, looking up from a phone",
        "turning around mid-drink in the kitchen",
        "hands paused over half-folded laundry"
      ]
    }
  },
  "street": {
    "place": {
      "ko": "저녁 골목길",
      "en": "on a narrow street at dusk"
    },
    "lights": {
      "ko": [
        "간판 불빛과 가로등이 섞인 잡광만으로 촬영",
        "해가 막 진 뒤 푸른 하늘빛과 노란 상가 조명이 섞임",
        "편의점 창에서 새어 나온 흰 빛이 옆얼굴에 걸림"
      ],
      "en": [
        "mixed light from shop signs and street lamps, nothing else",
        "blue post-sunset sky mixing with warm shopfront light",
        "cold white light from a convenience store window catching the side of the face"
      ]
    },
    "moments": {
      "ko": [
        "걷다 말고 뒤를 돌아본 순간",
        "신호를 기다리며 다른 데를 보는 순간",
        "가방을 고쳐 메다 만 순간",
        "바람에 머리가 얼굴을 스치는 순간"
      ],
      "en": [
        "stopping mid-stride to look back",
        "waiting at a crossing, attention elsewhere",
        "mid-shrug, adjusting a bag strap",
        "hair blowing across the face in a gust"
      ]
    }
  },
  "commute": {
    "place": {
      "ko": "지하철 안",
      "en": "inside a subway car"
    },
    "lights": {
      "ko": [
        "차내 형광등만으로 촬영, 창밖은 어두움",
        "터널을 벗어나며 들어온 바깥 빛이 순간적으로 섞임",
        "천장 조명이 정수리에 떨어져 눈 아래에 옅은 그림자"
      ],
      "en": [
        "only the carriage fluorescents, darkness outside",
        "outside light flooding in as the train leaves a tunnel",
        "overhead light landing on the crown of the head, faint shadow under the eyes"
      ]
    },
    "moments": {
      "ko": [
        "창밖을 보다 시선이 흐려진 순간",
        "이어폰을 고쳐 끼다 만 순간",
        "졸다 깨서 눈을 뜬 직후",
        "손잡이를 잡고 몸이 흔들리는 순간"
      ],
      "en": [
        "staring out the window, focus gone soft",
        "mid-adjustment of an earbud",
        "just waking from a doze",
        "body swaying while holding a strap"
      ]
    }
  },
  "park": {
    "place": {
      "ko": "공원",
      "en": "in a park"
    },
    "lights": {
      "ko": [
        "나뭇잎 사이로 새는 햇빛이 얼굴에 얼룩덜룩하게 떨어짐",
        "구름 낀 날의 평평한 자연광",
        "낮은 해가 뒤에서 들어와 머리카락 가장자리만 빛남"
      ],
      "en": [
        "dappled sunlight through leaves falling unevenly across the face",
        "flat natural light on an overcast day",
        "low sun from behind, rimming only the edge of the hair"
      ]
    },
    "moments": {
      "ko": [
        "벤치에 앉아 고개를 살짝 든 순간",
        "바람에 머리가 얼굴을 스치는 순간",
        "걷다 말고 신발을 내려다보는 순간",
        "누군가를 기다리며 다른 데를 보는 순간"
      ],
      "en": [
        "on a bench, chin just lifted",
        "hair blown across the face",
        "stopped mid-walk, looking down at her shoes",
        "waiting for someone, looking off to the side"
      ]
    }
  },
  "restaurant": {
    "place": {
      "ko": "식당 테이블",
      "en": "at a restaurant table"
    },
    "lights": {
      "ko": [
        "천장의 따뜻한 등 하나가 테이블 위로 떨어짐",
        "옆 테이블 조명과 주방 빛이 섞인 잡광",
        "창가 자리라 바깥의 푸른 빛과 실내 노란 빛이 얼굴 양쪽에 따로 걸림"
      ],
      "en": [
        "one warm ceiling lamp dropping onto the table",
        "mixed light from the next table and the kitchen",
        "a window seat, cool daylight on one side of the face and warm interior light on the other"
      ]
    },
    "moments": {
      "ko": [
        "말하다 웃음이 터지기 직전",
        "젓가락을 들다 말고 상대를 보는 순간",
        "잔을 내려놓으며 고개를 돌린 순간",
        "메뉴를 보다 고개를 든 순간"
      ],
      "en": [
        "mid-sentence, just before laughing",
        "chopsticks half-raised, looking at the person opposite",
        "setting a glass down while turning her head",
        "looking up from a menu"
      ]
    }
  },
  "office": {
    "place": {
      "ko": "사무실 책상",
      "en": "at an office desk"
    },
    "lights": {
      "ko": [
        "천장 형광등과 모니터 빛이 섞임",
        "블라인드 사이로 들어온 낮 빛이 책상에 줄무늬로 떨어짐",
        "모니터 빛만 얼굴 정면에 약하게 닿고 주변은 어둑함"
      ],
      "en": [
        "ceiling fluorescents mixed with monitor glow",
        "daylight through blinds striping the desk",
        "only monitor light on the face, the surroundings dim"
      ]
    },
    "moments": {
      "ko": [
        "모니터를 보다 옆을 본 순간",
        "머그를 들다 말고 손을 멈춘 순간",
        "의자에 기대 천장 쪽으로 시선을 올린 순간",
        "누가 부르는 쪽으로 고개를 돌리는 중"
      ],
      "en": [
        "eyes moving from the monitor to the side",
        "hand paused halfway to a mug",
        "leaning back, gaze drifting up",
        "turning toward someone calling her name"
      ]
    }
  },
  "night": {
    "place": {
      "ko": "밤의 실내 창가",
      "en": "by a window at night"
    },
    "lights": {
      "ko": [
        "방 안의 등 하나와 창밖 도시 불빛만으로 촬영",
        "폰 화면 빛이 아래에서 얼굴을 약하게 비춤",
        "옆방에서 새어 들어온 빛이 얼굴 절반만 밝힘"
      ],
      "en": [
        "one lamp in the room plus city light through the glass",
        "phone screen lighting the face weakly from below",
        "light spilling from the next room, catching only half the face"
      ]
    },
    "moments": {
      "ko": [
        "폰을 보다 고개를 든 순간",
        "창에 이마를 살짝 기댄 순간",
        "불을 끄려다 손을 멈춘 순간",
        "하품 직후 눈가가 아직 풀린 순간"
      ],
      "en": [
        "looking up from a phone",
        "forehead resting lightly against the window",
        "hand stopped on the way to the light switch",
        "just after a yawn, eyes still soft"
      ]
    }
  }
});

export const BLOG_SCENES = withPeople(false, {
  "bathroom-shelf": {
    "place": {
      "ko": "욕실 선반",
      "en": "on a bathroom shelf"
    },
    "lights": {
      "ko": [
        "작은 욕실 창으로 들어오는 아침 자연광만으로 촬영",
        "욕실 천장등 하나와 문틈으로 든 복도 빛이 섞임",
        "샤워 직후 수증기가 살짝 남아 빛이 부드럽게 퍼짐"
      ],
      "en": [
        "lit only by morning light from a small bathroom window",
        "one bathroom ceiling light mixed with hallway light through the door gap",
        "soft light diffused by a little steam left after a shower"
      ]
    },
    "moments": {
      "ko": [
        "방금 쓰고 내려놓은 듯 수건이 선반 끝에 걸쳐진 순간",
        "물기가 조금 남은 타일 위로 칫솔컵이 비스듬히 놓인 순간",
        "선반 위 소품이 제각각 놓여 생활감이 남은 순간"
      ],
      "en": [
        "a towel just draped over the shelf edge, as if set down a moment ago",
        "a toothbrush cup leaning slightly on tiles that are still a little wet",
        "shelf items standing unevenly, clearly lived with"
      ]
    }
  },
  "vanity": {
    "place": {
      "ko": "화장대 위",
      "en": "on a vanity table"
    },
    "lights": {
      "ko": [
        "창가 화장대라 한쪽에서만 들어오는 자연광으로 촬영",
        "거울 옆 스탠드 하나만 켜진 저녁 화장대",
        "흐린 날 창가의 평평한 빛, 거울에 방 안이 흐릿하게 비침"
      ],
      "en": [
        "a vanity by the window, lit from one side by daylight only",
        "an evening vanity with only the lamp beside the mirror on",
        "flat overcast window light, the room faintly reflected in the mirror"
      ]
    },
    "moments": {
      "ko": [
        "아침 준비 도중 뚜껑 열린 소품과 머리끈이 흩어진 순간",
        "화장솜과 손거울이 아무렇게나 놓인 순간",
        "외출 직전 급하게 정리하다 만 화장대"
      ],
      "en": [
        "mid-morning routine, an open cap and a hair tie scattered around",
        "cotton pads and a hand mirror left where they fell",
        "a vanity half-tidied in a rush before heading out"
      ]
    }
  },
  "desk": {
    "place": {
      "ko": "집 책상",
      "en": "on a home desk"
    },
    "lights": {
      "ko": [
        "창으로 들어오는 오후 빛과 모니터 빛이 섞임",
        "책상 스탠드 하나만 켜진 밤, 주변은 어둑함",
        "블라인드 사이로 들어온 낮 빛이 책상에 줄무늬로 떨어짐"
      ],
      "en": [
        "afternoon window light mixed with monitor glow",
        "night with only the desk lamp on, the surroundings dim",
        "daylight through blinds striping the desk"
      ]
    },
    "moments": {
      "ko": [
        "작업하다 잠깐 자리를 비운 듯 머그와 메모지가 놓인 순간",
        "케이블이 느슨하게 늘어진 채 일하던 흔적이 남은 순간",
        "의자가 살짝 빠져 있고 책이 펼쳐진 채인 순간"
      ],
      "en": [
        "a mug and sticky notes left as if someone just stepped away",
        "cables hanging loosely, traces of work in progress",
        "the chair pushed back a little, a book left open"
      ]
    }
  },
  "kitchen": {
    "place": {
      "ko": "집 주방 조리대",
      "en": "on a home kitchen counter"
    },
    "lights": {
      "ko": [
        "싱크대 위 창으로 들어오는 아침 자연광만으로 촬영",
        "주방 형광등과 거실 쪽 따뜻한 빛이 섞임",
        "해질 무렵 낮게 든 빛이 조리대 한쪽에만 걸림"
      ],
      "en": [
        "lit only by morning light through the window above the sink",
        "kitchen fluorescents mixed with warm light from the living room",
        "low evening light catching only one end of the counter"
      ]
    },
    "moments": {
      "ko": [
        "아침을 차리다 만 듯 도마와 컵이 놓인 순간",
        "설거지 후 물기가 남은 그릇이 건조대에 기대 있는 순간",
        "장 본 봉투를 막 내려놓은 조리대"
      ],
      "en": [
        "breakfast half-prepared, a cutting board and a cup out",
        "washed dishes still wet, leaning in the drying rack",
        "a counter where grocery bags were just set down"
      ]
    }
  },
  "living": {
    "place": {
      "ko": "거실",
      "en": "in a living room"
    },
    "lights": {
      "ko": [
        "큰 창으로 들어오는 오후 자연광만으로 촬영",
        "해가 진 뒤 스탠드 조명 하나와 TV 빛이 섞임",
        "커튼을 반쯤 친 창으로 들어온 빛이 바닥에 길게 떨어짐"
      ],
      "en": [
        "lit only by afternoon light from a large window",
        "after sunset, one floor lamp mixed with the glow of a TV",
        "light through half-drawn curtains stretching across the floor"
      ]
    },
    "moments": {
      "ko": [
        "쿠션이 한쪽으로 밀리고 담요가 소파에 걸쳐진 순간",
        "리모컨과 컵이 테이블에 아무렇게나 놓인 순간",
        "청소를 막 끝내고 창을 열어 둔 거실"
      ],
      "en": [
        "cushions pushed to one side, a throw draped over the sofa",
        "a remote and a cup left carelessly on the table",
        "a living room just cleaned, the window left open"
      ]
    }
  },
  "outdoor-gear": {
    "place": {
      "ko": "야외 활동 장소",
      "en": "at an outdoor activity spot"
    },
    "lights": {
      "ko": [
        "구름 낀 날의 평평한 자연광",
        "나뭇잎 사이로 새는 햇빛이 바닥에 얼룩덜룩하게 떨어짐",
        "낮은 해가 옆에서 들어와 그림자가 길게 늘어짐"
      ],
      "en": [
        "flat natural light on an overcast day",
        "dappled sunlight through leaves falling unevenly on the ground",
        "low sun from the side, shadows stretching long"
      ]
    },
    "moments": {
      "ko": [
        "잠깐 쉬려고 장비를 벤치에 내려놓은 순간",
        "운동을 마치고 물병과 수건을 옆에 둔 순간",
        "캠핑 의자에 겉옷을 걸쳐 둔 채 자리를 비운 순간"
      ],
      "en": [
        "gear just set down on a bench for a short break",
        "a water bottle and towel left beside, the workout just over",
        "a jacket hung on a camping chair, its owner stepped away"
      ]
    }
  },
  "kids-room": {
    "place": {
      "ko": "아이방",
      "en": "in a child's room"
    },
    "lights": {
      "ko": [
        "커튼 사이로 들어오는 오전 자연광만으로 촬영",
        "수면등 하나만 켜진 저녁, 주변은 어둑함",
        "창가 빛이 바닥 매트에 반사돼 방이 부드럽게 밝음"
      ],
      "en": [
        "lit only by morning light through a gap in the curtains",
        "evening with only a night light on, the room dim",
        "window light bouncing off the floor mat, the room softly bright"
      ]
    },
    "moments": {
      "ko": [
        "장난감이 매트 위에 흩어진 채 놀다 만 순간",
        "개어 둔 작은 옷이 침대 끝에 쌓인 순간",
        "그림책이 펼쳐진 채 바닥에 놓인 순간"
      ],
      "en": [
        "toys scattered over the mat, play just interrupted",
        "small folded clothes stacked at the foot of the bed",
        "a picture book left open on the floor"
      ]
    }
  },
  "street-day": {
    "place": {
      "ko": "여행지 골목",
      "en": "on a street in a travel destination"
    },
    "lights": {
      "ko": [
        "한낮의 햇빛이 건물 한쪽 벽에만 떨어짐",
        "구름 낀 날의 평평한 자연광",
        "늦은 오후 낮게 든 빛이 골목 바닥에 길게 깔림"
      ],
      "en": [
        "midday sun landing on only one side of the buildings",
        "flat natural light on an overcast day",
        "low late-afternoon light stretching along the street"
      ]
    },
    "moments": {
      "ko": [
        "걷다가 골목 안쪽을 돌아본 시점",
        "상점 차양 아래로 행인이 멀리 지나가는 순간",
        "계단 위에서 내려다본 골목"
      ],
      "en": [
        "a glance back down the alley mid-walk",
        "a passer-by far off under a shop awning",
        "the alley seen from the top of a flight of steps"
      ]
    }
  },
  "harbor": {
    "place": {
      "ko": "항구",
      "en": "at a harbor"
    },
    "lights": {
      "ko": [
        "바다에 반사된 아침 빛이 부두를 밝힘",
        "흐린 날 바다 쪽에서 오는 평평한 빛",
        "해질 무렵 역광으로 배의 윤곽만 도드라짐"
      ],
      "en": [
        "morning light reflected off the water brightening the pier",
        "flat light from the sea on an overcast day",
        "evening backlight picking out only the outlines of the boats"
      ]
    },
    "moments": {
      "ko": [
        "배가 막 들어와 밧줄을 묶는 부두",
        "선착장 난간 너머로 바다를 본 시점",
        "대합실 창밖으로 배가 보이는 순간"
      ],
      "en": [
        "a boat just in, ropes being tied at the pier",
        "looking out over the railing of the ferry dock",
        "a boat seen through the terminal window"
      ]
    }
  },
  "beach": {
    "place": {
      "ko": "해변",
      "en": "on a beach"
    },
    "lights": {
      "ko": [
        "한낮 햇빛이 모래와 물에 강하게 반사됨",
        "구름이 해를 가려 바다 색이 차분해진 빛",
        "해질 무렵 낮은 해가 수평선 가까이 걸림"
      ],
      "en": [
        "midday sun bouncing hard off sand and water",
        "clouds covering the sun, the sea a calmer color",
        "a low evening sun hanging near the horizon"
      ]
    },
    "moments": {
      "ko": [
        "파도가 막 빠져나가 모래가 젖어 있는 순간",
        "해변 끝에서 해안선을 따라 본 시점",
        "파라솔 그늘 아래에서 바다를 본 시점"
      ],
      "en": [
        "a wave just receding, the sand still wet",
        "the shoreline seen from one end of the beach",
        "the sea seen from the shade of a parasol"
      ]
    }
  },
  "temple": {
    "place": {
      "ko": "사원·유적",
      "en": "at a temple or heritage site"
    },
    "lights": {
      "ko": [
        "오전 햇빛이 지붕 처마 아래로 그림자를 떨어뜨림",
        "흐린 날의 부드러운 빛, 목재와 돌의 색이 차분함",
        "늦은 오후 빛이 기둥 사이로 비스듬히 들어옴"
      ],
      "en": [
        "morning sun casting shadows under the eaves",
        "soft overcast light, wood and stone in muted tones",
        "late-afternoon light slanting between the columns"
      ]
    },
    "moments": {
      "ko": [
        "입구 계단 아래에서 올려다본 시점",
        "회랑 끝에서 안쪽을 본 시점",
        "관람객이 멀리 작게 지나가는 마당"
      ],
      "en": [
        "looking up from the foot of the entrance steps",
        "looking in from the end of a corridor",
        "a courtyard with visitors passing small in the distance"
      ]
    }
  },
  "market": {
    "place": {
      "ko": "현지 시장",
      "en": "at a local market"
    },
    "lights": {
      "ko": [
        "천막 사이로 새는 햇빛과 가게 조명이 섞임",
        "지붕 덮인 시장 안의 형광등 빛",
        "해가 진 뒤 노점 전구 빛만으로 촬영"
      ],
      "en": [
        "sunlight leaking between awnings mixed with stall lights",
        "fluorescent light inside a covered market",
        "after dark, lit only by the stalls' bulbs"
      ]
    },
    "moments": {
      "ko": [
        "좌판 위 식재료가 수북이 쌓인 순간",
        "통로를 따라 가게들이 이어진 시점",
        "음식이 막 나온 노점 앞"
      ],
      "en": [
        "produce piled high on a stall",
        "stalls lined up along the aisle",
        "in front of a stall just as food comes out"
      ]
    }
  },
  "night-city": {
    "place": {
      "ko": "밤의 여행지 거리",
      "en": "on a city street at night"
    },
    "lights": {
      "ko": [
        "가로등과 상점 불빛이 섞인 잡광만으로 촬영",
        "해가 막 진 뒤 푸른 하늘빛과 노란 조명이 섞임",
        "강변 조명이 물에 비쳐 흔들림"
      ],
      "en": [
        "mixed light from street lamps and shops, nothing else",
        "blue post-sunset sky mixing with warm lights",
        "riverside lights reflected and wavering on the water"
      ]
    },
    "moments": {
      "ko": [
        "야경을 보려고 멈춰 선 다리 위",
        "골목 입구에서 불 켜진 거리를 본 시점",
        "행인이 멀리 작게 지나가는 광장"
      ],
      "en": [
        "stopped on a bridge to take in the night view",
        "looking down a lit street from its entrance",
        "a square with passers-by small in the distance"
      ]
    }
  },
  "hotel-room": {
    "place": {
      "ko": "호텔 객실",
      "en": "in a hotel room"
    },
    "lights": {
      "ko": [
        "커튼을 연 창으로 들어오는 아침 자연광만으로 촬영",
        "침대 옆 스탠드와 복도 조명이 섞인 저녁",
        "창밖 도시 불빛과 방 안 조명 하나"
      ],
      "en": [
        "lit only by morning light through opened curtains",
        "evening with the bedside lamp and entry light mixed",
        "city light through the window plus one lamp in the room"
      ]
    },
    "moments": {
      "ko": [
        "체크인 직후 캐리어를 막 열어 둔 순간",
        "이불이 조금 흐트러진 아침 침대",
        "창가 의자에서 바깥 풍경을 본 시점"
      ],
      "en": [
        "just after check-in, a suitcase freshly opened",
        "a morning bed with the covers a little rumpled",
        "the view seen from the chair by the window"
      ]
    }
  },
  "transit": {
    "place": {
      "ko": "여행 중 이동 구간",
      "en": "on the way during a trip"
    },
    "lights": {
      "ko": [
        "차창으로 들어오는 낮 빛만으로 촬영",
        "공항 터미널의 넓은 창으로 드는 평평한 빛",
        "해질 무렵 차창 밖이 주황빛으로 물듦"
      ],
      "en": [
        "lit only by daylight through the vehicle window",
        "flat light through the wide windows of an airport terminal",
        "evening sky turning orange outside the window"
      ]
    },
    "moments": {
      "ko": [
        "차창 밖으로 풍경이 지나가는 순간",
        "탑승 게이트 앞 창밖으로 비행기가 보이는 순간",
        "역 승강장에 열차가 들어오는 순간"
      ],
      "en": [
        "scenery sliding past the window",
        "a plane visible through the window at the gate",
        "a train pulling into the station platform"
      ]
    }
  }
});

export const PHOTOREAL_SCENES: Record<string, PhotorealScene> = { ...ORIGINAL_SCENES, ...BLOG_SCENES };

export type PhotorealSceneKey = keyof typeof PHOTOREAL_SCENES;
