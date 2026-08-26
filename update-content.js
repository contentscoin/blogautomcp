const fs = require('fs');

let code = fs.readFileSync('scripts/topic-agent.ts', 'utf8');

// Find the function definition
const startStr = "async function generateAdvancedContent(";
const startIdx = code.indexOf(startStr);

if (startIdx === -1) {
  console.error("Function not found");
  process.exit(1);
}

// Find the end of the function. We know it ends before openEditor
const nextFuncStr = "async function openEditor(";
const endIdx = code.indexOf(nextFuncStr, startIdx);

if (endIdx === -1) {
  console.error("Next function not found");
  process.exit(1);
}

// Replace the block
const oldFunc = code.substring(startIdx, endIdx);

const newFunc = `async function generateAdvancedContent(
    args: TopicArgs,
    styleGuide: string
): Promise<{ title: string; sections: string[]; hashtags: string[]; imagePrompts?: any[] }> {
    console.log("\\n🚀 Opal AI 에이전트 기반 고도화 파이프라인 시작...");

    const template = getTemplate(args.type);
    const baseKeywords = args.keywords.length > 0 ? args.keywords.join(", ") : template.seoKeywords.join(", ");

    let plan;
    let drafts: string[] = [];
    let polished: { sections: string[], hashtags: string[] } = { sections: [], hashtags: [] };
    let imageDir: { images: any[] } = { images: [] };

    if (!genAI) {
        throw new Error("Gemini API가 활성화되지 않았습니다. .env에서 AI_PROVIDER=gemini 및 GEMINI_API_KEY를 확인하세요.");
    }
    const geminiModel = genAI.getGenerativeModel({ model: GEMINI_MODEL });

    try {
        console.log("   [1/4] 기획 스킬 적용: 주제 및 스토리보드 구성 중...");
        const planPrompt = \`당신은 구글의 최신 AI 에이전트 플랫폼 'Opal'을 기반으로 작동하는 최고 수준의 전문 블로그 기획자이자 작가입니다. 단순한 정보 전달을 넘어, 깊이 있는 추론과 완벽한 스토리텔링으로 독자를 사로잡는 글을 기획합니다.
주제: \${args.topic}
키워드: \${baseKeywords}
상세정보: \${JSON.stringify(args.details)}

이 주제를 바탕으로 독자의 이목을 완벽히 끄는 프리미엄 블로그 포스팅 기획안을 작성하세요.
Opal 에이전트 특유의 심도 깊은 통찰력을 담아 정보가 풍부하고 길이가 길어야 합니다. 각 단락은 최소 300자 이상, 전체 글은 최소 2000자 이상이 되도록 매우 풍성하고 논리적인 내용을 기획하세요.

반드시 아래 JSON 포맷을 정확히 지켜서 출력하세요. 다른 설명이나 마크다운 백틱(\\\`\\\`\\\`) 없이 순수한 JSON만 반환해야 파싱 오류가 나지 않습니다.

{
  "title": "매력적이고 클릭을 유도하는 SEO 최적화 제목",
  "storyline": "이 포스팅을 관통하는 전체적인 스토리텔링의 흐름과 독자에게 전달할 감정선 (2-3문장)",
  "subtopics": [
    { "id": 1, "heading": "소주제 1", "intent": "이 단락에서 전달할 핵심 메시지와 분위기. 어떤 구체적인 정보나 팁이 들어갈지 상세히 기재." },
    { "id": 2, "heading": "소주제 2", "intent": "이 단락에서 전달할 핵심 메시지와 분위기" }
  ]
}\`;
        const planRes = await geminiModel.generateContent(planPrompt);
        const planJsonStr = planRes.response.text();
        const match1 = planJsonStr.match(/(\\{[\\s\\S]*\\}|\\[[\\s\\S]*\\])/);
        plan = JSON.parse(match1 ? match1[0] : planJsonStr);

        console.log("   [2/4] 작성 스킬 적용: 세부 스토리텔링 초안 작성 중...");
        const draftPrompt = \`당신은 최상위 AI 에이전트 'Opal'의 메인 스토리 작가입니다. 방대한 지식과 유려한 필력을 자랑합니다.
기획안: \${JSON.stringify(plan)}

위 기획안의 'storyline'을 바탕으로, 각 'subtopics'에 해당하는 세부 본문 초안을 아주 길고 상세하게 작성해주세요.
단순한 정보 나열이 아닌, 독자가 몰입할 수 있는 스토리텔링 방식으로 전개하되, 각 단락마다 아주 구체적이고 실용적인 정보(예: 골프공 피스별 차이점, 딤플의 원리, 추천 모델 특징 등)를 꽉꽉 채워 넣어야 합니다.
**각 단락(draft)은 반드시 최소 400~600자 이상의 충분한 길이여야 하며, 깊이 있는 전문가적 시각을 보여주세요.**

반드시 아래 JSON 포맷을 정확히 지켜서 출력하세요. 다른 설명 없이 순수한 JSON만 반환해야 합니다.

{
  "drafts": [
    "소주제 1의 본문 초안 (최소 400자 이상, 구체적인 정보와 스토리 포함)",
    "소주제 2의 본문 초안 (최소 400자 이상, 구체적인 정보와 스토리 포함)"
  ]
}\`;
        const draftRes = await geminiModel.generateContent(draftPrompt);
        const draftJsonStr = draftRes.response.text();
        const match2 = draftJsonStr.match(/(\\{[\\s\\S]*\\}|\\[[\\s\\S]*\\])/);
        const parsedDrafts = JSON.parse(match2 ? match2[0] : draftJsonStr);
        drafts = parsedDrafts.drafts || parsedDrafts;
        if (!Array.isArray(drafts)) drafts = [String(drafts)];

        console.log("   [3/4] 편집 스킬 적용: 모바일 최적화 및 스타일 고도화 중...");
        const polishPrompt = \`당신은 네이버 블로그 전문 모바일 에디터이자 Opal AI 시스템의 최종 검수자입니다.
다음은 작성된 본문 초안입니다:
\${JSON.stringify(drafts)}

\${styleGuide}

본문의 내용을 절대 축약하거나 삭제하지 마세요. 정보의 양을 그대로 유지하되 모바일 가독성만 최적화해야 합니다.
다음 규칙을 완벽히 지켜서 글을 고도화해주세요:
- 본문의 길이는 그대로 유지하거나 더 풍부하게 살립니다 (각 단락 최소 300자 이상).
- 한 문장은 짧고 간결하게 (50자 이내) 끊어치세요.
- 모바일에서 글이 빽빽해 보이지 않도록 1~2문장마다 줄바꿈(\\\\n\\\\n) 필수 적용.
- 기계적인 설명이 아닌 독자에게 직접 이야기하듯 생생한 감성적 어조 사용.
- 적절하고 다채로운 이모지 삽입.
- 물결표(~) 기호는 취소선으로 인식되므로 절대 사용 금지 (대신 '-' 사용).
- 본문 내에 '[사진 자리: ...]' 같은 텍스트 절대 사용 금지.

반드시 아래 JSON 포맷을 정확히 지켜서 출력하세요. 다른 설명 없이 순수한 JSON만 반환해야 합니다.
반드시 drafts로 전달받은 모든 단락을 고도화하여 돌려주어야 합니다.

{
  "sections": [
    "고도화된 단락 1 본문 (내용 축소 금지)",
    "고도화된 단락 2 본문"
  ],
  "hashtags": ["#해시태그1", "#해시태그2"]
}\`;
        const polishRes = await geminiModel.generateContent(polishPrompt);
        const polishJsonStr = polishRes.response.text();
        const match3 = polishJsonStr.match(/(\\{[\\s\\S]*\\}|\\[[\\s\\S]*\\])/);
        polished = JSON.parse(match3 ? match3[0] : polishJsonStr);

        console.log("   [4/4] 비주얼 스킬 적용: 단락별 이미지 키워드 및 프롬프트 기획 중...");
        const sectionsToUse = polished.sections && polished.sections.length > 0 ? polished.sections : drafts;
        const imagePromptStr = \`당신은 Opal AI 플랫폼 소속 수석 시각 디자인 디렉터입니다.
블로그 주제: \${plan.title || args.topic}
본문 단락들:
\${JSON.stringify(sectionsToUse)}

각 단락의 내용과 분위기에 완벽하게 어울리는 사진을 찾거나 생성하기 위해 기획해주세요.
무료 이미지 사이트(예: loremflickr)에서 검색하기 좋은 1~2개의 영단어 조합(searchKeyword)과, 전문 AI 이미지 생성기(FLUX, Midjourney 등)를 위한 정교한 영어 프롬프트(imagePrompt)를 모두 작성해주세요.
단락 개수와 동일하게 이미지 기획을 만들어주세요.

**프롬프트 작성 가이드:**
- 사진은 사실적이고(photorealistic), 전문 포토그래퍼가 찍은 듯한 고품질(high quality, masterpiece, 8k, highly detailed)이어야 합니다.
- 텍스트나 로고가 들어가지 않도록 프롬프트를 구성하세요 (no text, no logo, no watermark).
- 구체적인 장소, 피사체, 조명(lighting), 구도(composition), 분위기(mood)를 영어 명사구 중심으로 상세히 묘사하세요.
- 카메라 렌즈 설정(예: 35mm lens, f/1.8), 필름 종류, 각도(wide angle, close up) 등 사진학적 디테일을 추가하면 좋습니다.
- 인물이 없는(no people) 정물이나 배경 위주의 사진이 블로그 썸네일로 좋습니다.
- **매우 중요**: searchKeyword는 반드시 1개의 영어 단어만 사용하세요. (예: "golf", "ball", "grass", "sunset"). 여러 단어를 쓰면 무료 이미지 사이트에서 검색이 실패합니다!

반드시 아래 JSON 포맷을 정확히 지켜서 출력하세요. 다른 설명 없이 순수한 JSON만 반환해야 합니다.

{
  "images": [
    {
      "searchKeyword": "golf",
      "imagePrompt": "A photorealistic close-up of a premium white golf ball resting on perfectly manicured green grass, morning dew, warm morning sunlight, shallow depth of field, 35mm lens, f/1.8, highly detailed, 8k, cinematic lighting, no text, no watermark"
    }
  ]
}\`;
        const imageRes = await geminiModel.generateContent(imagePromptStr);
        const imageDirJsonStr = imageRes.response.text();
        const match4 = imageDirJsonStr.match(/(\\{[\\s\\S]*\\}|\\[[\\s\\S]*\\])/);
        imageDir = JSON.parse(match4 ? match4[0] : imageDirJsonStr);

    } catch (e) {
        console.error("Gemini API 호출 중 에러 발생:", e);
        throw e;
    }

    console.log(\`   ✅ 생성 완료: "\${plan?.title || args.topic}"\`);
    return {
        title: plan?.title || args.topic,
        sections: polished.sections && polished.sections.length > 0 ? polished.sections : drafts,
        hashtags: polished.hashtags && polished.hashtags.length > 0 ? polished.hashtags : args.keywords,
        imagePrompts: imageDir.images || []
    };
}

// ============================================
// 블로그 에디터 조작 함수들 (simple-agent에서 재사용)
// ============================================
`;

code = code.substring(0, startIdx) + newFunc + code.substring(endIdx + nextFuncStr.length);
fs.writeFileSync('scripts/topic-agent.ts', code);
console.log("Updated script successfully.");
