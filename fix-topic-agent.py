import os

file_path = 'scripts/topic-agent.ts'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add PrismaClient import if missing
if 'import { PrismaClient }' not in content:
    content = content.replace(
        'import { spawnSync } from "child_process";',
        'import { spawnSync } from "child_process";\nimport { PrismaClient } from "@prisma/client";'
    )

# 2. Modify main() to handle DB fetching
main_start = content.find("async function main() {")

if main_start != -1:
    old_main_top = """async function main() {
    console.log("╔════════════════════════════════════════╗");
    console.log("║   주제 기반 블로그 콘텐츠 생성기       ║");
    console.log("╚════════════════════════════════════════╝\\n");

    // 1. CLI 인자 파싱
    const args = parseArgs();
    if (!args) {
        throw new Error("필수 인자(--type, --topic)가 누락되었습니다.");
    }"""

    new_main_top = """async function main() {
    console.log("╔════════════════════════════════════════╗");
    console.log("║   주제 기반 블로그 콘텐츠 생성기       ║");
    console.log("╚════════════════════════════════════════╝\\n");

    let args: TopicArgs | null = null;
    let taskId: string | null = null;
    const firstArg = process.argv[2];

    // UUID 인지 확인 (DB 태스크 ID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (firstArg && uuidRegex.test(firstArg)) {
        taskId = firstArg;
        console.log(`📌 DB 태스크 로드 중: ${taskId}`);
        const prisma = new PrismaClient();
        const task = await prisma.topicPostTask.findUnique({ where: { id: taskId } });
        if (!task) {
            throw new Error(`태스크를 찾을 수 없습니다: ${taskId}`);
        }
        
        const runtimeOptions = parseRuntimePublishOptions(process.argv.slice(3));
        
        args = {
            type: (task.type as any) || "knowledge",
            topic: task.topic,
            keywords: task.keywords ? task.keywords.split(",").map(k => k.trim()) : [],
            category: task.categoryNo || undefined,
            publishMode: runtimeOptions.mode,
            scheduledDate: runtimeOptions.scheduledDateInput ? runtimeOptions.scheduledDate?.toISOString() : undefined,
            rawScheduledDate: runtimeOptions.scheduledDateInput ?? undefined,
            details: {},
        };
        await prisma.$disconnect();
    } else {
        // 1. CLI 인자 파싱
        args = parseArgs();
        if (!args) {
            throw new Error("필수 인자(--type, --topic)가 누락되었습니다.");
        }
    }"""
    
    if old_main_top in content:
        content = content.replace(old_main_top, new_main_top)
    else:
        print("Could not find exact old_main_top match.")

# 3. Modify main() bottom to update DB status after publish
main_bottom = """        const publishSuccess = await publish(page, args.category, {
            mode: args.publishMode,
            scheduledDate,
        });
        if (!publishSuccess) {
            throw new Error("발행 완료 버튼을 확인하지 못했습니다.");
        }

        await page.waitForTimeout(5000);
        console.log("\\n✅ 완료!");
    } catch (error) {
        throw error;
    } finally {
        await browser.close();
    }
}"""

new_main_bottom = """        const publishSuccess = await publish(page, args.category, {
            mode: args.publishMode,
            scheduledDate,
        });
        if (!publishSuccess) {
            throw new Error("발행 완료 버튼을 확인하지 못했습니다.");
        }

        await page.waitForTimeout(5000);
        console.log("\\n✅ 완료!");
        
        // DB 상태 업데이트
        if (taskId) {
            const prisma = new PrismaClient();
            await prisma.topicPostTask.update({
                where: { id: taskId },
                data: {
                    status: args.publishMode === "schedule" ? "SCHEDULED" : "PUBLISHED",
                    postUrl: page.url(),
                }
            });
            await prisma.$disconnect();
        }
    } catch (error) {
        if (taskId) {
            try {
                const prisma = new PrismaClient();
                await prisma.topicPostTask.update({
                    where: { id: taskId },
                    data: {
                        status: "FAILED",
                        errorMessage: error instanceof Error ? error.message : String(error)
                    }
                });
                await prisma.$disconnect();
            } catch (e) {}
        }
        throw error;
    } finally {
        await browser.close();
    }
}"""

if main_bottom in content:
    content = content.replace(main_bottom, new_main_bottom)
else:
    print("Could not find exact main_bottom match.")

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Updated topic-agent.ts successfully")