const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');

const PACKED_MAIN = 'scripts/electron/main.cjs';
const PACKED_REQUIRED_PATHS = [
  'package.json',
  PACKED_MAIN,
  'scripts/electron/auto-update.cjs',
];
const UNPACKED_REQUIRED_PATHS = [
  'package.json',
  'next.config.ts',
  'tsconfig.json',
  'tsconfig.scripts.json',
  'scripts/lib/draft-runtime-policy.json',
  'scripts/lib/editorial-batch-write.ts',
  'scripts/lib/editorial-templates.ts',
  'scripts/lib/naver-editorial-style.ts',
  'scripts/simple-agent.ts',
  'src/lib/post-composition-contract.ts',
];

function resolvePackagedResourcesRoot(appOutDir) {
  const candidates = [path.join(appOutDir, 'resources')];
  if (appOutDir.endsWith('.app')) candidates.push(path.join(appOutDir, 'Contents', 'Resources'));
  if (fs.existsSync(appOutDir)) {
    for (const entry of fs.readdirSync(appOutDir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.endsWith('.app')) {
        candidates.push(path.join(appOutDir, entry.name, 'Contents', 'Resources'));
      }
    }
  }
  return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0];
}

function resolvePackagedAppRoot(appOutDir) {
  return path.join(resolvePackagedResourcesRoot(appOutDir), 'app.asar.unpacked');
}

function normalizeArchiveEntry(entry) {
  return entry.replace(/^[/\\]+/, '').replace(/\\/g, '/');
}

function archiveLookupPath(relativePath) {
  return relativePath.replace(/\//g, path.sep);
}

function assertPackagedApp(appOutDir, sourceRoot = null) {
  const resourcesRoot = resolvePackagedResourcesRoot(appOutDir);
  const archivePath = path.join(resourcesRoot, 'app.asar');
  const unpackedRoot = path.join(resourcesRoot, 'app.asar.unpacked');
  if (!fs.existsSync(archivePath) || !fs.statSync(archivePath).isFile()) {
    throw new Error(`PACKAGING_ASAR_MISSING: ${archivePath}`);
  }
  if (!fs.existsSync(unpackedRoot) || !fs.statSync(unpackedRoot).isDirectory()) {
    throw new Error(`PACKAGING_UNPACKED_RUNTIME_MISSING: ${unpackedRoot}`);
  }

  const archiveEntries = new Set(asar.listPackage(archivePath).map(normalizeArchiveEntry));
  const missingPacked = PACKED_REQUIRED_PATHS.filter(relativePath => !archiveEntries.has(relativePath));
  if (missingPacked.length > 0) {
    throw new Error(`PACKAGING_ASAR_MISSING_FILES: ${missingPacked.join(', ')}`);
  }

  let packagedMetadata;
  try {
    packagedMetadata = JSON.parse(asar.extractFile(archivePath, archiveLookupPath('package.json')).toString('utf8'));
  } catch (error) {
    throw new Error(`PACKAGING_INVALID_PACKAGE_JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (packagedMetadata.main !== PACKED_MAIN) {
    throw new Error(`PACKAGING_UNSAFE_MAIN_ENTRY: expected ${PACKED_MAIN}, received ${packagedMetadata.main || '<missing>'}`);
  }

  const missingUnpacked = UNPACKED_REQUIRED_PATHS.filter(relativePath => !fs.existsSync(path.join(unpackedRoot, relativePath)));
  if (missingUnpacked.length > 0) {
    throw new Error(`PACKAGING_UNPACKED_RUNTIME_MISSING_FILES: ${missingUnpacked.join(', ')}`);
  }
  const templates = fs.readFileSync(path.join(unpackedRoot, 'scripts/lib/editorial-templates.ts'), 'utf8');
  if (!templates.includes('writeMode: "batch"')) {
    throw new Error('PACKAGING_MISSING_BATCH_WRITE_MODE: editorial-templates.ts must include writeMode batch');
  }

  if (sourceRoot) {
    for (const relativePath of ['scripts/electron/main.cjs', 'scripts/electron/auto-update.cjs']) {
      const packedBytes = asar.extractFile(archivePath, archiveLookupPath(relativePath));
      const sourceBytes = fs.readFileSync(path.join(sourceRoot, relativePath));
      if (!packedBytes.equals(sourceBytes)) {
        throw new Error(`PACKAGING_ASAR_SOURCE_MISMATCH: ${relativePath}`);
      }
    }
  }

  console.log(`Packaged ASAR main and unpacked runtime verified: ${archivePath}`);
}

module.exports = {
  assertPackagedApp,
  resolvePackagedResourcesRoot,
  resolvePackagedAppRoot,
  PACKED_MAIN,
  PACKED_REQUIRED_PATHS,
  UNPACKED_REQUIRED_PATHS,
};
if (require.main === module) {
  assertPackagedApp(path.resolve(__dirname, '../../out/win-unpacked'), path.resolve(__dirname, '../..'));
}
