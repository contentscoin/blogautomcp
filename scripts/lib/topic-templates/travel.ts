import type { TopicSectionOverlay, TopicTemplate, TravelTopicTemplateId } from "./types";

type SectionMap = Record<string, TopicSectionOverlay>;

/** 여행 계약 섹션 순서. 렌더 계약(TRAVEL_POST_CONTRACT_V1)의 ID와 같다. */
export const TRAVEL_SECTION_ORDER = [
  "travel-hook",
  "travel-differentiators",
  "travel-highlights",
  "travel-basics",
  "travel-lodging",
  "travel-route",
  "travel-day-1",
  "travel-day-2",
  "travel-day-3",
  "travel-inclusions",
  "travel-preparation",
  "travel-fit",
  "travel-close",
] as const;

/** 여행 생성 컷은 기존 실사풍 여행 에디토리얼 경로를 그대로 쓴다. 장면 의도만 넘긴다. */
const REAL_PHOTO = "실제 여행 사진처럼 자연스러운 실사풍, 과한 보정·가짜 간판 글자 없이";

const BASE: SectionMap = {
  "travel-hook": {
    headingHint: "{여행지} {기간} 한눈에 보기",
    purpose: "어디를·며칠·어떤 방식으로 가는 상품인지, 누구에게 맞는지를 3줄로 먼저 정리한다.",
    imageIntent: "목적지를 대표하는 풍경",
    imageSource: "staged-ai",
    promptRecipe: `${REAL_PHOTO}, 도착한 순간의 대표 풍경을 넓게`,
  },
  "travel-differentiators": {
    headingHint: "알고 가면 더 재밌는 배경",
    purpose: "여행지의 역사·문화·지리 배경을 여행 장면과 연결한다.",
    imageIntent: "코스 성격을 보여주는 대표 풍경",
    imageSource: "staged-ai",
    promptRecipe: `${REAL_PHOTO}, 지역 분위기가 드러나는 거리나 자연`,
  },
  "travel-highlights": {
    headingHint: "꼭 가보는 핵심 코스",
    purpose: "일정에 실제로 포함된 핵심 방문지를 소개한다.",
    imageIntent: "서로 다른 핵심 방문지 원본 사진",
    imageSource: "seller-original",
  },
  "travel-basics": {
    headingHint: "항공·이동 한눈에",
    purpose: "항공편·이동 수단·총 이동 시간을 확인된 값으로 정리한다.",
    imageIntent: "항공·일정 요약이 담긴 상품 상세 구간",
    imageSource: "seller-crop",
    format: "facts-list",
  },
  "travel-lodging": {
    headingHint: "첫 번째 코스에서 꼭 볼 것",
    purpose: "첫 핵심 장소의 볼거리와 동선을 쓰고, 현지 꿀팁 한 줄로 마무리한다.",
    imageIntent: "첫 핵심 장소 풍경",
    imageSource: "staged-ai",
    promptRecipe: `${REAL_PHOTO}, 해당 장소의 대표 구도`,
    format: "tips",
    experienceSlot: true,
  },
  "travel-route": {
    headingHint: "두 번째 코스에서 즐길 것",
    purpose: "두 번째 핵심 장소의 활동을 쓰고, 현지 꿀팁 한 줄로 마무리한다.",
    imageIntent: "두 번째 핵심 장소 풍경",
    imageSource: "staged-ai",
    promptRecipe: `${REAL_PHOTO}, 활동이 느껴지는 장면`,
    format: "tips",
    experienceSlot: true,
  },
  "travel-day-1": {
    headingHint: "1일차 코스와 꿀팁",
    purpose: "원본 일정 순서대로 1일차 동선을 쓰고 '💡 현지 꿀팁' 한 줄을 붙인다.",
    imageIntent: "1일차 방문지 사진",
    imageSource: "seller-original",
    format: "tips",
    experienceSlot: true,
  },
  "travel-day-2": {
    headingHint: "2일차 코스와 꿀팁",
    purpose: "원본 일정 순서대로 2일차 동선을 쓰고 '💡 현지 꿀팁' 한 줄을 붙인다.",
    imageIntent: "2일차 방문지 사진",
    imageSource: "seller-original",
    format: "tips",
    experienceSlot: true,
  },
  "travel-day-3": {
    headingHint: "마지막 날 코스와 꿀팁",
    purpose: "후반 일정과 귀국 동선을 쓰고 '💡 현지 꿀팁' 한 줄을 붙인다. 원본에 없는 일차는 만들지 않는다.",
    imageIntent: "후반 일정 풍경",
    imageSource: "staged-ai",
    promptRecipe: `${REAL_PHOTO}, 여행 후반의 여유로운 장면`,
    format: "tips",
  },
  "travel-inclusions": {
    headingHint: "포함·불포함 정리",
    purpose: "포함 사항·불포함 사항·선택관광·추가 비용을 항목별로 정리한다.",
    imageIntent: "포함·불포함이 적힌 상품 상세 구간",
    imageSource: "seller-crop",
    format: "facts-list",
  },
  "travel-preparation": {
    headingHint: "가기 전에 챙길 여행 꿀팁",
    purpose: "환전·결제, 유심·eSIM, 옷차림·날씨, 입국 서류, 공항 이동을 '▸ 꿀팁:' 체크리스트 3~5줄로 정리한다.",
    imageIntent: "여행 준비물·계절감 장면",
    imageSource: "staged-ai",
    promptRecipe: `${REAL_PHOTO}, 여행 가방과 준비물이 놓인 장면`,
    format: "checklist",
    experienceSlot: true,
  },
  "travel-fit": {
    headingHint: "이런 분께 추천해요",
    purpose: "잘 맞는 여행자(동반자·체력·여행 속도)와 맞지 않는 여행자를 나눠 쓴다.",
    imageIntent: "여행자와 목적지 분위기",
    imageSource: "staged-ai",
    promptRecipe: `${REAL_PHOTO}, 뒷모습 여행자와 풍경`,
  },
  "travel-close": {
    headingHint: "예약 전 체크와 자주 묻는 질문",
    purpose: "예약 전 확인할 조건을 정리하고, 근거 있는 질문 최대 3쌍의 FAQ로 마무리한다.",
    imageIntent: "여행의 여운을 남기는 마지막 풍경",
    imageSource: "staged-ai",
    promptRecipe: `${REAL_PHOTO}, 노을이나 야경 같은 마지막 장면`,
    format: "qa",
  },
};

