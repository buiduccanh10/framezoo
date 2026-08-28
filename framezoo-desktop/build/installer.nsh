!macro _FixedIsNativeARM64 _a _b _t _f
  !insertmacro _LOGICLIB_TEMP
  # Dedicated single-architecture ARM64 build: ALWAYS evaluate to true
  !ifdef APP_ARM64
    !ifndef APP_64
      !ifndef APP_32
        Goto `${_t}`
      !endif
    !endif
  !endif

  # Query IsWow64Process2 for native ARM64 machine type (0xAA64 = 43620)
  System::Call "kernel32::IsWow64Process2(p -1, *i, *i .s)"
  Pop $_LOGICLIB_TEMP
  IntCmpU $_LOGICLIB_TEMP 0xAA64 `${_t}`

  # Check environment variables
  ReadEnvStr $_LOGICLIB_TEMP "PROCESSOR_ARCHITECTURE"
  StrCmp $_LOGICLIB_TEMP "ARM64" `${_t}`
  
  ReadEnvStr $_LOGICLIB_TEMP "PROCESSOR_ARCHITEW6432"
  StrCmp $_LOGICLIB_TEMP "ARM64" `${_t}`

  Goto `${_f}`
!macroend

!macro customHeader
  !ifdef IsNativeARM64
    !undef IsNativeARM64
  !endif
  !define IsNativeARM64 `"" FixedIsNativeARM64 ""`
!macroend

!macro customInstall
  ${if} ${FileExists} "$appExe"
    # Write helper PowerShell script to create native shell links without emulation/plugin corruption
    FileOpen $R0 "$PLUGINSDIR\create-shortcuts.ps1" w
    FileWrite $R0 'param([string]$$Exe, [string]$$WorkDir, [string]$$DeskLnk, [string]$$MenuLnk, [string]$$Desc)$\r$\n'
    FileWrite $R0 'try {$\r$\n'
    FileWrite $R0 '  if (-not (Test-Path -LiteralPath $$Exe)) { exit 2 }$\r$\n'
    FileWrite $R0 '  $$ws = New-Object -ComObject WScript.Shell$\r$\n'
    FileWrite $R0 '  if ($$DeskLnk) {$\r$\n'
    FileWrite $R0 '    if (Test-Path -LiteralPath $$DeskLnk) { Remove-Item -LiteralPath $$DeskLnk -Force -ErrorAction SilentlyContinue }$\r$\n'
    FileWrite $R0 '    $$sc = $$ws.CreateShortcut($$DeskLnk)$\r$\n'
    FileWrite $R0 '    $$sc.TargetPath = $$Exe$\r$\n'
    FileWrite $R0 '    $$sc.WorkingDirectory = $$WorkDir$\r$\n'
    FileWrite $R0 '    $$sc.IconLocation = "$$Exe,0"$\r$\n'
    FileWrite $R0 '    if ($$Desc) { $$sc.Description = $$Desc }$\r$\n'
    FileWrite $R0 '    $$sc.Save()$\r$\n'
    FileWrite $R0 '  }$\r$\n'
    FileWrite $R0 '  if ($$MenuLnk) {$\r$\n'
    FileWrite $R0 '    $$menuDir = Split-Path -Parent $$MenuLnk$\r$\n'
    FileWrite $R0 '    if ($$menuDir -and -not (Test-Path -LiteralPath $$menuDir)) { New-Item -ItemType Directory -Path $$menuDir -Force | Out-Null }$\r$\n'
    FileWrite $R0 '    if (Test-Path -LiteralPath $$MenuLnk) { Remove-Item -LiteralPath $$MenuLnk -Force -ErrorAction SilentlyContinue }$\r$\n'
    FileWrite $R0 '    $$sc2 = $$ws.CreateShortcut($$MenuLnk)$\r$\n'
    FileWrite $R0 '    $$sc2.TargetPath = $$Exe$\r$\n'
    FileWrite $R0 '    $$sc2.WorkingDirectory = $$WorkDir$\r$\n'
    FileWrite $R0 '    $$sc2.IconLocation = "$$Exe,0"$\r$\n'
    FileWrite $R0 '    if ($$Desc) { $$sc2.Description = $$Desc }$\r$\n'
    FileWrite $R0 '    $$sc2.Save()$\r$\n'
    FileWrite $R0 '  }$\r$\n'
    FileWrite $R0 '  exit 0$\r$\n'
    FileWrite $R0 '} catch {$\r$\n'
    FileWrite $R0 '  exit 1$\r$\n'
    FileWrite $R0 '}$\r$\n'
    FileClose $R0

    !insertmacro createMenuDirectory

    # Run PowerShell script to generate native shell links
    nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\create-shortcuts.ps1" -Exe "$appExe" -WorkDir "$INSTDIR" -DeskLnk "$newDesktopLink" -MenuLnk "$newStartMenuLink" -Desc "${APP_DESCRIPTION}"'
    Pop $R0

    # Fallback to standard NSIS CreateShortCut if PowerShell execution fails
    ${if} $R0 != 0
      SetOutPath "$INSTDIR"
      Delete "$newDesktopLink"
      CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors

      Delete "$newStartMenuLink"
      CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
    ${endIf}
  ${else}
    MessageBox MB_OK|MB_ICONEXCLAMATION "Framezoo was installed, but the main executable could not be found at:$\r$\n$appExe$\r$\nPlease reinstall the application."
  ${endIf}

  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend
