[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Assert-LastCommand([string]$Message) {
    if ($LASTEXITCODE -ne 0) {
        throw $Message
    }
}

if (-not (Test-Path '.env.production')) {
    throw 'Missing .env.production in the application directory.'
}

$branch = (git branch --show-current).Trim()
Assert-LastCommand 'Could not read the current Git branch.'
if ($branch -ne 'main') {
    throw "Production checkout must use the main branch (current: $branch)."
}

Write-Host 'Updating ArchiveCore source...'
git fetch origin main
Assert-LastCommand 'git fetch failed.'
git pull --ff-only origin main
Assert-LastCommand 'git pull failed. Resolve local server changes before deploying.'

$commit = (git rev-parse --short HEAD).Trim()
Assert-LastCommand 'Could not read the deployed commit.'
Write-Host "Deploying commit $commit"

$compose = @('--env-file', '.env.production', '-f', 'docker-compose.prod.yml')

Write-Host 'Building a fresh application image...'
docker compose @compose build --pull --no-cache app
Assert-LastCommand 'Docker image build failed.'

Write-Host 'Applying database migrations...'
docker compose @compose run --rm app npx prisma migrate deploy
Assert-LastCommand 'Database migration failed.'

Write-Host 'Recreating the application and reverse proxy...'
docker compose @compose up -d --force-recreate app nginx
Assert-LastCommand 'Container recreation failed.'

$containerAsset = (docker compose @compose exec -T app sh -c 'grep -o "index-[A-Za-z0-9_-]*\.js" client/dist/index.html | head -n 1').Trim()
Assert-LastCommand 'Could not read the frontend asset name from the application container.'
if (-not $containerAsset) {
    throw 'The application container does not contain a built frontend asset.'
}

$cacheBuster = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$publicHtml = (Invoke-WebRequest -UseBasicParsing -Uri "https://archivecore.doxart.pl/login?deploy=$cacheBuster").Content
$publicMatch = [regex]::Match($publicHtml, 'index-[A-Za-z0-9_-]+\.js')
if (-not $publicMatch.Success) {
    throw 'Could not identify the public frontend asset.'
}

$publicAsset = $publicMatch.Value
Write-Host "Container frontend: $containerAsset"
Write-Host "Public frontend:    $publicAsset"

if ($publicAsset -ne $containerAsset) {
    throw 'Deployment verification failed: the public site still serves a different frontend image.'
}

docker compose @compose ps
Assert-LastCommand 'Could not read container status.'

Write-Host "ArchiveCore $commit deployed successfully."
