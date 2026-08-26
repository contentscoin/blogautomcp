const fs = require('fs');

const code = fs.readFileSync('scripts/topic-agent.ts', 'utf8');

const regex = /\/\/ ============================================\n\/\/ LLM으로 글 생성 \(에이전틱 다단계 고도화 파이프라인\)\n\/\/ ============================================\nasync function generateAdvancedContent\([\s\S]*?\n\}\n/m;

const newFunc = `// ============================================
// LLM으로 글 생성 (에이전틱 다단계 고도화 파이프라인 - V2)
// ============================================
import { createChatGPTContext, openChatGPTTarget, sendPromptToChatGPT, ChatGPTContextHandle } from "./lib/chatgpt-browser";

async function generateAdvancedContent(
    args: TopicArgs,
    styleGuide: string
): Promise<{ title: string; sections: string[]; hashtags: string[]; imagePrompts?: any[] }> {
    console.log("\\n🚀 [Topic Agent V2] 인간 지능 모방형 파이프라인 시작 (커스텀 GPT 기반)...");

    const template = getTemplate(args.type);
    const baseKeywords = args.keywords.length > 0 ? args.keywords.join(", ") : template.seoKeywords.join(", ");
    const CHATGPT_GPT_URL_TOPIC = process.env.CHATGPT_GPT_URL_TOPIC || "https://chatgpt.com/";

    let chatgptHandle: ChatGPTContextHandle | null = null;
    
    try {
        console.log("   🌐 브라우저 세션 초기화 (ChatGPT)...");
        chatgptHandle = await createChatGPTContext(true);
        const page = await chatgptHandle.context.newPage();
        await openChatGPTTarget(page, CHATGPT_GPT_URL_TOPIC, "기획/작성 GPT");

        // [1단계] 자료조사 및 기획 (Research & Outline)
        console.log("   [1/5] 기획 스킬 적용: 웹 검색 및 스토리보드 구성 중...");
        const planPrompt = \`주제: \${args.topic}
키워드: \${baseKeywords}
상세정보: \${JSON.stringify(args.details)}

먼저 브라우징(웹 검색)을 통해 최신 트렌드와 팩트를 조사해.
그리고 서론-본론(3개)-결론으로 이어지는 상세한 목차와 각 단락의 핵심 내용을 JSON으로 기획해줘.
반드시 아래 JSON 포맷만 순수하게 반환해. 백틱이나 다른 설명 금지.
{
  "title": "검색 트렌드가 반영된 매력적인 제목",
  "storyline": "전체적인 흐름",
  "subtopics": [
    { "id": "intro", "heading": "서론 제목", "intent": "의도 및 포함할 내용" },
    { "id": "body1", "heading": "본론 1 제목", "intent": "의도 및 포함할 내용" },
    { "id": "body2", "heading": "본론 2 제목", "intent": "의도 및 포함할 내용" },
    { "id": "body3", "heading": "본론 3 제목", "intent": "의도 및 포함할 내용" },
    { "id": "outro", "heading": "결론 제목", "intent": "의도 및 포함할 내용" }
  ]
}\`;
        
        const planRes = await sendPromptToChatGPT(page, planPrompt, "1단계(기획)");
        
        let plan;
        try {
            const match = planRes.match(/(\\{[\\s\\S]*\\}|\\[[\\s\\S]*\\])/);
            plan = JSON.parse(match ? match[0] : planRes);
            if (!plan.subtopics) throw new Error("Invalid plan format");
        } catch (e) {
            console.error("   ⚠️ 기획 JSON 파싱 실패, 기본 포맷 사용");
            plan = {
                title: args.topic,
                subtopics: [
                    { id: "intro", heading: "도입", intent: "서론" },
                    { id: "body1", heading: "본론", intent: "내용" },
                    { id: "outro", heading: "결론", intent: "마무리" }
                ]
            };
        }

        // [2단계] 단락별 집중 집필 (Focused Drafting)
        console.log("   [2/5] 작성 스킬 적용: 단락별 릴레이 집중 집필 중...");
        let drafts: string[] = [];
        
        for (const sub of plan.subtopics) {
            console.log(\`     ├ 단락 작성 요청: \${sub.heading}...\`);
            const draftPrompt = \`자, 방금 네가 짠 목차 중 **[\${sub.heading}]** 부분만 먼저 500자 이상으로 매우 상세하고 깊이 있게 써줘. 팩트와 전문적인 내용, 감성적인 스토리를 모두 담아줘. JSON 없이 텍스트로만 줘.\`;
            const sectionText = await sendPromptToChatGPT(page, draftPrompt, \`2단계(\${sub.id} 작성)\`);
            drafts.push(\`<h3>\${sub.heading}</h3>\\n\\n\${sectionText}\`);
        }

        // [3단계] 전체 윤문 및 스타일 최적화 (Polishing)
        console.log("   [3/5] 편집 스킬 적용: 전체 윤문 및 톤앤매너 최적화...");
        const fullDraft = drafts.join("\\n\\n");
        const polishPrompt = \`지금까지 작성된 전체 글을 아래 스타일 가이드에 맞춰 하나의 완성된 블로그 글로 다듬어줘.
- '다퍼주는남자' 특유의 친근한 톤앤매너(~요체) 유지
- 모바일 가독성을 위해 문장을 짧게 치고, 1~2문장마다 줄바꿈(\\n\\n) 필수
- 단락(sections)별로 분리해서 JSON으로 반환
- 물결표(~) 절대 금지
- 각 단락 분량이 절대 줄어들지 않게 할 것

반드시 아래 JSON 포맷만 순수하게 반환해.
{
  "sections": ["다듬어진 서론 본문 (제목 포함 안 됨)", "다듬어진 본론 본문...", "결론..."],
  "hashtags": ["#키워드1", "#키워드2"]
}\`;
        
        const polishRes = await sendPromptToChatGPT(page, polishPrompt, "3단계(윤문)");
        
        let polished = { sections: [], hashtags: [] };
        try {
            const match = polishRes.match(/(\\{[\\s\\S]*\\}|\\[[\\s\\S]*\\])/);
            polished = JSON.parse(match ? match[0] : polishRes);
            if (!polished.sections || polished.sections.length === 0) throw new Error("Empty sections");
        } catch (e) {
            console.error("   ⚠️ 윤문 JSON 파싱 실패, 원본 사용");
            polished.sections = drafts;
            polished.hashtags = args.keywords;
        }

        // [4단계] 시각 자료 매칭 (Visual Matching)을 위한 키워드 추출
        console.log("   [4/5] 비주얼 스킬 적용: 단락별 감성 스탁 이미지 키워드 추출...");
        const imagePromptStr = \`지금 완성된 글을 바탕으로 각 단락에 어울리는 감성적인 고화질 스탁 이미지(Unsplash 등) 검색용 영단어를 추출해줘.
예: "golf course aesthetic", "coffee flatlay", "luxury resort"
단락 개수와 동일하게 검색어만 JSON 배열로 줘.

{
  "images": [
    { "searchKeyword": "golf course aesthetic" },
    { "searchKeyword": "golf swing practice" }
  ]
}\`;
        const imageRes = await sendPromptToChatGPT(page, imagePromptStr, "4단계(이미지기획)");
        
        let imageDir = { images: [] };
        try {
            const match = imageRes.match(/(\\{[\\s\\S]*\\}|\\[[\\s\\S]*\\])/);
            imageDir = JSON.parse(match ? match[0] : imageRes);
        } catch(e) {
            imageDir.images = polished.sections.map(() => ({ searchKeyword: "golf" }));
        }

        console.log(\`   ✅ 콘텐츠 생성 완료: "\${plan.title}"\`);
        
        return {
            title: plan.title,
            sections: polished.sections,
            hashtags: polished.hashtags,
            imagePrompts: imageDir.images
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

if (!regex.test(code)) {
    console.error("Could not find generateAdvancedContent function block.");
    process.exit(1);
}

const newCode = code.replace(regex, newFunc);
// Remove duplicate import of playwright-extra since chatgpt-browser uses it, but topic-agent might need it.
// We will just let the StrReplace handle imports cleanly.
fs.writeFileSync('scripts/topic-agent.ts', newCode);
console.log("Updated topic-agent.ts");
