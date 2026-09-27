const fs = require('node:fs');
const path = require('node:path');

const REQUIRED_RELATIVE_PATHS = [
  'scripts/electron/main.cjs',
  'scripts/electron/auto-update.cjs',
  'scripts/lib/draft-runtime-policy.json',
  'scripts/lib/editorial-batch-write.ts',
  'scripts/lib/editorial-templates.ts',
  'scripts/lib/naver-editorial-style.ts',
  'scripts/simple-agent.ts',
  'src/lib/post-composition-contract.ts',
  'package.json',
];

const EXTERNAL_MAIN_RELATIVE_PATH = '../electron-runtime/main.cjs';
const MIRRORED_RUNTIME_FILES = [
  ['scripts/electron/main.cjs', '../electron-runtime/main.cjs'],
  ['scripts/electron/auto-update.cjs', '../electron-runtime/auto-update.cjs'],
  ['scripts/lib/draft-runtime-policy.json', '../lib/draft-runtime-policy.json'],
];

function resolvePackagedAppRoot(appOutDir) {
  const candidates = [path.join(appOutDir, 'resources', 'app')];
  if (appOutDir.endsWith('.app')) candidates.push(path.join(appOutDir, 'Contents', 'Resources', 'app'));
  if (fs.existsSync(appOutDir)) {
    for (const entry of fs.readdirSync(appOutDir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.endsWith('.app')) {
        candidates.push(path.join(appOutDir, entry.name, 'Contents', 'Resources', 'app'));
      }
    }
  }
  return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0];
}

function assertPackagedApp(appOutDir) {
  const appRoot = resolvePackagedAppRoot(appOutDir);
  const missing = REQUIRED_RELATIVE_PATHS.filter((relativePath) => !fs.existsSync(path.join(appRoot, relativePath)));
  if (missing.length > 0) {
    throw new Error(`PACKAGING_MISSING_FILES: ${missing.join(', ')}`);
  }
  const templates = fs.readFileSync(path.join(appRoot, 'scripts/lib/editorial-templates.ts'), 'utf8');
  if (!templates.includes('writeMode: "batch"')) {
    throw new Error('PACKAGING_MISSING_BATCH_WRITE_MODE: editorial-templates.ts must include writeMode batch');
  }

  let packagedMetadata;
  try {
    packagedMetadata = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
  } catch (error) {
    throw new Error(`PACKAGING_INVALID_PACKAGE_JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (packagedMetadata.main !== EXTERNAL_MAIN_RELATIVE_PATH) {
    throw new Error(`PACKAGING_UNSAFE_MAIN_ENTRY: expected ${EXTERNAL_MAIN_RELATIVE_PATH}, received ${packagedMetadata.main || '<missing>'}`);
  }

  const mainEntry = path.resolve(appRoot, packagedMetadata.main);
  if (!fs.existsSync(mainEntry) || !fs.statSync(mainEntry).isFile()) {
    throw new Error(`PACKAGING_MAIN_ENTRY_MISSING: ${mainEntry}`);
  }

  for (const [appRelativePath, resourceRelativePath] of MIRRORED_RUNTIME_FILES) {
    const appPath = path.resolve(appRoot, appRelativePath);
    const resourcePath = path.resolve(appRoot, resourceRelativePath);
    if (!fs.existsSync(resourcePath) || !fs.statSync(resourcePath).isFile()) {
      throw new Error(`PACKAGING_RUNTIME_MIRROR_MISSING: ${resourceRelativePath}`);
    }
    if (!fs.readFileSync(appPath).equals(fs.readFileSync(resourcePath))) {
      throw new Error(`PACKAGING_RUNTIME_MIRROR_MISMATCH: ${resourceRelativePath}`);
    }
  }

  console.log(`Packaged app main entry and runtime mirrors verified: ${mainEntry}`);
}

module.exports = {
  assertPackagedApp,
  resolvePackagedAppRoot,
  REQUIRED_RELATIVE_PATHS,
  EXTERNAL_MAIN_RELATIVE_PATH,
  MIRRORED_RUNTIME_FILES,
};
if (require.main === module) {
  assertPackagedApp(path.resolve(__dirname, '../../out/win-unpacked'));
}
