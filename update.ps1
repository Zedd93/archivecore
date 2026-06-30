[CmdletBinding()]
param(
    [string]$ServiceName = '',
    [string]$Pm2ProcessName = 'archivecore'
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Assert-LastCommand([string]$Message) {
    if ($LASTEXITCODE -ne 0) {
        throw $Message
    }
}

if (-not (Test-Path '.env')) {
    throw 'Missing .env in the application directory.'
}

$branch = (git branch --show-current).Trim()
Assert-LastCommand 'Could not read the current Git branch.'
if ($branch -ne 'main') {
    throw "Production checkout must use the main branch (current: $branch)."
}

$service = $null
if ($ServiceName) {
    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if (-not $service) {
        throw "Windows service '$ServiceName' was not found."
    }
} else {
    $serviceMatches = @(Get-Service | Where-Object {
        $_.Name -match 'archivecore' -or $_.DisplayName -match 'archivecore'
    })
    if ($serviceMatches.Count -eq 1) {
        $service = $serviceMatches[0]
    } elseif ($serviceMatches.Count -gt 1) {
        $names = ($serviceMatches | ForEach-Object Name) -join ', '
        throw "Multiple ArchiveCore services found ($names). Run update.ps1 -ServiceName <name>."
    }
}

$pm2 = Get-Command pm2 -ErrorAction SilentlyContinue
$processManager = $null
if ($service) {
    $processManager = 'service'
    Write-Host "Using Windows service: $($service.Name)"
} elseif ($pm2) {
    pm2 describe $Pm2ProcessName *> $null
    if ($LASTEXITCODE -eq 0) {
        $processManager = 'pm2'
        Write-Host "Using PM2 process: $Pm2ProcessName"
    }
}

if (-not $processManager) {
    throw 'ArchiveCore process manager was not found. Pass -ServiceName or register the PM2 process as archivecore.'
}

Write-Host 'Updating ArchiveCore source...'
git fetch origin main
Assert-LastCommand 'git fetch failed.'
git pull --ff-only origin main
Assert-LastCommand 'git pull failed. Resolve local server changes before deploying.'

$commit = (git rev-parse --short HEAD).Trim()
Assert-LastCommand 'Could not read the deployed commit.'
Write-Host "Deploying commit $commit"

if ($processManager -eq 'service') {
    Stop-Service -Name $service.Name -Force
} else {
    pm2 stop $Pm2ProcessName
    Assert-LastCommand 'Could not stop the PM2 process.'
}

$deploymentSucceeded = $false
try {
    Write-Host 'Installing dependencies...'
    npm ci --legacy-peer-deps
    Assert-LastCommand 'npm ci failed.'

    Write-Host 'Generating the Prisma client...'
    npx prisma generate
    Assert-LastCommand 'Prisma client generation failed.'

    Write-Host 'Building server and frontend...'
    npm run build
    Assert-LastCommand 'Application build failed.'

    Write-Host 'Applying database migrations...'
    npx prisma migrate deploy
    Assert-LastCommand 'Database migration failed.'

    $deploymentSucceeded = $true
} finally {
    if ($processManager -eq 'service') {
        Start-Service -Name $service.Name
    } else {
        pm2 restart $Pm2ProcessName --update-env
        Assert-LastCommand 'Could not restart the PM2 process.'
        pm2 save
        Assert-LastCommand 'Could not save the PM2 process list.'
    }
}

if (-not $deploymentSucceeded) {
    throw 'Deployment failed. The application process was started again after the failure.'
}

$builtHtml = Get-Content 'client/dist/index.html' -Raw
$builtMatch = [regex]::Match($builtHtml, 'index-[A-Za-z0-9_-]+\.js')
if (-not $builtMatch.Success) {
    throw 'Could not identify the built frontend asset.'
}

$publicMatch = $null
$lastRequestError = $null
for ($attempt = 1; $attempt -le 12; $attempt++) {
    try {
        $cacheBuster = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        $publicHtml = (Invoke-WebRequest -UseBasicParsing -Uri "https://archivecore.doxart.pl/login?deploy=$cacheBuster").Content
        $candidate = [regex]::Match($publicHtml, 'index-[A-Za-z0-9_-]+\.js')
        if ($candidate.Success) {
            $publicMatch = $candidate
            break
        }
    } catch {
        $lastRequestError = $_
    }
    Start-Sleep -Seconds 5
}

if (-not $publicMatch) {
    if ($lastRequestError) {
        throw "Public deployment check failed: $($lastRequestError.Exception.Message)"
    }
    throw 'Could not identify the public frontend asset.'
}

$builtAsset = $builtMatch.Value
$publicAsset = $publicMatch.Value
Write-Host "Built frontend:  $builtAsset"
Write-Host "Public frontend: $publicAsset"

if ($publicAsset -ne $builtAsset) {
    throw 'Deployment verification failed: the public site still serves a different frontend build.'
}

Write-Host "ArchiveCore $commit deployed successfully."
