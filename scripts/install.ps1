# install.ps1 — install Ouroboros meta-agent as a Windows Task Scheduler task
# Run in PowerShell (Admin not required for user-level tasks)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$EnvFile = Join-Path $RepoRoot ".env"

# ── Check prerequisites ───────────────────────────────────────────────────────

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js is required. Install from https://nodejs.org"
}
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    throw "pnpm is required. Run: npm install -g pnpm"
}
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
    throw "Claude Code CLI is required. Install from https://claude.ai/code"
}

# ── Bootstrap .env ────────────────────────────────────────────────────────────

if (-not (Test-Path $EnvFile)) {
    $EnvExample = Join-Path $RepoRoot ".env.example"
    if (Test-Path $EnvExample) {
        Copy-Item $EnvExample $EnvFile
        Write-Host "Created .env from .env.example — edit it before starting services"
        Write-Host "Required: DATABASE_URL, CLAUDE_CODE_OAUTH_TOKEN, OURO_REPO_ROOT"
        exit 0
    }
    throw ".env not found at $EnvFile. Copy .env.example to .env and fill in values."
}

# ── Install and build ─────────────────────────────────────────────────────────

Write-Host "Installing dependencies..."
Push-Location $RepoRoot
& pnpm install
Write-Host "Building packages..."
& pnpm build
Pop-Location

function Get-EnvVar($key) {
    $line = Get-Content $EnvFile | Where-Object { $_ -match "^$key=" } | Select-Object -First 1
    if ($line) { return ($line -split "=", 2)[1] }
    return ""
}

$DatabaseUrl           = Get-EnvVar "DATABASE_URL"
$ClaudeCodeOauthToken  = Get-EnvVar "CLAUDE_CODE_OAUTH_TOKEN"

if (-not $DatabaseUrl) {
    Write-Error "DATABASE_URL is not set in .env"
    exit 1
}
if (-not $ClaudeCodeOauthToken) {
    Write-Error "CLAUDE_CODE_OAUTH_TOKEN is not set in .env"
    exit 1
}

$NodeExe = (Get-Command node -ErrorAction Stop).Source
$MetaAgentMain = Join-Path $RepoRoot "packages\meta-agent\dist\index.js"
$LogFile = Join-Path $RepoRoot "meta-agent.log"

# ── Create Task Scheduler task ────────────────────────────────────────────────

$TaskName = "OuroborosMetaAgent"

# Remove existing task if present
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$Action = New-ScheduledTaskAction `
    -Execute $NodeExe `
    -Argument $MetaAgentMain `
    -WorkingDirectory $RepoRoot

# Run at logon, then keep alive via RestartCount
$Trigger = New-ScheduledTaskTrigger -AtLogOn

$Settings = New-ScheduledTaskSettingsSet `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Seconds 5) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew

# Pass env vars via the task's environment (requires a wrapper approach on Windows)
# We write a small launcher script that sets env vars then calls node
$LauncherPath = Join-Path $RepoRoot "scripts\_launcher.cmd"
@"
@echo off
set DATABASE_URL=$DatabaseUrl
set CLAUDE_CODE_OAUTH_TOKEN=$ClaudeCodeOauthToken
set OURO_REPO_ROOT=$RepoRoot
"$NodeExe" "$MetaAgentMain" >> "$LogFile" 2>&1
"@ | Set-Content $LauncherPath -Encoding ASCII

$Action = New-ScheduledTaskAction `
    -Execute "cmd.exe" `
    -Argument "/c `"$LauncherPath`""

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -RunLevel Limited `
    -Force | Out-Null

# Start immediately
Start-ScheduledTask -TaskName $TaskName

Write-Host "Task '$TaskName' registered and started."
Write-Host "Log output: $LogFile"
Write-Host "Manage via: taskschd.msc or Get-ScheduledTask -TaskName $TaskName"
