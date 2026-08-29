!macro _FixedIsNativeARM64 _a _b _t _f
  !insertmacro _LOGICLIB_TEMP
  !define _FixedIsNativeARM64_True _FixedIsNativeARM64_True_${__COUNTER__}
  !define _FixedIsNativeARM64_End _FixedIsNativeARM64_End_${__COUNTER__}

  # Dedicated single-architecture ARM64 build: ALWAYS evaluate to true
  !ifdef APP_ARM64
    !ifndef APP_64
      !ifndef APP_32
        Goto ${_FixedIsNativeARM64_True}
      !endif
    !endif
  !endif

  # Query IsWow64Process2 for native ARM64 machine type (0xAA64 = 43620)
  # IMPORTANT: Use *i0s to initialize the 32-bit int to 0. IsWow64Process2 only
  # writes a 16-bit USHORT. If uninitialized, the upper 16 bits contain garbage
  # and IntCmpU will fail.
  System::Call "kernel32::IsWow64Process2(p -1, *i, *i0s)"
  Pop $_LOGICLIB_TEMP
  IntCmpU $_LOGICLIB_TEMP 0xAA64 ${_FixedIsNativeARM64_True}

  # Check environment variables
  ReadEnvStr $_LOGICLIB_TEMP "PROCESSOR_ARCHITECTURE"
  StrCmp $_LOGICLIB_TEMP "ARM64" ${_FixedIsNativeARM64_True}
  
  ReadEnvStr $_LOGICLIB_TEMP "PROCESSOR_ARCHITEW6432"
  StrCmp $_LOGICLIB_TEMP "ARM64" ${_FixedIsNativeARM64_True}

  # If we reach here, it's false
  !insertmacro LogicLib_JumpToBranch `${_f}` `${_t}`
  Goto ${_FixedIsNativeARM64_End}

${_FixedIsNativeARM64_True}:
  !insertmacro LogicLib_JumpToBranch `${_t}` `${_f}`

${_FixedIsNativeARM64_End}:
  !undef _FixedIsNativeARM64_True
  !undef _FixedIsNativeARM64_End
!macroend

!macro customHeader
  !ifdef IsNativeARM64
    !undef IsNativeARM64
  !endif
  !define IsNativeARM64 `"" FixedIsNativeARM64 ""`
!macroend

!macro customFiles_arm64
  # Bundle the standalone 7za.dat just in case Nsis7z fails to extract PE files on ARM64 WoW64
  File /oname=$PLUGINSDIR\7za.dat "${BUILD_RESOURCES_DIR}\7za.dat"
!macroend

