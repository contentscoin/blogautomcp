const fs = require('fs');
let code = fs.readFileSync('scripts/topic-agent.ts', 'utf8');

// The replacement I did above removed "async function openEditor("
const searchStr = `// ============================================
// 블로그 에디터 조작 함수들 (simple-agent에서 재사용)
// ============================================
page: Page): Promise<void> {`;

const replaceStr = `// ============================================
// 블로그 에디터 조작 함수들 (simple-agent에서 재사용)
// ============================================
async function openEditor(page: Page): Promise<void> {`;

if (code.includes(searchStr)) {
    code = code.replace(searchStr, replaceStr);
    fs.writeFileSync('scripts/topic-agent.ts', code);
    console.log("Fixed openEditor signature");
} else {
    console.log("Not found, let's search for the exact text");
    const testIdx = code.indexOf("page: Page): Promise<void> {");
    if (testIdx > -1) {
        console.log("Found snippet around: ", code.substring(testIdx - 50, testIdx + 50));
    }
}
