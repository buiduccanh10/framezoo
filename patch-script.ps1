$scriptPath = "framezoo-desktop/scripts/verify-windows-installer-shortcuts.ps1"
$content = Get-Content $scriptPath -Raw

$diagnosticsCode = @"
        `$diagnosticsFile = Join-Path `$env:LOCALAPPDATA "Programs\Framezoo\install_diagnostics.txt"
        if (Test-Path `$diagnosticsFile) {
            Write-Host "--- BEGIN install_diagnostics.txt ---"
            Get-Content `$diagnosticsFile | Write-Host
            Write-Host "--- END install_diagnostics.txt ---"
        }
"@

$content = $content -replace '        \$exePath = Join-Path \$env:LOCALAPPDATA "Programs\\Framezoo\\Framezoo\.exe"', "$diagnosticsCode`n        `$exePath = Join-Path `$env:LOCALAPPDATA `"Programs\Framezoo\Framezoo.exe`""

Set-Content $scriptPath -Value $content
