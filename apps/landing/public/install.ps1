#Requires -Version 5.1
[CmdletBinding()]
param(
  [switch]$NoInit,
  [string]$Version = ""
)

$ErrorActionPreference = "Stop"

$Repo   = "esau-morais/grind"
$InstallDir = if ($env:GRIND_INSTALL_DIR) { $env:GRIND_INSTALL_DIR } else { "$env:USERPROFILE\.grind\bin" }

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

if (-not $NoInit) {
  grindxp init
}
