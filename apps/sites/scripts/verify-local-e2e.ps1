param(
  [string]$BaseUrl = 'http://localhost:3000',
  [string]$LocalAuthCookie = '__sites_local_auth=1',
  [string]$InstallerUploadKey = 'local-installer-upload-key-e2e'
)

$ErrorActionPreference = 'Stop'
$browserHeaders = @{ Cookie = $LocalAuthCookie; Origin = $BaseUrl }
$jsonHeaders = @{ Accept = 'application/json, text/event-stream' }

function Invoke-Mcp {
  param([string]$Url, [hashtable]$Message, [hashtable]$Headers = $jsonHeaders)
  Invoke-RestMethod -Method Post -Uri $Url -Headers $Headers -ContentType 'application/json' -Body ($Message | ConvertTo-Json -Depth 20 -Compress)
}

$connectionStatus = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/mcp-connections" -Headers @{ Cookie = $LocalAuthCookie }
$action = if ($connectionStatus.data.exists) { 'rotate' } else { 'issue' }
$issued = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/mcp-connections" -Headers $browserHeaders -ContentType 'application/json' -Body (@{ action = $action } | ConvertTo-Json -Compress)
$mcpUrl = [string]$issued.data.mcpUrl
if (-not $mcpUrl.StartsWith("$BaseUrl/api/mcp/")) { throw 'MCP URL origin or path is invalid.' }

$initialize = Invoke-Mcp -Url $mcpUrl -Message @{ jsonrpc = '2.0'; id = 1; method = 'initialize'; params = @{ protocolVersion = '2025-11-25'; capabilities = @{}; clientInfo = @{ name = 'sites-e2e'; version = '1.0' } } }
if ($initialize.result.protocolVersion -ne '2025-11-25') { throw 'MCP protocol negotiation failed.' }
$tools = Invoke-Mcp -Url $mcpUrl -Message @{ jsonrpc = '2.0'; id = 2; method = 'tools/list'; params = @{} }
$expectedToolCount = 27
if (@($tools.result.tools).Count -ne $expectedToolCount) { throw "Expected $expectedToolCount MCP tools." }
$toolNames = @($tools.result.tools | ForEach-Object { [string]$_.name })
if ($toolNames -notcontains 'post_prepare_draft' -or $toolNames -notcontains 'post_submit_draft') { throw 'Two-stage ChatGPT draft tools are missing.' }
foreach ($required in @('post_create_draft','post_get_draft','post_revise_draft','post_approve_draft','post_set_thumbnail','post_verify_published','travel_capture_contract','settings_get','job_cancel')) { if ($toolNames -notcontains $required) { throw "MCP tool $required is missing." } }

$modernProtocol = '2026-07-28'
$modernMeta = @{
  'io.modelcontextprotocol/protocolVersion' = $modernProtocol
  'io.modelcontextprotocol/clientInfo' = @{ name = 'sites-e2e'; version = '1.1.0' }
  'io.modelcontextprotocol/clientCapabilities' = @{}
}
$discoverHeaders = @{ Accept = 'application/json, text/event-stream'; 'MCP-Protocol-Version' = $modernProtocol; 'Mcp-Method' = 'server/discover' }
$discovery = Invoke-Mcp -Url $mcpUrl -Headers $discoverHeaders -Message @{ jsonrpc = '2.0'; id = 'discover-1'; method = 'server/discover'; params = @{ _meta = $modernMeta } }
if ($discovery.result.resultType -ne 'complete' -or $discovery.result.supportedVersions -notcontains $modernProtocol) { throw 'Modern MCP discovery failed.' }

$modernToolsHeaders = @{ Accept = 'application/json, text/event-stream'; 'MCP-Protocol-Version' = $modernProtocol; 'Mcp-Method' = 'tools/list' }
$modernTools = Invoke-Mcp -Url $mcpUrl -Headers $modernToolsHeaders -Message @{ jsonrpc = '2.0'; id = 30; method = 'tools/list'; params = @{ _meta = $modernMeta } }
if ($modernTools.result.resultType -ne 'complete' -or @($modernTools.result.tools).Count -ne $expectedToolCount -or $modernTools.result.cacheScope -ne 'private') { throw 'Modern MCP tool discovery failed.' }

