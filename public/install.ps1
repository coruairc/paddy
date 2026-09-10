# Paddy installer for Windows PowerShell 5+.
# Not affiliated with the OpenClaw Foundation or Nous Research.
#
#   irm https://raw.githubusercontent.com/coruairc/paddy/main/install.ps1 | iex
#   powershell -c "irm https://raw.githubusercontent.com/coruairc/paddy/main/install.ps1 | iex"
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/coruairc/paddy/main/install.ps1))) -NoOnboard

[CmdletBinding()]
param(
  [switch]$NoOnboard,
  [switch]$DryRun,
  [string]$Ref = $(if ($env:PADDY_REF) { $env:PADDY_REF } else { "main" }),
  [string]$Repo = $(if ($env:PADDY_REPO) { $env:PADDY_REPO } else { "coruairc/paddy" }),
  [string]$GitDir = $(if ($env:PADDY_GIT_DIR) { $env:PADDY_GIT_DIR } else { (Join-Path $HOME ".paddy\src") }),
  [string]$BinDir = $(if ($env:PADDY_BIN_DIR) { $env:PADDY_BIN_DIR } else { (Join-Path $HOME ".local\bin") })
)

$ErrorActionPreference = "Stop"

function Write-Paddy {
  param([string]$Message)
  Write-Host "==> $Message"
}

function Invoke-Paddy {
  param([scriptblock]$Block, [string]$Label)
  if ($DryRun) {
    Write-Host "[dry-run] $Label"
    return
  }
  & $Block
}

Write-Paddy "Paddy · $Repo@$Ref"

foreach ($cmd in @("git", "node", "npm")) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    throw "paddy install: need $cmd on PATH. Node 22+: winget install OpenJS.NodeJS.LTS  Git: winget install Git.Git"
  }
}

$major = [int]((node -p "parseInt(process.versions.node, 10)").ToString().Trim())
if ($major -lt 22) {
  throw "paddy install: Node.js $major is too old. Paddy wants 22+."
}
Write-Paddy "node $(node -v) · npm $(npm -v)"

$cloneUrl = "https://github.com/$Repo.git"
if (Test-Path (Join-Path $GitDir ".git")) {
  Write-Paddy "updating $GitDir"
  Invoke-Paddy { git -C $GitDir fetch --depth 1 origin $Ref; git -C $GitDir checkout -q FETCH_HEAD } "git fetch $Ref"
} else {
  Write-Paddy "cloning $cloneUrl → $GitDir"
  $parent = Split-Path $GitDir -Parent
  Invoke-Paddy {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    git clone --depth 1 --branch $Ref $cloneUrl $GitDir
  } "git clone"
}

$cli = Join-Path $GitDir "bin\paddy.mjs"
if (-not $DryRun -and -not (Test-Path $cli)) {
  throw "paddy install: checkout is missing bin/paddy.mjs — is $Repo the Paddy repo?"
}

Write-Paddy "npm install"
Invoke-Paddy { Push-Location $GitDir; try { npm install --no-fund --no-audit } finally { Pop-Location } } "npm install"

Write-Paddy "wrapper → $(Join-Path $BinDir 'paddy.cmd')"
$wrapper = Join-Path $BinDir "paddy.cmd"
$shim = Join-Path $BinDir "paddy"
Invoke-Paddy {
  New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
  @"
@echo off
node "$cli" %*
"@ | Set-Content -Encoding ASCII $wrapper
  @"
#!/usr/bin/env bash
exec node "$cli" "`$@"
"@ | Set-Content -Encoding ASCII $shim
} "write wrapper"

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not $userPath) { $userPath = "" }
if ($userPath -notlike "*$BinDir*") {
  if ($DryRun) {
    Write-Host "[dry-run] add $BinDir to user PATH"
  } else {
    [Environment]::SetEnvironmentVariable("Path", "$BinDir;$userPath", "User")
    Write-Paddy "added $BinDir to your user PATH — open a new terminal to pick it up"
  }
}
$env:Path = "$BinDir;$env:Path"

$prefix = if ($env:PADDY_HOME) { $env:PADDY_HOME } else { (Join-Path $HOME ".paddy") }
if (-not $NoOnboard) {
  Write-Paddy "paddy onboard"
  Invoke-Paddy {
    $env:PADDY_HOME = $prefix
    & node $cli onboard --yes
  } "paddy onboard --yes"
}

Write-Host @"

Paddy is on this machine.

  paddy gateway          # start the control plane
  paddy dashboard        # web console
  paddy chat "hello"
  paddy models
  paddy doctor

Put keys in $GitDir\selfhost.env or $prefix\selfhost.env, then prefer a model.

"@
