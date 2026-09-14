// Explicitly authorized one-image diagnostic. Never runs a whole batch or publishes.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const original = process.argv[2];
const jobs = JSON.parse(fs.readFileSync(original, 'utf8'));
const selected = jobs.find(job => job.id === '6');
if (!selected) throw new Error('Expected diagnostic slot 6');
const dir = fs.mkdtempSync(path.join(path.dirname(original), 'visible-diagnostic-'));
const jobsFile = path.join(dir, 'jobs.json');
fs.writeFileSync(jobsFile, JSON.stringify([{ ...selected, outStem: path.join(dir, 'generated') }]));
console.log(JSON.stringify({ diagnosticDirectory: dir, jobId: selected.id }));
const child = spawn(process.execPath, [
  'node_modules/ts-node/dist/bin.js', '--project', 'tsconfig.scripts.json',
  'scripts/chatgpt-generate-image-batch.ts', '--jobs-file', jobsFile,
  '--results-file', path.join(dir, 'results.jsonl'), '--gpt-url', 'https://chatgpt.com/'
], { cwd: path.resolve(__dirname, '..'), stdio: 'inherit', env: {
  ...process.env, DESKTOP_USER_DATA: 'C:/Users/USER/AppData/Roaming/brandconnect-automation',
  SESSION_STORAGE_DIR: 'C:/Users/USER/AppData/Roaming/brandconnect-automation/playwright/storage',
  CHATGPT_BROWSER_VISIBILITY: 'visible',
  CHATGPT_IMAGE_DIAGNOSTIC_KEEP_OPEN: 'true'
} });
child.on('exit', code => { process.exitCode = code ?? 1; });