$modernStatusHeaders = @{ Accept = 'application/json, text/event-stream'; 'MCP-Protocol-Version' = $modernProtocol; 'Mcp-Method' = 'tools/call'; 'Mcp-Name' = 'agent_get_status' }
$modernStatus = Invoke-Mcp -Url $mcpUrl -Headers $modernStatusHeaders -Message @{ jsonrpc = '2.0'; id = 31; method = 'tools/call'; params = @{ name = 'agent_get_status'; arguments = @{}; _meta = $modernMeta } }
if ($modernStatus.result.resultType -ne 'complete' -or -not $modernStatus.result.structuredContent.ok) { throw 'Modern MCP tool call failed.' }

$mismatch = Invoke-WebRequest -SkipHttpErrorCheck -Method Post -Uri $mcpUrl -Headers @{ Accept = 'application/json, text/event-stream'; 'MCP-Protocol-Version' = $modernProtocol; 'Mcp-Method' = 'ping' } -ContentType 'application/json' -Body (@{ jsonrpc = '2.0'; id = 32; method = 'tools/list'; params = @{ _meta = $modernMeta } } | ConvertTo-Json -Depth 20 -Compress)
$mismatchBody = $mismatch.Content | ConvertFrom-Json
if ($mismatch.StatusCode -ne 400 -or $mismatchBody.error.code -ne -32020) { throw 'Modern MCP header mismatch was not rejected.' }

$unsupportedProtocol = '2099-01-01'
$unsupportedMeta = @{ 'io.modelcontextprotocol/protocolVersion' = $unsupportedProtocol; 'io.modelcontextprotocol/clientCapabilities' = @{} }
$unsupported = Invoke-WebRequest -SkipHttpErrorCheck -Method Post -Uri $mcpUrl -Headers @{ Accept = 'application/json, text/event-stream'; 'MCP-Protocol-Version' = $unsupportedProtocol; 'Mcp-Method' = 'ping' } -ContentType 'application/json' -Body (@{ jsonrpc = '2.0'; id = 33; method = 'ping'; params = @{ _meta = $unsupportedMeta } } | ConvertTo-Json -Depth 20 -Compress)
$unsupportedBody = $unsupported.Content | ConvertFrom-Json
if ($unsupported.StatusCode -ne 400 -or $unsupportedBody.error.code -ne -32022 -or $unsupportedBody.error.data.supported -notcontains $modernProtocol) { throw 'Unsupported MCP protocol version response is invalid.' }

$badOrigin = Invoke-WebRequest -SkipHttpErrorCheck -Method Post -Uri $mcpUrl -Headers @{ Origin = 'https://invalid.example'; Accept = 'application/json, text/event-stream' } -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":20,"method":"ping"}'
if ($badOrigin.StatusCode -ne 403) { throw 'A foreign browser Origin was not rejected.' }

$pairBody = @{ mcpUrl = $mcpUrl; deviceName = 'E2E-PC-1'; platform = 'win32-x64'; appVersion = '1.0.0' } | ConvertTo-Json -Compress
$firstPair = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/device/pair" -ContentType 'application/json' -Body $pairBody
$secondPairBody = @{ mcpUrl = $mcpUrl; deviceName = 'E2E-PC-2'; platform = 'win32-x64'; appVersion = '1.3.10' } | ConvertTo-Json -Compress
$secondPair = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/device/pair" -ContentType 'application/json' -Body $secondPairBody

$oldDevice = Invoke-WebRequest -SkipHttpErrorCheck -Method Post -Uri "$BaseUrl/api/agent/jobs/claim" -Headers @{ Authorization = "Bearer $($firstPair.data.deviceToken)" } -ContentType 'application/json' -Body '{}'
if ($oldDevice.StatusCode -ne 401) { throw 'The replaced PC token was not revoked.' }

