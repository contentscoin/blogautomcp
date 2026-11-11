import crypto from "node:crypto";
import fs from "node:fs";

/**
 * 파일 SHA-256을 (경로, 크기, 수정·변경 시각)으로 기억한다.
 *
 * 소재 목록은 몇 초마다 모든 소재의 원고·이미지 무결성을 다시 확인한다. 매번 파일 전체를 읽어
 * 해시하면 소재가 수십 개만 되어도 초당 수백 MB를 읽게 되어 PC 전체가 느려진다. stat은 싸고,
 * 파일을 덮어쓰면 수정 시각이나 크기가 바뀌므로 그때만 다시 읽는다.
 */
const MAX_ENTRIES = 4000;
const digests = new Map<string, string>();

function remember(key: string, value: string): string {
  if (digests.size >= MAX_ENTRIES) digests.delete(digests.keys().next().value as string);
  digests.set(key, value);
  return value;
}

/** 파일이 없거나 읽을 수 없으면 원래 fs 오류를 그대로 던진다. */
export function cachedSha256File(filePath: string): string {
  const stat = fs.statSync(filePath);
  const key = `${filePath}\0${stat.size}\0${stat.mtimeMs}\0${stat.ctimeMs}`;
  const hit = digests.get(key);
  if (hit) {
    // 최근에 쓴 항목이 먼저 지워지지 않게 순서를 갱신한다.
    digests.delete(key);
    digests.set(key, hit);
    return hit;
  }
  return remember(key, crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex"));
}

/** 테스트용. */
export function clearFileDigestCache(): void {
  digests.clear();
}
