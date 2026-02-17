import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiKey } from "@/lib/api-auth";
import { runTsNodeScript, ScriptExecutionError } from "@/lib/run-script";

interface ReviewRequestBody {
    placeName?: string;
    address?: string;
    rawNotes?: string;
    keywords?: string;
    tips?: string;
    category?: string;
    phone?: string;
    parking?: string;
    style?: string;
    publish?: boolean;
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "알 수 없는 오류";
}

function getErrorStderr(error: unknown): string | undefined {
    if (error instanceof ScriptExecutionError) {
        return error.stderr.slice(-1000) || undefined;
    }

    if (typeof error !== "object" || error === null || !("stderr" in error)) {
        return undefined;
    }

    const stderr = (error as { stderr?: unknown }).stderr;
    return typeof stderr === "string" ? stderr.slice(-1000) : undefined;
}

/**
 * 리뷰 글 생성 API
 * V5 Phase 11: GPTs 패턴 기반 장소/제품 리뷰
 */
export async function POST(req: NextRequest) {
    try {
        const authError = requireAdminApiKey(req);
        if (authError) {
            return authError;
        }

        const body = (await req.json()) as ReviewRequestBody;

        const {
            placeName,
            address,
            rawNotes,
            keywords,
            tips,
            category,
            phone,
            parking,
            style,
            publish,
        } = body;

        // 필수값 검증
        const normalizedPlaceName = placeName?.trim();
        const normalizedRawNotes = rawNotes?.trim();

        if (!normalizedPlaceName || !normalizedRawNotes) {
            return NextResponse.json(
                { success: false, error: "placeName과 rawNotes는 필수입니다" },
                { status: 400 }
            );
        }

        if (normalizedRawNotes.length > 5000) {
            return NextResponse.json(
                { success: false, error: "rawNotes가 너무 깁니다. 5000자 이하로 입력하세요." },
                { status: 400 }
            );
        }

        // 안전한 인자 배열로 스크립트 실행 (쉘 문자열 결합 금지)
        const args = [
            `--name=${normalizedPlaceName}`,
            `--notes=${normalizedRawNotes}`,
        ];

        if (address?.trim()) args.push(`--address=${address.trim()}`);
        if (keywords?.trim()) args.push(`--keywords=${keywords.trim()}`);
        if (tips?.trim()) args.push(`--tips=${tips.trim()}`);
        if (category) args.push(`--category=${category}`);
        if (phone?.trim()) args.push(`--phone=${phone.trim()}`);
        if (parking?.trim()) args.push(`--parking=${parking.trim()}`);
        if (style) args.push(`--style=${style}`);
        if (publish) args.push("--publish");

        const { stdout } = await runTsNodeScript("scripts/review-agent.ts", args, {
            timeoutMs: 300000,
        });

        // 결과 파싱
        const titleMatch = stdout.match(/제목: (.+)/);
        const jsonMatch = stdout.match(/생성된 콘텐츠:\s*([\s\S]*?)$/);

        let content = null;
        if (jsonMatch) {
            try {
                content = JSON.parse(jsonMatch[1]);
            } catch {
                // JSON 파싱 실패시 무시
            }
        }

        return NextResponse.json({
            success: true,
            data: {
                title: titleMatch?.[1] || normalizedPlaceName,
                content,
                published: publish || false,
            },
        });

    } catch (error: unknown) {
        console.error("리뷰 생성 실패:", error);
        return NextResponse.json(
            {
                success: false,
                error: getErrorMessage(error),
                stderr: getErrorStderr(error),
            },
            { status: 500 }
        );
    }
}
