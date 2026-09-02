import fs from "fs";
import path from "path";

const scriptPath = path.join(process.cwd(), "scripts", "topic-agent.ts");
let content = fs.readFileSync(scriptPath, "utf-8");

const imageGenLogic = `
        // 일반 텍스트 생성 모드 -> 에이전틱 고도화 파이프라인으로 대체
        const advancedContent = await generateAdvancedContent(args, styleGuide);
        content = {
            title: advancedContent.title,
            sections: advancedContent.sections,
            hashtags: advancedContent.hashtags,
        };
        
        console.log(\`\\n📷 일반 ChatGPT를 활용한 이미지 생성 시작\`);
        
        const autoImageDir = path.join(IMAGE_WORK_DIR, \`auto-\${Date.now()}\`);
        if (!fs.existsSync(autoImageDir)) {
            fs.mkdirSync(autoImageDir, { recursive: true });
        }
        
        const CHATGPT_BASE_URL = "https://chatgpt.com/";
        
        let imageGptHandle = null;
        try {
            console.log("   🌐 이미지 생성 GPT 브라우저 세션 초기화...");
            imageGptHandle = await createChatGPTContext(true);
            const imagePage = await imageGptHandle.context.newPage();
            
            await openChatGPTTarget(imagePage, CHATGPT_BASE_URL, "이미지 생성 ChatGPT");
            
            console.log("   [1/2] 이미지 생성 GPT에 내용 전달 중...");
            const imagePrompt = \`다음 블로그 글 내용에 어울리는 고품질 이미지를 3장 생성해줘:\\n\\n\${content.sections.join("\\n\\n").substring(0, 1500)}\`;
            await sendPromptToChatGPT(imagePage, imagePrompt, "이미지 생성 요청");
            
            // Wait extra time for DALL-E to generate
            console.log("   [2/2] 이미지 생성 대기 중 (최대 2분)...");
            await imagePage.waitForTimeout(30000); // 30s base wait for images to be generated
            
            // Extract images using the new downloadChatGPTImages
            // Note: need to import it if it's exported from chatgpt-browser.ts
            // Actually, we can just call the function we added to chatgpt-browser.ts
            
            const downloadedPaths = await (await import("./lib/chatgpt-browser.js")).downloadChatGPTImages(imagePage, autoImageDir);
            
            if (downloadedPaths.length > 0) {
                imagePaths = downloadedPaths;
            } else {
                console.log("   ⚠️ 이미지 생성 실패, 기본 텍스트만 발행합니다.");
            }
        } catch (e) {
            console.error("❌ 이미지 생성 파이프라인 에러:", e);
        } finally {
            if (imageGptHandle) {
                await imageGptHandle.close();
            }
        }
`;

// Regex replacement
content = content.replace(
    /\/\/ 일반 텍스트 생성 모드 \-\> 에이전틱 고도화 파이프라인으로 대체[\s\S]*?(?=await new Promise\(resolve \=\> setTimeout\(resolve, 1500\)\); \/\/ Rate limit 방지\n        \}\n    \})/m,
    imageGenLogic + "        // dummy close bracket replacement\n"
);
// Above regex is tricky. Let's do string split and replace
const startSearch = "// 일반 텍스트 생성 모드 -> 에이전틱 고도화 파이프라인으로 대체";
const endSearch = "    console.log(\"\\n\" + \"─\".repeat(40));\n    console.log(\"📝 생성된 콘텐츠 미리보기:\");";

const sIdx = content.indexOf(startSearch);
const eIdx = content.indexOf(endSearch);

if (sIdx !== -1 && eIdx !== -1) {
    const before = content.substring(0, sIdx);
    const after = content.substring(eIdx);
    content = before + imageGenLogic + "\n    }\n\n" + after;
    fs.writeFileSync(scriptPath, content);
    console.log("Replaced image logic successfully");
} else {
    console.log("Could not find start/end index for image logic", {sIdx, eIdx});
}
