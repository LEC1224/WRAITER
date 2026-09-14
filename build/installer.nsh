!include nsDialogs.nsh
!include LogicLib.nsh
!ifndef BUILD_UNINSTALLER
Var WraiterMode
Var WraiterSimple
Var WraiterAdvanced

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
!endif

!macro customInstall
  FileOpen $0 "$INSTDIR\setup-mode.txt" w
  FileWrite $0 "$WraiterMode"
  FileClose $0
!macroend

!macro customUnInstall
  Delete "$INSTDIR\setup-mode.txt"
!macroend
