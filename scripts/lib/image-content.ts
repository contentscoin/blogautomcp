/**
 * 이미지 기반 콘텐츠 생성 (멀티모달)
 * V4 Phase 9: Gemini Vision으로 이미지 분석 → 스토리 생성
 */

import "dotenv/config";
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
    visualComposition?: string;
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

    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.trim() === "") {
        console.warn("⚠️ GEMINI_API_KEY_MISSING: 이미지를 분석하지 않고 기본 정보만 반환합니다.");
        return {
            description: "제공된 이미지입니다.",
            tags: ["이미지"],
            mood: "일반적인",
            suggestedCaption: "사진입니다.",
            visualComposition: "기본값"
        };
    }

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const prompt = `이 이미지를 분석해주세요. 단순한 사물 묘사를 넘어, 사진 속 상황에 스토리를 부여하여 매우 구체적으로 분석해주세요. 
JSON 형식으로 반환:
{
  "description": "사진 속 장소, 상황, 시간대, 인물의 감정 등을 포함한 생생하고 구체적인 스토리텔링 기반 설명 (3-4문장)",
  "tags": ["관련", "키워드", "장소", "감정", "분위기"],
  "mood": "이미지에서 느껴지는 감성이나 분위기 (예: 여유로운 주말 아침, 설레는 여행 첫날의 두근거림)",
  "suggestedCaption": "블로그 본문에 바로 삽입할 수 있는, 독자에게 말 거는 듯한 자연스러운 캡션",
  "visualComposition": "이미지의 구도, 피사체의 위치, 색감의 대비, 시선의 흐름 등 시각적/미학적인 관점에서의 분석"
}`;

    try {
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

        const json = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || "{}");
        return json;
    } catch (e: any) {
        log.warn(`이미지 분석 실패: ${image.filename}`, e);
        return {
            description: "이미지 분석 실패",
            tags: [],
            mood: "알 수 없음",
            suggestedCaption: "",
            visualComposition: "분석 실패"
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

    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.trim() === "") {
        throw new Error("GEMINI_API_KEY가 없어 이미지 기반 콘텐츠를 생성할 수 없습니다.");
    }

    // 1. 각 이미지 분석
    const analyses: ImageAnalysis[] = [];
    for (const image of images) {
        const analysis = await analyzeImage(image);
        analyses.push(analysis);
        log.debug(`분석 완료: ${image.filename}`, { tags: analysis.tags });
    }

    if (analyses.every((analysis) => analysis.description === "이미지 분석 실패")) {
        throw new Error("모든 이미지 분석에 실패했습니다.");
    }

    // 2. 전체 스토리 생성
    let text = "";
    {
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

        const imageDescriptions = analyses.map((a, i) =>
            `[이미지 ${i + 1}] ${a.description}\n- 분위기/감성: ${a.mood}\n- 시각적 구도: ${a.visualComposition || '정보 없음'}`
        ).join("\n\n");

        const prompt = `당신은 네이버 블로그 전문 여행/리뷰 에디터입니다.
${styleGuide}

## 주제: ${topic}
## 이미지 스토리보드 (순서대로 나열됨):
${imageDescriptions}

위 이미지들의 상황, 분위기, 그리고 미학적인 구도를 바탕으로, 물 흐르듯 자연스럽게 이어지는 하나의 '스토리'로 블로그 글을 작성해주세요.
단순히 "첫번째 사진은 ~입니다" 같은 딱딱한 설명은 절대 금지합니다. 
장소의 분위기, 그 순간의 감정, 시각적 아름다움을 독자에게 직접 이야기하듯 생생하게 감정을 담아주세요.
독자가 마치 그 사진 속 장소에 함께 있는 듯한 공감각적인 묘사를 더해주세요.

**모바일 최적화 가이드 (필수):**
- 모바일 가독성을 위해 한 문장은 짧고 간결하게 작성하세요 (50자 이내 권장).
- 글이 빽빽해 보이지 않도록 1~2문장마다 줄바꿈(엔터)을 꼭 넣어주세요.
- 적절한 이모지를 사용하여 생동감을 더해주세요.
- 각 이미지와 텍스트의 배치가 시각적인 리듬감을 갖도록 문장의 길이를 조절하세요.

각 이미지마다 1개의 섹션을 작성합니다.

JSON 형식으로 반환:
{
  "title": "SEO 최적화된 매력적이고 클릭을 유도하는 제목",
  "sections": [
    { "imageIndex": 0, "text": "이미지 1에 대한 스토리텔링 본문 (모바일 최적화, 공감각적 묘사, 100-200자)" },
    { "imageIndex": 1, "text": "이미지 2에 대한 스토리텔링 본문" },
    ...
  ],
  "hashtags": ["#해시태그1", "#해시태그2", ...]
}`;

        try {
            const response = await model.generateContent(prompt);
            text = response.response.text();
        } catch (e: any) {
            log.error("제미나이 전체 스토리 생성 실패", e);
            throw new Error("이미지 기반 스토리 생성 실패");
        }
    }

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
