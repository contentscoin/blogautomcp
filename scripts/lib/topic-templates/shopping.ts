import type { ShoppingTopicTemplateId, TopicSectionOverlay, TopicTemplate } from "./types";

type SectionMap = Record<string, TopicSectionOverlay>;

/** 쇼핑 계약 섹션 순서. 렌더 계약(SHOPPING_POST_CONTRACT_V1)의 ID와 같다. */
export const SHOPPING_SECTION_ORDER = [
  "shopping-hook",
  "shopping-summary",
  "shopping-package",
  "shopping-design",
  "shopping-feature-1",
  "shopping-feature-2",
  "shopping-feature-3",
  "shopping-scale",
  "shopping-pros-cautions",
  "shopping-fit",
  "shopping-verdict",
] as const;

const NO_FAKE_TEXT = "화면·라벨에 없는 글자나 로고를 새로 만들지 않기";

/** 모든 쇼핑 유형이 공유하는 기본 흐름. 유형별 템플릿은 필요한 섹션만 덮어쓴다. */
const BASE: SectionMap = {
  "shopping-hook": {
    headingHint: "{상품명} 한눈에 보기",
    purpose: "무엇인지·누구에게 맞는지·핵심 조건을 3줄로 먼저 정리한다(AI 요약이 그대로 인용할 수 있는 형태).",
    imageIntent: "제품 전체가 보이는 대표 연출컷",
    imageSource: "staged-ai",
    promptRecipe: `제품이 화면 중앙 1/3을 차지하는 밝은 자연광 생활 장면, 배경은 단순하게, ${NO_FAKE_TEXT}`,
    format: "prose",
  },
  "shopping-summary": {
    headingHint: "어떤 제품인지부터",
    purpose: "제품 정체와 구성, 같은 카테고리 일반 제품과 다른 점을 소개한다.",
    imageIntent: "전체 구성 또는 패키지 원본 사진",
    imageSource: "seller-original",
  },
  "shopping-package": {
    headingHint: "핵심 기능이 실제로 만드는 차이",
    purpose: "가장 중요한 기능이 어떤 구조로 작동하고 무엇이 편해지는지 설명한다.",
    imageIntent: "핵심 기능·작동 방식을 설명하는 상세페이지 근거 구간",
    imageSource: "seller-crop",
  },
  "shopping-design": {
    headingHint: "이 제품만의 특장점",
    purpose: "다른 제품과 갈리는 특장점을 사용 장면과 연결한다.",
    imageIntent: "특장점을 설명하는 상세페이지 근거 구간",
    imageSource: "seller-crop",
  },
  "shopping-feature-1": {
    headingHint: "직접 써보며 확인한 사용감",
    purpose: "실제 사용 장면에서 체감되는 점을 쓴다. 체험 메모가 없으면 사양에서 이어지는 사용 조건으로 쓴다.",
    imageIntent: "실제 사용 장면 연출컷",
    imageSource: "staged-ai",
    promptRecipe: `제품을 실제로 쓰는 순간의 생활 공간, 손이나 사용 흔적은 자연스럽게, ${NO_FAKE_TEXT}`,
    experienceSlot: true,
  },
  "shopping-feature-2": {
    headingHint: "처음부터 제대로 쓰는 방법",
    purpose: "개봉·설치·조작·관리 순서를 단계로 설명한다.",
    imageIntent: "사용법·조작부를 설명하는 상세페이지 근거 구간",
    imageSource: "seller-crop",
    format: "checklist",
  },
  "shopping-feature-3": {
    headingHint: "구매후기에서 반복된 좋은 점",
    purpose: "실제 구매후기 근거가 있을 때만 반복되는 장점을 정리한다. 근거가 없으면 이 섹션을 생략한다.",
    imageIntent: "생활 속 사용 장면 연출컷",
    imageSource: "staged-ai",
    promptRecipe: `제품이 놓인 일상 공간의 다른 각도, 대표컷과 다른 구도, ${NO_FAKE_TEXT}`,
  },
  "shopping-scale": {
    headingHint: "비슷한 제품과 갈리는 기준",
    purpose: "스펙·크기·옵션을 항목별 세로 목록으로 비교 기준과 함께 정리한다(표 이미지 대신 텍스트).",
    imageIntent: "크기·스펙표 상세페이지 근거 구간",
    imageSource: "seller-crop",
    format: "facts-list",
  },
  "shopping-pros-cautions": {
    headingHint: "아쉬운 점과 확인할 점",
    purpose: "구조상 한계와 구매 전 확인할 조건을 솔직하게 쓴다.",
    imageIntent: "옵션·주의사항 상세페이지 근거 구간",
    imageSource: "seller-crop",
    experienceSlot: true,
  },
  "shopping-fit": {
    headingHint: "이런 분께 잘 맞아요",
    purpose: "추천 대상과 맞지 않는 대상을 조건으로 나눠 쓴다.",
    imageIntent: "추천 사용 환경 연출컷",
    imageSource: "staged-ai",
    promptRecipe: `추천 대상이 쓰는 공간 분위기, 제품은 작게라도 분명히 보이게, ${NO_FAKE_TEXT}`,
  },
  "shopping-verdict": {
    headingHint: "종합 후기",
    purpose: "기능·사용성·한계를 종합한 조건부 결론과 FAQ(근거 있는 질문 최대 3쌍)로 마무리한다.",
    imageIntent: "제품 대표 원본 사진",
    imageSource: "seller-original",
    format: "qa",
    experienceSlot: true,
  },
};

