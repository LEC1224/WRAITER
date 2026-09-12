# WRAITER 0.3.0 validation

Verified on Windows on 2026-09-12. All document fixtures were synthetic and desktop tests used isolated application data. Existing author manuscripts and LibreCompleteAI source were not edited.

## Automated checks

- `npm test`: **121 passing checks**. Covers native document validation, exact ProseMirror steps and reversible project actions, persistent undo/redo and branches, fsync ordering, crash replay, corrupt-history preservation and injected write failures, native format bindings and external-edit protection, UTF-16 LE/BE/BOM/line endings, actionable format-loss review, provider routing/cancellation, agent tools and stale-result rejection, references, prompts, and actual Git repositories.
- `npm run test:io`: **18 passing import/export groups** and six imported projects passing native validation. Covers ODT/DOCX round trips, whitespace and blank paragraphs, formatting/images/tables/lists/Unicode, chapter metadata verification, malicious or stale metadata, scopes, text encoding, CommonMark, BBCode, EPUB structure, and private-data exclusion.
- `npm run test:app`: **13 passing desktop workflow groups**, using nine mock-provider requests. Verifies native menus, saves/recovery, chapters, find/replace, fonts/sizes, Git checkpoints/restores, selection Tab previews, partial acceptance, pending-request typing, task models, translation, PDF, hotkeys, theme/layout and restart.
- `npm run test:v03`: **8 passing desktop workflow groups**, using two mock agent calls. Verifies layouts and font previews; manuscript-wide agent edits preserving marks; one-operation agent undo and restart redo; individual character undo/redo across sessions; chapter/manuscript/selection exports; three PDFs and EPUB; direct ODT saveback, DOCX Save As and native binding after restart.
- `npm run test:history-recovery`: **2 passing desktop scenarios** for unreadable interior JSONL and valid JSON with a mismatched fingerprint. Both preserve the intact document and exact damaged journal, open a recovery notice, and support fresh edits, undo and restart redo.
- `npm run test:settings` and `npm run test:desktop`: passed final source tests for settings, independent task profiles, encrypted endpoint-scoped credentials, native accelerator capture/conflicts, all themes, fonts, dictionaries, and Git.
- `git diff --check`: clean.

The three desktop workflow suites (13 + 8 + 2 groups) also passed against `release/win-unpacked/WRAITER.exe`, using the shipped ASAR. Settings and desktop IPC suites ran against the final source build.

## Independent format checks

`npm run test:office` generated ODT and DOCX with synthetic rich text, then opened both in a separate headless LibreOffice profile. Its PDF output retained the fixture wording, fonts, paragraph layout and table content. Generated files and rendered pages were inspected under `test-output/office-interop-1789247934155/`.

`npm run test:pdf` printed actual Chromium PDFs and checked page dimensions and text with PyMuPDF. Every one of 55 synthetic paragraphs was found in each output; private notes were absent.

| Preset | Dimensions (points) | Fixture pages |
|---|---|---|
| Standard | 594.96 × 841.92 | 6 |
| Desktop | 510 × 723.12 | 7 |
| Mobile | 298.08 × 529.92 | 11 |

Page counts describe the test fixture, not fixed document limits. PDF evidence is under `test-output/pdf-layout-1789247305151/`.

## Actual Codex connection

A v0.3 live agent smoke test reused the saved Codex account and the configured chat model, **GPT-5.6 Sol**, without opening sign-in or a terminal. Two model turns and one `normalize_spaces` tool call removed five repeated-space runs across three passages in two synthetic chapters. Wording, bold/italic marks, paragraph breaks/alignment and the original snapshot were preserved; private notes were excluded. Elapsed time was 9.7 seconds. This is a small smoke test, not a latency benchmark.

The earlier v0.2 live tests also verified GPT-6-Astra correction, Swedish-to-English selection translation, and reference-based continuation. Other provider adapters use local mock regression tests; live Anthropic, OpenAI API, compatible APIs and installed Ollama generation were not exercised for this release.

## Release and visual review

Portable artifact: `release/WRAITER-0.3.0-Windows.exe`, **100,370,941 bytes**, product version **0.3.0**.

SHA-256: `3d21e425c90c90efbeec6c330463f23cf3e6cbe0c5a8975a9ebecb550ecdca96`.

Reviewed the clean Story document, agent actions and undo control, open searchable font picker, generated office pages, mobile PDF, themes, and minimum window size. Native Windows menu behavior is checked through Electron and native input; renderer screenshots exclude operating-system chrome.

Reports/screenshots are local QA output in `test-output/`: `integration-results.json`, `v03-app-results.json`, `history-recovery-ui-results.json`, `live-codex-agent-results.json`, `v03-writer-story.png`, `v03-agent-edits.png`, and `writer-font-picker.png`.

## Limits

This is an unsigned Windows preview. Direct ODT/DOCX editing does not preserve every Word/Writer feature: unsupported named styles, page sections, headers/footers, comments, tracked changes, footnotes, fields or floating content may be simplified after compatibility review. Originals and preceding-save backups are retained. Review complex office documents and publication exports.

Undo history begins with edits made in v0.3 and stays in local application data; copying an office/text file alone does not transfer its history or private notes. Atomic history works without Git; Git checkpoints require Git. Neither is an off-device backup. The agent has bounded document tools, not an unrestricted computer agent. Live print pagination, direct Claude Code/Grok Build connections, and macOS/Linux builds remain unimplemented.
