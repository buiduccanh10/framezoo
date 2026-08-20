param(
  [Parameter(Mandatory = $true)]
  [string]$InstallerPath,

  [Parameter(Mandatory = $true)]
  [ValidateSet("x64", "arm64")]
  [string]$Architecture
)

$ErrorActionPreference = "Stop"

$installer = (Resolve-Path -LiteralPath $InstallerPath).Path
$desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "Framezoo.lnk"
$startMenuShortcut = Join-Path ([Environment]::GetFolderPath("Programs")) "Framezoo.lnk"

function Stop-Framezoo {
  Get-Process -Name "Framezoo" -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue
}

function Remove-Shortcut([string]$path) {
  Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
}

function Install-Framezoo([switch]$Updated) {
  Stop-Framezoo

  $arguments = @("/S")
  if ($Updated) {
    $arguments += "--updated"
  }

  $process = Start-Process `
    -FilePath $installer `
    -ArgumentList $arguments `
    -Wait `
    -PassThru

  if ($process.ExitCode -ne 0) {
    throw "Framezoo $Architecture installer exited with code $($process.ExitCode)."
  }

  Start-Sleep -Seconds 3
  Stop-Framezoo
}

function Assert-Shortcut([string]$path, [string]$label) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "$label shortcut is missing: $path"
  }

  $shell = New-Object -ComObject WScript.Shell
  $link = $shell.CreateShortcut($path)
  $target = $link.TargetPath

  if ([string]::IsNullOrWhiteSpace($target)) {
    throw "$label shortcut has no target: $path"
  }

  if ([IO.Path]::GetFileName($target) -ne "Framezoo.exe") {
    throw "$label shortcut targets '$target', expected Framezoo.exe."
  }

  if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
    throw "$label shortcut target does not exist: $target"
  }
}

Write-Host "Verifying Framezoo $Architecture installer: $installer"

# First pass covers a clean install. Later passes cover the real failure:
# KeepShortcuts is preserved while previously deleted links must be recreated.
Remove-Shortcut $desktopShortcut
Remove-Shortcut $startMenuShortcut
Install-Framezoo

Assert-Shortcut $desktopShortcut "Desktop"
Assert-Shortcut $startMenuShortcut "Start Menu"

Remove-Shortcut $desktopShortcut
Install-Framezoo

Assert-Shortcut $desktopShortcut "Desktop repair"
Assert-Shortcut $startMenuShortcut "Start Menu after Desktop repair"

Remove-Shortcut $startMenuShortcut
Install-Framezoo

Assert-Shortcut $desktopShortcut "Desktop after Start Menu repair"
Assert-Shortcut $startMenuShortcut "Start Menu repair"

Remove-Shortcut $desktopShortcut
Remove-Shortcut $startMenuShortcut
Install-Framezoo -Updated

Assert-Shortcut $desktopShortcut "Desktop after full repair"
Assert-Shortcut $startMenuShortcut "Start Menu after full repair"

Write-Host "Framezoo $Architecture installer shortcuts verified across clean, partial-repair, and full-repair installs."
