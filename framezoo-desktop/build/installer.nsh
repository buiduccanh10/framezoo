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
