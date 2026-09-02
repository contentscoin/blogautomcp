import fs from "fs";
import path from "path";

const scriptPath = path.join(process.cwd(), "scripts", "topic-agent.ts");
let content = fs.readFileSync(scriptPath, "utf-8");

const newContentLogic = `
async function generateAdvancedContent(
    args: TopicArgs,
    styleGuide: string
): Promise<{ title: string; sections: string[]; hashtags: string[]; imagePrompts?: any[] }> {
    console.log("\\n🚀 [Topic Agent V2] 일반 ChatGPT 기반 파이프라인 시작...");

    const template = getTemplate(args.type);
    const baseKeywords = args.keywords.length > 0 ? args.keywords.join(", ") : template.seoKeywords.join(", ");
    
    const CHATGPT_BASE_URL = "https://chatgpt.com/";

    let chatgptHandle: ChatGPTContextHandle | null = null;
    
    try {
        console.log("   🌐 브라우저 세션 초기화 (ChatGPT)...");
        chatgptHandle = await createChatGPTContext(true);
        const page = await chatgptHandle.context.newPage();
        
        // 1. 글 생성 파이프라인
        await openChatGPTTarget(page, CHATGPT_BASE_URL, "글 생성 ChatGPT");
        
        console.log("   [1/3] GPT와 대화 시작 (안녕하세요)...");
        await sendPromptToChatGPT(page, "안녕하세요", "인사");
        
        const contentPrompt = \`주제: \${args.topic}\\n키워드: \${baseKeywords}\\n상세정보: \${JSON.stringify(args.details)}\\n\\n절차에 따라 진행해.\`;
        console.log("   [2/3] 주제 및 키워드 전달 중...");
        let contentRes = await sendPromptToChatGPT(page, contentPrompt, "주제 전달");
        
        let finalContent = contentRes;
        
        // GPT가 확인을 요구하는 경우 계속 진행하도록 루프
        for (let i = 0; i < 5; i++) {
            if (finalContent.includes("진행할까요") || finalContent.includes("작성해 드릴까요") || finalContent.includes("다음 단계") || finalContent.includes("진행해 드릴까요") || finalContent.includes("시작할까요")) {
                console.log(\`   [대화] GPT 응답에 진행 여부 확인 메시지가 포함됨. (\${i+1}차 계속 요청)\`);
                let res = await sendPromptToChatGPT(page, "네, 다음 절차를 계속 진행해서 블로그 본문을 완성해주세요.", "계속 진행");
                finalContent += "\\n\\n" + res;
            } else {
                // If it asks nothing, we might still want to explicitly ask for the final blog post if it just printed an outline
                if (finalContent.includes("목차") && !finalContent.includes("결론")) {
                    console.log(\`   [대화] 목차만 출력된 것으로 보임. 본문 작성 요청...\`);
                    let res = await sendPromptToChatGPT(page, "위 목차를 바탕으로 최종 블로그 본문 전체를 작성해주세요.", "본문 작성");
                    finalContent += "\\n\\n" + res;
                } else {
                    break;
                }
            }
        }
        
        console.log("   ✅ 글 생성 완료");

        // 마크다운 형태의 텍스트를 섹션으로 분리
        const lines = finalContent.split('\\n');
        let title = args.topic;
        const sections: string[] = [];
        let currentSection = "";
        
        for (let line of lines) {
            if (line.match(/^#+\\s/)) {
                if (currentSection.trim()) {
                    sections.push(currentSection.trim());
                    currentSection = "";
                }
                if (line.startsWith("# ") || line.startsWith("## ")) {
                    // Use the first header as title if not set
                    if (sections.length === 0 && title === args.topic) {
                        title = line.replace(/^#+\\s*/, "").replace(/\\*/g, "").trim();
                    } else {
                        currentSection += line + "\\n";
                    }
                } else {
                    currentSection += line + "\\n";
                }
            } else {
                currentSection += line + "\\n";
            }
        }
        if (currentSection.trim()) sections.push(currentSection.trim());
        if (sections.length === 0) sections.push(finalContent);

        // 이미지 생성을 위한 프롬프트는 빈 배열로 리턴하여 메인 함수에서 이미지 생성 파이프라인으로 넘기게 함
        // (이전의 JSON 파싱 방식 제거)
        return {
            title: title,
            sections: sections,
            hashtags: args.keywords,
            imagePrompts: [] // Not used in new flow directly from content parsing
        };

    } catch (error) {
        console.error("❌ ChatGPT 파이프라인 에러:", error);
        throw error;
    } finally {
        if (chatgptHandle) {
            await chatgptHandle.close();
        }
    }
}
`;

// replace generateAdvancedContent function
const startIdx = content.indexOf('async function generateAdvancedContent');
const endIdx = content.indexOf('async function openEditor(page: Page)');

if (startIdx !== -1 && endIdx !== -1) {
    const before = content.substring(0, startIdx);
    const after = content.substring(endIdx);
    content = before + newContentLogic + '\n// ============================================\n// 블로그 에디터 조작 함수들 (simple-agent에서 재사용)\n// ============================================\n' + after.replace('// ============================================\n// 블로그 에디터 조작 함수들 (simple-agent에서 재사용)\n// ============================================\nasync function openEditor', 'async function openEditor');
    fs.writeFileSync(scriptPath, content);
    console.log("Replaced generateAdvancedContent successfully");
} else {
    console.log("Could not find start/end index");
}
