#Requires -Version 5.1
[CmdletBinding()]
param(
  [switch]$NoInit,
  [string]$Version = ""
)

$ErrorActionPreference = "Stop"

$Repo   = "esau-morais/grind"
$InstallDir = if ($env:GRIND_INSTALL_DIR) { $env:GRIND_INSTALL_DIR } else { "$env:USERPROFILE\.grind\bin" }

function Ensure-UserPathContains {
  param([string]$Dir)

  if (-not $Dir) { return }

  $normalized = $Dir.Trim().TrimEnd("\\")
  if (-not $normalized) { return }

  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $parts = @()
  if ($userPath) {
    $parts = $userPath.Split(";") | ForEach-Object { $_.Trim() } | Where-Object { $_ }
  }

  $existsInUserPath = $parts | Where-Object {
    $_.TrimEnd("\\").ToLowerInvariant() -eq $normalized.ToLowerInvariant()
  }

  if (-not $existsInUserPath) {
    $newUserPath = if ($userPath -and $userPath.Trim().Length -gt 0) {
      "$userPath;$normalized"
    } else {
      $normalized
    }
    [Environment]::SetEnvironmentVariable("Path", $newUserPath, "User")
    Write-Host "Added to user PATH: $normalized"
  }

  $sessionParts = $env:Path.Split(";") | ForEach-Object { $_.Trim() } | Where-Object { $_ }
  $existsInSessionPath = $sessionParts | Where-Object {
    $_.TrimEnd("\\").ToLowerInvariant() -eq $normalized.ToLowerInvariant()
  }
  if (-not $existsInSessionPath) {
    $env:Path = if ($env:Path -and $env:Path.Trim().Length -gt 0) {
      "$env:Path;$normalized"
    } else {
      $normalized
    }
  }
}

# ── WSL2 delegation ──────────────────────────────────────────────────────────
# If WSL2 is available, install inside WSL for full feature support.

function Test-Wsl {
  try {
    $out = wsl --status 2>&1
    return ($LASTEXITCODE -eq 0) -or ($out -match "Default Distribution")
  } catch {
    return $false
  }
}

if (Test-Wsl) {
  Write-Host "WSL2 detected — installing inside WSL for full feature support."
  $noInitFlag = if ($NoInit) { "-- --no-init" } else { "" }
  $versionEnv = if ($Version) { "GRIND_VERSION=$Version " } else { "" }
  wsl bash -c "${versionEnv}curl -fsSL https://grindxp.app/install.sh | bash $noInitFlag"
  Write-Host ""
  Write-Host "Run 'wsl' to open your WSL terminal, then use 'grindxp' normally."
  exit 0
}

# ── Native Windows fallback (npm) ─────────────────────────────────────────────
# Full binary releases require WSL2. On native Windows we install via npm.

Write-Host "WSL2 not found — installing via npm (limited: Forge daemon requires WSL2)."

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Error "npm is not installed. Install Node.js from https://nodejs.org or enable WSL2 for full support."
  exit 1
}

$pkg = if ($Version) { "grindxp@$Version" } else { "grindxp" }
npm install -g $pkg

try {
  $npmPrefix = (npm prefix -g 2>$null).Trim()
  if ($npmPrefix) {
    Ensure-UserPathContains $npmPrefix
  }
} catch {
  # ignore PATH persistence failures
}

Write-Host "If grindxp is not recognized, open a new terminal to refresh PATH."

if (-not $NoInit) {
  Write-Host ""
  Write-Host "Starting setup wizard (-NoInit to skip)..."
  try {
    grindxp init
  } catch {
    Write-Host ""
    Write-Host "Setup wizard did not complete. Run 'grindxp init' to retry."
    throw
  }
} else {
  Write-Host ""
  Write-Host "Skipped setup wizard (-NoInit). Run 'grindxp init' when you're ready."
}