!macro customInstall
  # If Nsis7z silently failed to extract PE files (Windows Defender / WoW64 bug), fallback to 7za.dat
  ${ifNot} ${FileExists} "$appExe"
    ${if} ${FileExists} "$PLUGINSDIR\7za.dat"
      ${if} ${FileExists} "$PLUGINSDIR\app-arm64.7z"
        DetailPrint "Nsis7z extraction failed for executable. Falling back to standalone 7za.dat..."
        # Extract directly to INSTDIR using standalone 7za.dat and capture output
        nsExec::ExecToStack '"$PLUGINSDIR\7za.dat" x "$PLUGINSDIR\app-arm64.7z" -o"$INSTDIR" -y'
        Pop $R0
        Pop $R4 # Capture stdout/stderr from 7za
        
        # Write to fallback log
        FileOpen $R5 "$INSTDIR\7za_fallback_log.txt" w
        FileWrite $R5 "7za exit code: $R0$\r$\n"
        FileWrite $R5 $R4
        FileClose $R5
        
        # We also need to manually trigger shell notification since files were modified externally
        System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
      ${endIf}
    ${endIf}
  ${endIf}

  # DIAGNOSTICS: Write an installation log to debug the silent extraction failure
  FileOpen $R1 "$INSTDIR\install_diagnostics.txt" w
  FileWrite $R1 "--- Framezoo ARM64 Installation Diagnostics ---$\r$\n"
  FileWrite $R1 "Installer Arch: $packageArch$\r$\n"
  FileWrite $R1 "IsNativeARM64 (LogicLib Check): "
  ${if} ${IsNativeARM64}
    FileWrite $R1 "TRUE$\r$\n"
  ${else}
    FileWrite $R1 "FALSE$\r$\n"
  ${endIf}
  FileWrite $R1 "PROCESSOR_ARCHITECTURE: "
  ReadEnvStr $R2 "PROCESSOR_ARCHITECTURE"
  FileWrite $R1 "$R2$\r$\n"
  FileWrite $R1 "PROCESSOR_ARCHITEW6432: "
  ReadEnvStr $R2 "PROCESSOR_ARCHITEW6432"
  FileWrite $R1 "$R2$\r$\n"
  FileWrite $R1 "Expected appExe path: $appExe$\r$\n"
  FileWrite $R1 "Expected PLUGINSDIR: $PLUGINSDIR$\r$\n"

  # Check if the 7z payload was properly extracted to PLUGINSDIR
  ${if} ${FileExists} "$PLUGINSDIR\app-arm64.7z"
    FileWrite $R1 "Payload in PLUGINSDIR: FOUND (app-arm64.7z)$\r$\n"
  ${else}
    FileWrite $R1 "Payload in PLUGINSDIR: MISSING (app-arm64.7z)$\r$\n"
  ${endIf}

  ${if} ${FileExists} "$PLUGINSDIR\7za.dat"
    FileWrite $R1 "7za.dat in PLUGINSDIR: FOUND$\r$\n"
  ${else}
    FileWrite $R1 "7za.dat in PLUGINSDIR: MISSING (Likely deleted by AV/SmartAppControl!)$\r$\n"
  ${endIf}

  # List the contents of INSTDIR
  FileWrite $R1 "--- Contents of INSTDIR ---$\r$\n"
  FindFirst $R2 $R3 "$INSTDIR\*.*"
  loop_instdir:
    StrCmp $R3 "" done_instdir
    FileWrite $R1 " - $R3$\r$\n"
    FindNext $R2 $R3
    Goto loop_instdir
  done_instdir:
  FindClose $R2

  # List the contents of PLUGINSDIR\7z-out (if it exists)
  FileWrite $R1 "--- Contents of 7z-out ---$\r$\n"
  ${if} ${FileExists} "$PLUGINSDIR\7z-out"
    FindFirst $R2 $R3 "$PLUGINSDIR\7z-out\*.*"
    loop_7zout:
      StrCmp $R3 "" done_7zout
      FileWrite $R1 " - $R3$\r$\n"
      FindNext $R2 $R3
      Goto loop_7zout
    done_7zout:
    FindClose $R2
  ${else}
    FileWrite $R1 "7z-out directory: MISSING$\r$\n"
  ${endIf}

  ${if} ${FileExists} "$INSTDIR\7za_fallback_log.txt"
    FileWrite $R1 "--- Contents of 7za_fallback_log.txt ---$\r$\n"
    FileOpen $R4 "$INSTDIR\7za_fallback_log.txt" r
    loop_fallback_log:
      FileRead $R4 $R5
      StrCmp $R5 "" done_fallback_log
      FileWrite $R1 $R5
      Goto loop_fallback_log
    done_fallback_log:
    FileClose $R4
    FileWrite $R1 "$\r$\n-----------------------------------------$\r$\n"
  ${else}
    FileWrite $R1 "7za_fallback_log.txt: MISSING$\r$\n"
  ${endIf}
  
  FileClose $R1
  
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
    MessageBox MB_OK|MB_ICONEXCLAMATION "Framezoo was installed, but the main executable could not be found at:$\r$\n$appExe$\r$\n$\r$\nPlease check install_diagnostics.txt in the installation folder and reinstall the application." /SD IDOK
  ${endIf}

  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend
