# Silent install BrandConnect Automation from out/, verifying packaged editorial libs.
param(
  [string]$SetupPath = "",
  [switch]$SkipStart
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not $SetupPath) {
  $SetupPath = Join-Path $root "out\BrandConnect-Automation-Setup-1.3.54.exe"
}
if (-not (Test-Path -LiteralPath $SetupPath)) {
  throw "missing installer: $SetupPath"
}

Write-Output "Stopping BrandConnect processes..."
Get-Process | Where-Object {
  $_.ProcessName -match 'BrandConnect|BrandConnect-Automation-Setup'
} | ForEach-Object {
  Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2

$installRoot = Join-Path $env:LOCALAPPDATA "Programs\brandconnect-automation"
$uninstall = Join-Path $installRoot "Uninstall BrandConnect Automation.exe"
if (Test-Path -LiteralPath $uninstall) {
  Write-Output "Uninstalling previous copy..."
  $u = Start-Process -FilePath $uninstall -ArgumentList "/S" -PassThru
  $deadline = (Get-Date).AddMinutes(3)
  while (-not $u.HasExited -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 2 }
  if (-not $u.HasExited) { Stop-Process -Id $u.Id -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
}

Write-Output "Installing $SetupPath"
$p = Start-Process -FilePath $SetupPath -ArgumentList "/S" -PassThru
$deadline = (Get-Date).AddMinutes(5)
while (-not $p.HasExited -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 3 }
if (-not $p.HasExited) {
  throw "installer still running after 5 minutes (pid=$($p.Id))"
}
Write-Output "installer exit=$($p.ExitCode)"

$app = Join-Path $installRoot "resources\app"
$required = @(
  "package.json",
  "scripts\lib\editorial-batch-write.ts",
  "scripts\lib\editorial-templates.ts",
  "scripts\simple-agent.ts",
  "src\lib\post-composition-contract.ts"
)
foreach ($rel in $required) {
  $full = Join-Path $app $rel
  if (-not (Test-Path -LiteralPath $full)) {
    throw "installed app missing: $rel"
  }
}
$ver = (Get-Content (Join-Path $app "package.json") -Raw | ConvertFrom-Json).version
$batch = Select-String -LiteralPath (Join-Path $app "scripts\lib\editorial-templates.ts") -Pattern 'writeMode: "batch"' -Quiet
if (-not $batch) { throw "installed app missing writeMode batch" }
Write-Output "installed version=$ver batch=True"

if (-not $SkipStart) {
  $exe = Join-Path $installRoot "BrandConnect Automation.exe"
  Start-Process -FilePath $exe
  $ok = $false
  for ($i = 1; $i -le 24; $i++) {
    Start-Sleep -Seconds 5
    try {
      $r = Invoke-RestMethod "http://127.0.0.1:43127/api/system/update-readiness" -TimeoutSec 5
      Write-Output ("readiness=" + ($r | ConvertTo-Json -Compress))
      $ok = [bool]$r.data.ready
      break
    } catch {
      Write-Output "wait readiness $i"
    }
  }
  if (-not $ok) { throw "update-readiness failed after install" }
}

Write-Output "silent install ok"
