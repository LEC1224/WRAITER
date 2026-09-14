# WRAITER 0.7.0 validation

## Version 0.7.0 · 2026-09-14

- Added Discord text, Telegram bot MarkdownV2/HTML, and formatted HTML clipboard exports. Every text-based format offers a clipboard destination with the same scope and title controls as file export.
- `npm test`: 161 passing tests. Five chat-export groups cover escaping, emphasis, Telegram underline/italic boundaries, links, code, lists, tables, image placeholders, scope, privacy and long text without truncation. The five groups passed again after the final boundary fix.
- `npm run test:io`: all 19 existing import/export regression checks passed.
- `npm run test:clipboard`: passed in Electron and against `release/win-unpacked/WRAITER.exe`. Covers all eight clipboard formats, rich/plain MIME payloads, chapter/selection scope, switching to file-only formats, clipboard errors with retry, all four new file exports, and rejection of binary clipboard exports. Clipboard methods were intercepted to preserve the user's actual clipboard.
- `npm run build` and `git diff --check` passed. The desktop export dialog screenshot was visually reviewed.
- No live Telegram/Discord message was posted or pasted. Telegram Desktop HTML clipboard support is documented upstream; final formatting depends on the receiving app. Chat exports retain long text in full and do not automatically split it into messages.
- Release build: `npm run package`; artifact `release/WRAITER-0.7.0-Windows.exe`. The desktop export suite passed again against the packaged 0.7.0 application. Windows executable metadata reports file version `0.7.0` and product version `0.7.0.0`.

## Previous 0.6.0 validation

Verified on Windows on 2026-09-13. All document fixtures were synthetic and desktop tests used isolated application data. Author manuscripts and LibreCompleteAI source were not edited.

## Automated checks

- `npm test`: **156 passing checks**, including eight new workspace/session groups. They cover migration from single-document recovery, separate tab stores, restoration and reading positions, duplicate-open handling, preventing saves into another tab's file, staged native imports, changed/missing source files, clean startup, draft preservation, independent identities for copied manuscripts, corrupt-manifest fallback, rollback after a simulated full disk, recent-menu paths, startup validation and existing custom hotkeys.
- `npm run test:v06`: **8 passing desktop workflow groups** against the packaged v0.6 application. New/Open add tabs; active and inactive tabs close correctly; native Open Recent activates an existing tab; Windows Ctrl+Tab, Ctrl+Shift+Tab and Ctrl+W work. ODT and WRAITER projects retain separate bindings and undo histories. Restart restores tab order, the last active project, chapter position and native binding. Unnamed drafts survive tab closing and clean startup. Missing recent files leave the current tab intact; clearing the list does not delete files. Assistant conversations stay with their project and switching tabs cancels a pending completion before it can affect another document.
- `npm run test:app`: **13 passing desktop workflow groups** against the final source build. Existing menus, saves/recovery, chapters, find/replace, fonts, Git checkpoints/restores, AI previews and partial acceptance, task models, translation, PDF, custom hotkeys, themes and restart still work.
- `npm run test:v03`: **8 passing desktop workflow groups** against the packaged v0.6 application. Covers agent edits preserving rich formatting; atomic and cross-session undo/redo; selected-text, chapter and manuscript exports; three real PDF presets; EPUB; direct ODT saveback; DOCX Save As; and native file binding after restart.
- `npm run test:v05`: **5 passing desktop workflow groups** against the packaged v0.6 application. Continuous-view scrolling, automatic divided pages at 100% and 150% zoom, native Ctrl+End/Ctrl+Enter, Backspace removal of page breaks, persistent undo/redo and ranked selection translations remain working. All 194 measured text rectangles stayed within the five test sheets' content areas.
- `npm run test:history-recovery`: **2 passing desktop scenarios** against the packaged v0.6 application. Both unreadable interior JSONL and a valid-JSON fingerprint mismatch preserve the intact document and original damaged journal, then support new edits with undo and restart redo.
- `npm run test:settings`: passed against the final source build, covering native settings menus, independent task models, native language, AI controls, shortcut capture/conflicts and all themes.
- `npm run test:desktop`: passed against the final source build, covering native menus, task routing, encrypted endpoint-scoped credentials, font enumeration, language selection and Git history.

Native-window suites ran sequentially. No renderer errors were reported in the final desktop workflow runs. Save As navigation is synchronized so a project switch cannot race the save. The export regression helper now explicitly dismisses the existing Export details notice using its actual Close dialog/Continue writing buttons before opening the next export.

## Evidence

- `test-output/v06-app-results.json` and `test-output/v06-tabs-kjFZhb/`: the eight packaged tab/startup/AI scenarios.
- `test-output/session-YD9Hom/`: the thirteen general desktop regression groups.
- `test-output/v03-desktop-6EKe2S/`: native ODT/DOCX saves, scoped exports, PDF/EPUB and agent/history workflows.
- `test-output/v05-ui-O0Ku08/`: page geometry, manual breaks and ranked rephrasing.
- `test-output/history-recovery-unreadable-interior-J2B5SH/` and `test-output/history-recovery-valid-json-mismatch-sjJJxv/`: damaged-history recovery scenarios.

Reviewed `test-output/v06-project-tabs.png` and `test-output/v06-startup-settings.png`. The tab strip keeps the existing writer layout and exposes project titles, close controls and a new-tab button. The General settings page explains both startup choices and draft preservation. Native menu labels, exact recent paths and keyboard accelerators were exercised through Electron; renderer screenshots exclude Windows menu chrome.

## Release

Portable artifact: `release/WRAITER-0.6.0-Windows.exe`, **100,388,816 bytes**, product version **0.6.0**.

SHA-256: `fe3d9b3c5cfa731d9683da6ee431adcd97ce5571de74c80b00cd58795f5febbe`.

## Scope and limits

This remains an unsigned Windows preview. Restore all tabs is the default; clean startup is opt-in. Recent projects lists twelve paths. Recovery files and atomic undo journals stay in local application data and do not travel with an office/text file copied to another computer. Assistant conversations are retained while switching tabs within a running session; they are not restored after quitting. Unfinished AI requests are cancelled when switching projects.

The existing office-format limitations remain: complex Word/Writer sections, headers/footers, comments, tracked changes, footnotes and floating content are not fully preserved. Compatibility review, original-file preservation and preceding-save backups still apply. Screen pagination is not an exact preview of every export preset.

Provider and local-engine implementations are unchanged. This release used local mock services for its new AI isolation checks; it made no new live paid-provider requests. The actual Codex, portable Ollama and standalone GGUF smoke tests and independent LibreOffice/PDF checks remain recorded in the v0.4 and v0.5 versions of this report in Git.
