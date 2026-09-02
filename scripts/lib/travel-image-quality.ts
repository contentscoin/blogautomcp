import fs from "node:fs";
import sharp from "sharp";

export interface TravelImageQualityResult {
  pass: boolean;
  score: number;
  width: number;
  height: number;
  entropy: number;
  sharpness: number;
  reasons: string[];
}

/**
 * 여행 본문용 원본 이미지의 기술 품질을 검사한다.
 * 작은 썸네일, 과도하게 뭉개진 캡처, 정보량이 거의 없는 플레이스홀더를
 * 발행 이미지로 쓰지 않기 위한 보수적인 게이트다.
 */
export async function assessTravelImageQuality(
  imagePath: string,
): Promise<TravelImageQualityResult> {
  const reasons: string[] = [];
  try {
    const fileSize = fs.statSync(imagePath).size;
    const image = sharp(imagePath).rotate();
    const [metadata, stats] = await Promise.all([image.metadata(), image.stats()]);
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    const entropy = Number.isFinite(stats.entropy) ? stats.entropy : 0;
    const sharpness = Number.isFinite(stats.sharpness) ? stats.sharpness : 0;
    const pixels = width * height;
    const ratio = height > 0 ? width / height : 0;

    if (width < 720 || height < 480 || pixels < 500_000) reasons.push("해상도 부족");
    if (fileSize < 45_000) reasons.push("파일 정보량 부족");
    if (ratio < 0.62 || ratio > 2.4) reasons.push("본문에 부적합한 화면비");
    if (entropy < 2.8) reasons.push("시각 정보량 부족");
    if (sharpness < 0.8) reasons.push("선명도 부족");

    const score = Math.max(0, Math.min(100,
      100
      - (width < 720 || height < 480 ? 28 : 0)
      - (pixels < 500_000 ? 18 : 0)
      - (fileSize < 45_000 ? 18 : 0)
      - (ratio < 0.62 || ratio > 2.4 ? 16 : 0)
      - (entropy < 2.8 ? 18 : 0)
      - (sharpness < 0.8 ? 18 : 0)
    ));
    return { pass: reasons.length === 0, score, width, height, entropy, sharpness, reasons };
  } catch {
    return {
      pass: false,
      score: 0,
      width: 0,
      height: 0,
      entropy: 0,
      sharpness: 0,
      reasons: ["이미지 분석 실패"],
    };
  }
}
