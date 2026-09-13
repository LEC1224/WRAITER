# WRAITER 0.5.0 validation

Verified on Windows on 2026-09-13. Document fixtures were synthetic and desktop tests used isolated application data. Existing author manuscripts and LibreCompleteAI source were not edited.

## Automated checks

- `npm test`: **148 passing checks**. New coverage includes ranked rephrasing responses, malformed and legacy responses, surrounding-context prompts, automatic page placement, oversized objects, existing hotkey preservation, and compatibility with older saved undo histories and document fingerprints. Existing document, agent, provider, local-engine, format, history and Git checks also pass.
- `npm run test:v05`: **5 passing desktop workflow groups**, against both the source build and the packaged v0.5 application. Checks continuous view as the default, scrolling almost a viewport below the last line, persisted divided-page settings, automatic wrapping across pages, native Ctrl+End and Ctrl+Enter, Backspace removal of a manual break, independent undo and redo across restart, and ranked selection translations accepted with arrows plus Enter or Tab. Escape restores the original selection; preview alternatives do not enter the saved document.
- `npm run test:app`: **13 passing desktop workflow groups** against the final source build. Covers existing menus, saves/recovery, chapters, find/replace, fonts, Git, AI previews and partial acceptance, task models, translation, PDF, custom hotkeys, themes and restart. A shortcut collision found during testing was fixed: adding Ctrl+Enter for page breaks preserves an existing user assignment to that key.
- `npm run test:v03`: **8 passing desktop workflow groups** against the packaged v0.5 application. Covers agent edits preserving formatting, atomic and cross-session undo/redo, export scopes, PDF/EPUB output, direct ODT saveback, DOCX Save As and native file binding after restart.
- `npm run test:history-recovery`: **2 passing desktop scenarios** against the packaged v0.5 application. Unreadable interior JSONL and a valid-JSON fingerprint mismatch both preserve the intact document and damaged journal, provide a recovery notice, and support new edits with undo and restart redo.
- `npm run test:settings`: passed against the final source build.
- `npm run test:io`: **19 passing import/export groups**, with **9 imported projects validated**. Includes manual-page-break round trips through ODT, DOCX and HTML, PDF styling, and disclosure when a text format cannot retain breaks. Existing rich formatting, whitespace, chapter metadata, export scope, EPUB, BBCode, encoding and private-data exclusion checks also pass.

Desktop suites ran sequentially to avoid native-window focus conflicts. The final v0.5 workflow run reported no renderer errors. Automatic pagination produced five sheets for the test document: all 194 measured text rectangles stayed inside page content areas at both 100% and 150% zoom. Changing the view did not change the document's paragraph count.

Evidence includes `test-output/v05-app-results.json`, `test-output/v05-ui-4dW5Gq/`, `test-output/session-IXItER/`, `test-output/v03-desktop-qROBK4/`, and the two `test-output/history-recovery-*/` profiles from this release.

## Independent format verification

`npm run test:office` generated synthetic ODT and DOCX documents, opened each through a separate headless LibreOffice profile, and inspected the resulting PDFs with PyMuPDF. Both produced **two pages**, with the paragraph after the explicit break on page two. Text, fonts, lists, table content and the image were retained. Evidence: `test-output/office-interop-1789291612764/`.

`npm run test:pdf` printed actual Chromium PDFs and checked dimensions and extracted text with PyMuPDF. All **55 synthetic paragraphs** were present in each preset; private notes were absent. A separate explicit-break fixture produced exactly **two pages**.

| Preset | Dimensions (points) | Fixture pages |
|---|---|---|
| Standard | 594.96 × 841.92 | 6 |
| Desktop | 510 × 723.12 | 7 |
| Mobile | 298.08 × 529.92 | 11 |

Page counts describe the fixtures. Evidence: `test-output/pdf-layout-1789291221698/`, including `manual-break.pdf`.

## Actual Codex response

A live request reused the saved Codex connection and the configured rewrite model, **GPT-5.6 Terra**, without sign-in or an open CLI session. For the user's surrounding passage and selected Swedish word `uppåtvindar`, the model returned:

| Alternative | Context-fit rating |
|---|---|
| updrafts | 3/3 |
| rising currents | 2/3 |
| upward winds | 1/3 |

Elapsed time was 6.5 seconds. These are the model's judgments, not measured probabilities. Evidence: `test-output/v05-live-options.json`. Other providers were covered through local regression tests, not new live external-service requests.

The installed/portable Ollama, GGUF registration, model pull, inference and shutdown smoke tests from v0.4 remain documented in that release's Git version of this report; the engine implementation is unchanged in v0.5.

## Release and visual review

Portable artifact: `release/WRAITER-0.5.0-Windows.exe`, **100,384,601 bytes**, product version **0.5.0**.

SHA-256: `9ac922b4c58a406317708a4a57e1796d963c26c4c35d244d2bd642b401ca2c66`.

Reviewed `test-output/v05-divided-pages.png` and `test-output/v05-rephrase-options.png`: visible page margins and numbering, text continuing across sheets, and a selection-anchored dropdown with distinct options, star ratings and keyboard hints. Renderer screenshots exclude operating-system chrome.

## Limits

This is an unsigned Windows preview. Divided pages use screen-sized A4 proportions and the selected writing-column width. Export presets have their own paper dimensions; the editor is not an exact print-layout preview. Oversized tables and images stay intact on an expanded screen sheet. Complex Word/Writer features such as sections, headers/footers, tracked changes, footnotes and floating content are not fully preserved by direct editing; compatibility review and existing original/preceding-save backups still apply.

The model is asked for up to three useful alternatives and can return fewer. Legacy providers returning a single plain-text answer show it as unrated. Only an accepted alternative changes the document.

Atomic undo history remains in local application data and is not transferred by copying an office/text file alone. Git checkpoints require Git and are separate from atomic history. macOS/Linux builds and direct Claude Code/Grok Build integrations remain future work.
