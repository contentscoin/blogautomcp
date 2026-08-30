param(
  [string]$BaseUrl = 'http://localhost:3000',
  [string]$LocalAuthCookie = '__sites_local_auth=1'
)

$ErrorActionPreference = 'Stop'
$clientId = 'https://chatgpt.com/oauth/client.json'
$redirectUri = 'https://chatgpt.com/connector_platform_oauth_redirect'
$resource = "$BaseUrl/api/mcp"
$browserHeaders = @{ Cookie = $LocalAuthCookie; Origin = $BaseUrl }

function New-Pkce {
  $verifier = 'v' + [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
  $bytes = [Security.Cryptography.SHA256]::HashData([Text.Encoding]::ASCII.GetBytes($verifier))
  $challenge = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
  return @{ verifier = $verifier; challenge = $challenge }
}

function New-AuthorizationCode([string]$Scope) {
  $pkce = New-Pkce
  $state = 'oauth-e2e-' + [Guid]::NewGuid().ToString('N')
  $body = @{
    client_id = $clientId
    redirect_uri = $redirectUri
    response_type = 'code'
    code_challenge = $pkce.challenge
    code_challenge_method = 'S256'
    resource = $resource
    scope = $Scope
    state = $state
  }
  $response = Invoke-WebRequest -SkipHttpErrorCheck -MaximumRedirection 0 -ErrorAction SilentlyContinue -Method Post -Uri "$BaseUrl/api/oauth/authorize" -Headers $browserHeaders -ContentType 'application/x-www-form-urlencoded' -Body $body
  if ([int]$response.StatusCode -ne 303) { throw 'OAuth authorization did not return a 303 callback.' }
  $location = [Uri][string]$response.Headers.Location
  if ($location.GetLeftPart([UriPartial]::Path) -ne $redirectUri) { throw 'OAuth callback URI is invalid.' }
  $values = [System.Web.HttpUtility]::ParseQueryString($location.Query)
  if ($values['state'] -ne $state -or $values['iss'] -ne $BaseUrl) { throw 'OAuth callback state or issuer is invalid.' }
  return @{ code = $values['code']; verifier = $pkce.verifier }
}

$resourceMetadata = Invoke-RestMethod -Uri "$BaseUrl/.well-known/oauth-protected-resource/api/mcp"
$serverMetadata = Invoke-RestMethod -Uri "$BaseUrl/.well-known/oauth-authorization-server"
if ($resourceMetadata.resource -ne $resource -or $resourceMetadata.authorization_servers[0] -ne $BaseUrl) { throw 'Protected resource metadata is invalid.' }
if ($serverMetadata.code_challenge_methods_supported -notcontains 'S256' -or $serverMetadata.grant_types_supported -notcontains 'refresh_token') { throw 'Authorization server metadata is incomplete.' }

$unauthorized = Invoke-WebRequest -SkipHttpErrorCheck -Method Post -Uri $resource -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
if ($unauthorized.StatusCode -ne 401 -or -not [string]$unauthorized.Headers.'WWW-Authenticate') { throw 'Unauthenticated MCP request did not return an OAuth challenge.' }

$authorization = New-AuthorizationCode -Scope 'mcp:read offline_access'
$token = Invoke-RestMethod -Method Post -Uri "$BaseUrl/oauth/token" -ContentType 'application/x-www-form-urlencoded' -Body @{
  grant_type = 'authorization_code'; code = $authorization.code; client_id = $clientId
  redirect_uri = $redirectUri; code_verifier = $authorization.verifier; resource = $resource
}
if (-not $token.access_token -or -not $token.refresh_token) { throw 'OAuth token pair was not issued.' }

$replay = Invoke-WebRequest -SkipHttpErrorCheck -Method Post -Uri "$BaseUrl/oauth/token" -ContentType 'application/x-www-form-urlencoded' -Body @{
  grant_type = 'authorization_code'; code = $authorization.code; client_id = $clientId
  redirect_uri = $redirectUri; code_verifier = $authorization.verifier; resource = $resource
}
if ($replay.StatusCode -ne 400) { throw 'An authorization code was accepted twice.' }

$oauthHeaders = @{ Authorization = "Bearer $($token.access_token)" }
$tools = Invoke-RestMethod -Method Post -Uri $resource -Headers $oauthHeaders -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
$expectedTools = @(
  'agent_get_status', 'brandconnect_list_products', 'brandconnect_sync_products',
  'post_create_draft', 'post_submit_draft', 'thumbnail_prepare', 'thumbnail_apply_generated',
  'blog_profile_get', 'blog_profile_prepare_update', 'blog_profile_apply_update',
  'blog_design_get', 'post_publish', 'post_schedule', 'job_get', 'job_cancel'
)
$actualTools = @($tools.result.tools | ForEach-Object { [string]$_.name })
$missingTools = @($expectedTools | Where-Object { $_ -notin $actualTools })
if ($actualTools.Count -ne $expectedTools.Count -or $missingTools.Count -gt 0 -or $tools.result.tools[0].securitySchemes[0].type -ne 'oauth2') { throw 'OAuth MCP tool discovery is invalid.' }

$writeDenied = Invoke-RestMethod -Method Post -Uri $resource -Headers $oauthHeaders -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"post_submit_draft","arguments":{}}}'
if ($writeDenied.result.structuredContent.code -ne 'INSUFFICIENT_SCOPE') { throw 'A read-only OAuth token performed a write action.' }

$refreshed = Invoke-RestMethod -Method Post -Uri "$BaseUrl/oauth/token" -ContentType 'application/x-www-form-urlencoded' -Body @{
  grant_type = 'refresh_token'; refresh_token = $token.refresh_token; client_id = $clientId; resource = $resource
}
if (-not $refreshed.refresh_token -or $refreshed.refresh_token -eq $token.refresh_token) { throw 'Refresh token rotation failed.' }
$oldRefresh = Invoke-WebRequest -SkipHttpErrorCheck -Method Post -Uri "$BaseUrl/oauth/token" -ContentType 'application/x-www-form-urlencoded' -Body @{
  grant_type = 'refresh_token'; refresh_token = $token.refresh_token; client_id = $clientId; resource = $resource
}
if ($oldRefresh.StatusCode -ne 400) { throw 'A rotated refresh token remained valid.' }

Invoke-WebRequest -Method Post -Uri "$BaseUrl/oauth/revoke" -ContentType 'application/x-www-form-urlencoded' -Body @{ token = $refreshed.access_token; client_id = $clientId } | Out-Null
$revoked = Invoke-WebRequest -SkipHttpErrorCheck -Method Post -Uri $resource -Headers @{ Authorization = "Bearer $($refreshed.access_token)" } -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":4,"method":"ping","params":{}}'
if ($revoked.StatusCode -ne 401) { throw 'A revoked access token remained valid.' }

[pscustomobject]@{
  metadata = 'ok'
  pkce = 'S256'
  authorizationCodeReplay = 'blocked'
  readOnlyScope = 'enforced'
  refreshRotation = 'ok'
  revocation = 'ok'
  tools = @($tools.result.tools).Count
} | ConvertTo-Json