$publishGuard = Invoke-Mcp -Url $mcpUrl -Message @{ jsonrpc = '2.0'; id = 21; method = 'tools/call'; params = @{ name = 'post_publish'; arguments = @{ connectKind = 'travel'; draftId = 'draft-e2e'; confirmed = $false; idempotencyKey = ('e2e-publish:' + [guid]::NewGuid().ToString('N')) } } }
if ($publishGuard.result.structuredContent.code -ne 'INVALID_ARGUMENT' -or -not $publishGuard.result.isError -or $publishGuard.result.structuredContent.errors -notcontains 'confirmed: must equal true' -or $publishGuard.result.structuredContent.jobId) { throw 'Unconfirmed publishing was not blocked by the confirmation schema.' }

$idempotencyKey = 'e2e:' + [guid]::NewGuid().ToString('N')
$queued = Invoke-Mcp -Url $mcpUrl -Message @{ jsonrpc = '2.0'; id = 3; method = 'tools/call'; params = @{ name = 'brandconnect_list_products'; arguments = @{ connectKind = 'travel'; status = 'all'; idempotencyKey = $idempotencyKey } } }
if (-not $queued.result.structuredContent.ok) { throw 'TravelConnect job was not queued.' }
$jobId = [string]$queued.result.structuredContent.jobId
$reused = Invoke-Mcp -Url $mcpUrl -Message @{ jsonrpc = '2.0'; id = 22; method = 'tools/call'; params = @{ name = 'brandconnect_list_products'; arguments = @{ connectKind = 'travel'; status = 'all'; idempotencyKey = $idempotencyKey } } }
if (-not $reused.result.structuredContent.reused -or $reused.result.structuredContent.jobId -ne $jobId) { throw 'Idempotent retry created a second job.' }
$conflict = Invoke-Mcp -Url $mcpUrl -Message @{ jsonrpc = '2.0'; id = 23; method = 'tools/call'; params = @{ name = 'brandconnect_list_products'; arguments = @{ connectKind = 'travel'; status = 'ready'; idempotencyKey = $idempotencyKey } } }
if ($conflict.result.structuredContent.code -ne 'IDEMPOTENCY_CONFLICT') { throw 'Conflicting idempotency-key reuse was not rejected.' }

$claim = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/agent/jobs/claim" -Headers @{ Authorization = "Bearer $($secondPair.data.deviceToken)" } -ContentType 'application/json' -Body '{}'
if ($claim.data.id -ne $jobId -or $claim.data.input.connectKind -ne 'travel') { throw 'The active PC did not claim the TravelConnect job.' }

$completion = @{ status = 'SUCCEEDED'; result = @{ connectKind = 'travel'; count = 0; products = @() } } | ConvertTo-Json -Depth 8 -Compress
$completed = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/agent/jobs/$jobId/complete" -Headers @{ Authorization = "Bearer $($secondPair.data.deviceToken)" } -ContentType 'application/json' -Body $completion
if ($completed.data.status -ne 'SUCCEEDED') { throw 'The job completion was not stored.' }

$jobResult = Invoke-Mcp -Url $mcpUrl -Message @{ jsonrpc = '2.0'; id = 4; method = 'tools/call'; params = @{ name = 'job_get'; arguments = @{ jobId = $jobId } } }
if ($jobResult.result.structuredContent.job.status -ne 'SUCCEEDED') { throw 'MCP could not read the completed job.' }

