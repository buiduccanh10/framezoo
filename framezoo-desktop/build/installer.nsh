!macro customInstall
  # Always delete and recreate shortcuts so that reinstalls/updates never leave
  # a broken shortcut pointing to the old (moved or deleted) exe path.
  Delete "$newDesktopLink"
  CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
  ClearErrors
  WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"

  Delete "$newStartMenuLink"
  !insertmacro createMenuDirectory
  CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
  ClearErrors
  WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"

  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend
