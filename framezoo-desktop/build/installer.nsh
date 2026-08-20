!macro customInstall
  # electron-builder keeps KeepShortcuts=true on reinstall/update. Its built-in
  # repair path misses the unchanged shortcut name, so repair missing links here.
  ${ifNot} ${FileExists} "$newDesktopLink"
    CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  ${endIf}

  ${ifNot} ${FileExists} "$newStartMenuLink"
    !insertmacro createMenuDirectory
    CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
  ${endIf}

  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend
