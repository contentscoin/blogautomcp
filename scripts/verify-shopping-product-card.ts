import assert from "node:assert/strict";
import { gradeProductEvidence } from "./lib/product-editorial-plan";
import { extractDetailFromHtml, parseShoppingProductCard, redactSensitiveFields } from "./lib/shopping-product-card";

// 스마트스토어형: 전역 상태 안에 상품 노드가 중첩되어 있고, 추천 상품 목록이 함께 들어 있다.
const preloadedState = {
  user: { memberNo: 12345, loginId: "someone" },
  recommend: { products: [{ name: "다른 상품 무선 선풍기", salePrice: 9900, representImage: { url: "https://shop-phinf.pstatic.net/other.jpg" } }] },
  product: {
    A: {
      id: 987654,
      name: "모던홈 접이식 빨래건조대 대형",
      salePrice: 59000,
      discountedSalePrice: 39900,
      category: { wholeCategoryName: "생활/건강>세탁용품>빨래건조대" },
      representImage: { url: "https://shop-phinf.pstatic.net/main.jpg" },
      productImages: [{ url: "https://shop-phinf.pstatic.net/main.jpg" }, { url: "//shop-phinf.pstatic.net/sub1.jpg" }, { url: "https://shop-phinf.pstatic.net/icon_badge.png" }],
      reviewAmount: { totalReviewCount: 1284, averageReviewScore: 4.78 },
      seoInfo: { sellerTags: [{ name: "인기", value: "최고의 건조대" }] },
      productAttributes: [
        { attributeName: "재질", attributeValue: "스테인리스" },
        { attributeName: "펼친 크기", attributeValue: "145 x 55 x 98cm" },
      ],
      productInfoProvidedNotice: { items: [{ title: "제조국", content: "대한민국" }, { title: "A/S 책임자", content: "-" }] },
      optionCombinations: [
        { optionGroupName1: "색상", optionName1: "화이트" },
        { optionGroupName1: "색상", optionName1: "그레이" },
      ],
      detailContents: { detailContentText: "<div><p>두꺼운 이불도 널 수 있는 3단 구조</p><img data-src=\"https://shop-phinf.pstatic.net/detail1.jpg\"><script>ignored()</script><p>접으면 두께 9cm</p></div>" },
    },
  },
};
const card = parseShoppingProductCard([{ unrelated: true }, preloadedState]);
assert.equal(card.found, true);
assert.equal(card.name, "모던홈 접이식 빨래건조대 대형", "추천 목록의 다른 상품을 고르면 안 된다");
assert.equal(card.price, "39,900원");
assert.equal(card.originalPrice, "59,000원");
assert.equal(card.discountRate, "32%");
assert.equal(card.categoryPath, "생활/건강 > 세탁용품 > 빨래건조대");
assert.equal(card.reviewCount, "1,284");
assert.equal(card.rating, "4.78");
assert.deepEqual(card.imageUrls, ["https://shop-phinf.pstatic.net/main.jpg", "https://shop-phinf.pstatic.net/sub1.jpg"]);
assert.deepEqual(card.detailImageUrls, ["https://shop-phinf.pstatic.net/detail1.jpg"]);
assert.match(card.detailText, /3단 구조/u);
assert.match(card.detailText, /두께 9cm/u);
assert.doesNotMatch(card.detailText, /ignored/u);
assert.ok(card.factLines.includes("재질: 스테인리스"));
assert.ok(card.factLines.includes("펼친 크기: 145 x 55 x 98cm"));
assert.ok(card.factLines.includes("제조국: 대한민국"));
assert.equal(card.factLines.some((line) => /최고의 건조대|A\/S 책임자/u.test(line)), false, "홍보 태그와 빈 값은 사실이 아니다");
assert.deepEqual(card.optionLines, ["색상: 화이트, 그레이"]);

// Next.js형: props.pageProps 아래에 다른 키 이름으로 들어 있다.
const nextData = { props: { pageProps: { initialState: { productDetail: {
  productName: "브리즈온 무선 핸디 선풍기",
  price: 24900,
  imageUrl: "https://shopping-phinf.pstatic.net/fan.jpg",
  specs: [{ label: "배터리", value: "4000mAh" }, { label: "무게", value: "210g" }],
  options: [{ groupName: "색상", name: "민트" }, { groupName: "색상", name: "핑크" }],
} } } } };
const nextCard = parseShoppingProductCard([nextData]);
assert.equal(nextCard.found, true);
assert.equal(nextCard.name, "브리즈온 무선 핸디 선풍기");
assert.equal(nextCard.price, "24,900원");
assert.equal(nextCard.originalPrice, "");
assert.deepEqual(nextCard.factLines, ["배터리: 4000mAh", "무게: 210g"]);
assert.deepEqual(nextCard.optionLines, ["색상: 민트, 핑크"]);

// 상품이 없는 데이터, 깨진 값, 지나치게 깊은 구조는 안전하게 미발견으로 끝난다.
assert.equal(parseShoppingProductCard([]).found, false);
assert.equal(parseShoppingProductCard([null, "text", 3, { name: "이름만" }, { a: { b: [] } }]).found, false);
let deep: Record<string, unknown> = { name: "깊은 상품", salePrice: 1000, representImage: "https://shop-phinf.pstatic.net/deep.jpg" };
for (let index = 0; index < 30; index += 1) deep = { child: deep };
assert.equal(parseShoppingProductCard([deep]).found, false);
const cyclic: Record<string, unknown> = { name: "순환" };
cyclic.self = cyclic;
assert.equal(parseShoppingProductCard([cyclic]).found, false);

assert.deepEqual(extractDetailFromHtml("<p>가&amp;나</p><img src='https://a.pstatic.net/x.jpg?type=w860'>"), {
  text: "가&나", imageUrls: ["https://a.pstatic.net/x.jpg?type=w860"],
});

// 근거 등급: 사실이 없으면 sparse, 구조화 사실이 붙으면 올라간다.
assert.equal(gradeProductEvidence({ productName: card.name, description: "", features: [], targetSectionCount: 11 }), "sparse");
assert.notEqual(gradeProductEvidence({
  productName: card.name, description: card.detailText,
  features: [...card.factLines, ...card.optionLines, "3단 구조: 두꺼운 이불 건조", "접은 두께: 9cm", "최대 하중: 20kg"],
  targetSectionCount: 11,
}), "sparse");

// 캡처 파일에서 계정·인증 값은 지운다.
assert.deepEqual(redactSensitiveFields({ product: { name: "상품", sellerEmail: "a@b.c" }, memberNo: 1, list: [{ accessToken: "x", price: 1 }] }), {
  product: { name: "상품", sellerEmail: "[removed]" }, memberNo: "[removed]", list: [{ accessToken: "[removed]", price: 1 }],
});
console.log("shopping product card ok");
