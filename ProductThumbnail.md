# ProductThumbnail.md - 제품 리뷰용 네이버 블로그 썸네일 생성 단독 지침

이 파일은 브랜드커넥트/쇼핑커넥트 상품 리뷰 포스팅에서 사용할 제품 대표 이미지, 썸네일, 본문 상단 이미지를 만들 때 적용하는 지침이다.

핵심은 단순히 상품 사진 위에 글자를 나중에 얹는 방식이 아니라, 이미지 생성 단계에서 상품 장면, 실제 제품명, 큰 한글 제목, 배지, CTA까지 함께 완성하도록 프롬프팅하는 것이다.

단, 결과물은 실제 이미지 기준으로 QC한다. 제품 형태 왜곡, 한글 오탈자, 잘림, 가짜 글자, 허위 혜택, 플랫 벡터 스타일은 최종 통과하지 않는다.

## 0. 최상위 원칙

제품 썸네일은 한 번에 완성형으로 만든다.

GPT Image 2.0 또는 Codex 이미지 생성 프롬프트 안에 아래 요소를 모두 포함한다.

- 실제 상품 또는 상품과 직접 연결된 실사 장면
- 실제 제품명. `productName`을 임의로 요약하거나 다른 상품명으로 바꾸지 않는다.
- 큰 한글 메인 제목
- 상단 배지
- 하단 CTA
- 흰색 내부 테두리
- 좌우 분할 또는 제품 중심 레이아웃

스마트폰/쇼핑 화면/리뷰 카드 목업은 기본 필수 요소가 아니다.

- 제품 실물과 제품명이 충분히 전달되면 목업을 넣지 않는다.
- 앱, 디지털 서비스, 비교표, 사용법 안내처럼 화면이 꼭 필요한 주제에서만 목업을 넣는다.
- 목업을 넣더라도 제품보다 크게 보이거나 제품명을 밀어내면 실패다.

후처리/후합성은 기본 제작 방식이 아니다.

- 한글 제목을 나중에 얹어서 최종본처럼 보고하지 않는다.
- 선택적으로 사용한 쇼핑 화면 목업을 나중에 붙여놓고 생성본이라고 하지 않는다.
- 허용되는 후처리는 파일명 정리, 포맷 변환, 리사이즈, 압축, 25% 미리보기 생성 정도로 제한한다.
- 예외는 사용자가 명시적으로 "후합성으로 고쳐"라고 지시한 경우뿐이다.

95점 미만은 최종 금지다.

- 제품이 원본과 다르게 보이면 최종 금지.
- 실제 제품명이 빠지거나 다른 이름으로 바뀌면 최종 금지.
- 한글이 틀리면 최종 금지.
- 상품명, 가격, 혜택, CTA가 잘리면 최종 금지.
- 선택적으로 넣은 폰/노트북/쇼핑 화면이 가짜 placeholder처럼 보이면 최종 금지.
- 플랫 벡터, 아이콘 위주, 만화풍이면 최종 금지.
- 제휴 수수료, 커미션율, 내부 운영 정보가 화면에 보이면 최종 금지.

## 1. 적용 범위

이 지침은 아래 작업에 적용한다.

- 브랜드커넥트 상품 리뷰 대표 썸네일
- 쇼핑커넥트 상품 카드가 들어가는 네이버 블로그 본문 상단 이미지
- 상품 비교/추천/구매 전 체크 포스팅 이미지
- 정기 작업에서 자동으로 생성되는 제품 리뷰 썸네일
- Telegram 또는 로그로 전달되는 제품 썸네일 이미지 파일

이 지침은 아래 작업에는 기본 적용하지 않는다.

- 브랜드 로고 디자인
- 순수 캐릭터/일러스트 작업
- 상세페이지 전체 디자인
- 카드뉴스 여러 장 제작
- 사용자가 명시적으로 "정확한 후합성 이미지"를 요청한 경우

## 2. 입력 데이터

자동화는 가능한 경우 아래 값을 수집한 뒤 프롬프트에 반영한다.

