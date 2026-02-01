import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * 리뷰 글 생성 API
 * V5 Phase 11: GPTs 패턴 기반 장소/제품 리뷰
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();

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
        if (!placeName || !rawNotes) {
            return NextResponse.json(
                { success: false, error: "placeName과 rawNotes는 필수입니다" },
                { status: 400 }
            );
        }

        // 명령어 구성
        const args = [
            `--name="${placeName}"`,
            `--notes="${rawNotes.replace(/"/g, '\\"')}"`,
        ];

        if (address) args.push(`--address="${address}"`);
        if (keywords) args.push(`--keywords="${keywords}"`);
        if (tips) args.push(`--tips="${tips}"`);
        if (category) args.push(`--category=${category}`);
        if (phone) args.push(`--phone="${phone}"`);
        if (parking) args.push(`--parking="${parking}"`);
        if (style) args.push(`--style=${style}`);
        if (publish) args.push("--publish");

        const command = `npx ts-node --project tsconfig.scripts.json scripts/review-agent.ts ${args.join(" ")}`;

        console.log("실행 명령:", command);

        // 실행 (5분 타임아웃)
        const { stdout, stderr } = await execAsync(command, {
            cwd: process.cwd(),
            timeout: 300000,
        });

        // 결과 파싱
        const titleMatch = stdout.match(/제목: (.+)/);
        const jsonMatch = stdout.match(/생성된 콘텐츠:\s*([\s\S]*?)$/);

        let content = null;
        if (jsonMatch) {
            try {
                content = JSON.parse(jsonMatch[1]);
            } catch (e) {
                // JSON 파싱 실패시 무시
            }
        }

        return NextResponse.json({
            success: true,
            data: {
                title: titleMatch?.[1] || placeName,
                content,
                published: publish || false,
            },
        });

    } catch (error: any) {
        console.error("리뷰 생성 실패:", error);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}
