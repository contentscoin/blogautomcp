import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

interface TopicGenerateRequest {
    type: "travel" | "golf" | "knowledge";
    topic: string;
    keywords?: string;
    style?: string;
    category?: string;
    publish?: boolean;
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "콘텐츠 생성에 실패했습니다";
}

function getErrorStderr(error: unknown): string | undefined {
    if (typeof error !== "object" || error === null || !("stderr" in error)) {
        return undefined;
    }

    const stderr = (error as { stderr?: unknown }).stderr;
    return typeof stderr === "string" ? stderr.slice(-1000) : undefined;
}

export async function POST(req: NextRequest) {
    try {
        const body: TopicGenerateRequest = await req.json();

        // 필수 값 검증
        if (!body.type || !body.topic) {
            return NextResponse.json(
                { success: false, error: "type과 topic은 필수입니다" },
                { status: 400 }
            );
        }

        // 명령어 구성
        const args = [
            `--type=${body.type}`,
            `--topic="${body.topic}"`,
        ];

        if (body.keywords) {
            args.push(`--keywords="${body.keywords}"`);
        }
        if (body.style) {
            args.push(`--style=${body.style}`);
        }
        if (body.category) {
            args.push(`--category="${body.category}"`);
        }
        if (body.publish) {
            args.push("--publish");
        }

        const command = `npx ts-node --project tsconfig.scripts.json scripts/topic-agent.ts ${args.join(" ")}`;

        console.log(`🚀 실행: ${command}`);

        // 최대 5분 타임아웃
        const { stdout, stderr } = await execAsync(command, {
            cwd: process.cwd(),
            timeout: 300000,
            env: { ...process.env },
        });

        console.log("✅ 완료:", stdout);

        if (stderr) {
            console.warn("⚠️ Stderr:", stderr);
        }

        // 결과에서 JSON 파싱
        const jsonMatch = stdout.match(/📄 생성된 콘텐츠:\s*(\{[\s\S]*\})/);
        let content = null;

        if (jsonMatch) {
            try {
                content = JSON.parse(jsonMatch[1]);
            } catch { }
        }

        // 발행 성공 여부 확인
        const published = stdout.includes("🎉 발행 완료") || stdout.includes("✅ 완료");

        return NextResponse.json({
            success: true,
            data: {
                content,
                published,
                output: stdout.slice(-2000), // 마지막 2000자만
            }
        });

    } catch (error: unknown) {
        console.error("❌ 오류:", error);

        return NextResponse.json({
            success: false,
            error: getErrorMessage(error),
            stderr: getErrorStderr(error),
        }, { status: 500 });
    }
}
