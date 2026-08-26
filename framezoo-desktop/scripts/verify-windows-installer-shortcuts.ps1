[CmdletBinding()]
param (
    [Parameter(Position = 0, Mandatory = $false)]
    [Alias("Path", "Installer", "FilePath")]
    [string]$InstallerPath,

    [Parameter(Position = 1, Mandatory = $false)]
    [Alias("Arch", "TargetArch")]
    [ValidateSet("x64", "arm64", "ia32", "x86")]
    [string]$Architecture = "x64"
)

$ErrorActionPreference = "Stop"

# Auto-detect installer file if not provided
if (-not $InstallerPath) {
    $searchPaths = @(
        "framezoo-desktop/release",
        "release",
        "."
    )
    $installerPattern = "Framezoo-*-$Architecture.exe"
    foreach ($path in $searchPaths) {
        if (Test-Path $path) {
            $found = Get-ChildItem -Path $path -Filter $installerPattern -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($found) {
                $InstallerPath = $found.FullName
                break
            }
        }
    }
    if (-not $InstallerPath) {
        throw "Installer for architecture '$Architecture' matching '$installerPattern' not found."
    }
}

if (-not (Test-Path $InstallerPath)) {
    throw "Installer path does not exist: $InstallerPath"
}

Write-Host "Verifying Framezoo $Architecture installer: $InstallerPath"

# Normalize runner architecture
$runnerArch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLower()
Write-Host "Host runner architecture: $runnerArch"

# Case 1: Cross-Architecture Verification (e.g. ARM64 installer on x64 Windows runner)
# Windows on x64 cannot run ARM64 binaries and electron-builder's NSIS script skips extraction on non-ARM64 OS.
if ($Architecture -eq "arm64" -and $runnerArch -ne "arm64") {
    Write-Host "Cross-architecture detected (Target: $Architecture, Runner: $runnerArch)."
    Write-Host "Verifying NSIS package integrity & ARM64 binary payload via 7-Zip..."

    $7zExe = "7z"
    if (-not (Get-Command $7zExe -ErrorAction SilentlyContinue)) {
        $candidate7z = "C:\Program Files\7-Zip\7z.exe"
        if (Test-Path $candidate7z) {
            $7zExe = $candidate7z
        } else {
            throw "7-Zip executable not found on system to inspect installer package."
        }
    }

    $tempDir = Join-Path $env:TEMP "framezoo-arm64-verify-$([System.Guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
    try {
        # Extract app-arm64.7z from installer
        & $7zExe e "$InstallerPath" "app-arm64.7z" -o"$tempDir" -y 2>&1 | Out-Null
        $arm7z = Join-Path $tempDir "app-arm64.7z"
        if (-not (Test-Path $arm7z)) {
            throw "Installer $InstallerPath does not contain 'app-arm64.7z' payload."
        }

        # Inspect contents of app-arm64.7z
        $innerList = & $7zExe l "$arm7z"
        if ($LASTEXITCODE -ne 0 -or -not ($innerList | Select-String -Pattern "Framezoo\.exe")) {
            throw "Payload app-arm64.7z is missing Framezoo.exe."
        }

        # Extract Framezoo.exe to verify PE Machine header
        & $7zExe e "$arm7z" "Framezoo.exe" -o"$tempDir" -y 2>&1 | Out-Null
        $exePath = Join-Path $tempDir "Framezoo.exe"
        if (-not (Test-Path $exePath)) {
            throw "Failed to extract Framezoo.exe from app-arm64.7z."
        }

        $bytes = [System.IO.File]::ReadAllBytes($exePath)
        $peOffset = [System.BitConverter]::ToInt32($bytes, 0x3C)
        $machineType = [System.BitConverter]::ToUInt16($bytes, $peOffset + 4)
        if ($machineType -ne 0xAA64) {
            $hexMachine = "0x" + $machineType.ToString("X4")
            throw "Framezoo.exe has machine type $hexMachine, expected 0xAA64 (ARM64)."
        }

        Write-Host " [PASS] ARM64 payload and Framezoo.exe (Machine: 0xAA64) verified successfully."
    } finally {
        Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    exit 0
}

# Case 2: Native Architecture Verification (e.g. x64 installer on x64 Windows runner)
Write-Host "Running silent installation test..."
$installProcess = Start-Process -FilePath $InstallerPath -ArgumentList "/S" -PassThru -Wait
if ($installProcess.ExitCode -ne 0) {
    throw "Installer exited with non-zero exit code: $($installProcess.ExitCode)"
}

Start-Sleep -Seconds 4

function Find-FirstExistingPath {
    param ([string[]]$Candidates)
    foreach ($cand in $Candidates) {
        if ($cand -and (Test-Path $cand)) {
            return $cand
        }
    }
    return $null
}

$desktopCandidates = @(
    (Join-Path ([Environment]::GetFolderPath("Desktop")) "Framezoo.lnk"),
    (Join-Path ([Environment]::GetFolderPath("CommonDesktopDirectory")) "Framezoo.lnk"),
    (Join-Path $env:USERPROFILE "Desktop\Framezoo.lnk"),
    (Join-Path $env:PUBLIC "Desktop\Framezoo.lnk")
) | Select-Object -Unique

$startMenuCandidates = @(
    (Join-Path ([Environment]::GetFolderPath("Programs")) "Framezoo.lnk"),
    (Join-Path ([Environment]::GetFolderPath("CommonPrograms")) "Framezoo.lnk"),
    (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Framezoo.lnk"),
    (Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\Framezoo.lnk")
) | Select-Object -Unique

$desktopShortcut = Find-FirstExistingPath -Candidates $desktopCandidates
$startMenuShortcut = Find-FirstExistingPath -Candidates $startMenuCandidates

function Verify-Shortcut {
    param (
        [string]$Path,
        [string]$Label
    )

    if (-not $Path -or -not (Test-Path $Path)) {
        throw "$Label shortcut does not exist."
    }

    $wshShell = New-Object -ComObject WScript.Shell
    $shortcut = $wshShell.CreateShortcut($Path)
    $target = $shortcut.TargetPath

    Write-Host "$Label shortcut ($Path) target: $target"

    if (-not (Test-Path $target)) {
        throw "$Label shortcut target does not exist: $target"
    }

    Write-Host " [PASS] $Label shortcut is valid and target executable exists."
}

Verify-Shortcut -Path $desktopShortcut -Label "Desktop"
if ($startMenuShortcut) {
    Verify-Shortcut -Path $startMenuShortcut -Label "Start Menu"
}

# Cleanup: Uninstall test instance
$uninstallCandidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\Framezoo\Uninstall Framezoo.exe"),
    (Join-Path $env:ProgramFiles "Framezoo\Uninstall Framezoo.exe")
)
$uninstallExe = Find-FirstExistingPath -Candidates $uninstallCandidates
if ($uninstallExe) {
    Write-Host "Cleaning up test installation via $uninstallExe..."
    Start-Process -FilePath $uninstallExe -ArgumentList "/S" -Wait
}

Write-Host " [PASS] Windows installer and shortcuts verified successfully!"
