# WRAITER validation

## Version 0.11.0 · Public release · 2026-09-20

- `npm test`: **180 passing tests**.
- `npm run build`: passed with Vite 8.3.0.
- `npm run test:proofreading`: passed the proofreading review, batch correction/undo, statistics, model selection, and spelling-highlight workflow.
- `npm run test:v06`: passed all eight project-tab/startup groups, including saved chats completing in their originating project while another tab is active.
- `npm run test:reload-numbering`: passed external WRAITER/native reload, draft preservation, fresh undo history, persistent row/page/paragraph numbering, zoom alignment, and history exclusion.
- `npm run test:pdf-export`: passed large and small production PDF exports plus load/print failure cleanup without overwriting an existing export.
- `WRAITER-0.11.0-Setup.exe`: **111,855,517 bytes**, product/file version **0.11.0**, SHA-256 `a8ea3d1e1da590d46578949c468b06855121b9b7acaafce7e1296a81dc751f4a`.
- `WRAITER-0.11.0-Windows.exe`: **111,638,383 bytes**, product/file version **0.11.0**, SHA-256 `1bb8a3e40ecd219ee9d352ae5ad4bb094a13dbc11a50fb152fd2fc129d4cc7c5`.
- Both executables are unsigned Windows x64 previews, as documented in the README. Tests used synthetic documents and local mock services; no author manuscript or live provider request was used for this release validation.

## First public release packaging · 2026-09-15

- `npm test`: **168 passing tests**. The MIT release metadata and lockfile remain consistent.
- `npm run package`: passed with the MIT license and notices for 109 installed application dependencies included beside the executable. Electron and Chromium notices are retained. The application archive contains only the expected source, built frontend, assets and package metadata; it contains no account settings or manuscript recovery data.
- `npm run test:onboarding` and `npm run test:tutorial`: passed against the rebuilt `release/win-unpacked/WRAITER.exe`. A timing issue in the tutorial test setup was corrected: it now starts with automatic suggestions off, then enables them through the real command after the practice manuscript owns the tour. This verifies tutorial suppression with the renderer and saved settings in agreement.
- Verified packaged main-process files against the release source, 13 local documentation links, and the GitHub workflow/issue-form YAML. Reviewed the README screenshot with synthetic practice text. A pattern scan of current files and historical text blobs found no credentials or personal document paths before publication.
- `WRAITER-0.9.0-Setup.exe`: **111,839,819 bytes**, SHA-256 `4c1f2bd4176613f452c8c94ed994d8e5ba6d2138f9a93cb68ee82c678d112a1d`.
- `WRAITER-0.9.0-Windows.exe`: **111,622,768 bytes**, SHA-256 `38ef32c9abe3fa246553331dabbcabdf084ddbd1a38192d217078b892bd245c7`.
- Both executables remain unsigned Windows x64 previews. Live Claude Code and completely fresh-PC provider installation/sign-in remain outside the validated scope. The live Codex results below are from the same application source, before publication metadata and license files were added.

## Version 0.9.0 · In-editor writing walkthrough · 2026-09-14

- Replaced the tutorial dialog with a nonmodal dock beneath the real editor. A separate tutorial manuscript starts with one short chapter. The user creates chapter two; the exact requested opening is typed into it. The guide responds to real editor operations and offers a pause/resume path, lesson skipping, and return to the original project.
- `npm test`: **168 passing tests**. New checks cover distinct tutorial documents, the exact opening text, event-driven progress, wrong-project and paused-event rejection, partial/full acceptance, undo/redo order and saved-state validation. The writing-agent tests now verify writing voice is shared, while private notes remain excluded.
- `npm run test:tutorial`: passed in development Electron and again against the packaged `release/win-unpacked/WRAITER.exe`. Exercises the normal editor, IPC and provider HTTP adapter with a local test service: real chapter creation and opening insertion; switching away during introductory typing; untouched original-project contents; request failure/retry and cancellation; character/word/full acceptance; selected-word rephrasing; undo/redo; correction; writing voice; disabled references; multi-turn document-agent edits; pause/restart/resume; Settings preserving newer tutorial progress; history/search/page/focus controls; and the real export dialog. Automatic suggestions do not send background requests from the tutorial manuscript.
- `npm run test:tutorial:live`: **passed using the saved Codex account** with two short real requests and no original-author manuscript content. Codex generated a continuation about an author choosing a confident goose instead of a dragon, then supplied three alternatives for “software”. The actual editor accepted a word, accepted the remainder, accepted a selected-word revision and undid it. This opt-in test uses an isolated WRAITER profile and the synthetic tutorial manuscript. Live Claude Code inference was not exercised in this run.
- `npm run test:onboarding` and `npm run test:settings`: passed after integration with the new walkthrough. The installer/account setup remains a dialog; only the writing tutorial has been replaced. Help can resume a paused tour or start a fresh one after completion.
- Screenshots of the dock, real continuation, live rephrasing menu, assistant edit and minimum-size window were visually reviewed. At 960 × 650, the formatting toolbar becomes one horizontally scrollable row during the tour to leave room for the manuscript. Tutorial notices remain above the dock. No tutorial overlay intercepts the editor's keys or clicks.
- `npm run package`: built `release/WRAITER-0.9.0-Setup.exe` and `release/WRAITER-0.9.0-Windows.exe`. Both remain unsigned Windows previews. `git diff --check` passed. Existing running WRAITER sessions and original writing files were left in place.

## Version 0.8.0 · Guided setup and tutorial · 2026-09-14

- Built `release/WRAITER-0.8.0-Setup.exe` (assisted, per-user Windows NSIS installer) and `release/WRAITER-0.8.0-Windows.exe` (portable). Both are unsigned previews. The 0.7 portable app was already running, so it was left running and the new release uses a separate versioned filename.
- `npm test`: 165 passing tests, including setup preference validation, Claude process isolation arguments, allowlisted installer commands, bounded process output, errors and cancellation.
- `npm run test:onboarding`: passed in development Electron and again against `release/win-unpacked/WRAITER.exe`. Verifies fresh setup, Simple versus Advanced controls, account sign-in gating, successful synthetic writing test, four-task provider assignment, tutorial practice, unchanged manuscript contents, preferences across restart, and Help-menu replay.
- `npm run test:desktop` and `npm run test:settings`: passed. Existing task routing, account-key scoping, menus, shortcuts and settings still work.
- Setup welcome, advanced connection, tutorial layout and tutorial practice screenshots were rendered and visually reviewed under `test-output/`. The screens fit the desktop viewport with clear navigation and readable text.
- Official Codex and Claude Code installation and CLI documentation were checked. Read-only inspection of the installed Claude Code 2.1.62 help confirmed the flags used by the integration. Codex discovery now also checks the standalone installer's `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin` location before a restart is needed.
- No provider installation, live authentication, subscription purchase or live AI inference was performed during QA. Provider responses in integration tests were simulated. A fresh Windows machine's installer/account flow still needs end-to-end human validation; successfully building NSIS does not establish that clean-machine result. Claude aliases are suggestions and model access is verified by the wizard's writing test.
- `npm run build`, the NSIS/portable packaging pipeline, and `git diff --check` passed. Author manuscripts and LibreCompleteAI were not modified.

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
