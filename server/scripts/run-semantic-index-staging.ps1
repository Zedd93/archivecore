param(
  [ValidateSet('init', 'smoke')]
  [string]$Action = 'smoke'
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
  $env:DATABASE_URL = 'postgresql://staging_admin:' + [Uri]::EscapeDataString($password) + '@127.0.0.1:55433/archivecore_staging'
  $password = $null
  Push-Location (Resolve-Path (Join-Path $PSScriptRoot '..\..'))
  try {
    & npm run db:semantic-index-staging -- --staging-db archivecore_staging --staging-data-dir $dataDir ("--$Action")
    if ($LASTEXITCODE -ne 0) { throw "Testowy indeks zakonczyl sie kodem $LASTEXITCODE." }
  } finally {
    Pop-Location
  }
} finally {
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
}
