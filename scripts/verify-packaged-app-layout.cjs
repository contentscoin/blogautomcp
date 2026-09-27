const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const asar = require('@electron/asar');
const {
  assertPackagedApp,
  resolvePackagedResourcesRoot,
  resolvePackagedAppRoot,
  PACKED_MAIN,
  PACKED_REQUIRED_PATHS,
  UNPACKED_REQUIRED_PATHS,
} = require('./electron/assert-packaged-app.cjs');

async function main() {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'packaged-app-layout-'));
  try {
    const macRoot = path.join(fixtureRoot, 'BrandConnect Automation.app');
    const resourcesRoot = path.join(macRoot, 'Contents', 'Resources');
    const sourceRoot = path.join(fixtureRoot, 'source');
    const unpackedRoot = path.join(resourcesRoot, 'app.asar.unpacked');
    for (const relativePath of new Set([...PACKED_REQUIRED_PATHS, ...UNPACKED_REQUIRED_PATHS])) {
      const target = path.join(sourceRoot, relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const content = relativePath === 'package.json'
        ? JSON.stringify({ name: 'fixture', version: '1.0.0', main: PACKED_MAIN })
        : relativePath.endsWith('editorial-templates.ts')
          ? 'writeMode: "batch"'
          : 'fixture';
      fs.writeFileSync(target, content, 'utf8');
    }
    fs.mkdirSync(resourcesRoot, { recursive: true });
    await asar.createPackage(sourceRoot, path.join(resourcesRoot, 'app.asar'));
    for (const relativePath of UNPACKED_REQUIRED_PATHS) {
      const target = path.join(unpackedRoot, relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(sourceRoot, relativePath), target);
    }

    assert.equal(resolvePackagedResourcesRoot(fixtureRoot), resourcesRoot);
    assert.equal(resolvePackagedAppRoot(fixtureRoot), unpackedRoot);
    assertPackagedApp(fixtureRoot, sourceRoot);
    fs.rmSync(path.join(unpackedRoot, 'scripts/lib/draft-runtime-policy.json'));
    assert.throws(() => assertPackagedApp(fixtureRoot), /PACKAGING_UNPACKED_RUNTIME_MISSING_FILES/);

    const packagedRoot = process.argv[2];
    if (packagedRoot) assertPackagedApp(path.resolve(packagedRoot), path.resolve('.'));
    console.log('Packaged ASAR entrypoint layout checks passed.');
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
