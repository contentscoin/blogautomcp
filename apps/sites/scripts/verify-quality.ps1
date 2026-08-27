$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
Push-Location $projectRoot
try {
  & (Join-Path $projectRoot 'node_modules\.bin\tsc.cmd') --noEmit
  if ($LASTEXITCODE -ne 0) { throw 'TypeScript verification failed.' }
  & $npm run lint
  if ($LASTEXITCODE -ne 0) { throw 'Lint verification failed.' }
  & $npm audit --omit=dev
  if ($LASTEXITCODE -ne 0) { throw 'Production dependency audit failed.' }
  & pwsh -NoProfile -File (Join-Path $PSScriptRoot 'verify-local-e2e.ps1')
  if ($LASTEXITCODE -ne 0) { throw 'Local Sites E2E verification failed.' }
} finally {
  Pop-Location
}