| 입력값 | 사용 방식 | 주의 |
|---|---|---|
| productName | 화면에 반드시 들어갈 실제 제품명 | 임의 요약, 카테고리명 대체, 다른 모델명 금지 |
| storeName | 보조 신뢰 요소 | 화면에 꼭 넣을 필요 없음 |
| categoryName | 장면/소품 선택 | 제품 사용 맥락 결정 |
| representativeImagePath | 제품 외형 기준 이미지 | 제품 형태/색상 유지 |
| imageUrls/imagePaths | 제품 이미지 후보 | 첫 번째 고품질 이미지를 우선 |
| price/salePrice | 정확할 때만 화면에 사용 | 불확실하면 가격 문구 금지 |
| discount/coupon/promotion | 소비자 혜택일 때만 사용 | 수수료/커미션 노출 금지 |
| reviewCount/rating | 정확할 때만 사용 | 과장 금지 |
| blogTitle/postTitle | 클릭 카피 후보 | 2~3줄로 압축 |

금지 입력값:

- 제휴 수수료
- 커미션율
- 내부 정산 조건
- 자동화 운영 로그
- 실제 확인되지 않은 최저가, 1위, 완판, 공식 인증 문구

## 2-1. 썸네일용 제품 이미지 선별

썸네일 배경은 반드시 판매페이지에서 가져온 실제 상품 대표 이미지가 우선이다.

우선순위:

1. 판매페이지 상단 상품 갤러리의 대표 이미지
2. `og:image`가 실제 상품컷일 때의 대표 이미지
3. 판매페이지 상품 갤러리의 추가 컷
4. 상세 설명 내 상품 이미지는 본문 보조 이미지로만 사용
5. 후기/리뷰 이미지는 썸네일 원본으로 사용하지 않음

후기/리뷰 이미지는 기본적으로 썸네일 배경으로 쓰지 않는다.

- `checkout.phinf`, `blogfiles`, `postfiles`, `cafefiles`, `review` 계열 이미지는 썸네일 대표 후보에서 낮은 점수로 본다.
- 후기 이미지가 크더라도 판매페이지 대표 상품 이미지보다 앞에 오면 안 된다.
- 판매페이지 대표 상품 이미지를 확정하지 못하면 썸네일 생성을 건너뛴다.
- 썸네일 원본을 임의 생성 이미지, 후기 이미지, 상세 하단 이미지로 대체하지 않는다.

현재 자동화는 `scripts/lib/product-image-selection.ts`에서 이미지 URL, DOM 위치, 이미지 크기, 비율, class/alt 문맥을 점수화한다.

- `shop-phinf.pstatic.net`, `shopping-phinf.pstatic.net` 등 판매페이지 상품 이미지를 우선한다.
- 페이지 상단에 있고 정사각형/상품 갤러리 문맥인 이미지를 우선한다.
- 후기/상세/배너/쿠폰/아이콘성 이미지는 감점한다.
- 썸네일 생성에는 판매페이지 상품 이미지로 검증된 `representativeImagePath`만 넣는다.
- 제품 이미지를 작은 카드나 프레임 안에 가두지 않는다. 상품이 썸네일 상단/중앙의 주인공으로 크게 보여야 한다.
- 제품명, 배지, CTA는 상품 본체를 가리지 않는 안전 영역에만 배치한다.

## 3. 목표 결과물

제품 썸네일은 아래 성격을 유지한다.

완성형 제품 썸네일 = 실제 상품 중심 장면 + 정확한 제품명 + 큰 한글 제목 + 짧은 배지 + CTA + 95점 이상 QC

필수 조건:

- 모바일 목록에서 1초 안에 어떤 제품인지 읽힌다.
- 제품이 화면의 주인공으로 보인다.
- 실제 제품명이 보이고 정확하다.
- 핵심 구매 포인트가 크고 강하다.
- 배지와 CTA가 짧고 명확하다.
- 쇼핑 화면 목업은 필요할 때만 넣고, 있다면 상품명, 리뷰/조건, CTA 버튼까지 들어간다.
- 실제 상품과 전혀 다른 형태, 색상, 재질로 생성하지 않는다.
- 수수료/커미션 정보는 이미지에 절대 넣지 않는다.

## 4. 기본 레이아웃

대부분의 제품 썸네일은 아래 둘 중 하나를 기본값으로 한다.

