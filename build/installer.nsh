!include nsDialogs.nsh
!include LogicLib.nsh
!include "${__FILEDIR__}\file-associations.nsh"
!ifndef BUILD_UNINSTALLER
Var WraiterMode
Var WraiterSimple
Var WraiterAdvanced
Var WraiterAssociateFiles
Var WraiterAssociationCheckbox

!macro customInit
  StrCpy $WraiterMode "simple"
  ClearErrors
  ReadRegDWORD $WraiterAssociateFiles SHELL_CONTEXT "${WRAITER_ASSOC_STATE_KEY}" "AssociateFiles"
  ${If} ${Errors}
    StrCpy $WraiterAssociateFiles ${BST_CHECKED}
  ${EndIf}
!macroend

!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
  Page custom WraiterModePage WraiterModeLeave

Function WraiterModePage
  !insertmacro MUI_HEADER_TEXT "Make WRAITER yours" "Choose how much guidance you would like."
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateLabel} 0 0 100% 30u "Next you will choose where to install WRAITER. When it opens, a guided setup connects your Codex or Claude Code account."
  Pop $0
  ${NSD_CreateRadioButton} 0 40u 100% 15u "Simple (recommended)"
  Pop $WraiterSimple
  ${NSD_CreateLabel} 12u 60u 90% 28u "Choose an AI account, sign in, and try a small writing test. WRAITER chooses the writing settings for you."
  Pop $0
  ${NSD_CreateRadioButton} 0 100u 100% 15u "Advanced"
  Pop $WraiterAdvanced
  ${NSD_CreateLabel} 12u 120u 90% 28u "Also choose a helper executable, an AI model, and whether suggestions appear automatically."
  Pop $0
  ${If} $WraiterMode == "advanced"
    ${NSD_Check} $WraiterAdvanced
  ${Else}
    ${NSD_Check} $WraiterSimple
  ${EndIf}
  nsDialogs::Show
FunctionEnd

Function WraiterModeLeave
  ${NSD_GetState} $WraiterAdvanced $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $WraiterMode "advanced"
  ${Else}
    StrCpy $WraiterMode "simple"
  ${EndIf}
FunctionEnd
!macroend

!macro customPageAfterChangeDir
  Page custom WraiterFilesPage WraiterFilesLeave

Function WraiterFilesPage
  !insertmacro MUI_HEADER_TEXT "Open manuscripts with WRAITER" "Choose whether Windows opens your WRAITER files in this app."
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateCheckbox} 0 8u 100% 16u "Associate .wraiter files with WRAITER (recommended)"
  Pop $WraiterAssociationCheckbox
  ${NSD_SetState} $WraiterAssociationCheckbox $WraiterAssociateFiles
  ${NSD_OnClick} $WraiterAssociationCheckbox WraiterFilesChanged
  ${NSD_CreateLabel} 0 36u 100% 44u "Double-click a .wraiter manuscript to open it in WRAITER. WRAITER will also appear in Windows' Open with menu."
  Pop $0
  nsDialogs::Show
FunctionEnd

Function WraiterFilesLeave
  ${NSD_GetState} $WraiterAssociationCheckbox $WraiterAssociateFiles
FunctionEnd

Function WraiterFilesChanged
  Pop $0
  ${NSD_GetState} $WraiterAssociationCheckbox $WraiterAssociateFiles
FunctionEnd
!macroend
!endif

!macro customInstall
  FileOpen $0 "$INSTDIR\setup-mode.txt" w
  FileWrite $0 "$WraiterMode"
  FileClose $0
  ${If} $WraiterAssociateFiles == ${BST_CHECKED}
    !insertmacro WraiterRegisterFiles
  ${Else}
    !insertmacro WraiterUnregisterFiles
  ${EndIf}
  WriteRegDWORD SHELL_CONTEXT "${WRAITER_ASSOC_STATE_KEY}" "AssociateFiles" $WraiterAssociateFiles
!macroend

!macro customUnInstall
  Delete "$INSTDIR\setup-mode.txt"
  ; The new installer handles registration after an upgrade. Keep both the
  ; original association and the saved checkbox choice until that point.
  ${IfNot} ${isUpdated}
    !insertmacro WraiterUnregisterFiles
  ${EndIf}
!macroend
