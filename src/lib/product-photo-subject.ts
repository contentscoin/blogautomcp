/** Photo staging follows the selected product noun, not its target fabric or
 * usage context. This module stays browser-safe for composition previews. */
export function isFabricLintRemoverProduct(productName: string): boolean {
  return /보[풀플]\s*제거기|\bfabric\s+(?:lint\s+)?shaver\b|\blint\s+shaver\b/iu.test(String(productName || "").normalize("NFKC"));
}

export function isClothingPhotoSubject(productName: string): boolean {
  const name = String(productName || "").normalize("NFKC");
  if (isFabricLintRemoverProduct(name)) return false;
  const otherProduct = /이어폰|헤드폰|스마트워치|시계|가방|백팩|지갑|파우치|선글라스|세탁기|건조기|의류\s*관리기|다리미|옷걸이|행거|세제|세탁망|집게|니트릴|프린터|프레스|스티커|인형|바디\s*워시|샴푸|\b(?:earphones?|headphones?|smartwatch|backpack|detergent|dryer|printer)\b/iu.test(name);
  return !otherProduct && /티셔츠|셔츠|블라우스|바지|팬츠|반바지|원피스|스커트|치마|재킷|자켓|점퍼|패딩|코트|니트|가디건|조끼|양말|속옷|레깅스|\b(?:t[-\s]?shirts?|shirts?|blouses?|pants|trousers|shorts|dresses|skirts?|jackets?|coats?|cardigans?|leggings)\b/iu.test(name);
}
