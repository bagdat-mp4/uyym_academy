param([switch]$ImportKeyOnly)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
try { Add-Type -AssemblyName System.Security -ErrorAction Stop } catch { throw 'STAGING_DPAPI_ASSEMBLY_UNAVAILABLE' }

$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$node = 'C:\Program Files\nodejs\node.exe'
$git = 'C:\Program Files\Git\cmd\git.exe'
$serverEntry = Join-Path $repo 'tests\ui-fixture.ts'
$viteEntry = Join-Path $repo 'node_modules\vite\bin\vite.js'
$stageDir = Join-Path $env:LOCALAPPDATA 'UYYM\DriveStaging'
$plainKey = Join-Path $stageDir 'service-account.json'
$encryptedKey = Join-Path $stageDir 'service-account.dpapi'
$rootIdFile = Join-Path $stageDir 'root-folder-id.txt'
$partKey = $encryptedKey + '.' + [Guid]::NewGuid().ToString('N') + '.part'
$userSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$systemSid = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
$serviceProcess = $null
$viteProcess = $null
$secretSecure = $null
$secretPointer = [IntPtr]::Zero
$secretText = $null
$keyBytes = $null
$plainBytes = $null
$encryptedBytes = $null
$serviceBase64 = $null
$createdEncrypted = $false
$expectedServiceAccountEmail = 'uyym-staging-reader@uyym-academy-drive.iam.gserviceaccount.com'

function New-PrivateDirectorySecurity() {
  $acl = New-Object Security.AccessControl.DirectorySecurity
  $acl.SetOwner($userSid)
  $acl.SetAccessRuleProtection($true,$false)
  $inheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
  $ownerRule = New-Object -TypeName Security.AccessControl.FileSystemAccessRule -ArgumentList @($userSid,[Security.AccessControl.FileSystemRights]::FullControl,$inheritance,[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow)
  $systemRule = New-Object -TypeName Security.AccessControl.FileSystemAccessRule -ArgumentList @($systemSid,[Security.AccessControl.FileSystemRights]::FullControl,$inheritance,[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow)
  $acl.AddAccessRule($ownerRule)
  $acl.AddAccessRule($systemRule)
  return $acl
}

function Assert-PrivateDirectoryAcl([string]$Path,[string]$FailureCode) {
  if (!(Test-Path -LiteralPath $Path -PathType Container)) { throw 'STAGING_PRIVATE_DIRECTORY_MISSING' }
  $item = Get-Item -LiteralPath $Path -Force
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'STAGING_DIRECTORY_REPARSE_POINT_REJECTED' }
  $directoryInfo = New-Object IO.DirectoryInfo($Path)
  $acl = $directoryInfo.GetAccessControl([Security.AccessControl.AccessControlSections]::Access -bor [Security.AccessControl.AccessControlSections]::Owner)
  if (!$acl.AreAccessRulesProtected -or !$acl.GetOwner([Security.Principal.SecurityIdentifier]).Equals($userSid)) { throw $FailureCode }
  $rules = @($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
  if ($rules.Count -ne 2) { throw $FailureCode }
  $ownerFull = $false
  $systemFull = $false
  foreach ($rule in $rules) {
    if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or $rule.IsInherited -or $rule.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl -or $rule.InheritanceFlags -ne ([Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit) -or $rule.PropagationFlags -ne [Security.AccessControl.PropagationFlags]::None -or (!$rule.IdentityReference.Equals($userSid) -and !$rule.IdentityReference.Equals($systemSid))) { throw $FailureCode }
    if ($rule.IdentityReference.Equals($userSid)) { if ($ownerFull) { throw $FailureCode }; $ownerFull = $true }
    if ($rule.IdentityReference.Equals($systemSid)) { if ($systemFull) { throw $FailureCode }; $systemFull = $true }
  }
  if (!$ownerFull -or !$systemFull) { throw $FailureCode }
}

function Get-ValidatedParentDirectory([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path) -or ![IO.Path]::IsPathRooted($Path)) { throw 'STAGING_DIRECTORY_PATH_INVALID' }
  $fullPath = [IO.Path]::GetFullPath($Path)
  $pathRoot = [IO.Path]::GetPathRoot($fullPath)
  if ($pathRoot -notmatch '^[A-Za-z]:\\$') { throw 'STAGING_DIRECTORY_PATH_INVALID' }
  $parentPath = [IO.Path]::GetDirectoryName($fullPath)
  if ([string]::IsNullOrWhiteSpace($parentPath) -or $parentPath -eq $fullPath) { throw 'STAGING_DIRECTORY_PATH_INVALID' }
  return $parentPath
}

function Assert-PrivateDirectory([string]$Path) {
  if (!(Test-Path -LiteralPath $Path -PathType Container)) { throw 'STAGING_PRIVATE_DIRECTORY_MISSING' }
  $parentPath = Get-ValidatedParentDirectory $Path
  Assert-PrivateDirectoryAcl $parentPath 'STAGING_PARENT_DIRECTORY_ACL_REJECTED'
  Assert-PrivateDirectoryAcl $Path 'STAGING_DIRECTORY_ACL_REJECTED'
}

function Assert-PrivateFile([string]$Path) {
  if (!(Test-Path -LiteralPath $Path -PathType Leaf)) { throw 'STAGING_KEY_FILE_MISSING' }
  $item = Get-Item -LiteralPath $Path -Force
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'STAGING_KEY_FILE_REJECTED' }
  $fileInfo = New-Object IO.FileInfo($Path)
  $acl = $fileInfo.GetAccessControl([Security.AccessControl.AccessControlSections]::Access -bor [Security.AccessControl.AccessControlSections]::Owner)
  if (!$acl.GetOwner([Security.Principal.SecurityIdentifier]).Equals($userSid)) { throw 'STAGING_KEY_FILE_OWNER_REJECTED' }
  foreach ($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or (!$rule.IdentityReference.Equals($userSid) -and !$rule.IdentityReference.Equals($systemSid))) { throw 'STAGING_KEY_FILE_ACL_REJECTED' }
  }
}