# OAuth MCP 초안은 PC 사실 수집 -> 현재 ChatGPT 원고 작성 -> PC 초안 제출의
# 두 단계여야 한다. PC에서 OpenAI API를 다시 부르는 예전 계약으로 회귀하지 않도록
# 실제 큐 입력과 contextJobId 결합을 검증한다.
$draftProductId = 'product-e2e-shopping'
$draftContextKey = 'e2e-draft-context:' + [guid]::NewGuid().ToString('N')
$draftContextQueued = Invoke-Mcp -Url $mcpUrl -Message @{ jsonrpc = '2.0'; id = 41; method = 'tools/call'; params = @{ name = 'post_create_draft'; arguments = @{ connectKind = 'shopping'; productId = $draftProductId; qualityPreset = 'premium'; experienceMode = 'ai_assisted_information'; idempotencyKey = $draftContextKey } } }
if (-not $draftContextQueued.result.structuredContent.ok) { throw 'Draft context job was not queued.' }
$draftContextJobId = [string]$draftContextQueued.result.structuredContent.jobId
$draftContextClaim = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/agent/jobs/claim" -Headers @{ Authorization = "Bearer $($secondPair.data.deviceToken)" } -ContentType 'application/json' -Body '{}'
if ($draftContextClaim.data.id -ne $draftContextJobId -or $draftContextClaim.data.type -ne 'POST_PREPARE_DRAFT') { throw 'Draft context job type is invalid.' }
# post_submit_draft 는 준비 작업 결과의 brand-draft-context/v2 스냅샷(productId·connectKind·snapshotId)을 요구한다.
$draftSnapshotId = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes("e2e-snapshot:$draftProductId"))).ToLowerInvariant()
$draftContextResult = @{
  status = 'SUCCEEDED'
  result = @{
    schema = 'blogautomcp.job-result/v1'
    jobType = 'POST_PREPARE_DRAFT'
    kind = 'draft-context'
    summary = 'e2e draft context'
    warnings = @()
    data = @{
      version = 'brand-draft-context/v2'
      productId = $draftProductId
      contextJobId = $draftContextJobId
      connectKind = 'shopping'
      snapshotId = $draftSnapshotId
      snapshot = @{ version = 'brand-product-snapshot/v1'; productId = $draftProductId; connectKind = 'shopping'; snapshotId = $draftSnapshotId }
      verifiedFacts = @('상품명: 휴대용 선풍기')
      sourceImages = @()
      harness = @{ minimumSectionCount = 9; maximumSectionCount = 12 }
      systemPrompt = 'e2e system prompt'
      userPrompt = 'e2e user prompt'
      generation = @{ minimumSectionCount = 9; maximumSectionCount = 12 }
    }
  }
} | ConvertTo-Json -Depth 12 -Compress
Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/agent/jobs/$draftContextJobId/complete" -Headers @{ Authorization = "Bearer $($secondPair.data.deviceToken)" } -ContentType 'application/json' -Body $draftContextResult | Out-Null

$draftSections = @(1..9 | ForEach-Object {
  "제품 판단 $_`n`n" + ("확인된 상품 사실을 바탕으로 제품의 장점과 한계를 구체적으로 해석합니다. 구매 목적과 사용 환경에 따라 적합도가 달라지며, 확인되지 않은 성능은 단정하지 않습니다. " * 3)
})
$draftSubmitKey = 'e2e-draft-submit:' + [guid]::NewGuid().ToString('N')
$draftSubmitted = Invoke-Mcp -Url $mcpUrl -Message @{
  jsonrpc = '2.0'
  id = 42
  method = 'tools/call'
  params = @{
    name = 'post_submit_draft'
    arguments = @{
      connectKind = 'shopping'
      productId = $draftProductId
      contextJobId = $draftContextJobId
      draft = @{
        title = '휴대용 선풍기 선택 기준과 제품 장단점'
        sections = $draftSections
        hashtags = @('휴대용선풍기', '선풍기추천', '제품비교')
      }
      idempotencyKey = $draftSubmitKey
    }
  }
}
if (-not $draftSubmitted.result.structuredContent.ok) { throw "ChatGPT draft submission was rejected: $($draftSubmitted.result.structuredContent.message)" }
$draftSubmitJobId = [string]$draftSubmitted.result.structuredContent.jobId
$draftSubmitClaim = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/agent/jobs/claim" -Headers @{ Authorization = "Bearer $($secondPair.data.deviceToken)" } -ContentType 'application/json' -Body '{}'
if ($draftSubmitClaim.data.id -ne $draftSubmitJobId -or $draftSubmitClaim.data.type -ne 'POST_SUBMIT_DRAFT') { throw 'Submitted draft job type is invalid.' }
if ($draftSubmitClaim.data.input.contextJobId -ne $draftContextJobId -or @($draftSubmitClaim.data.input.draft.sections).Count -ne 9) { throw 'Submitted ChatGPT draft payload was not preserved.' }
if ($draftSubmitClaim.data.input.snapshotId -ne $draftSnapshotId -or $draftSubmitClaim.data.input.contextSnapshot.snapshot.snapshotId -ne $draftSnapshotId) { throw 'Submitted draft did not pin the prepared product snapshot.' }
$draftSubmitCompletion = @{ status = 'SUCCEEDED'; result = @{ draftId = $draftProductId; connectKind = 'shopping' } } | ConvertTo-Json -Depth 8 -Compress
Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/agent/jobs/$draftSubmitJobId/complete" -Headers @{ Authorization = "Bearer $($secondPair.data.deviceToken)" } -ContentType 'application/json' -Body $draftSubmitCompletion | Out-Null

