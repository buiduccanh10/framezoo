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
    Write-Host "Skipping live execution test. Verifying NSIS package integrity via 7-Zip..."

    $7zExe = "7z"
    if (-not (Get-Command $7zExe -ErrorAction SilentlyContinue)) {
        $candidate7z = "C:\Program Files\7-Zip\7z.exe"
        if (Test-Path $candidate7z) {
            $7zExe = $candidate7z
        } else {
            throw "7-Zip executable not found on system to inspect installer package."
        }
    }

    $listOutput = & $7zExe l "$InstallerPath"
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to list contents of installer $InstallerPath using 7-Zip."
    }

    $hasPayload = ($listOutput | Select-String -Pattern "app-arm64\.7z|Framezoo\.exe")
    if (-not $hasPayload) {
        throw "Installer $InstallerPath is missing the ARM64 application payload."
    }

    Write-Host " [PASS] ARM64 installer package structure and payload verified successfully."
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
