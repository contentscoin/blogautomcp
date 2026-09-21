/** Small real PNG with distinct trailing test labels for content-addressed fixtures. */
export function testPngFixture(label: string): Buffer {
  return Buffer.concat([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64"), Buffer.from(label)]);
}
