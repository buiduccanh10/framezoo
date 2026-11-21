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
  # Bundle the standalone 32-bit 7za.dat. Being 32-bit, WoW64 CAN execute it.
  File /oname=$PLUGINSDIR\7za.dat "${BUILD_RESOURCES_DIR}\7za.dat"
!macroend

!macro customInstall
  # If Nsis7z (the 32-bit plugin) silently dropped PE files due to Defender/SmartAppControl on WoW64...
  ${ifNot} ${FileExists} "$appExe"
    ${if} ${FileExists} "$PLUGINSDIR\7za.dat"
      ${if} ${FileExists} "$PLUGINSDIR\app-arm64.7z"
        DetailPrint "Executable missing. Falling back to standalone 32-bit 7za.dat extraction..."
        nsExec::ExecToStack '"$PLUGINSDIR\7za.dat" x "$PLUGINSDIR\app-arm64.7z" -o"$INSTDIR" -y'
        Pop $R0
        Pop $R4 # Capture output for debugging just in case
        
        # Trigger shell notification since files were modified externally
        System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
        
        ${ifNot} ${FileExists} "$appExe"
          MessageBox MB_OK|MB_ICONEXCLAMATION "Installation failed to extract files. Exit code: $R0$\nOutput: $R4" /SD IDOK
        ${endIf}
      ${endIf}
    ${endIf}
  ${endIf}
!macroend
