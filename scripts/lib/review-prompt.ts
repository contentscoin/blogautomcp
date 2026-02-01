/**
 * 리뷰 프롬프트 템플릿
 * V5 Phase 11: GPTs 패턴 기반 장소/제품 리뷰 생성
 */

export interface ReviewInput {
    // 장소/제품 정보
    placeName: string;
    address: string;
    phone?: string;
    parking?: string;

    // 사용자 입력
    rawNotes: string;
    titleIdea?: string;
    keywords: string[];
    tips?: string[];

    // 옵션
    category: "place" | "product" | "food" | "travel" | "parenting";
    targetAudience?: string;
    styleProfile?: string;
}

export interface ReviewOutput {
    title: string;
    infoBox: {
        placeName: string;
        address: string;
        phone?: string;
        parking?: string;
        rating?: string;
        features: string[];
    };
    introduction: string;
    sections: Array<{
        emoji: string;
        title: string;
        content: string;
    }>;
    tips: string[];
    recommendation: string[];
    hashtags: string[];
}

/**
 * 카테고리별 이모지 매핑
 */
const CATEGORY_EMOJIS: Record<string, string[]> = {
    place: ["📍", "🏛️", "✨", "📝", "👨‍👩‍👧", "🔖"],
    product: ["📦", "💡", "⭐", "📝", "💁", "🔖"],
    food: ["🍽️", "😋", "🥢", "📝", "👨‍👩‍👧", "🔖"],
    travel: ["✈️", "🗺️", "📸", "📝", "🎒", "🔖"],
    parenting: ["👶", "🎡", "🧸", "📝", "👨‍👩‍👧", "🔖"],
};

/**
 * 리뷰 프롬프트 생성
 */
export function buildReviewPrompt(input: ReviewInput, styleGuide: string = ""): string {
    const emojis = CATEGORY_EMOJIS[input.category] || CATEGORY_EMOJIS.place;

    const categoryGuide = getCategoryGuide(input.category);

    return `당신은 네이버 블로그 상위노출 전문 작가입니다.
${styleGuide}

## 네이버 SEO 최적화 규칙 (필수!)
- 제목: "키워드｜서브키워드 후기" 형식
- 도입부: 첫 2-3줄에 핵심 키워드 자연스럽게 3회 반복
- 본문: 2000자 이상
- 문단: 2-3줄 후 줄바꿈 (가독성)

## 글쓰기 스타일 (반드시 따라주세요!)
- ~요체 사용 (했어요, 더라구요, 같아요)
- 이모지 자연스럽게 배치
- 공감 표현 (ㅎㅎ, ㅋㅋ, 😊)
- 개인적인 경험담 톤

## 출력 구조 (반드시 이 순서로!)

### ${emojis[0]} 장소 기본 정보
\`\`\`
🏷️ 장소명: ${input.placeName}
📍 위치: ${input.address}
${input.phone ? `📞 연락처: ${input.phone}` : ''}
${input.parking ? `🚗 주차: ${input.parking}` : ''}
⭐ 특징: (3가지 키워드)
\`\`\`

### ${emojis[1]} 도입부
- 왜 방문했는지 자연스러운 스토리
- SEO 키워드 포함

### ${emojis[2]} 상세 후기
- 이모지 헤더로 소제목
- 각 항목 2-3줄씩
- 장점 위주 + 솔직한 팁

### ${emojis[3]} TIP 정리
${input.tips?.map(t => `✔️ ${t}`).join('\n') || '✔️ 핵심 팁들을 체크리스트로'}

### ${emojis[4]} 추천 대상
- ✔️ 이런 분들에게 추천해요 형식

### ${emojis[5]} 해시태그
- #키워드 형식으로 15-20개

${categoryGuide}

## 입력 정보

### 장소/제품
- 이름: ${input.placeName}
- 주소: ${input.address}

### 사용자 메모
${input.rawNotes}

### SEO 키워드
${input.keywords.join(", ")}

${input.targetAudience ? `### 타겟 독자\n${input.targetAudience}` : ''}

---

위 정보를 바탕으로 네이버 블로그 상위노출에 최적화된 리뷰 글을 작성해주세요.

JSON으로 반환:
{
  "title": "SEO 최적화된 제목 (키워드｜서브키워드 후기 형식)",
  "infoBox": {
    "placeName": "장소명",
    "address": "주소",
    "phone": "연락처 (있으면)",
    "parking": "주차 정보 (있으면)",
    "features": ["특징1", "특징2", "특징3"]
  },
  "introduction": "도입부 (2-3줄, SEO 키워드 포함)",
  "sections": [
    { "emoji": "이모지", "title": "소제목", "content": "본문 내용" }
  ],
  "tips": ["✔️ 팁1", "✔️ 팁2"],
  "recommendation": ["✔️ 추천 대상1", "✔️ 추천 대상2"],
  "hashtags": ["#해시태그1", "#해시태그2", ...]
}`;
}

/**
 * 카테고리별 가이드
 */
function getCategoryGuide(category: string): string {
    const guides: Record<string, string> = {
        place: `
## 장소 리뷰 가이드
- 위치/접근성 정보 포함
- 시설 상세 설명
- 이용 팁 강조`,

        food: `
## 맛집 리뷰 가이드
- 대표 메뉴 상세 설명
- 가격대 정보 필수
- 웨이팅/예약 팁`,

        travel: `
## 여행 리뷰 가이드
- 코스 추천 포함
- 소요 시간 안내
- 계절별 팁`,

        parenting: `
## 육아 리뷰 가이드
- 연령대 추천 필수
- 안전 정보 포함
- 편의시설 상세`,

        product: `
## 제품 리뷰 가이드
- 사용 후기 솔직하게
- 장단점 균형있게
- 구매 팁 포함`,
    };

    return guides[category] || guides.place;
}

/**
 * 해시태그 자동 생성
 */
export function generateReviewHashtags(input: ReviewInput): string[] {
    const base: string[] = [];

    // 키워드 기반
    input.keywords.forEach(k => {
        base.push(`#${k.replace(/\s/g, '')}`);
    });

    // 장소명
    base.push(`#${input.placeName.replace(/\s/g, '')}`);

    // 카테고리별
    const categoryTags: Record<string, string[]> = {
        place: ["#핫플", "#가볼만한곳", "#추천"],
        food: ["#맛집", "#먹스타그램", "#맛집추천"],
        travel: ["#여행", "#국내여행", "#여행스타그램"],
        parenting: ["#육아", "#아이와가볼만한곳", "#육아맘"],
        product: ["#리뷰", "#솔직후기", "#추천템"],
    };

    base.push(...(categoryTags[input.category] || []));

    // 시즌 태그
    const month = new Date().getMonth() + 1;
    if (month >= 3 && month <= 5) base.push("#봄나들이");
    if (month >= 6 && month <= 8) base.push("#여름휴가");
    if (month >= 9 && month <= 11) base.push("#가을여행");
    if (month === 12 || month <= 2) base.push("#겨울나들이");

    // 중복 제거 및 20개 제한
    return [...new Set(base)].slice(0, 20);
}
