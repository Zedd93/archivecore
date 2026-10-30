param([switch]$Complete)

$ErrorActionPreference = 'Stop'
$root = 'C:\Apps\PostgreSQL-Staging'
$pgRoot = Join-Path $root '16'
$dataDir = Join-Path $root 'data'
$passwordFile = Join-Path $root 'initdb-password.txt'
$encryptedPasswordFile = Join-Path $root 'staging-password.dpapi'
$taskName = 'ArchiveCorePgvectorInit'
$serviceName = 'archivecore-pgvector-staging'
$port = 55433

function Assert-ExitCode($operation) {
  if ($LASTEXITCODE -ne 0) { throw "$operation failed with exit code $LASTEXITCODE" }
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$admin = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $admin.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this script from an elevated PowerShell session.'
}
if (-not (Test-Path (Join-Path $pgRoot 'bin\initdb.exe'))) {
  throw "PostgreSQL staging binaries are missing from $pgRoot"
}
if (-not $Complete) {
if (Test-Path $dataDir) { throw "Staging data directory already exists: $dataDir" }
if (Get-Service -Name $serviceName -ErrorAction SilentlyContinue) {
  throw "Staging service already exists: $serviceName"
}
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  throw "Scheduled task already exists: $taskName"
}
if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
  throw "Staging port is already listening: $port"
}

New-Item -ItemType Directory -Path $dataDir | Out-Null
& icacls.exe $dataDir '/inheritance:r' '/grant:r' '*S-1-5-19:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
Assert-ExitCode 'Data directory ACL'

$bytes = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
$password = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
New-Item -ItemType File -Path $passwordFile | Out-Null
& icacls.exe $passwordFile '/inheritance:r' '/grant:r' '*S-1-5-19:R' '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null
Assert-ExitCode 'Temporary password ACL'
[IO.File]::WriteAllText($passwordFile, $password + [Environment]::NewLine, [Text.Encoding]::ASCII)

New-Item -ItemType File -Path $encryptedPasswordFile | Out-Null
& icacls.exe $encryptedPasswordFile '/inheritance:r' '/grant:r' '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null
Assert-ExitCode 'Encrypted password ACL'
ConvertTo-SecureString -String $password -AsPlainText -Force |
  ConvertFrom-SecureString |
  Set-Content -LiteralPath $encryptedPasswordFile -Encoding ASCII
$password = $null

try {
  $arguments = '-D "{0}" -U staging_admin --auth-host=scram-sha-256 --pwfile="{1}" --encoding=UTF8' -f $dataDir, $passwordFile
  $action = New-ScheduledTaskAction -Execute (Join-Path $pgRoot 'bin\initdb.exe') -Argument $arguments
  $principal = New-ScheduledTaskPrincipal -UserId 'LOCALSERVICE' -LogonType ServiceAccount
  Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Force | Out-Null
  $startedAt = Get-Date
  Start-ScheduledTask -TaskName $taskName
  $completed = $false
  for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Seconds 1
    $task = Get-ScheduledTask -TaskName $taskName
    $info = Get-ScheduledTaskInfo -TaskName $taskName
    if ($info.LastRunTime -ge $startedAt -and $task.State -ne 'Running') {
      if ($info.LastTaskResult -ne 0 -or -not (Test-Path (Join-Path $dataDir 'PG_VERSION'))) {
        throw "initdb failed; scheduled task result: $($info.LastTaskResult)"
      }
      $completed = $true
      break
    }
  }
  if (-not $completed) { throw 'initdb did not finish within 120 seconds' }
} finally {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $passwordFile -ErrorAction SilentlyContinue
}

Add-Content -LiteralPath (Join-Path $dataDir 'postgresql.conf') -Value @(
  '',
  '# ArchiveCore isolated pgvector staging cluster',
  "port = $port",
  "listen_addresses = '127.0.0.1'",
  'max_connections = 20',
  'shared_buffers = 64MB'
)

$pgCtl = Join-Path $pgRoot 'bin\pg_ctl.exe'
$binPath = '"{0}" runservice -N "{1}" -D "{2}" -w' -f $pgCtl, $serviceName, $dataDir
& sc.exe create $serviceName 'binPath=' $binPath 'start=' 'demand' 'obj=' 'NT AUTHORITY\LocalService' | Out-Null
Assert-ExitCode 'Staging service registration'
Start-Service -Name $serviceName
} else {
  if (-not (Test-Path (Join-Path $dataDir 'PG_VERSION'))) {
    throw "Staging data directory is not initialized: $dataDir"
  }
  $service = Get-CimInstance Win32_Service | Where-Object Name -eq $serviceName
  if (-not $service -or -not $service.PathName.Contains($pgRoot) -or -not $service.PathName.Contains($dataDir)) {
    throw 'Staging service does not point to the expected binaries and data directory'
  }
  if ((Get-Service -Name $serviceName).Status -ne 'Running') { Start-Service -Name $serviceName }
}

$pgIsReady = Join-Path $pgRoot 'bin\pg_isready.exe'
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  & $pgIsReady -h 127.0.0.1 -p $port | Out-Null
  if ($LASTEXITCODE -eq 0) { $ready = $true; break }
  Start-Sleep -Seconds 1
}
if (-not $ready) { throw 'Staging database did not become ready within 30 seconds' }

$securePassword = (Get-Content -LiteralPath $encryptedPasswordFile -Raw).Trim() | ConvertTo-SecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
  $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  & (Join-Path $pgRoot 'bin\createdb.exe') -h 127.0.0.1 -p $port -U staging_admin archivecore_staging
  Assert-ExitCode 'Staging database creation'
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
}

$listeners = @(Get-NetTCPConnection -LocalPort $port -State Listen)
if ($listeners.Count -ne 1 -or $listeners[0].LocalAddress -ne '127.0.0.1') {
  throw 'Staging database is not bound exclusively to 127.0.0.1'
}
Write-Output "Staging PostgreSQL is ready on 127.0.0.1:$port in $dataDir"