### A. 좌측 카피 + 우측 제품 실사

| 영역 | 비율 | 기준 |
|---|---:|---|
| 좌측 텍스트 패널 | 40~46% | 짙은 네이비/블랙, 큰 한글 제목 |
| 우측 제품 실사 장면 | 54~60% | 제품, 손, 사용 장소, 패키지, 소품 |
| 상단 배지 | 8~13% 높이 | 추천, 구매 전 필독, 오늘 체크 |
| 하단 CTA | 8~14% 높이 | 리뷰 보기, 조건 확인, 구매 전 체크 |
| 내부 테두리 | 전체 | 흰색 라운드 테두리, 안전 여백 |

### B. 중앙 제품 히어로 + 하단 CTA

| 영역 | 기준 |
|---|---|
| 중앙 | 제품을 크게 배치, 배경은 사용 맥락 실사 |
| 좌상단/우상단 | 짧은 배지 1~2개 |
| 하단 | 노랑/빨강/검정 CTA 바 |
| 배경 | 실제 사용 장소, 테이블, 손, 생활 소품 |

기본 색상:

- 배경 패널: 네이비/블랙/딥그레이
- 메인 글자: 흰색 + 노랑 강조
- 배지: 빨강 + 흰색 글자
- CTA: 노랑/빨강/검정 조합
- 외곽선/그림자: 검정 강하게

## 5. 제품 카테고리별 장면 매핑

| 카테고리 | 실사 장면 | 필수 소품 | 선택 목업 |
|---|---|---|---|
| 가전 | 주방, 거실, 책상, 세탁실 | 콘센트, 손, 제품 패키지, 사용 중 장면 | 필요 시 핵심 기능 카드 |
| 디지털 | 책상, 재택근무, 카페, 게임/작업 환경 | 노트북, 케이블, 키보드, 제품 액세서리 | 필요 시 스펙 카드 |
| 생활/건강 | 욕실, 현관, 침실, 정리된 집 | 수납, 타월, 손, 체크리스트 | 필요 시 사용 전 체크 카드 |
| 뷰티 | 화장대, 욕실 거울, 손에 든 제품 | 거울, 브러시, 패키지, 피부/헤어 소품 | 필요 시 성분/사용법 카드 |
| 식품 | 식탁, 주방, 플레이팅 | 접시, 컵, 패키지, 조리 도구 | 필요 시 구성/용량 카드 |
| 육아/반려 | 거실, 놀이 공간, 산책/돌봄 장면 | 장난감, 매트, 가방, 케어 용품 | 필요 시 안전/사용 팁 카드 |
| 스포츠/레저 | 야외, 운동 공간, 캠핑/골프 장면 | 가방, 장비, 신발, 물병 | 필요 시 장점 비교 카드 |
| 패션/잡화 | 옷장, 외출 준비, 착용 디테일 | 옷걸이, 가방, 신발, 거울 | 필요 시 사이즈/코디 카드 |

## 6. 카피 생성 규칙

### 6-1. 메인 제목

- 실제 `productName`은 메인 제목 또는 별도 제품명 라벨로 정확히 들어가야 한다.
- 제품명이 길어도 카테고리명으로 대체하지 않는다.
- 너무 긴 제품명은 `제품명 라벨`에는 원문 핵심 모델명까지 유지하고, 메인 제목은 구매 포인트로 나눠 쓴다.
- 2~5단어
- 최대 3줄
- 각 줄은 2~8자 수준을 우선
- 메인 제목은 제품명 + 구매 포인트로 구성
- 긴 문장 금지

좋은 예:

- 다이슨 V12
- 흡입력 체크
- 구매 전 확인

- 샤오미 G20
- 오늘 추천
- 실사용 포인트

- 스탠리 텀블러
- 수납력 체크
- 후기 확인

나쁜 예:

- 이 제품은 가격도 괜찮고 디자인도 좋아서 구매하기 전에 꼭 확인하면 좋은 추천 상품입니다
- 실제 상품명이 빠진 "무선청소기 추천"
- 제품명을 "생활가전" 같은 카테고리명으로 대체
- 수수료 높은 추천 제품
- 커미션 좋은 상품

### 6-2. 배지 문구

