const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  assertPackagedApp,
  resolvePackagedAppRoot,
  REQUIRED_RELATIVE_PATHS,
} = require('./electron/assert-packaged-app.cjs');

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'packaged-app-layout-'));
try {
  const macAppRoot = path.join(fixtureRoot, 'BrandConnect Automation.app', 'Contents', 'Resources', 'app');
  for (const relativePath of REQUIRED_RELATIVE_PATHS) {
    const target = path.join(macAppRoot, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      relativePath.endsWith('editorial-templates.ts') ? 'writeMode: "batch"' : 'fixture',
      'utf8',
    );
  }
  assert.equal(resolvePackagedAppRoot(fixtureRoot), macAppRoot);
  assertPackagedApp(fixtureRoot);
  assertPackagedApp(path.resolve('out/release-1.3.77/win-unpacked'));
  console.log('Packaged Windows and macOS layout checks passed.');
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
