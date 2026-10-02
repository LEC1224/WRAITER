; Separate keys let the installer smoke test exercise real registry operations
; in an isolated HKCU subtree instead of changing the user's file associations.
!define /ifndef WRAITER_CLASSES_KEY "Software\Classes"
!define /ifndef WRAITER_CAPABILITIES_KEY "Software\WRAITER\Capabilities"
!define /ifndef WRAITER_ASSOC_STATE_KEY "Software\WRAITER\Installer"
!define /ifndef WRAITER_REGISTERED_APPS_KEY "Software\RegisteredApplications"
!define WRAITER_PROGID "studio.wraiter.desktop.Manuscript"

!macro WraiterRegisterFiles
  ReadRegStr $0 SHELL_CONTEXT "${WRAITER_CLASSES_KEY}\.wraiter" ""
  ${If} $0 != "${WRAITER_PROGID}"
    WriteRegStr SHELL_CONTEXT "${WRAITER_ASSOC_STATE_KEY}" "PreviousProgId" "$0"
  ${EndIf}
  WriteRegStr SHELL_CONTEXT "${WRAITER_CLASSES_KEY}\.wraiter" "" "${WRAITER_PROGID}"
  WriteRegNone SHELL_CONTEXT "${WRAITER_CLASSES_KEY}\.wraiter\OpenWithProgids" "${WRAITER_PROGID}"
  WriteRegStr SHELL_CONTEXT "${WRAITER_CLASSES_KEY}\${WRAITER_PROGID}" "" "WRAITER manuscript"
  WriteRegStr SHELL_CONTEXT "${WRAITER_CLASSES_KEY}\${WRAITER_PROGID}\DefaultIcon" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
  WriteRegStr SHELL_CONTEXT "${WRAITER_CLASSES_KEY}\${WRAITER_PROGID}\shell" "" "open"
  WriteRegStr SHELL_CONTEXT "${WRAITER_CLASSES_KEY}\${WRAITER_PROGID}\shell\open" "" "Open with WRAITER"
  WriteRegStr SHELL_CONTEXT "${WRAITER_CLASSES_KEY}\${WRAITER_PROGID}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  ; Also repair the handler used when the user manually chooses WRAITER.exe.
  WriteRegStr SHELL_CONTEXT "${WRAITER_CLASSES_KEY}\Applications\${APP_EXECUTABLE_FILENAME}" "FriendlyAppName" "WRAITER"
  WriteRegStr SHELL_CONTEXT "${WRAITER_CLASSES_KEY}\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".wraiter" ""
  WriteRegStr SHELL_CONTEXT "${WRAITER_CLASSES_KEY}\Applications\${APP_EXECUTABLE_FILENAME}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegStr SHELL_CONTEXT "${WRAITER_CAPABILITIES_KEY}" "ApplicationName" "WRAITER"
  WriteRegStr SHELL_CONTEXT "${WRAITER_CAPABILITIES_KEY}" "ApplicationDescription" "Write and edit WRAITER manuscripts."
  WriteRegStr SHELL_CONTEXT "${WRAITER_CAPABILITIES_KEY}\FileAssociations" ".wraiter" "${WRAITER_PROGID}"
  WriteRegStr SHELL_CONTEXT "${WRAITER_REGISTERED_APPS_KEY}" "WRAITER" "${WRAITER_CAPABILITIES_KEY}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro WraiterUnregisterFiles
  ReadRegStr $0 SHELL_CONTEXT "${WRAITER_CLASSES_KEY}\.wraiter" ""
  ${If} $0 == "${WRAITER_PROGID}"
    ReadRegStr $0 SHELL_CONTEXT "${WRAITER_ASSOC_STATE_KEY}" "PreviousProgId"
    ${If} $0 == ""
      DeleteRegValue SHELL_CONTEXT "${WRAITER_CLASSES_KEY}\.wraiter" ""
    ${Else}
      WriteRegStr SHELL_CONTEXT "${WRAITER_CLASSES_KEY}\.wraiter" "" "$0"
    ${EndIf}
  ${EndIf}
  DeleteRegValue SHELL_CONTEXT "${WRAITER_CLASSES_KEY}\.wraiter\OpenWithProgids" "${WRAITER_PROGID}"
  DeleteRegKey SHELL_CONTEXT "${WRAITER_CLASSES_KEY}\${WRAITER_PROGID}"
  DeleteRegKey SHELL_CONTEXT "${WRAITER_CLASSES_KEY}\Applications\${APP_EXECUTABLE_FILENAME}"
  DeleteRegKey SHELL_CONTEXT "${WRAITER_CAPABILITIES_KEY}"
  DeleteRegValue SHELL_CONTEXT "${WRAITER_REGISTERED_APPS_KEY}" "WRAITER"
  DeleteRegKey SHELL_CONTEXT "${WRAITER_ASSOC_STATE_KEY}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