배지는 짧게 쓴다.

- 오늘 추천
- 구매 전 필독
- 실사용 체크
- 리뷰 포인트
- 인기상품
- 구성 확인
- 옵션 확인
- 여름 필수
- 집들이 추천

### 6-3. CTA 문구

CTA는 행동 중심이어야 한다.

- 리뷰 보기
- 구매 전 체크
- 옵션 확인
- 후기 확인
- 구성 보기
- 장단점 확인
- 실사용 포인트
- 가격 확인

CTA에 쓰면 안 되는 표현:

- 수수료 확인
- 커미션 보기
- 제휴율 보기
- 무조건 최저가
- 1위 확정
- 공식 인증

## 7. 완성형 프롬프트 원칙

### 7-1. 반드시 완성본을 요구한다

프롬프트는 배경 요청이 아니라 완성 썸네일 요청이어야 한다.

반드시 포함할 표현:

```text
Generate ONE finished premium Korean Naver blog product thumbnail image in a single generation.
Everything must be created inside the image: the photorealistic product scene, exact product name text, large Korean headline, badges, CTA, product-focused layout, and border.
Do NOT leave blank text areas. Do NOT rely on later overlay/compositing.
```

### 7-2. 텍스트 정확성 지시

프롬프트에는 정확한 텍스트 목록을 넣는다.

```text
Render ONLY these Korean text strings, exactly as written, with correct spacing and no extra text:
- Product name label: "..."
- Main headline line 1: "..."
- Main headline line 2: "..."
- Main headline line 3: "..."
- Top-left badge: "..."
- Top-right badge: "..."
- Bottom CTA: "..."
- Optional product info card text if used: "..."
```

금지문:

```text
No misspelled Korean. No malformed Hangul. No fake letters. No random extra captions. No cropped text. No English unless explicitly requested. No watermark. No fake logos. No affiliate commission text. No seller-only internal data.
```

### 7-3. 제품 기준 이미지 지시

상품 이미지가 있을 때는 프롬프트에 아래 원칙을 넣는다.

```text
Use the provided product image as the visual reference for the product's shape, color, material, and package impression.
Render the exact product name from productName as visible Korean text in the thumbnail.
Keep the product recognizable and faithful to the reference.
Do not invent a different model, different color, fake logo, or unrelated package.
If exact logo rendering is uncertain, keep the logo area subtle and avoid fabricating brand marks.
```

## 8. 공통 프롬프트 템플릿

아래 템플릿을 제품 썸네일 생성의 기본 골격으로 사용한다.

```text
Generate ONE finished premium Korean Naver blog product thumbnail image in a single generation.
Everything must be created inside the image: the photorealistic product scene, exact product name text, large Korean headline, badges, CTA, product-focused layout, and border.
Do NOT rely on later overlay/compositing.

Product:
- Product name: [상품명]
- Exact visible product name label: [상품명 그대로]
- Category: [카테고리]
- Key selling point: [핵심 포인트]
- Consumer benefit: [확인된 혜택 또는 빈칸]
- Reference product image: use the provided product image as shape/color/material reference.

Audience: Korean Naver blog readers who are considering buying this product.
Goal: make the product instantly understandable and clickable on mobile.

Canvas and layout:
- 16:9 landscape Korean Naver blog thumbnail.
- Thin white rounded inner border.
- Left 42% dark navy/black editorial text panel.
- Right 58% photorealistic product scene: [카테고리별 실제 사용 장면].
- Product must be large, sharp, and recognizable.
- Exact product name label must be visible and correct.
- Do not include a phone, laptop, or shopping screen unless specifically needed.
- Top red badges.
- Bottom yellow/red/black CTA.
- Safe margins around all text.

Visible text must be exactly:
- Product name label: "[상품명 그대로]"
- Main headline line 1: "[짧은 제목 1]"
- Main headline line 2: "[짧은 제목 2]"
- Main headline line 3: "[짧은 제목 3]"
- Badge 1: "[배지 1]"
- Badge 2: "[배지 2]"
- CTA: "[CTA]"
- Optional product info card text if used: "[선택 카드 문구]"

Typography:
- Extra-bold Korean sans-serif.
- Main headline is huge, mobile-readable, white/yellow with thick black stroke and strong shadow.
- Badges and CTA are large, centered, high contrast.
- Keep every Korean character complete and uncropped, especially the product name label.

Photorealistic product scene:
- [구체 장면]
- Include [필수 소품].
- Realistic hands, shadows, reflections, product material, packaging texture.
- Cinematic lighting and depth of field.
- No flat vector illustration, no cheap icons, no cartoon, no abstract background.

Optional product info card:
- Default is no phone, no laptop, and no shopping screen.
- Use a small physical label, product tag, shelf card, or simple info card only when it helps readability.
- If a screen/card is used, it must stay secondary to the product and exact product name.
- Do not show affiliate commission, commission rate, seller-only internal data, or fake platform logos.

Hard negatives:
- No misspelled Korean.
- No malformed Hangul.
- No fake letters.
- No random extra captions.
- No cropped text.
- No unnecessary phone/laptop/shopping screen.
- No blank phone/laptop screen if a device is used.
- No abstract placeholder UI only.
- No flat vector, no icon-only design, no cartoon, no watermark, no fake logo.
- No affiliate commission text.
- No exaggerated claims such as "official", "No.1", "lowest price" unless verified.
```