function template(
  id: TravelTopicTemplateId,
  spec: Omit<TopicTemplate, "id" | "kind" | "sections"> & { sections?: SectionMap },
): TopicTemplate {
  const merged: SectionMap = { ...BASE, ...(spec.sections || {}) };
  return {
    ...spec,
    id,
    kind: "TRAVEL",
    sections: TRAVEL_SECTION_ORDER.map((sectionId) => [sectionId, merged[sectionId]!] as const),
  };
}

const COMMON_TRAVEL_FAQ = ["환전은 얼마나 하면 되나요?", "유심과 eSIM 중 무엇이 편한가요?", "옷차림은 어떻게 준비하나요?"];

export const TRAVEL_TOPIC_TEMPLATES: Record<TravelTopicTemplateId, TopicTemplate> = {
  package_tour: template("package_tour", {
    label: "패키지 여행 (일정·꿀팁형)",
    readerIntent: "일차별 동선이 무리 없는지, 포함·불포함과 실제로 쓸 현지 꿀팁",
    keywords: ["패키지", "일차", "박", "출발확정", "노쇼핑", "노옵션", "가이드", "전일정"],
    editorialTemplateId: "travel-itinerary",
    titleFormulas: ["{여행지} {기간} 패키지 여행 꿀팁 | 일정·포함사항 정리", "{여행지} 패키지 {기간} 후기, 일정별 현지 꿀팁"],
    faqSeeds: ["자유시간은 얼마나 있나요?", "선택관광은 꼭 해야 하나요?", ...COMMON_TRAVEL_FAQ],
    researchFocus: ["일차별 일정·이동 시간", "포함·불포함·선택관광", "시기별 날씨", "공항↔시내 이동", "환전·결제·유심"],
    primaryKeywordSuffix: "패키지",
  }),
  hotel_resort: template("hotel_resort", {
    label: "호텔·리조트 (숙소형)",
    readerIntent: "위치와 동선, 객실·부대시설·조식, 주변 꿀팁",
    keywords: ["호텔", "리조트", "료칸", "숙박권", "스테이", "풀빌라", "객실", "조식", "체크인"],
    editorialTemplateId: "travel-conditions",
    sections: {
      "travel-highlights": { ...BASE["travel-highlights"]!, headingHint: "위치와 주변 동선", purpose: "숙소 위치와 공항·명소까지의 동선을 쓴다." },
      "travel-lodging": { ...BASE["travel-lodging"]!, headingHint: "객실에서 확인한 것", purpose: "객실 타입·크기·뷰·어메니티를 쓴다.", imageIntent: "객실 원본 사진", imageSource: "seller-original" },
      "travel-route": { ...BASE["travel-route"]!, headingHint: "부대시설과 조식", purpose: "수영장·스파·조식 등 부대시설과 이용 팁을 쓴다.", imageIntent: "부대시설 원본 사진", imageSource: "seller-original" },
      "travel-day-1": { ...BASE["travel-day-1"]!, headingHint: "숙소 주변 꿀팁 스폿", purpose: "숙소 근처 식당·산책 코스·편의시설 꿀팁을 쓴다.", imageSource: "staged-ai", promptRecipe: `${REAL_PHOTO}, 숙소 주변 거리 풍경` },
      "travel-inclusions": { ...BASE["travel-inclusions"]!, headingHint: "체크인·요금 조건 정리", purpose: "체크인/아웃 시간, 포함 사항, 추가 요금, 취소 규정을 정리한다." },
    },
    titleFormulas: ["{여행지} {상품명} 숙박 꿀팁 | 객실·조식·위치", "{여행지} 호텔 후기, {상품명} 이용 꿀팁"],
    faqSeeds: ["공항에서 얼마나 걸리나요?", "조식은 포함인가요?", "얼리 체크인이 되나요?"],
    researchFocus: ["위치·교통", "객실·부대시설", "체크인 규정", "취소 규정"],
    primaryKeywordSuffix: "호텔",
  }),
  activity_ticket: template("activity_ticket", {
    label: "투어·티켓 (이용 꿀팁형)",
    readerIntent: "이용 방법과 소요 시간, 줄 서지 않는 꿀팁, 가격 조건",
    keywords: ["입장권", "티켓", "패스", "투어", "액티비티", "체험", "케이블카", "크루즈", "테마파크", "유니버설", "디즈니", "공연", "스노클링", "다이빙"],
    editorialTemplateId: "travel-scenic",
    sections: {
      "travel-highlights": { ...BASE["travel-highlights"]!, headingHint: "이 티켓으로 즐길 수 있는 것", purpose: "포함된 시설·코스·체험을 소개한다." },
      "travel-basics": { ...BASE["travel-basics"]!, headingHint: "이용 방법과 소요 시간", purpose: "교환·입장 방법, 운영 시간, 예상 소요 시간을 정리한다." },
      "travel-lodging": { ...BASE["travel-lodging"]!, headingHint: "줄 안 서는 꿀팁", purpose: "대기 줄이 짧은 시간대·동선 순서 같은 이용 꿀팁을 쓴다." },
      "travel-route": { ...BASE["travel-route"]!, headingHint: "사진 잘 나오는 포인트", purpose: "사진 스폿과 촬영 팁을 쓴다." },
    },
    titleFormulas: ["{여행지} {상품명} 이용 꿀팁 | 가격·소요시간", "{상품명} 후기, {여행지} 가기 전 알아둘 꿀팁"],
    faqSeeds: ["현장 구매보다 저렴한가요?", "소요 시간은 얼마나 걸리나요?", "당일 사용이 가능한가요?"],
    researchFocus: ["운영 시간·휴무", "교환·입장 방법", "소요 시간", "환불 규정"],
    primaryKeywordSuffix: "티켓",
  }),
  airtel_freetour: template("airtel_freetour", {
    label: "에어텔·자유여행 (동선·꿀팁형)",
    readerIntent: "추천 동선과 교통, 맛집·스폿 꿀팁, 준비물",
    keywords: ["에어텔", "자유여행", "항공+호텔", "항공권", "자유일정"],
    editorialTemplateId: "travel-scenic",
    sections: {
      "travel-highlights": { ...BASE["travel-highlights"]!, headingHint: "추천 동선", purpose: "자유 일정에서 무리 없는 추천 동선을 제안한다(원본 상품 조건 범위 안에서)." },
      "travel-basics": { ...BASE["travel-basics"]!, headingHint: "항공·숙소·교통 정리", purpose: "항공편·숙소·현지 교통 수단을 확인된 값으로 정리한다." },
      "travel-day-1": { ...BASE["travel-day-1"]!, headingHint: "맛집·카페 꿀팁", purpose: "지역 음식과 식사 꿀팁을 쓴다.", imageSource: "staged-ai", promptRecipe: `${REAL_PHOTO}, 현지 음식이 놓인 식탁` },
      "travel-day-2": { ...BASE["travel-day-2"]!, headingHint: "쇼핑·야경 꿀팁", purpose: "쇼핑 거리·야경 스폿 꿀팁을 쓴다.", imageSource: "staged-ai", promptRecipe: `${REAL_PHOTO}, 야경이나 쇼핑 거리` },
    },
    titleFormulas: ["{여행지} {기간} 자유여행 꿀팁 | 동선·교통·맛집", "{여행지} 에어텔 후기, {기간} 자유여행 꿀팁"],
    faqSeeds: ["공항에서 시내까지 어떻게 가나요?", "교통 패스가 필요한가요?", ...COMMON_TRAVEL_FAQ],
    researchFocus: ["공항↔시내 교통", "교통 패스", "지역별 동선", "환전·결제·유심"],
    primaryKeywordSuffix: "자유여행",
  }),
  generic_travel: template("generic_travel", {
    label: "여행 기본형",
    readerIntent: "여행지 매력과 동선, 포함 조건, 현지 꿀팁",
    keywords: [],
    editorialTemplateId: "travel-scenic",
    titleFormulas: ["{여행지} {기간} 여행 꿀팁 | 코스·준비물", "{여행지} 여행 후기, {상품명} 꿀팁 정리"],
    faqSeeds: COMMON_TRAVEL_FAQ,
    researchFocus: ["핵심 방문지", "시기별 날씨", "환전·결제·유심"],
    primaryKeywordSuffix: "여행",
  }),
};
