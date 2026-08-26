const fs = require('fs');

let code = fs.readFileSync('scripts/topic-agent.ts', 'utf8');

const targetStr = `    if (process.env.AI_PROVIDER === "gemini" && genAI) {`;

const newCode = `    if (process.env.AI_PROVIDER === "gemini" && genAI) {`;

// Let's actually restore the fallback logic to use runOpenCode if not gemini
// Since we completely replaced it earlier, let's look at git history to get the opencode fallback