## 9. 제품 유형별 프롬프트 조각

### 9-1. 가전

```text
Photorealistic home appliance scene in a modern Korean apartment, product placed prominently on a clean table or in use, natural window light, realistic hands operating the product, package and accessories visible, premium review thumbnail mood.
Optional info card text: "기능 체크", "후기 요약", "구매 전 확인"
```

### 9-2. 디지털/IT

```text
Photorealistic desk setup with the product as the hero object, realistic cable/accessory details, soft studio lighting, sharp material texture, premium tech review mood. Do not add a phone screen unless the product itself is a phone or app-connected device.
Optional info card text: "스펙 비교", "리뷰 포인트", "옵션 확인"
```

### 9-3. 생활/건강

```text
Photorealistic everyday home scene, product used naturally in bathroom, bedroom, kitchen, or entryway, clean organized lifestyle mood, hands demonstrating use, realistic package texture.
Optional info card text: "사용 포인트", "구성 확인", "후기 확인"
```

### 9-4. 뷰티

```text
Photorealistic vanity or bathroom mirror scene, product and package in foreground, soft clean lighting, realistic hand holding product, premium beauty review mood, no exaggerated skin transformation.
Optional info card text: "사용법", "성분 체크", "리뷰 요약"
```

### 9-5. 식품

```text
Photorealistic kitchen or dining table scene, package and prepared serving visible, realistic food texture, clean appetizing lighting, product label area subtle and not fabricated.
Optional info card text: "구성 확인", "맛 포인트", "후기 보기"
```

### 9-6. 스포츠/레저

```text
Photorealistic outdoor or activity scene, product in real use, gear and environment visible, dynamic but clean composition, product remains sharp and recognizable.
Optional info card text: "사용감 체크", "옵션 확인", "후기 보기"
```

## 10. QC 기준

### 10-1. 점수표

| 항목 | 배점 | 통과 기준 |
|---|---:|---|
| 제품명 정확성 | 25 | 실제 `productName`이 빠짐없이 보이고 다른 이름으로 바뀌지 않음 |
| 제품 충실도 | 20 | 원본 상품과 형태/색상/용도가 크게 다르지 않음 |
| 한글 텍스트 정확성 | 15 | 오탈자, 가짜 글자, 잘림 없음 |
| 모바일 가독성 | 15 | 20~25% 축소에서도 제목과 CTA가 읽힘 |
| 포토리얼 제품 장면 | 15 | 실제 사진 같은 손, 공간, 소품, 재질 |
| 레이아웃/위계 | 5 | 제품, 제품명, 제목, 배지, CTA가 명확하게 분리됨 |
| 선택 카드/목업 적절성 | 참고 | 사용한 경우에만 확인. 없다고 감점하지 않음 |
| 과장/금지 정보 차단 | 5 | 수수료/허위혜택/가짜 로고/무근거 1위 문구 없음 |
| 총점 | 100 | 95점 이상만 최종 |

### 10-2. 자동 탈락 조건

