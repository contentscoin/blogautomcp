param(
  [string]$AppPath = 'out/win-unpacked/BrandConnect Automation.exe',
  [int]$AppPort = 43129,
  [int]$UpdatePort = 43130
)

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$resolvedAppPath = [IO.Path]::GetFullPath((Join-Path $projectRoot $AppPath))
$expectedAppRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'out\win-unpacked'))
if (-not $resolvedAppPath.StartsWith($expectedAppRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw '패키지 실행 파일이 예상 out/win-unpacked 폴더 밖에 있습니다.'
}
if (-not (Test-Path -LiteralPath $resolvedAppPath -PathType Leaf)) { throw "패키지 실행 파일을 찾지 못했습니다: $resolvedAppPath" }
if (Get-NetTCPConnection -State Listen -LocalPort $AppPort,$UpdatePort -ErrorAction SilentlyContinue) { throw '패키지 검증 포트가 이미 사용 중입니다.' }
$preexistingAppProcessIds = @(
  Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath) -eq $resolvedAppPath
  } | ForEach-Object { [int]$_.ProcessId }
)

$packagedPackagePath = Join-Path $expectedAppRoot 'resources\app\package.json'
if (-not (Test-Path -LiteralPath $packagedPackagePath -PathType Leaf)) { throw '패키지 앱의 package.json을 찾지 못했습니다.' }
$currentVersion = [string]((Get-Content -LiteralPath $packagedPackagePath -Raw | ConvertFrom-Json).version)
$versionMatch = [regex]::Match($currentVersion, '^(\d+)\.(\d+)\.(\d+)$')
if (-not $versionMatch.Success) { throw "패키지 앱 버전 형식이 올바르지 않습니다: $currentVersion" }
$detectedVersion = '{0}.{1}.{2}' -f $versionMatch.Groups[1].Value,$versionMatch.Groups[2].Value,([int]$versionMatch.Groups[3].Value + 1)
$detectedVersionPattern = [regex]::Escape($detectedVersion)

$temporaryBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$testRoot = [IO.Path]::GetFullPath((Join-Path $temporaryBase ("blogautomcp-packaged-update-" + [guid]::NewGuid().ToString('N'))))
if (-not $testRoot.StartsWith($temporaryBase, [StringComparison]::OrdinalIgnoreCase)) { throw '임시 검증 폴더가 시스템 임시 폴더 밖에 있습니다.' }
New-Item -ItemType Directory -Path $testRoot | Out-Null

$serverOut = Join-Path $testRoot 'fake-update.out.log'
$serverErr = Join-Path $testRoot 'fake-update.err.log'
$token = 'B' * 43
$serverProcess = $null
$appProcess = $null

function Wait-Until {
  param([scriptblock]$Condition, [int]$TimeoutSeconds, [string]$FailureMessage)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (& $Condition) { return }
    Start-Sleep -Milliseconds 250
  }
  throw $FailureMessage
}

