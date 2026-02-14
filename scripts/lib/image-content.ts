/**
 * 이미지 기반 콘텐츠 생성 (멀티모달)
 * V4 Phase 9: Gemini Vision으로 이미지 분석 → 스토리 생성
 */

import * as fs from "fs";
import * as path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { createTaskLogger } from "./logger";

const log = createTaskLogger("ImageContent");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

interface ImageInfo {
    path: string;
    filename: string;
    mimeType: string;
    base64: string;
}

interface ImageAnalysis {
    description: string;
    tags: string[];
    mood: string;
    suggestedCaption: string;
}

interface ImageBasedContent {
    title: string;
    sections: Array<{
        imagePath: string;
        text: string;
    }>;
    hashtags: string[];
}

interface GeneratedSection {
    imageIndex?: number;
    text?: string;
}

interface GeneratedContentResponse {
    title?: string;
    sections?: GeneratedSection[];
    hashtags?: string[];
}

/**
 * 이미지 파일 로드 및 Base64 변환
 */
export function loadImages(folderPath: string): ImageInfo[] {
    log.info(`이미지 폴더 로드: ${folderPath}`);

    if (!fs.existsSync(folderPath)) {
        log.error(`폴더가 존재하지 않습니다: ${folderPath}`);
        return [];
    }

    const supportedExtensions = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
    const files = fs.readdirSync(folderPath)
        .filter(file => supportedExtensions.includes(path.extname(file).toLowerCase()))
        .sort(); // 파일명 순서대로 정렬

    const images: ImageInfo[] = files.map(file => {
        const filePath = path.join(folderPath, file);
        const ext = path.extname(file).toLowerCase();
        const mimeType = ext === ".png" ? "image/png"
            : ext === ".gif" ? "image/gif"
                : ext === ".webp" ? "image/webp"
                    : "image/jpeg";

        const base64 = fs.readFileSync(filePath).toString("base64");

        return {
            path: filePath,
            filename: file,
            mimeType,
            base64,
        };
    });

    log.info(`이미지 ${images.length}개 로드 완료`);
    return images;
}

/**
 * Gemini Vision으로 이미지 분석
 */
export async function analyzeImage(image: ImageInfo): Promise<ImageAnalysis> {
    log.debug(`이미지 분석: ${image.filename}`);

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const prompt = `이 이미지를 분석해주세요. JSON 형식으로 반환:
{
  "description": "이미지에 대한 자세한 설명 (2-3문장)",
  "tags": ["관련", "키워드", "태그"],
  "mood": "이미지의 분위기 (예: 활기찬, 평화로운, 럭셔리한)",
  "suggestedCaption": "블로그에 쓸 수 있는 자연스러운 문장"
}`;

    const response = await model.generateContent([
        prompt,
        {
            inlineData: {
                mimeType: image.mimeType,
                data: image.base64,
            },
        },
    ]);

    const text = response.response.text();

    try {
        const json = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || "{}");
        return json;
    } catch {
        log.warn(`이미지 분석 JSON 파싱 실패: ${image.filename}`);
        return {
            description: "이미지 분석 실패",
            tags: [],
            mood: "알 수 없음",
            suggestedCaption: "",
        };
    }
}

/**
 * 이미지들을 기반으로 스토리 생성
 */
export async function generateContentFromImages(
    images: ImageInfo[],
    topic: string,
    type: "travel" | "golf" | "knowledge",
    styleGuide: string = ""
): Promise<ImageBasedContent> {
    log.info(`이미지 기반 콘텐츠 생성 시작: ${images.length}장`);

    // 1. 각 이미지 분석
    const analyses: ImageAnalysis[] = [];
    for (const image of images) {
        const analysis = await analyzeImage(image);
        analyses.push(analysis);
        log.debug(`분석 완료: ${image.filename}`, { tags: analysis.tags });
    }

    // 2. 전체 스토리 생성
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const imageDescriptions = analyses.map((a, i) =>
        `[이미지 ${i + 1}] ${a.description} (분위기: ${a.mood})`
    ).join("\n");

    const prompt = `당신은 인기 블로거입니다.
${styleGuide}

## 주제: ${topic}
## 이미지 순서와 설명:
${imageDescriptions}

위 이미지들을 순서대로 사용하여 블로그 글을 작성해주세요.
각 이미지마다 1개의 섹션을 작성합니다.

JSON 형식으로 반환:
{
  "title": "SEO 최적화된 매력적인 제목",
  "sections": [
    { "imageIndex": 0, "text": "이미지 1에 대한 본문 (100-200자)" },
    { "imageIndex": 1, "text": "이미지 2에 대한 본문" },
    ...
  ],
  "hashtags": ["#해시태그1", "#해시태그2", ...]
}`;

    const response = await model.generateContent(prompt);
    const text = response.response.text();

    try {
        const json = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || "{}") as GeneratedContentResponse;

        // 이미지 경로 매핑
        const content: ImageBasedContent = {
            title: json.title || topic,
            sections: (json.sections || []).map((section, i) => ({
                imagePath: images[section.imageIndex ?? i]?.path || "",
                text: section.text || "",
            })),
            hashtags: (json.hashtags || []).filter((tag): tag is string => typeof tag === "string"),
        };

        log.info(`콘텐츠 생성 완료: "${content.title}"`);
        return content;

    } catch {
        log.error("콘텐츠 생성 JSON 파싱 실패");
        throw new Error("이미지 기반 콘텐츠 생성 실패");
    }
}

export type { ImageInfo, ImageAnalysis, ImageBasedContent };