아래 중 하나라도 있으면 점수와 무관하게 최종 금지다.

- 제품이 원본과 다른 물건처럼 보임
- 실제 제품명이 빠짐
- 제품명이 다른 모델명, 카테고리명, 일반명으로 바뀜
- 상품명 또는 메인 제목 오탈자
- 배지/CTA 오탈자
- 한글이 깨짐
- 글자가 잘림
- 제품이 너무 작거나 가려짐
- 선택 목업을 넣었는데 빈 화면 또는 막대 placeholder뿐임
- 수수료, 커미션, 내부 정산 문구 노출
- 허위 할인/최저가/공식/1위 문구
- 워터마크 또는 가짜 로고
- 플랫 벡터/아이콘/카툰 스타일

## 11. 실패 시 재생성 루프

1차 생성 후 실제 이미지로 확인한다.

확인 항목:

- 제품이 원본과 유사한가
- 실제 제품명이 정확히 들어갔는가
- 메인 제목 2~3줄이 정확한가
- 배지와 CTA가 정확한가
- 모바일 축소 보기에서 제목과 제품이 보이는가
- 실사 장면이 제품 카테고리와 맞는가
- 선택 카드/목업을 넣었다면 제품보다 산만하지 않고 실제처럼 보이는가
- 수수료/커미션/내부 문구가 없는가

실패 유형별 corrective prompt:

| 실패 유형 | 재생성 지시 |
|---|---|
| 제품 왜곡 | "Make the product more faithful to the provided reference image: same shape, color, material, and package impression." |
| 제품명 누락/변형 | "Render the exact product name label exactly as provided. Do not replace it with a category name or generic product name." |
| 한글 오탈자 | "Korean text must be exactly copied, fewer text strings, larger text, no extra text." |
| 글자 잘림 | "Increase safe margins, keep all text fully inside the white border." |
| 제품이 작음 | "Make the product much larger and sharper as the main hero object." |
| 실사감 부족 | "More photorealistic real-world product scene, camera/lens realism, no vector or cartoon style." |
| 불필요한 폰/목업 | "Remove the phone, laptop, or shopping screen. Focus on the product hero scene and exact product name label." |
| 선택 목업 실패 | "If an info card is used, make it small and secondary, not abstract bars, not a floating fake UI." |
| CTA 약함 | "Larger bottom CTA, high contrast yellow/red/black, mobile-readable." |
| 금지 정보 노출 | "Remove all affiliate commission, commission rate, internal seller data, and unverified claims." |

기본 최대 5회 재생성한다.

5회 안에 95점 이상이 나오지 않으면 QC 보류로 보고하고 최종 이미지라고 말하지 않는다.

## 12. 실제 자동화 반영 및 삽입 규칙

현재 제품 포스팅 자동화는 아래 코드 경로로 이 지침을 적용한다.

- 생성 모듈: `scripts/lib/product-thumbnail.ts`
- 호출 위치: `scripts/simple-agent.ts`의 `STEP2.5 대표 썸네일 생성`
- 기본 처리 방식: 검증된 판매페이지 대표 이미지를 OAuth 기반 ChatGPT/GPT Image 생성 프롬프트에 레퍼런스로 첨부하고, 이 문서의 완성형 프롬프트 규칙에 따라 제품 장면, 정확한 제품명, 메인 문구, 배지, CTA가 한 이미지 안에서 함께 생성되도록 한다.
- Codex imagegen fallback: OAuth/ChatGPT 이미지 생성이 `GPT 상호작용 접근 불가`, 로그인 요구, 이미지 산출물 없음으로 실패하면 Codex 내장 imagegen을 사용한다. 자동화 스크립트는 `PRODUCT_THUMBNAIL_CODEX_IMAGEGEN_PATH`에 지정된 Codex imagegen 결과 파일을 첫 썸네일로 복사해 사용한다. 경로가 비어 있으면 `logs/codex-imagegen-requests/`에 Codex imagegen 요청 MD를 남긴다.
- 후합성 금지: `sharp`로 제품명 라벨, 배지, CTA를 나중에 얹는 방식은 기본 경로가 아니다.
- 예외 처리: `PRODUCT_THUMBNAIL_COMPOSITE_FALLBACK_ENABLED=true`가 명시된 경우에만 후합성 fallback을 허용한다.
- 제품명 기준: DB/스크랩에서 확보한 `product.name`을 `productNameLabel`로 그대로 그린다.
- 목업 기준: 폰, 노트북, 쇼핑 화면 목업은 기본 생성하지 않는다.
- 실패 처리: 판매페이지 대표 이미지를 확정하지 못하거나 썸네일 생성에 실패하면 썸네일은 만들지 않고 포스팅은 본문 이미지 순서로 계속 진행하되, 로그에 실패 사유를 남긴다.