function Resolve-StagingRootFolderId([string]$InputValue) {
  $value = $InputValue.Trim()
  if ($value -match '^[A-Za-z0-9_-]{5,200}$') { return $value }
  $uri = $null
  if (![Uri]::TryCreate($value,[UriKind]::Absolute,[ref]$uri)) { throw 'STAGING_ROOT_FOLDER_ID_INVALID' }
  if ($uri.Scheme -cne 'https' -or $uri.Host -cne 'drive.google.com' -or $uri.UserInfo -or $uri.Query -or $uri.Fragment -or $uri.AbsolutePath -cnotmatch '^/drive/(?:u/[0-9]+/)?folders/([A-Za-z0-9_-]{5,200})/?$') { throw 'STAGING_ROOT_FOLDER_ID_INVALID' }
  return $Matches[1]
}

function Test-LocalPort([int]$Port) {
  $client = New-Object Net.Sockets.TcpClient
  try { $client.Connect('127.0.0.1',$Port); return $true } catch { return $false } finally { $client.Dispose() }
}

function Quote-ProcessArgument([string]$Value) {
  $builder = New-Object Text.StringBuilder
  [void]$builder.Append('"')
  $slashes = 0
  foreach ($char in $Value.ToCharArray()) {
    if ($char -eq '\') { $slashes++; continue }
    if ($char -eq '"') { [void]$builder.Append(('\' * (2*$slashes+1))); [void]$builder.Append('"'); $slashes=0; continue }
    if ($slashes) { [void]$builder.Append(('\' * $slashes)); $slashes=0 }
    [void]$builder.Append($char)
  }
  if ($slashes) { [void]$builder.Append(('\' * (2*$slashes)) ) }
  [void]$builder.Append('"')
  return $builder.ToString()
}

function Start-IsolatedNode([string[]]$Arguments,[hashtable]$ExtraEnvironment) {
  $info = New-Object Diagnostics.ProcessStartInfo
  $info.FileName = $node
  $info.WorkingDirectory = $repo
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $false
  $info.Arguments = [String]::Join(' ',@($Arguments | ForEach-Object { Quote-ProcessArgument ([string]$_) }))
  $info.EnvironmentVariables.Clear()
  $safeEnvironment = @{
    SystemRoot=$env:SystemRoot; WINDIR=$env:WINDIR; COMSPEC='C:\Windows\System32\cmd.exe'
    PATH='C:\Program Files\nodejs;C:\Windows\System32'; PATHEXT='.COM;.EXE;.BAT;.CMD'
    TEMP=$env:TEMP; TMP=$env:TMP; USERPROFILE=$env:USERPROFILE; LOCALAPPDATA=$env:LOCALAPPDATA
    HOMEDRIVE=$env:HOMEDRIVE; HOMEPATH=$env:HOMEPATH
  }
  foreach ($entry in $safeEnvironment.GetEnumerator()) { if ($entry.Value) { $info.EnvironmentVariables[$entry.Key]=[string]$entry.Value } }
  foreach ($entry in $ExtraEnvironment.GetEnumerator()) { if ($null -ne $entry.Value) { $info.EnvironmentVariables[$entry.Key]=[string]$entry.Value } }
  $process = New-Object Diagnostics.Process
  $process.StartInfo = $info
  if (!$process.Start()) { $process.Dispose(); throw 'LOCAL_STAGING_PROCESS_START_FAILED' }
  $info.EnvironmentVariables.Clear()
  return $process
}

try {
  if (!(Test-Path -LiteralPath $node -PathType Leaf) -or !(Test-Path -LiteralPath $git -PathType Leaf)) { throw 'QUALIFIED_NODE_OR_GIT_NOT_FOUND' }
  if (!(Test-Path -LiteralPath (Join-Path $repo '.git') -PathType Container)) { throw 'STAGING_REPOSITORY_REQUIRED' }
  $branch = (& $git -C $repo branch --show-current).Trim()
  if ($LASTEXITCODE -ne 0 -or $branch -ne 'codex/teacher-drive-upload-integration') { throw 'EXPECTED_PR12_BRANCH_REQUIRED' }
  if (!(Test-Path -LiteralPath $serverEntry -PathType Leaf) -or !(Test-Path -LiteralPath $viteEntry -PathType Leaf)) { throw 'RUN_NPM_CI_BEFORE_STAGING' }

  $parent = Join-Path $env:LOCALAPPDATA 'UYYM'
  if (!(Test-Path -LiteralPath $parent -PathType Container)) { [void][IO.Directory]::CreateDirectory($parent,(New-PrivateDirectorySecurity)) }
  Assert-PrivateDirectoryAcl $parent 'STAGING_PARENT_DIRECTORY_ACL_REJECTED'
  if (!(Test-Path -LiteralPath $stageDir -PathType Container)) {
    [void][IO.Directory]::CreateDirectory($stageDir,(New-PrivateDirectorySecurity))
  }
  Assert-PrivateDirectory $stageDir

  if (!(Test-Path -LiteralPath $encryptedKey -PathType Leaf)) {
    if (!(Test-Path -LiteralPath $plainKey -PathType Leaf)) { Write-Host "Create a staging-only Google service account key and save it to: $plainKey"; throw 'STAGING_SERVICE_ACCOUNT_KEY_REQUIRED' }
    Assert-PrivateFile $plainKey
    $plainBytes = [IO.File]::ReadAllBytes($plainKey)
    if ($plainBytes.Length -lt 100 -or $plainBytes.Length -gt 32768) { throw 'STAGING_KEY_SIZE_REJECTED' }
    $json = [Text.Encoding]::UTF8.GetString($plainBytes) | ConvertFrom-Json
    if ($json.type -ne 'service_account' -or $json.token_uri -ne 'https://oauth2.googleapis.com/token' -or ([string]$json.client_email).Trim().ToLowerInvariant() -cne $expectedServiceAccountEmail -or $json.private_key -notmatch '^-----BEGIN PRIVATE KEY-----') { throw 'STAGING_SERVICE_ACCOUNT_KEY_REJECTED' }
    $encryptedBytes = [System.Security.Cryptography.ProtectedData]::Protect($plainBytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    Assert-PrivateDirectory $stageDir
    if (Test-Path -LiteralPath $encryptedKey) { throw 'STAGING_KEY_OVERWRITE_REFUSED' }
    Assert-PrivateDirectory $stageDir
    $stream = New-Object IO.FileStream($partKey,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try { $stream.Write($encryptedBytes,0,$encryptedBytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
    Assert-PrivateDirectory $stageDir
    [IO.File]::Move($partKey,$encryptedKey)
    $createdEncrypted = $true
    [Array]::Clear($encryptedBytes,0,$encryptedBytes.Length); $encryptedBytes = $null
    $removeSource = Read-Host 'DPAPI-encrypted staging key is ready. Delete the plaintext source file now? Type YES to remove it (file deletion is not guaranteed physical erasure)'
    if ($removeSource -cne 'YES') { throw 'PLAINTEXT_KEY_REMAINS; no staging process was started' }
    Assert-PrivateDirectory $stageDir
    Assert-PrivateFile $plainKey
    [IO.File]::Delete($plainKey)
    [Array]::Clear($plainBytes,0,$plainBytes.Length); $plainBytes = $null
    $json.private_key = $null
    $json = $null
  } elseif (Test-Path -LiteralPath $plainKey) {
    throw 'PLAINTEXT_AND_ENCRYPTED_KEYS_BOTH_EXIST; remove the plaintext file before launch'
  }

  Assert-PrivateDirectory $stageDir
  Assert-PrivateFile $encryptedKey
  $encryptedBytes = [IO.File]::ReadAllBytes($encryptedKey)
  $plainBytes = [System.Security.Cryptography.ProtectedData]::Unprotect($encryptedBytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)
  if ($plainBytes.Length -gt 32768) { throw 'STAGING_KEY_SIZE_REJECTED' }
  $json = [Text.Encoding]::UTF8.GetString($plainBytes) | ConvertFrom-Json
  if ($json.type -ne 'service_account' -or $json.token_uri -ne 'https://oauth2.googleapis.com/token' -or ([string]$json.client_email).Trim().ToLowerInvariant() -cne $expectedServiceAccountEmail -or $json.private_key -notmatch '^-----BEGIN PRIVATE KEY-----') { throw 'STAGING_SERVICE_ACCOUNT_KEY_REJECTED' }
  $serviceBase64 = [Convert]::ToBase64String($plainBytes)
  $json.private_key = $null
  $json = $null

  if ($ImportKeyOnly) {
    Write-Host 'Staging service-account key identity is verified and DPAPI import is complete. No staging server was started.'
    return
  }

  if (!(Test-Path -LiteralPath $rootIdFile -PathType Leaf)) {
    $newRootId = Resolve-StagingRootFolderId (Read-Host 'Existing staging Drive root folder URL or ID (verify owner and Reader access first)')
    Assert-PrivateDirectory $stageDir
    $rootStream = New-Object IO.FileStream($rootIdFile,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try { $rootBytes=[Text.Encoding]::ASCII.GetBytes($newRootId); $rootStream.Write($rootBytes,0,$rootBytes.Length); $rootStream.Flush($true) } finally { $rootStream.Dispose() }
  }
  Assert-PrivateDirectory $stageDir
  Assert-PrivateFile $rootIdFile
  $rootId = [IO.File]::ReadAllText($rootIdFile,[Text.Encoding]::ASCII).Trim()
  if ($rootId -notmatch '^[A-Za-z0-9_-]{5,200}$') { throw 'STAGING_ROOT_FOLDER_ID_INVALID' }
  $ownerEmail = (Read-Host 'Google account email used only for this staging test').Trim().ToLowerInvariant()
  if ($ownerEmail -notmatch '^\S+@\S+\.\S+$') { throw 'STAGING_OWNER_EMAIL_INVALID' }
  $clientId = (Read-Host 'Staging Google OAuth Web client ID').Trim()
  if ($clientId -notmatch '^\d+-[a-z0-9-]+\.apps\.googleusercontent\.com$') { throw 'STAGING_OAUTH_CLIENT_ID_INVALID' }
  $secretSecure = Read-Host 'Staging Google OAuth client secret (hidden; not saved)' -AsSecureString
  if ($secretSecure.Length -lt 1 -or $secretSecure.Length -gt 512) { throw 'STAGING_OAUTH_CLIENT_SECRET_INVALID' }
  $secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secretSecure)
  $secretText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
  if ($secretText -match '[\r\n\0]') { throw 'STAGING_OAUTH_CLIENT_SECRET_INVALID' }
  $keyBytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($keyBytes) } finally { $rng.Dispose() }
  $encryptionKey = [BitConverter]::ToString($keyBytes).Replace('-','').ToLowerInvariant()

  if ((Test-LocalPort 5174) -or (Test-LocalPort 18878)) { throw 'LOCAL_STAGING_PORT_ALREADY_IN_USE' }
  $serverEnvironment = @{
    NODE_ENV='test'; UYYM_UI_DRIVE_STAGING='1'; UYYM_STAGING_OWNER_EMAIL=$ownerEmail
    UYYM_STAGING_OAUTH_CLIENT_ID=$clientId; UYYM_STAGING_OAUTH_CLIENT_SECRET=$secretText
    UYYM_STAGING_OAUTH_ENCRYPTION_KEY=$encryptionKey; UYYM_STAGING_SERVICE_ACCOUNT_BASE64=$serviceBase64
    UYYM_STAGING_ROOT_FOLDER_ID=$rootId
  }
  $serviceProcess = Start-IsolatedNode -Arguments @('--import','tsx','tests/ui-fixture.ts') -ExtraEnvironment $serverEnvironment
  $serverEnvironment.Clear()
  $secretText = $null
  $serviceBase64 = $null
  $encryptionKey = $null
  if ($secretPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer); $secretPointer=[IntPtr]::Zero }
  if ($secretSecure) { $secretSecure.Dispose(); $secretSecure=$null }
  if ($keyBytes) { [Array]::Clear($keyBytes,0,$keyBytes.Length); $keyBytes=$null }
  if ($plainBytes) { [Array]::Clear($plainBytes,0,$plainBytes.Length); $plainBytes=$null }
  if ($encryptedBytes) { [Array]::Clear($encryptedBytes,0,$encryptedBytes.Length); $encryptedBytes=$null }
  $json = $null
  $viteEnvironment = @{NODE_ENV='development'}
  $viteProcess = Start-IsolatedNode -Arguments @($viteEntry,'--config','tests/ui-vite.config.ts') -ExtraEnvironment $viteEnvironment
  $viteEnvironment.Clear()
  $serverReady = $false
  for ($attempt=0;$attempt -lt 40;$attempt++) { if ($serviceProcess.HasExited) { throw 'LOCAL_STAGING_SERVER_EXITED' }; if (Test-LocalPort 18878) { $serverReady=$true; break }; [Threading.Thread]::Sleep(500) }
  if (!$serverReady) { throw 'LOCAL_STAGING_SERVER_START_TIMEOUT' }
  $viteReady = $false
  for ($attempt=0;$attempt -lt 40;$attempt++) { if ($viteProcess.HasExited) { throw 'LOCAL_STAGING_WEB_EXITED' }; if (Test-LocalPort 5174) { $viteReady=$true; break }; [Threading.Thread]::Sleep(500) }
  if (!$viteReady) { throw 'LOCAL_STAGING_WEB_START_TIMEOUT' }
  Write-Host 'Local staging is ready at http://localhost:5174. It uses in-memory PGlite, synthetic Auth users and the staging-only Google OAuth client.'
  Write-Host 'The staging server stops after two hours or when this PowerShell window is closed. No production URL or database is configured.'
  $deadline = [DateTime]::UtcNow.AddHours(2)
  while ([DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Seconds 1
    if ($serviceProcess.HasExited -or $viteProcess.HasExited) { break }
  }
  if ($serviceProcess.HasExited) { Write-Host 'Local staging server stopped.' }
  elseif ($viteProcess.HasExited) { Write-Host 'Local staging web process stopped.' }
  else { Write-Host 'Local staging session reached its two-hour limit.' }
} finally {
  if ($viteProcess) { if (!$viteProcess.HasExited) { try { $viteProcess.Kill(); $viteProcess.WaitForExit(5000) } catch {} }; $viteProcess.Dispose() }
  if ($serviceProcess) { if (!$serviceProcess.HasExited) { try { $serviceProcess.Kill(); $serviceProcess.WaitForExit(5000) } catch {} }; $serviceProcess.Dispose() }
  if ($secretPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer) }
  if ($secretSecure) { $secretSecure.Dispose() }
  foreach ($buffer in @($keyBytes,$plainBytes,$encryptedBytes)) { if ($buffer -is [byte[]] -and $buffer.Length -gt 0) { [Array]::Clear($buffer,0,$buffer.Length) } }
  $secretText = $null; $serviceBase64 = $null; $json = $null
  $encryptionKey = $null
  if (Test-Path -LiteralPath $partKey -PathType Leaf) { try { Assert-PrivateDirectory $stageDir; [IO.File]::Delete($partKey) } catch { Write-Host 'Encrypted staging key partial-file cleanup incomplete.' } }
  if ($createdEncrypted -and (Test-Path -LiteralPath $plainKey -PathType Leaf) -and (Test-Path -LiteralPath $encryptedKey -PathType Leaf)) { try { Assert-PrivateDirectory $stageDir; Assert-PrivateFile $encryptedKey; [IO.File]::Delete($encryptedKey) } catch { Write-Host 'New DPAPI staging key cleanup incomplete while the plaintext source remains.' } }
}