function template(
  id: ShoppingTopicTemplateId,
  spec: Omit<TopicTemplate, "id" | "kind" | "sections"> & { sections?: SectionMap },
): TopicTemplate {
  const merged: SectionMap = { ...BASE, ...(spec.sections || {}) };
  return {
    ...spec,
    id,
    kind: "SHOPPING",
    sections: SHOPPING_SECTION_ORDER.map((sectionId) => [sectionId, merged[sectionId]!] as const),
  };
}

export const SHOPPING_TOPIC_TEMPLATES: Record<ShoppingTopicTemplateId, TopicTemplate> = {
  digital_it: template("digital_it", {
    label: "디지털·IT (스펙형)",
    readerIntent: "사양이 내 사용 환경에서 어떤 차이를 만드는지, 호환성과 설정 방법",
    keywords: ["노트북", "태블릿", "충전기", "케이블", "모니터", "이어폰", "헤드폰", "스마트워치", "키보드", "마우스", "스피커", "보조배터리", "허브", "SSD", "USB", "블루투스", "스마트폰", "웹캠", "공유기"],
    editorialTemplateId: "shopping-detail",
    sections: {
      "shopping-summary": { ...BASE["shopping-summary"]!, headingHint: "개봉하면 들어 있는 것", purpose: "구성품과 첫 설정에 필요한 것을 정리한다." },
      "shopping-package": { ...BASE["shopping-package"]!, headingHint: "핵심 스펙이 체감되는 지점", purpose: "숫자 스펙(속도·용량·배터리·해상도)이 실제 작업에서 어떤 차이인지 해석한다." },
      "shopping-feature-1": { ...BASE["shopping-feature-1"]!, headingHint: "책상 위에서 써본 사용감", promptRecipe: `정돈된 책상이나 작업 공간, 화면·케이블 연결이 자연스러운 구도, ${NO_FAKE_TEXT}` },
      "shopping-feature-2": { ...BASE["shopping-feature-2"]!, headingHint: "연결·설정 순서", purpose: "페어링·연결·앱 설정 순서와 호환 기기 조건을 단계로 쓴다." },
      "shopping-scale": { ...BASE["shopping-scale"]!, headingHint: "핵심 사양 정리" },
    },
    titleFormulas: ["{키워드} {상품명} 사용 후기 | 스펙과 실사용 차이", "{상품명} 후기, {키워드} 고를 때 확인한 사양"],
    faqSeeds: ["어떤 기기와 호환되나요?", "배터리(또는 성능)는 실제로 어느 정도인가요?", "설정은 어렵지 않나요?"],
    researchFocus: ["호환 기기·규격", "배터리·성능 수치의 측정 조건", "펌웨어·앱 지원"],
    primaryKeywordSuffix: "후기",
  }),
  home_appliance: template("home_appliance", {
    label: "가전 (설치·사용형)",
    readerIntent: "우리 집 공간과 생활 패턴에 맞는지, 소음·전력·관리 부담",
    keywords: ["청소기", "로봇청소기", "드라이기", "선풍기", "서큘레이터", "에어컨", "냉장고", "세탁기", "건조기", "공기청정기", "제습기", "가습기", "전기포트", "에어프라이어", "밥솥", "믹서기", "블렌더", "커피머신", "식기세척기", "전자레인지", "오븐", "가전", "주방가전", "히터", "전기장판", "트리머", "면도기", "고데기", "미용가전"],
    editorialTemplateId: "shopping-detail",
    sections: {
      "shopping-summary": { ...BASE["shopping-summary"]!, headingHint: "크기와 구성부터", purpose: "본체 크기·무게·구성품과 놓을 자리를 정리한다." },
      "shopping-feature-1": { ...BASE["shopping-feature-1"]!, headingHint: "집에서 돌려본 사용감", purpose: "소음·바람/흡입 세기·조작감 같은 체감 요소를 쓴다.", promptRecipe: `실제 거실·주방 같은 생활 공간에 제품이 놓인 장면, 제품 전면이 보이게, ${NO_FAKE_TEXT}` },
      "shopping-feature-2": { ...BASE["shopping-feature-2"]!, headingHint: "설치부터 세척까지", purpose: "설치·조작·필터 교체·세척 순서를 단계로 쓴다." },
      "shopping-pros-cautions": { ...BASE["shopping-pros-cautions"]!, headingHint: "소음·전력·관리에서 아쉬운 점" },
    },
    titleFormulas: ["{키워드} {상품명} 실사용 후기 | 소음·관리까지", "{상품명} 후기, {키워드} 고르기 전 확인한 점"],
    faqSeeds: ["소음은 어느 정도인가요?", "관리(세척·필터)는 얼마나 자주 해야 하나요?", "원룸에서도 쓰기 괜찮은가요?"],
    researchFocus: ["소비전력·에너지등급", "소음(dB) 표기", "소모품 가격·교체 주기", "A/S 조건"],
    primaryKeywordSuffix: "후기",
  }),
  beauty_body: template("beauty_body", {
    label: "뷰티·바디 (성분·제형형)",
    readerIntent: "내 피부·모발 고민에 맞는 성분과 제형인지, 사용 루틴과 자극 여부",
    keywords: ["뷰티", "화장품", "스킨", "토너", "로션", "에센스", "세럼", "앰플", "크림", "선크림", "클렌징", "마스크팩", "샴푸", "트리트먼트", "헤어", "바디워시", "바디로션", "향수", "립", "쿠션", "파운데이션"],
    editorialTemplateId: "shopping-problem",
    sections: {
      "shopping-summary": { ...BASE["shopping-summary"]!, headingHint: "이런 고민에 쓰는 제품", purpose: "해결하려는 피부·모발 고민과 제품 정체를 연결한다." },
      "shopping-package": { ...BASE["shopping-package"]!, headingHint: "성분에서 확인한 것", purpose: "상세페이지에서 확인된 주요 성분·함량과 그 의미를 설명한다. 효능은 단정하지 않는다.", imageIntent: "성분표·전성분 상세페이지 근거 구간" },
      "shopping-design": { ...BASE["shopping-design"]!, headingHint: "제형과 향", purpose: "제형·향·흡수감을 묘사한다.", imageIntent: "제형 텍스처 클로즈업 연출컷", imageSource: "staged-ai", promptRecipe: `욕실 선반·화장대 위 자연광 클로즈업, 제형 텍스처가 보이는 구도, ${NO_FAKE_TEXT}`, experienceSlot: true },
      "shopping-feature-1": { ...BASE["shopping-feature-1"]!, headingHint: "며칠 써보니 달라진 점", promptRecipe: `아침·저녁 루틴이 떠오르는 화장대나 욕실 장면, ${NO_FAKE_TEXT}` },
      "shopping-feature-2": { ...BASE["shopping-feature-2"]!, headingHint: "사용 순서와 양", purpose: "루틴에서의 사용 순서·양·주기를 단계로 쓴다." },
      "shopping-pros-cautions": { ...BASE["shopping-pros-cautions"]!, headingHint: "피부 타입별 주의할 점", purpose: "민감 피부·알레르기·사용 주의사항을 쓴다." },
    },
    titleFormulas: ["{키워드} {상품명} 사용 후기 | 성분·제형 솔직 리뷰", "{상품명} 후기, {키워드} 찾다가 써본 결과"],
    faqSeeds: ["민감한 피부도 쓸 수 있나요?", "어떤 순서로 바르나요?", "향이 강한가요?"],
    researchFocus: ["전성분·주요 성분 함량", "피부 테스트 완료 여부", "용량·사용 기한"],
    primaryKeywordSuffix: "후기",
  }),
  food_supplement: template("food_supplement", {
    label: "식품·건강식품 (섭취형)",
    readerIntent: "원재료·함량·맛, 먹는 방법과 보관, 섭취 시 주의",
    keywords: ["식품", "건강식품", "영양제", "비타민", "유산균", "프로바이오틱스", "오메가3", "콜라겐", "단백질", "프로틴", "간식", "커피", "녹차", "과자", "밀키트", "견과", "홍삼", "즙", "젤리", "시리얼", "도시락"],
    editorialTemplateId: "shopping-detail",
    sections: {
      "shopping-package": { ...BASE["shopping-package"]!, headingHint: "원재료와 함량", purpose: "원재료·함량·인증을 상세페이지 근거로 정리한다. 효능·치료 효과는 단정하지 않는다.", imageIntent: "원재료·영양정보 상세페이지 근거 구간", format: "facts-list" },
      "shopping-design": { ...BASE["shopping-design"]!, headingHint: "맛과 식감", purpose: "맛·향·식감·먹기 편한 정도를 묘사한다.", imageIntent: "먹는 장면 연출컷", imageSource: "staged-ai", promptRecipe: `식탁·주방의 자연광 장면, 제품 포장이 함께 보이는 구도, ${NO_FAKE_TEXT}`, experienceSlot: true },
      "shopping-feature-2": { ...BASE["shopping-feature-2"]!, headingHint: "먹는 방법과 보관", purpose: "섭취량·시간·조리법·보관 방법을 단계로 쓴다." },
      "shopping-pros-cautions": { ...BASE["shopping-pros-cautions"]!, headingHint: "섭취 전 확인할 점", purpose: "알레르기 유발 성분·섭취 주의·유통기한을 쓴다." },
    },
    titleFormulas: ["{키워드} {상품명} 먹어본 후기 | 함량·맛·먹는 법", "{상품명} 후기, {키워드} 고를 때 본 원재료"],
    faqSeeds: ["하루에 얼마나 먹나요?", "언제 먹는 게 좋나요?", "보관은 어떻게 하나요?"],
    researchFocus: ["원재료·함량", "건강기능식품 인증 여부", "알레르기 유발 성분", "보관 방법"],
    primaryKeywordSuffix: "후기",
  }),
  living_health: template("living_health", {
    label: "생활·건강 (생활 고민 해결형)",
    readerIntent: "생활 속 불편을 어떻게 줄여주는지, 공간과 관리 조건",
    keywords: ["생활", "건강", "욕실", "침구", "베개", "매트리스", "토퍼", "수납", "정리함", "살균", "세정", "청소", "방석", "쿠션", "안마기", "마사지", "주방용품", "텀블러", "밀폐용기", "우산", "보냉백", "쿨러백"],
    editorialTemplateId: "shopping-problem",
    sections: {
      "shopping-summary": { ...BASE["shopping-summary"]!, headingHint: "이런 불편을 줄여주는 제품", purpose: "해결하려는 생활 불편과 제품 정체를 연결한다." },
      "shopping-feature-1": { ...BASE["shopping-feature-1"]!, headingHint: "집에서 써보니", promptRecipe: `정돈된 생활 공간에서 불편이 해결된 순간, ${NO_FAKE_TEXT}` },
    },
    titleFormulas: ["{키워드} {상품명} 사용 후기 | 생활 속 달라진 점", "{상품명} 후기, {키워드} 고민 해결됐을까"],
    faqSeeds: ["어떤 공간에 잘 맞나요?", "세척·관리는 어떻게 하나요?", "크기는 어느 정도인가요?"],
    researchFocus: ["크기·재질", "세척·관리 방법", "사용 공간 조건"],
    primaryKeywordSuffix: "후기",
  }),
  fashion_goods: template("fashion_goods", {
    label: "패션·잡화 (핏·소재형)",
    readerIntent: "사이즈·핏·소재·코디, 세탁과 내구성",
    keywords: ["패션", "의류", "티셔츠", "셔츠", "바지", "반바지", "원피스", "자켓", "점퍼", "니트", "조끼", "가방", "백팩", "신발", "운동화", "슬리퍼", "지갑", "모자", "선글라스", "시계", "양말", "속옷", "레깅스"],
    editorialTemplateId: "shopping-detail",
    sections: {
      "shopping-package": { ...BASE["shopping-package"]!, headingHint: "소재와 마감", purpose: "소재 구성·두께·마감을 설명한다.", imageIntent: "소재·디테일 상세페이지 근거 구간" },
      "shopping-design": { ...BASE["shopping-design"]!, headingHint: "착용 핏과 코디", purpose: "착용 핏과 어울리는 코디를 묘사한다.", imageIntent: "착용·코디 연출컷", imageSource: "staged-ai", promptRecipe: `제품이 잘 보이는 코디 플랫레이 또는 행거 장면, 사람 얼굴 없이, ${NO_FAKE_TEXT}`, experienceSlot: true },
      "shopping-scale": { ...BASE["shopping-scale"]!, headingHint: "사이즈 고르는 기준", purpose: "사이즈표 수치와 사이즈 선택 기준을 항목별로 정리한다.", imageIntent: "사이즈표 상세페이지 근거 구간" },
      "shopping-feature-2": { ...BASE["shopping-feature-2"]!, headingHint: "세탁과 관리", purpose: "세탁·건조·보관 방법을 단계로 쓴다." },
    },
    titleFormulas: ["{키워드} {상품명} 착용 후기 | 사이즈·핏·소재", "{상품명} 후기, {키워드} 사이즈 고민 정리"],
    faqSeeds: ["사이즈는 정사이즈인가요?", "세탁기 사용이 가능한가요?", "비침이나 두께는 어떤가요?"],
    researchFocus: ["사이즈표 수치", "소재 혼용률", "세탁 방법"],
    primaryKeywordSuffix: "후기",
  }),
  baby_pet: template("baby_pet", {
    label: "육아·반려 (안전·소재 우선형)",
    readerIntent: "아이·반려동물에게 안전한 소재인지, 사용 연령·체급과 관리",
    keywords: ["육아", "아기", "유아", "신생아", "기저귀", "젖병", "유모차", "카시트", "아기띠", "이유식", "아기비데", "반려", "강아지", "고양이", "사료", "간식", "펫", "배변", "하네스", "캣타워", "구강", "덴탈"],
    editorialTemplateId: "shopping-detail",
    sections: {
      "shopping-package": { ...BASE["shopping-package"]!, headingHint: "소재와 안전 인증", purpose: "소재·인증·안전 기준을 상세페이지 근거로 정리한다.", imageIntent: "소재·인증 상세페이지 근거 구간" },
      "shopping-feature-1": { ...BASE["shopping-feature-1"]!, headingHint: "실제로 써보니", promptRecipe: `아이방·반려동물 공간의 따뜻한 자연광 장면, 아이·동물 얼굴은 드러나지 않게, ${NO_FAKE_TEXT}` },
      "shopping-scale": { ...BASE["shopping-scale"]!, headingHint: "사용 연령·체급 기준" },
    },
    titleFormulas: ["{키워드} {상품명} 사용 후기 | 소재·안전 확인", "{상품명} 후기, {키워드} 고를 때 본 기준"],
    faqSeeds: ["몇 개월(몇 kg)부터 쓸 수 있나요?", "세척·소독은 어떻게 하나요?", "안전 인증이 있나요?"],
    researchFocus: ["KC 등 안전 인증", "사용 연령·체급", "소재·세척 방법"],
    primaryKeywordSuffix: "후기",
  }),
  sports_leisure: template("sports_leisure", {
    label: "스포츠·레저 (사용 환경형)",
    readerIntent: "운동·야외 환경에서의 성능, 휴대성과 내구성",
    keywords: ["골프", "골프공", "골프채", "스포츠", "운동", "헬스", "요가", "필라테스", "러닝", "등산", "캠핑", "텐트", "낚시", "자전거", "수영", "레저", "라운드", "아웃도어", "배드민턴", "테니스"],
    editorialTemplateId: "shopping-detail",
    sections: {
      "shopping-feature-1": { ...BASE["shopping-feature-1"]!, headingHint: "현장에서 써본 느낌", purpose: "실제 운동·야외 환경에서의 체감 요소를 쓴다.", promptRecipe: `운동장·코스·캠핑장 같은 실제 사용 환경, 제품이 주인공인 구도, ${NO_FAKE_TEXT}` },
      "shopping-fit": { ...BASE["shopping-fit"]!, headingHint: "이런 레벨·환경에 맞아요", promptRecipe: `야외 사용 환경의 넓은 장면, ${NO_FAKE_TEXT}` },
    },
    titleFormulas: ["{키워드} {상품명} 사용 후기 | 현장에서 써본 결과", "{상품명} 후기, {키워드} 고를 때 확인한 점"],
    faqSeeds: ["초보자도 쓰기 쉬운가요?", "휴대하기 편한가요?", "비·땀에 강한가요?"],
    researchFocus: ["무게·크기", "방수·내구 등급", "사용 레벨"],
    primaryKeywordSuffix: "후기",
  }),
  generic_shopping: template("generic_shopping", {
    label: "쇼핑 기본형",
    readerIntent: "제품 정체와 핵심 기능, 사용법과 한계, 맞는 사람",
    keywords: [],
    editorialTemplateId: "shopping-problem",
    titleFormulas: ["{키워드} {상품명} 사용 후기 | 장단점 정리", "{상품명} 후기, {키워드} 고를 때 확인한 점"],
    faqSeeds: ["어떤 분께 맞나요?", "사용법은 어렵지 않나요?", "구매 전 확인할 점은요?"],
    researchFocus: ["구성·규격", "사용·관리 방법"],
    primaryKeywordSuffix: "후기",
  }),
};
