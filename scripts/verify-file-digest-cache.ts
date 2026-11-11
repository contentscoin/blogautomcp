import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cachedSha256File, clearFileDigestCache } from "../src/lib/file-digest-cache";
import { publicationImageGeometryIssue } from "./lib/publication-image-geometry";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "digest-cache-"));
const file = path.join(dir, "a.bin");
const sha = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
try {
  clearFileDigestCache();
  fs.writeFileSync(file, "first");
  assert.equal(cachedSha256File(file), sha("first"));

  // 바뀌지 않은 파일은 다시 읽지 않는다.
  const original = fs.readFileSync;
  let reads = 0;
  (fs as { readFileSync: unknown }).readFileSync = (...args: Parameters<typeof fs.readFileSync>) => { reads += 1; return original(...args); };
  try {
    for (let index = 0; index < 50; index += 1) assert.equal(cachedSha256File(file), sha("first"));
    assert.equal(reads, 0, "unchanged file must not be read again");

    // 내용이 바뀌면(크기 또는 수정 시각) 새 해시를 돌려준다.
    fs.writeFileSync(file, "second-longer");
    assert.equal(cachedSha256File(file), sha("second-longer"));
    assert.equal(reads, 1);

    // 같은 크기로 덮어써도 수정 시각이 달라지면 다시 읽는다.
    fs.writeFileSync(file, "SECOND-LONGER");
    fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
    assert.equal(cachedSha256File(file), sha("SECOND-LONGER"));
    assert.equal(reads, 2);

    // 이미지 크기 판정도 같은 파일을 반복해서 읽지 않는다.
    const png = path.join(dir, "p.png");
    fs.writeFileSync(png, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));
    reads = 0;
    assert.equal(publicationImageGeometryIssue(png), null);
    assert.equal(publicationImageGeometryIssue(png), null);
    assert.equal(reads, 1);
  } finally { (fs as { readFileSync: unknown }).readFileSync = original; }

  // 없는 파일은 캐시하지 않고 오류를 그대로 던진다.
  assert.throws(() => cachedSha256File(path.join(dir, "missing.bin")));
  assert.match(publicationImageGeometryIssue(path.join(dir, "missing.png")) || "", /INVALID_IMAGE/u);
  console.log("file digest cache ok");
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