$rotated = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/mcp-connections" -Headers $browserHeaders -ContentType 'application/json' -Body '{"action":"rotate"}'
$oldMcp = Invoke-WebRequest -SkipHttpErrorCheck -Method Post -Uri $mcpUrl -Headers $jsonHeaders -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":5,"method":"ping"}'
$oldActiveDevice = Invoke-WebRequest -SkipHttpErrorCheck -Method Post -Uri "$BaseUrl/api/agent/jobs/claim" -Headers @{ Authorization = "Bearer $($secondPair.data.deviceToken)" } -ContentType 'application/json' -Body '{}'
$oldPair = Invoke-WebRequest -SkipHttpErrorCheck -Method Post -Uri "$BaseUrl/api/device/pair" -ContentType 'application/json' -Body $secondPairBody
if ($oldMcp.StatusCode -ne 401) { throw 'The prior MCP URL remained valid after rotation.' }
if ($oldActiveDevice.StatusCode -ne 401) { throw 'The active PC token remained valid after MCP rotation.' }
if ($oldPair.StatusCode -ne 401) { throw 'A rotated MCP URL paired a new PC.' }

$installerAdminHeaders = @{ 'x-installer-upload-key' = $InstallerUploadKey }
$fixture = [Text.Encoding]::UTF8.GetBytes(('BlogAutoMCP installer fixture ' * 4096))
$fixtureSha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($fixture)).ToLowerInvariant()
$beginInstallerUpload = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/admin/installer" -Headers $installerAdminHeaders -ContentType 'application/json' -Body (@{ action = 'begin'; size = $fixture.Length; sha256 = $fixtureSha256 } | ConvertTo-Json -Compress)
$installerUploadId = [string]$beginInstallerUpload.data.uploadId
$uploadedInstallerPart = Invoke-RestMethod -Method Put -Uri "$BaseUrl/api/admin/installer?uploadId=$([Uri]::EscapeDataString($installerUploadId))&partNumber=1" -Headers $installerAdminHeaders -ContentType 'application/octet-stream' -Body $fixture
$completeInstallerUpload = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/admin/installer" -Headers $installerAdminHeaders -ContentType 'application/json' -Body (@{ action = 'complete'; uploadId = $installerUploadId; parts = @($uploadedInstallerPart.data) } | ConvertTo-Json -Depth 8 -Compress)
if ($completeInstallerUpload.data.size -ne $fixture.Length) { throw 'Installer multipart upload size is invalid.' }
$installerMetadata = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/admin/installer" -Headers $installerAdminHeaders
if ($installerMetadata.data.sha256 -ne $fixtureSha256 -or $installerMetadata.data.size -ne $fixture.Length) { throw 'Installer metadata verification failed.' }
$releaseBeforeUpdate = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/admin/updates/windows" -Headers $installerAdminHeaders
$expectedExistingDownloadSha256 = if ($releaseBeforeUpdate.data.release -and $releaseBeforeUpdate.data.release.installerSha256) {
  [string]$releaseBeforeUpdate.data.release.installerSha256
} else {
  $fixtureSha256
}

