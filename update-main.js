const fs = require('fs');

const code = fs.readFileSync('scripts/topic-agent.ts', 'utf8');

// I will just look for the start and end of the image block.
const startStr = "let imageGenerated = false;";
const endStr = "// 4. 발행 여부 확인 (테스트용으로 일단 생성만)";

const startIndex = code.indexOf(startStr);
const endIndex = code.indexOf(endStr);

if (startIndex === -1 || endIndex === -1) {
    console.error("Could not find start or end index.");
    process.exit(1);
}

// Ensure the replace bounds
const blockToReplace = code.substring(startIndex, code.indexOf("if (fs.existsSync(destPath)) {", startIndex));

const newBlock = `let imageGenerated = await downloadHighQualityStockImage(keyword, destPath);
            `;

const newCode = code.replace(blockToReplace, newBlock);

const importStr = `import { downloadHighQualityStockImage } from "./lib/image-stock";\n`;
const insertImportIndex = newCode.indexOf('import { createTaskLogger } from "./lib/logger";') + 'import { createTaskLogger } from "./lib/logger";'.length + 1;
const finalCode = newCode.substring(0, insertImportIndex) + importStr + newCode.substring(insertImportIndex);

fs.writeFileSync('scripts/topic-agent.ts', finalCode);
console.log("Updated main in topic-agent.ts");
