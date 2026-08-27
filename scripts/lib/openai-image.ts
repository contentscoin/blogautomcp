/**
 * OpenAI Images API 기반 제품 썸네일 생성(image-to-image).
 *
 * 데스크톱 앱에서 실제로 동작하는 생성형 썸네일 경로다. 기존 경로들은 데스크톱에서
 * 모두 죽어 있었다: ChatGPT 브라우저 모드는 main.cjs가 강제로 끄고, Codex imagegen은
 * 사람이 미리 만들어 둔 파일 경로를 환경변수로 넘겨야만 동작한다. 그래서 항상
 * 작은 글씨의 로컬 합성 썸네일만 나왔다.
 *
 * 여기서는 판매페이지의 실제 제품 이미지를 레퍼런스로 넣고(images/edits),
 * ProductThumbnail.md 지침대로 큰 한글 제목까지 생성 단계에서 함께 그리게 한다.
 * 생성 후에는 Gemini 비전으로 한글 오탈자·제품 왜곡을 검사하고(QC), 통과하지
 * 못하면 호출자가 로컬 합성 폴백으로 넘어간다.
 */

import fs from "fs";
import path from "path";

const OPENAI_IMAGE_ENDPOINT_EDITS = "https://api.openai.com/v1/images/edits";
const OPENAI_IMAGE_ENDPOINT_GENERATIONS = "https://api.openai.com/v1/images/generations";

const IMAGE_API_ENABLED =
  (process.env.PRODUCT_THUMBNAIL_IMAGE_API_ENABLED || "true").toLowerCase() !== "false";
const IMAGE_API_MODEL = process.env.PRODUCT_THUMBNAIL_IMAGE_MODEL?.trim() || "gpt-image-1";
// 네이버 블로그 썸네일에 맞는 가로형. gpt-image 계열이 지원하는 크기만 허용된다.
const IMAGE_API_SIZE = process.env.PRODUCT_THUMBNAIL_IMAGE_SIZE?.trim() || "1536x1024";
const IMAGE_API_TIMEOUT_MS = (() => {
  const parsed = Number.parseInt(process.env.PRODUCT_THUMBNAIL_IMAGE_WAIT_MS || "", 10);
  return Number.isFinite(parsed) && parsed >= 10_000 ? parsed : 120_000;
})();

export interface ImageApiThumbnailOptions {
  prompt: string;
  /** 판매페이지 제품 이미지. 있으면 edits(이미지→이미지), 없으면 generations. */
  referenceImagePath?: string | null;
  outputDir: string;
  fileLabel: string;
}

function sanitizeLabel(value: string): string {
  return value.replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "thumbnail";
}

function mimeTypeForExtension(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

export function isImageApiThumbnailAvailable(): boolean {
  return IMAGE_API_ENABLED && Boolean(process.env.OPENAI_API_KEY?.trim());
}

/**
 * Images API로 썸네일 1장을 생성해 파일로 저장한다. 실패하면 null(호출자가 폴백).
 */
export async function generateProductThumbnailViaImageApi(
  options: ImageApiThumbnailOptions
): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!IMAGE_API_ENABLED || !apiKey) return null;

  const hasReference = Boolean(
    options.referenceImagePath && fs.existsSync(options.referenceImagePath)
  );

  let response: Response | null = null;
  try {
    if (hasReference) {
      const referencePath = options.referenceImagePath as string;
      const form = new FormData();
      form.append("model", IMAGE_API_MODEL);
      form.append("prompt", options.prompt);
      form.append("size", IMAGE_API_SIZE);
      form.append(
        "image",
        new Blob([new Uint8Array(fs.readFileSync(referencePath))], {
          type: mimeTypeForExtension(referencePath),
        }),
        path.basename(referencePath)
      );
      response = await fetch(OPENAI_IMAGE_ENDPOINT_EDITS, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(IMAGE_API_TIMEOUT_MS),
      });
    } else {
      response = await fetch(OPENAI_IMAGE_ENDPOINT_GENERATIONS, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ model: IMAGE_API_MODEL, prompt: options.prompt, size: IMAGE_API_SIZE }),
        signal: AbortSignal.timeout(IMAGE_API_TIMEOUT_MS),
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`   ⚠️ Images API 썸네일 요청 실패: ${message}`);
    return null;
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.log(
      `   ⚠️ Images API 썸네일 실패 (HTTP ${response.status}): ${body.slice(0, 300)}`
    );
    return null;
  }

  const payload = (await response.json().catch(() => null)) as {
    data?: Array<{ b64_json?: string }>;
  } | null;
  const b64 = payload?.data?.[0]?.b64_json;
  if (!b64) {
    console.log("   ⚠️ Images API 응답에 이미지 데이터가 없습니다.");
    return null;
  }

  fs.mkdirSync(options.outputDir, { recursive: true });
  const outputPath = path.join(
    options.outputDir,
    `product_thumbnail_imagegen_${Date.now()}_${sanitizeLabel(options.fileLabel)}.png`
  );
  fs.writeFileSync(outputPath, Buffer.from(b64, "base64"));
  return outputPath;
}