$unauthorizedInstaller = Invoke-WebRequest -SkipHttpErrorCheck -Method Get -Uri "$BaseUrl/api/download/windows"
if ($unauthorizedInstaller.StatusCode -ne 401) { throw 'Installer download was not protected by ChatGPT sign-in.' }
$downloadPath = Join-Path ([IO.Path]::GetTempPath()) ("blogautomcp-installer-e2e-$([guid]::NewGuid().ToString('N')).bin")
try {
  Invoke-WebRequest -Method Get -Uri "$BaseUrl/api/download/windows" -Headers @{ Cookie = $LocalAuthCookie } -OutFile $downloadPath
  $downloadSha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([IO.File]::ReadAllBytes($downloadPath))).ToLowerInvariant()
  if ($downloadSha256 -ne $expectedExistingDownloadSha256) { throw 'Authenticated installer download hash is invalid.' }
} finally {
  if (Test-Path -LiteralPath $downloadPath) { Remove-Item -LiteralPath $downloadPath -Force }
}

function Send-UpdateArtifact {
  param(
    [string]$ArtifactName,
    [byte[]]$Bytes,
    [string]$Sha512 = ''
  )

  $sha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($Bytes)).ToLowerInvariant()
  $beginBody = @{ action = 'begin'; artifactName = $ArtifactName; size = $Bytes.Length; sha256 = $sha256 }
  if ($Sha512) { $beginBody['sha512'] = $Sha512 }
  $begin = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/admin/updates/windows" -Headers $installerAdminHeaders -ContentType 'application/json' -Body ($beginBody | ConvertTo-Json -Compress)
  $uploadId = [string]$begin.data.uploadId
  try {
    $partUrl = "$BaseUrl/api/admin/updates/windows?artifactName=$([Uri]::EscapeDataString($ArtifactName))&uploadId=$([Uri]::EscapeDataString($uploadId))&partNumber=1"
    $part = Invoke-RestMethod -Method Put -Uri $partUrl -Headers $installerAdminHeaders -ContentType 'application/octet-stream' -Body $Bytes
    $complete = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/admin/updates/windows" -Headers $installerAdminHeaders -ContentType 'application/json' -Body (@{ action = 'complete'; artifactName = $ArtifactName; uploadId = $uploadId; parts = @($part.data) } | ConvertTo-Json -Depth 8 -Compress)
    if ($complete.data.size -ne $Bytes.Length) { throw "Update artifact size mismatch: $ArtifactName" }
  } catch {
    Invoke-WebRequest -SkipHttpErrorCheck -Method Post -Uri "$BaseUrl/api/admin/updates/windows" -Headers $installerAdminHeaders -ContentType 'application/json' -Body (@{ action = 'abort'; artifactName = $ArtifactName; uploadId = $uploadId } | ConvertTo-Json -Compress) | Out-Null
    throw
  }
}

$rotatedMcpUrl = [string]$rotated.data.mcpUrl
if (-not $rotatedMcpUrl.StartsWith("$BaseUrl/api/mcp/")) { throw 'Rotated MCP URL is invalid.' }
$updatePairBody = @{ mcpUrl = $rotatedMcpUrl; deviceName = 'E2E-UPDATE-PC'; platform = 'win32-x64'; appVersion = '1.1.0' } | ConvertTo-Json -Compress
$updatePair = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/device/pair" -ContentType 'application/json' -Body $updatePairBody
$activeUpdateToken = [string]$updatePair.data.deviceToken

$versionPatch = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$releaseVersion = "99.0.$versionPatch"
$releaseInstallerName = "BrandConnect-Automation-Setup-$releaseVersion.exe"
$releaseBlockmapName = "$releaseInstallerName.blockmap"
$releaseFixture = [Text.Encoding]::UTF8.GetBytes(('BlogAutoMCP automatic update fixture ' * 8192))
$releaseBlockmap = [Text.Encoding]::UTF8.GetBytes(('Blockmap fixture ' * 1024))
$releaseSha512 = [Convert]::ToBase64String([Security.Cryptography.SHA512]::HashData($releaseFixture))
$releaseSha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($releaseFixture)).ToLowerInvariant()
$releaseDate = [DateTime]::UtcNow.ToString('o')
$manifest = @"
version: $releaseVersion
files:
  - url: $releaseInstallerName
    sha512: $releaseSha512
    size: $($releaseFixture.Length)