제품 포스팅 자동화에서 썸네일이 생성되면 이미지 우선순위는 아래와 같다.

1. 생성된 제품 썸네일
2. 상품 대표 이미지
3. 상품 본문 이미지
4. 기타 수집 이미지

네이버 블로그 본문에서는 생성된 제품 썸네일을 가장 먼저 넣는다.

쇼핑커넥트 상품 카드는 본문 흐름상 상품 소개 문단 뒤에 넣되, 썸네일 이미지 자체에 쇼핑커넥트 링크나 수수료 정보를 표시하지 않는다.

## 13. 산출물 폴더 구조

권장 구조:

```text
working/10-projects/product-thumbnail/YYYY-MM-DD-[product-slug]/
├─ 01-brief.json
├─ 02-copy-candidates.md
├─ 03-prompts/
│  ├─ prompt-v1.md
│  ├─ prompt-v2-corrective.md
│  └─ prompt-final.md
├─ 04-generated/
│  ├─ candidate-v1.png
│  ├─ candidate-v2.png
│  └─ rejected/
├─ 05-qc/
│  ├─ preview-100.png
│  ├─ preview-25.png
│  └─ QC_REPORT.md
└─ 06-final/
   ├─ final-product-thumbnail.jpg
   └─ source-manifest.json
```

후합성용 파일은 기본 산출물에 포함하지 않는다.

사용자가 후합성을 명시한 예외 작업에서만 `05-composite/`를 별도로 만든다.

## 14. 최종 보고 형식

```markdown
## 제품 썸네일 생성 결과

| 항목 | 결과 |
|---|---|
| 상품명 |  |
| 카테고리 |  |
| 제작 방식 | 판매페이지 상품 이미지 레퍼런스 기반 OAuth ChatGPT/GPT Image single-generation. 실패 시 Codex imagegen 결과 파일 사용 |
| 후합성 여부 | 없음. 명시적 fallback 사용 시에만 별도 표기 |
| 규격 | 자동화 기본 1080x1080 / 생성형 기본 16:9 |
| 메인 문구 |  |
| 배지/CTA |  |
| 선택 카드/목업 | 포함 / 미포함 |
| 제품 충실도 QC | 통과 / 보류 |
| 100% QC | 통과 / 보류 |
| 25% 모바일 QC | 통과 / 보류 |
| 최종 점수 | NN/100 |
| 판정 | 최종 / QC 보류 |
| 제한사항 |  |

MEDIA:/absolute/path/to/final-product-thumbnail.jpg
```

95점 미만이면 아래처럼 보고한다.

```markdown
QC 보류: 최고 점수 NN/100
사유:
- 제품명 누락 / 제품 왜곡 / 한글 오탈자 / 글자 잘림 / 실사감 부족 / 불필요한 목업 / 금지 정보 노출 중 해당 항목

다음 조치:
- corrective prompt로 재생성 필요
```

## 15. 요약

제품 썸네일 기본값:

1. 상품 이미지와 상품 정보를 기준으로 완성형 이미지 생성
2. 실제 제품명을 필수 텍스트로 넣고 제목, 배지, CTA를 프롬프트에 모두 명시
3. 제품은 크고 선명하게, 원본과 최대한 충실하게 유지
4. 수수료/커미션/내부 정산 정보는 이미지에 절대 노출하지 않음
5. 제품명 정확성, 모바일 가독성, 한글 정확성, 제품 충실도 기준으로 QC
6. 95점 이상만 최종 이미지로 사용
7. 생성된 제품 썸네일은 블로그 본문 첫 이미지로 삽입