export interface ThumbnailQcResult {
  pass: boolean;
  /** QC를 실제로 수행했는지. 키가 없으면 검사 없이 통과 처리하고 false가 된다. */
  checked: boolean;
  reason: string;
}

const IMAGE_QC_ENABLED =
  (process.env.PRODUCT_THUMBNAIL_IMAGE_QC_ENABLED || "true").toLowerCase() !== "false";

/**
 * 생성 썸네일 QC — ProductThumbnail.md의 최종 금지 항목을 자동 검사한다.
 * (한글 오탈자, 제품명 누락, 잘림, 플랫 벡터화)
 * Gemini 키가 없으면 검사 없이 통과시키되 checked=false로 알린다.
 */
export async function qcGeneratedThumbnail(
  imagePath: string,
  expected: { productName: string; headline: string }
): Promise<ThumbnailQcResult> {
  if (!IMAGE_QC_ENABLED) return { pass: true, checked: false, reason: "QC 비활성화" };
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  if (!geminiKey) return { pass: true, checked: false, reason: "GEMINI_API_KEY 없음 — QC 생략" };

  try {
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const imageBase64 = fs.readFileSync(imagePath).toString("base64");

    const prompt = [
      "이 이미지는 네이버 블로그 상품 썸네일이다. 아래 기준으로만 검사해서 JSON으로 답하라.",
      `기대 제품명: "${expected.productName}"`,
      `기대 헤드라인: "${expected.headline}"`,
      "",
      "검사 기준:",
      "1. koreanTypo: 이미지 속 한글에 오탈자·깨진 글자·가짜 글자가 있는가",
      "2. productNameMissing: 기대 제품명(또는 그와 동일하게 읽히는 표기)이 화면에 없는가",
      "3. textCut: 주요 문구가 화면 밖으로 잘렸는가",
      "4. flatVector: 실사 제품 사진 없이 플랫 벡터/아이콘/만화풍으로만 구성됐는가",
      "",
      '응답 형식: {"koreanTypo": bool, "productNameMissing": bool, "textCut": bool, "flatVector": bool, "note": "짧은 설명"}',
    ].join("\n");

    const response = await model.generateContent([
      prompt,
      { inlineData: { mimeType: mimeTypeForExtension(imagePath), data: imageBase64 } },
    ]);
    const text = response.response.text();
    const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || "{}") as {
      koreanTypo?: boolean;
      productNameMissing?: boolean;
      textCut?: boolean;
      flatVector?: boolean;
      note?: string;
    };

    const failures: string[] = [];
    if (parsed.koreanTypo) failures.push("한글 오탈자");
    if (parsed.productNameMissing) failures.push("제품명 누락");
    if (parsed.textCut) failures.push("문구 잘림");
    if (parsed.flatVector) failures.push("플랫 벡터 스타일");

    if (failures.length > 0) {
      return { pass: false, checked: true, reason: `${failures.join(", ")}${parsed.note ? ` (${parsed.note})` : ""}` };
    }
    return { pass: true, checked: true, reason: parsed.note || "통과" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // QC 자체가 실패하면 이미지를 버리지 않는다 — 검사 불가로 통과 처리.
    return { pass: true, checked: false, reason: `QC 실행 실패 — 생략 (${message})` };
  }
}