path: $releaseInstallerName
sha512: $releaseSha512
releaseDate: '$releaseDate'
"@

Send-UpdateArtifact -ArtifactName $releaseBlockmapName -Bytes $releaseBlockmap
Send-UpdateArtifact -ArtifactName $releaseInstallerName -Bytes $releaseFixture -Sha512 $releaseSha512
$publishedRelease = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/admin/updates/windows" -Headers $installerAdminHeaders -ContentType 'application/json' -Body (@{ action = 'publish'; manifest = $manifest } | ConvertTo-Json -Compress)
if ($publishedRelease.data.release.version -ne $releaseVersion) { throw 'Automatic update release was not published.' }

$unauthorizedUpdate = Invoke-WebRequest -SkipHttpErrorCheck -Method Get -Uri "$BaseUrl/api/updates/windows/latest.yml"
if ($unauthorizedUpdate.StatusCode -ne 401) { throw 'Update metadata was not protected by device authentication.' }
$revokedUpdate = Invoke-WebRequest -SkipHttpErrorCheck -Method Get -Uri "$BaseUrl/api/updates/windows/latest.yml" -Headers @{ Authorization = "Bearer $($secondPair.data.deviceToken)" }
if ($revokedUpdate.StatusCode -ne 401) { throw 'A revoked PC downloaded update metadata.' }
$latestUpdate = Invoke-WebRequest -Method Get -Uri "$BaseUrl/api/updates/windows/latest.yml" -Headers @{ Authorization = "Bearer $activeUpdateToken" }
$latestUpdateText = if ($latestUpdate.Content -is [byte[]]) { [Text.Encoding]::UTF8.GetString($latestUpdate.Content) } else { [string]$latestUpdate.Content }
if ($latestUpdate.StatusCode -ne 200 -or -not $latestUpdateText.Contains("version: $releaseVersion")) { throw 'The active PC could not read latest.yml.' }

$rangePath = Join-Path ([IO.Path]::GetTempPath()) ("blogautomcp-update-range-e2e-$([guid]::NewGuid().ToString('N')).bin")
$fullUpdatePath = Join-Path ([IO.Path]::GetTempPath()) ("blogautomcp-update-full-e2e-$([guid]::NewGuid().ToString('N')).bin")
$manualReleasePath = Join-Path ([IO.Path]::GetTempPath()) ("blogautomcp-update-manual-e2e-$([guid]::NewGuid().ToString('N')).bin")
try {
  $artifactUrl = "$BaseUrl/api/updates/windows/$([Uri]::EscapeDataString($releaseInstallerName))"
  $rangeResponse = Invoke-WebRequest -Method Get -Uri $artifactUrl -Headers @{ Authorization = "Bearer $activeUpdateToken"; Range = 'bytes=0-15' } -OutFile $rangePath -PassThru
  $contentRange = [string]$rangeResponse.Headers['Content-Range']
  if ($rangeResponse.StatusCode -ne 206 -or $contentRange -ne "bytes 0-15/$($releaseFixture.Length)" -or (Get-Item -LiteralPath $rangePath).Length -ne 16) { throw 'Single-range update download is invalid.' }

  $invalidRange = Invoke-WebRequest -SkipHttpErrorCheck -Method Get -Uri $artifactUrl -Headers @{ Authorization = "Bearer $activeUpdateToken"; Range = "bytes=$($releaseFixture.Length)-" }
  if ($invalidRange.StatusCode -ne 416) { throw 'Invalid update range was not rejected.' }

  Invoke-WebRequest -Method Get -Uri $artifactUrl -Headers @{ Authorization = "Bearer $activeUpdateToken" } -OutFile $fullUpdatePath
  $fullUpdateSha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([IO.File]::ReadAllBytes($fullUpdatePath))).ToLowerInvariant()
  if ($fullUpdateSha256 -ne $releaseSha256) { throw 'Full automatic update download hash is invalid.' }

  $manualReleaseResponse = Invoke-WebRequest -Method Get -Uri "$BaseUrl/api/download/windows" -Headers @{ Cookie = $LocalAuthCookie } -OutFile $manualReleasePath -PassThru
  $manualReleaseSha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([IO.File]::ReadAllBytes($manualReleasePath))).ToLowerInvariant()
  if ($manualReleaseSha256 -ne $releaseSha256 -or -not ([string]$manualReleaseResponse.Headers['Content-Disposition']).Contains($releaseInstallerName)) { throw 'Dashboard download did not switch to the latest release.' }
} finally {
  foreach ($temporaryPath in @($rangePath, $fullUpdatePath, $manualReleasePath)) {
    if (Test-Path -LiteralPath $temporaryPath) { Remove-Item -LiteralPath $temporaryPath -Force }
  }
}