try {
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $serverScript = Join-Path $projectRoot 'scripts\fixtures\fake-update-server.mjs'
  $serverProcess = Start-Process -FilePath $node -ArgumentList @($serverScript) -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $serverOut -RedirectStandardError $serverErr -Environment @{
    FAKE_UPDATE_PORT = [string]$UpdatePort
    FAKE_UPDATE_TOKEN = $token
    FAKE_UPDATE_VERSION = $detectedVersion
  }
  Wait-Until -TimeoutSeconds 20 -FailureMessage '가짜 중앙 업데이트 서버가 시작되지 않았습니다.' -Condition {
    (Test-Path -LiteralPath $serverOut) -and ((Get-Content -LiteralPath $serverOut -Raw -ErrorAction SilentlyContinue) -match "READY $UpdatePort")
  }

  $appProcess = Start-Process -FilePath $resolvedAppPath -ArgumentList @('--hidden', "--user-data-dir=$testRoot") -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -Environment @{
    APP_HOST = '127.0.0.1'
    APP_PORT = [string]$AppPort
    DISABLE_AUTO_START = '1'
    AUTO_UPDATE_ALLOW_LOCAL_HTTP = '1'
    AUTO_UPDATE_FORCE = '1'
    AUTO_UPDATE_TEST_MODE = '1'
    AUTO_UPDATE_DOWNLOAD = 'false'
    AUTO_UPDATE_START_DELAY_MS = '100'
    AUTO_UPDATE_CHECK_INTERVAL_MS = '60000'
    REMOTE_SITE_URL = "http://127.0.0.1:$UpdatePort"
    REMOTE_DEVICE_ID = 'device_packaged_smoke'
    REMOTE_DEVICE_TOKEN = $token
  }

  $readiness = $null
  Wait-Until -TimeoutSeconds 120 -FailureMessage "패키지 앱이 $detectedVersion 업데이트를 감지하지 못했습니다." -Condition {
    try {
      $script:readiness = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$AppPort/api/system/update-readiness" -TimeoutSec 3
      return $script:readiness.success -and $script:readiness.data.update.status -eq 'available' -and $script:readiness.data.update.version -eq $detectedVersion
    } catch {
      return $false
    }
  }

  $rootResponse = Invoke-WebRequest -Method Get -Uri "http://127.0.0.1:$AppPort/" -TimeoutSec 5
  if ($rootResponse.StatusCode -ne 200) { throw '패키지 앱의 로컬 화면이 응답하지 않습니다.' }

  $controlBefore = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$AppPort/api/system/control" -TimeoutSec 5
  if (-not $controlBefore.success -or -not $controlBefore.data.available) {
    throw 'Electron 제어 브리지가 준비되지 않았습니다.'
  }
  $controlHeaders = @{
    Origin = "http://127.0.0.1:$AppPort"
    'Sec-Fetch-Site' = 'same-origin'
  }
  $manualUpdate = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$AppPort/api/system/control" -Headers $controlHeaders -ContentType 'application/json' -Body '{"action":"check-updates"}' -TimeoutSec 15
  if (-not $manualUpdate.success -or $manualUpdate.data.update.status -ne 'available') {
    throw 'Electron 수동 업데이트 확인 명령이 실행되지 않았습니다.'
  }

  $mainProcessId = $appProcess.Id
  $restartResponse = Invoke-WebRequest -Method Post -Uri "http://127.0.0.1:$AppPort/api/system/control" -Headers $controlHeaders -ContentType 'application/json' -Body '{"action":"restart-server"}' -SkipHttpErrorCheck -TimeoutSec 10
  if ($restartResponse.StatusCode -ne 202) { throw "Electron 서버 재시작 요청이 거절되었습니다: $($restartResponse.StatusCode)" }
  $restartedMainProcessId = $null
  Wait-Until -TimeoutSeconds 120 -FailureMessage 'Electron 프로그램이 새 프로세스로 재시작되지 않았습니다.' -Condition {
    try {
      $nextMain = Get-CimInstance Win32_Process | Where-Object {
        $_.ExecutablePath -and
        [IO.Path]::GetFullPath($_.ExecutablePath) -eq $resolvedAppPath -and
        $_.ProcessId -ne $mainProcessId -and
        $_.CommandLine -notmatch '--type=' -and
        $_.CommandLine -and
        $_.CommandLine.Contains("--user-data-dir=$testRoot")
      } | Select-Object -First 1
      if (-not $nextMain) { return $false }
      $controlAfter = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$AppPort/api/system/control" -TimeoutSec 3
      if (-not $controlAfter.success -or -not $controlAfter.data.available) { return $false }
      $script:restartedMainProcessId = [int]$nextMain.ProcessId
      return $true
    } catch {
      return $false
    }
  }
  Wait-Until -TimeoutSeconds 20 -FailureMessage '재시작 후 이전 Electron 메인 프로세스가 남아 있습니다.' -Condition {
    -not (Get-Process -Id $mainProcessId -ErrorAction SilentlyContinue)
  }
  $restartedProcessInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $restartedMainProcessId"
  if (-not $restartedProcessInfo.CommandLine.Contains("--user-data-dir=$testRoot")) {
    throw '재시작된 Electron 프로세스가 격리된 사용자 데이터 경로를 유지하지 않았습니다.'
  }

  $packagedEngine = [IO.Path]::GetFullPath((Join-Path $expectedAppRoot 'resources\app\src\generated\prisma\query_engine-windows.dll.node'))
  $workspaceEngine = [IO.Path]::GetFullPath((Join-Path $projectRoot 'src\generated\prisma\query_engine-windows.dll.node'))
  $loadedModules = @((Get-Process -Id $restartedMainProcessId -ErrorAction Stop).Modules | ForEach-Object { $_.FileName })
  if ($loadedModules -notcontains $packagedEngine) { throw '패키지 앱이 자체 Prisma 엔진을 로드하지 않았습니다.' }
  if ($loadedModules -contains $workspaceEngine) { throw '패키지 앱이 개발 작업 폴더의 Prisma 엔진을 잘못 로드했습니다.' }

  $updateLog = Join-Path $testRoot 'logs\auto-update.log'
  if (-not (Test-Path -LiteralPath $updateLog)) { throw '패키지 자동업데이트 로그가 생성되지 않았습니다.' }
  $updateLogText = Get-Content -LiteralPath $updateLog -Raw
  if ($updateLogText -notmatch "state=available version=$detectedVersionPattern") { throw '패키지 자동업데이트 상태 로그가 올바르지 않습니다.' }
  if ($updateLogText.Contains($token)) { throw '자동업데이트 로그에 PC 토큰이 노출되었습니다.' }

  $serverLogText = Get-Content -LiteralPath $serverOut -Raw
  if ($serverLogText -notmatch 'GET /api/updates/windows/latest.yml auth=ok') { throw '패키지 앱이 인증 헤더로 latest.yml을 요청하지 않았습니다.' }
  if ($readiness.data.update.currentVersion -ne $currentVersion -or -not $readiness.data.ready) { throw '패키지 앱 버전 또는 유휴 상태 확인이 올바르지 않습니다.' }

  [ordered]@{
    success = $true
    currentVersion = [string]$readiness.data.update.currentVersion
    detectedVersion = [string]$readiness.data.update.version
    updateStatus = [string]$readiness.data.update.status
    authenticatedMetadataRequest = $true
    packagedPrismaEngineLoaded = $true
    workspacePrismaEngineLoaded = $false
    localUiStatus = $rootResponse.StatusCode
    desktopControlAvailable = $true
    manualUpdateCheck = $true
    serverRestartedByRelaunch = $true
    tokenRedacted = $true
  } | ConvertTo-Json -Compress
} finally {
  if ($appProcess -and (Get-Process -Id $appProcess.Id -ErrorAction SilentlyContinue)) {
    Stop-Process -Id $appProcess.Id -Force
  }
  Start-Sleep -Milliseconds 300
  for ($cleanupAttempt = 0; $cleanupAttempt -lt 20; $cleanupAttempt += 1) {
    $remainingAppProcesses = @(Get-CimInstance Win32_Process | Where-Object {
      $_.ExecutablePath -and
      [IO.Path]::GetFullPath($_.ExecutablePath) -eq $resolvedAppPath -and
      $preexistingAppProcessIds -notcontains [int]$_.ProcessId
    })
    if ($remainingAppProcesses.Count -eq 0) { break }
    foreach ($remaining in $remainingAppProcesses) { Stop-Process -Id $remaining.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 250
  }
  if ($serverProcess -and (Get-Process -Id $serverProcess.Id -ErrorAction SilentlyContinue)) {
    Stop-Process -Id $serverProcess.Id -Force
  }
  if (Test-Path -LiteralPath $testRoot) {
    $validatedTestRoot = [IO.Path]::GetFullPath($testRoot)
    if (-not $validatedTestRoot.StartsWith($temporaryBase, [StringComparison]::OrdinalIgnoreCase)) { throw '검증 임시 폴더 삭제 범위가 올바르지 않습니다.' }
    Remove-Item -LiteralPath $validatedTestRoot -Recurse -Force
  }
}
