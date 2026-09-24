/**
 * 상품 유형 템플릿 — 커넥트 종류(쇼핑/여행) 안에서 상품 유형별로 글 구조를 미리 고정한다.
 *
 * 렌더 계약(post-composition-contract)의 섹션 ID·이미지 슬롯 개수는 바꾸지 않는다.
 * 이미지 배치·검수·패키지 코드가 섹션 ID에 묶여 있기 때문이다. 템플릿은 같은 ID 위에
 * 제목 방향·목적·근거 규칙·이미지 의도·이미지 출처만 덮어쓰는 오버레이다.
 */

import type { EditorialTemplateId } from "../editorial-templates";

export type TopicConnectKind = "SHOPPING" | "TRAVEL";

export type ShoppingTopicTemplateId =
  | "digital_it"
  | "home_appliance"
  | "beauty_body"
  | "food_supplement"
  | "living_health"
  | "fashion_goods"
  | "baby_pet"
  | "sports_leisure"
  | "generic_shopping";

export type TravelTopicTemplateId =
  | "package_tour"
  | "hotel_resort"
  | "activity_ticket"
  | "airtel_freetour"
  | "generic_travel";

export type TopicTemplateId = ShoppingTopicTemplateId | TravelTopicTemplateId;

/**
 * 섹션 이미지의 출처.
 * - seller-original: 판매·상품 페이지 원본 이미지(구성, 대표 컷)
 * - seller-crop: 상세페이지에서 잘라낸 근거 구간(스펙표, 성분, 사이즈표, 일정표)
 * - staged-ai: 실제 상품 이미지를 잠금 합성한 연출컷(쇼핑) / 실사풍 풍경 생성(여행)
 * - editorial-card: 요약 카드
 * - none: 이미지 없음
 */
export type TopicImageSource = "seller-original" | "seller-crop" | "staged-ai" | "editorial-card" | "none";

export type TopicSectionFormat = "prose" | "facts-list" | "checklist" | "qa" | "tips";

export interface TopicSectionOverlay {
  /** 소제목 방향. 그대로 복사하지 않고 상품에 맞게 바꿔 쓰도록 안내한다. */
  headingHint: string;
  purpose: string;
  evidenceRule?: string;
  imageIntent: string;
  imageSource: TopicImageSource;
  /** staged-ai일 때 배경·장면 연출 지시. 상품 형태는 잠금 합성으로 보존된다. */
  promptRecipe?: string;
  format?: TopicSectionFormat;
  /** 체험 메모가 있을 때 1인칭 체험 문장이 들어갈 자리 */
  experienceSlot?: boolean;
}

export interface TopicTemplate {
  id: TopicTemplateId;
  kind: TopicConnectKind;
  label: string;
  /** 독자가 이 유형의 글에서 얻고 싶은 것 */
  readerIntent: string;
  /** 분류 신호. 상품명 일치는 가중치를 높게 준다. */
  keywords: readonly string[];
  /** 상세 근거가 특정 편집 템플릿을 가리키지 않을 때 쓰는 기본 편집 템플릿 */
  editorialTemplateId: EditorialTemplateId;
  /** 섹션 ID(렌더 계약) → 오버레이. 순서는 글 흐름 순서다. */
  sections: ReadonlyArray<readonly [sectionId: string, overlay: TopicSectionOverlay]>;
  /** SEO 제목 공식. {키워드} {상품명} {여행지} {기간} 자리표시자를 쓴다. */
  titleFormulas: readonly string[];
  /** FAQ·질문형 소제목 후보(근거가 있을 때만 사용) */
  faqSeeds: readonly string[];
  /** 리서치에서 확인할 항목 */
  researchFocus: readonly string[];
  /** 대표 검색어 뒤에 붙일 정보형 접미사 */
  primaryKeywordSuffix: string;
}

export interface TopicTemplateSelection {
  id: TopicTemplateId;
  reason: string;
}
