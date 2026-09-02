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
 * 생성 후 QC(OpenAI 비전, §10 배점)와 교정 재생성 루프는 thumbnail-gen/ 이 담당한다.
 */

import fs from "fs";
import path from "path";

const OPENAI_IMAGE_ENDPOINT_EDITS = "https://api.openai.com/v1/images/edits";
const OPENAI_IMAGE_ENDPOINT_GENERATIONS = "https://api.openai.com/v1/images/generations";

const IMAGE_API_ENABLED =
  (process.env.PRODUCT_THUMBNAIL_IMAGE_API_ENABLED || "true").toLowerCase() !== "false";
// gpt-image-2: 텍스트 렌더링(특히 한글)과 편집 시 원본 보존이 이전 세대보다 좋다.
// 구모델이 필요하면 PRODUCT_THUMBNAIL_IMAGE_MODEL=gpt-image-1 로 내릴 수 있다.
const IMAGE_API_MODEL = process.env.PRODUCT_THUMBNAIL_IMAGE_MODEL?.trim() || "gpt-image-2";
// 네이버 검색/피드 노출은 1:1 크롭 중심이라 정사각을 기본으로 한다. gpt-image 계열이
// 지원하는 크기(1024x1024, 1024x1536, 1536x1024)만 허용된다.
const IMAGE_API_SIZE = process.env.PRODUCT_THUMBNAIL_IMAGE_SIZE?.trim() || "1024x1024";
// 재시도 루프 비용을 줄이기 위해 기본 medium. 최종본만 high 로 올리려면 env 로 조정.
const IMAGE_API_QUALITY = process.env.PRODUCT_THUMBNAIL_IMAGE_QUALITY?.trim() || "medium";
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
  /** 기본 env PRODUCT_THUMBNAIL_IMAGE_SIZE (1024x1024) */
  size?: string;
  /** 기본 env PRODUCT_THUMBNAIL_IMAGE_QUALITY (medium) */
  quality?: string;
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

  const size = options.size?.trim() || IMAGE_API_SIZE;
  const quality = options.quality?.trim() || IMAGE_API_QUALITY;
  const requestWithModel = async (model: string): Promise<Response> => {
    if (hasReference) {
      const referencePath = options.referenceImagePath as string;
      const form = new FormData();
      form.append("model", model);
      form.append("prompt", options.prompt);
      form.append("size", size);
      form.append("quality", quality);
      form.append(
        "image",
        new Blob([new Uint8Array(fs.readFileSync(referencePath))], {
          type: mimeTypeForExtension(referencePath),
        }),
        path.basename(referencePath)
      );
      return fetch(OPENAI_IMAGE_ENDPOINT_EDITS, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(IMAGE_API_TIMEOUT_MS),
      });
    }
    return fetch(OPENAI_IMAGE_ENDPOINT_GENERATIONS, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model, prompt: options.prompt, size, quality }),
      signal: AbortSignal.timeout(IMAGE_API_TIMEOUT_MS),
    });
  };

  // 계정에 따라 gpt-image-2 접근이 아직 안 열려 있을 수 있다(조직 인증 필요).
  // 모델 접근 오류로 보이면 gpt-image-1로 한 번 내려서 재시도한다.
  const candidateModels = Array.from(new Set([IMAGE_API_MODEL, "gpt-image-1"]));
  let b64: string | null = null;

  for (const [index, model] of candidateModels.entries()) {
    let response: Response;
    try {
      response = await requestWithModel(model);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`   ⚠️ Images API 썸네일 요청 실패(${model}): ${message}`);
      return null;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const modelAccessProblem =
        (response.status === 400 || response.status === 403 || response.status === 404) &&
        /model|verification|not\s*found|unsupported/i.test(body);
      console.log(`   ⚠️ Images API 썸네일 실패 (${model}, HTTP ${response.status}): ${body.slice(0, 240)}`);
      if (modelAccessProblem && index < candidateModels.length - 1) {
        console.log(`   ↪️ ${candidateModels[index + 1]} 모델로 재시도합니다.`);
        continue;
      }
      return null;
    }

    const payload = (await response.json().catch(() => null)) as {
      data?: Array<{ b64_json?: string }>;
    } | null;
    b64 = payload?.data?.[0]?.b64_json || null;
    break;
  }

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
