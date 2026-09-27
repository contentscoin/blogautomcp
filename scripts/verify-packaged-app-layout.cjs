const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  assertPackagedApp,
  resolvePackagedAppRoot,
  REQUIRED_RELATIVE_PATHS,
  EXTERNAL_MAIN_RELATIVE_PATH,
  MIRRORED_RUNTIME_FILES,
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
  fs.writeFileSync(
    path.join(macAppRoot, 'package.json'),
    JSON.stringify({ name: 'fixture', version: '1.0.0', main: EXTERNAL_MAIN_RELATIVE_PATH }),
    'utf8',
  );
  for (const [appRelativePath, resourceRelativePath] of MIRRORED_RUNTIME_FILES) {
    const source = path.join(macAppRoot, appRelativePath);
    const target = path.resolve(macAppRoot, resourceRelativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  assert.equal(resolvePackagedAppRoot(fixtureRoot), macAppRoot);
  assertPackagedApp(fixtureRoot);
  const externalMain = path.resolve(macAppRoot, EXTERNAL_MAIN_RELATIVE_PATH);
  fs.rmSync(externalMain);
  assert.throws(() => assertPackagedApp(fixtureRoot), /PACKAGING_MAIN_ENTRY_MISSING/);

  const packagedRoot = process.argv[2];
  if (packagedRoot) assertPackagedApp(path.resolve(packagedRoot));
  console.log('Packaged entrypoint layout checks passed.');
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