$duplicateRelease = Invoke-WebRequest -SkipHttpErrorCheck -Method Post -Uri "$BaseUrl/api/admin/updates/windows" -Headers $installerAdminHeaders -ContentType 'application/json' -Body (@{ action = 'publish'; manifest = $manifest } | ConvertTo-Json -Compress)
$duplicateReleaseBody = $duplicateRelease.Content | ConvertFrom-Json
if ($duplicateRelease.StatusCode -ne 409 -or $duplicateReleaseBody.error.code -ne 'VERSION_NOT_NEWER') { throw 'Duplicate or downgraded update release was not rejected.' }
$verifiedRelease = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/admin/updates/windows" -Headers $installerAdminHeaders
if ($verifiedRelease.data.release.version -ne $releaseVersion -or $verifiedRelease.data.release.installerSha256 -ne $releaseSha256) { throw 'Published update pointer verification failed.' }

[ordered]@{
  mcpProtocol = [string]$initialize.result.protocolVersion
  modernProtocol = [string]$discovery.result.supportedVersions[0]
  modernDiscovery = $discovery.result.resultType -eq 'complete'
  modernToolCall = $modernStatus.result.resultType -eq 'complete'
  modernHeaderMismatchRejected = $mismatch.StatusCode -eq 400
  unsupportedProtocolAdvertised = $unsupportedBody.error.data.supported -contains $modernProtocol
  toolCount = @($tools.result.tools).Count
  foreignOriginRejected = $badOrigin.StatusCode -eq 403
  replacedPcRevoked = $oldDevice.StatusCode -eq 401
  unconfirmedPublishBlocked = $publishGuard.result.isError -and $publishGuard.result.structuredContent.errors -contains 'confirmed: must equal true'
  idempotentRetryReused = [bool]$reused.result.structuredContent.reused
  idempotencyConflictRejected = $conflict.result.structuredContent.code -eq 'IDEMPOTENCY_CONFLICT'
  travelJobLifecycle = [string]$jobResult.result.structuredContent.job.status
  oauthDraftContextJob = [string]$draftContextClaim.data.type
  oauthDraftSubmissionJob = [string]$draftSubmitClaim.data.type
  rotatedGeneration = [int]$rotated.data.generation
  oldMcpRevoked = $oldMcp.StatusCode -eq 401
  oldPcRevokedAfterRotation = $oldActiveDevice.StatusCode -eq 401
  oldMcpCannotPair = $oldPair.StatusCode -eq 401
  installerUploadVerified = $installerMetadata.data.sha256 -eq $fixtureSha256
  installerLoginRequired = $unauthorizedInstaller.StatusCode -eq 401
  installerDownloadVerified = $downloadSha256 -eq $expectedExistingDownloadSha256
  updateRelease = [string]$verifiedRelease.data.release.version
  updateDeviceAuthRequired = $unauthorizedUpdate.StatusCode -eq 401
  revokedPcUpdateDenied = $revokedUpdate.StatusCode -eq 401
  updateRangeVerified = $rangeResponse.StatusCode -eq 206
  updateHashVerified = $fullUpdateSha256 -eq $releaseSha256
  dashboardUsesLatestRelease = $manualReleaseSha256 -eq $releaseSha256
  duplicateReleaseRejected = $duplicateRelease.StatusCode -eq 409
} | ConvertTo-Json -Compress
