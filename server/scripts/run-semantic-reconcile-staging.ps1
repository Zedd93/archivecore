param(
  [Parameter(Mandatory = $true)]
  [string]$Tenant,
  [ValidateRange(1, 100)]
  [int]$MaxChanges = 20,
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'
$root = 'C:\Apps\PostgreSQL-Staging'
$keyPath = Join-Path $root 'staging-password.key'
$passwordPath = Join-Path $root 'staging-password.aes'
$dataDir = Join-Path $root 'data'

if (-not (Test-Path -LiteralPath $keyPath) -or -not (Test-Path -LiteralPath $passwordPath)) {
  throw 'Brak zaszyfrowanego hasla testowego klastra PostgreSQL.'
}

$key = [IO.File]::ReadAllBytes($keyPath)
$encrypted = (Get-Content -LiteralPath $passwordPath -Raw).Trim()
$secure = $encrypted | ConvertTo-SecureString -Key $key
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  $env:STAGING_DATABASE_URL = 'postgresql://staging_admin:' + [Uri]::EscapeDataString($password) + '@127.0.0.1:55433/archivecore_staging'
  $password = $null
  $mode = if ($Apply) { '--apply' } else { '--dry-run' }
  Push-Location (Resolve-Path (Join-Path $PSScriptRoot '..\..'))
  try {
    & npm run db:reconcile-semantic-staging -- --tenant $Tenant --max-changes $MaxChanges --staging-db archivecore_staging --staging-data-dir $dataDir $mode
    if ($LASTEXITCODE -ne 0) { throw "Odswiezanie indeksu zakonczylo sie kodem $LASTEXITCODE." }
  } finally {
    Pop-Location
  }
} finally {
  Remove-Item Env:STAGING_DATABASE_URL -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
}
