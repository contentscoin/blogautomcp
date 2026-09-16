const fs = require('node:fs');
const path = require('node:path');

const REQUIRED_RELATIVE_PATHS = [
  'scripts/lib/editorial-batch-write.ts',
  'scripts/lib/editorial-templates.ts',
  'scripts/lib/naver-editorial-style.ts',
  'scripts/simple-agent.ts',
  'src/lib/post-composition-contract.ts',
  'package.json',
];

function assertPackagedApp(appOutDir) {
  const appRoot = path.join(appOutDir, 'resources', 'app');
  const missing = REQUIRED_RELATIVE_PATHS.filter((relativePath) => !fs.existsSync(path.join(appRoot, relativePath)));
  if (missing.length > 0) {
    throw new Error(`PACKAGING_MISSING_FILES: ${missing.join(', ')}`);
  }
  const templates = fs.readFileSync(path.join(appRoot, 'scripts/lib/editorial-templates.ts'), 'utf8');
  if (!templates.includes('writeMode: "batch"')) {
    throw new Error('PACKAGING_MISSING_BATCH_WRITE_MODE: editorial-templates.ts must include writeMode batch');
  }
  console.log('Packaged app contains required editorial batch-write files.');
}

module.exports = { assertPackagedApp, REQUIRED_RELATIVE_PATHS };
if (require.main === module) {
  assertPackagedApp(path.resolve(__dirname, '../../out/win-unpacked'));
}
