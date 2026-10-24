/** Photo staging follows the selected product noun, not its target fabric or
 * usage context. This module stays browser-safe for composition previews. */
export function isFabricLintRemoverProduct(productName: string): boolean {
  return /보[풀플]\s*제거기|\bfabric\s+(?:lint\s+)?shaver\b|\blint\s+shaver\b/iu.test(String(productName || "").normalize("NFKC"));
}

export function isClothingPhotoSubject(productName: string): boolean {
  const name = String(productName || "").normalize("NFKC");
  if (isFabricLintRemoverProduct(name)) return false;
  const otherProduct = /이어폰|헤드폰|스마트워치|시계|가방|백팩|지갑|파우치|선글라스|세탁기|건조기|살균기|소독기|의류\s*관리기|다리미|옷걸이|행거|보관함|방석|쿠션|커튼|이불|세제|세탁망|집게|니트릴|프린터|프레스|스티커|인형|바디\s*워시|샴푸|\b(?:earphones?|headphones?|smartwatch|backpack|detergent|dryer|printer)\b/iu.test(name);
  // "순면 원단 내복" is a garment, while "내복용 니트 원단" is
  // unmade fabric. A material adjective cannot cancel an actual garment noun.
  if (/원단/u.test(name) && !/티셔츠|셔츠|블라우스|바지|팬츠|반바지|내복|내의|원피스|스커트|치마|재킷|자켓|점퍼|패딩|코트|가디건|조끼|양말|속옷|레깅스|\b(?:shirts?|pants|trousers|dresses|jackets?|coats?|cardigans?|leggings|underwear)\b/iu
    .test(name.replace(/(?:티셔츠|셔츠|바지|팬츠|내복|내의|원피스|치마|조끼|속옷)\s*용/gu, ""))) return false;
  return !otherProduct && /티셔츠|셔츠|블라우스|바지|팬츠|반바지|내복|내의|히트택|히트텍|원피스|스커트|치마|재킷|자켓|점퍼|패딩|코트|니트|가디건|조끼|양말|속옷|레깅스|\b(?:t[-\s]?shirts?|shirts?|blouses?|pants|trousers|shorts|dresses|skirts?|jackets?|coats?|cardigans?|leggings|thermal\s+underwear)\b/iu.test(name);
}
