# WRAITER 0.4.0 validation

Verified on Windows on 2026-09-12–13. All document fixtures were synthetic and desktop tests used isolated application data. Existing author manuscripts and LibreCompleteAI source were not edited.

## Automated checks

- `npm test`: **140 passing checks**, including 19 new checks for paragraph-block deletion, preserving required table/list structure, selection boundaries, persistent atomic undo/redo, offline model discovery, local resource controls, GGUF registration, cancellation, official release verification, real Windows ZIP extraction/path rejection, failed-install cleanup, initialization races, Unicode progress, and dotted model names. The existing document, history, format, provider, Git and reference regressions also pass.
- `npm run test:v04`: **6 passing desktop workflow groups**. The exact screenshot request removes three paragraph blocks across two chapters, preserves bold text, and undoes/redoes across restart. Exercises native folder/GGUF choosers, per-task local assignment, real installed-engine start/stop, resource persistence and restart. Model-download, GGUF registration and portable-install IPC are mocked in this desktop suite; the separate live test below runs those engine paths for real.
- `npm run test:io`: the **18 passing import/export groups** from v0.3 remain recorded. Import/export implementation is unchanged in this release. Covers ODT/DOCX round trips, whitespace and blank paragraphs, formatting/images/tables/lists/Unicode, chapter metadata verification, malicious or stale metadata, scopes, text encoding, CommonMark, BBCode, EPUB structure, and private-data exclusion.
- `npm run test:app`: **13 passing desktop workflow groups**, using nine mock-provider requests. Verifies native menus, saves/recovery, chapters, find/replace, fonts/sizes, Git checkpoints/restores, selection Tab previews, partial acceptance, pending-request typing, task models, translation, PDF, hotkeys, theme/layout and restart.
- `npm run test:v03`: **8 passing desktop workflow groups**, using two mock agent calls. Verifies layouts and font previews; manuscript-wide agent edits preserving marks; one-operation agent undo and restart redo; individual character undo/redo across sessions; chapter/manuscript/selection exports; three PDFs and EPUB; direct ODT saveback, DOCX Save As and native binding after restart.
- `npm run test:history-recovery`: **2 passing desktop scenarios** for unreadable interior JSONL and valid JSON with a mismatched fingerprint. Both preserve the intact document and exact damaged journal, open a recovery notice, and support fresh edits, undo and restart redo.
- `npm run test:settings` and `npm run test:desktop`: passed final source tests for settings, independent task profiles, encrypted endpoint-scoped credentials, native accelerator capture/conflicts, all themes, fonts, dictionaries, and Git.
- `git diff --check`: clean.

All four desktop workflow suites (13 + 8 + 6 + 2 groups) passed against `release/win-unpacked/WRAITER.exe`, using the shipped v0.4 ASAR. Settings and desktop IPC suites ran against the final v0.4 source build. An initial general desktop run timed out selecting text while other native-window suites ran concurrently; it passed when rerun alone. No renderer errors occurred and no production change was needed for that test interruption.

## Independent format checks retained from v0.3

`npm run test:office` generated ODT and DOCX with synthetic rich text, then opened both in a separate headless LibreOffice profile. Its PDF output retained the fixture wording, fonts, paragraph layout and table content. Generated files and rendered pages were inspected under `test-output/office-interop-1789247934155/`.

`npm run test:pdf` printed actual Chromium PDFs and checked page dimensions and text with PyMuPDF. Every one of 55 synthetic paragraphs was found in each output; private notes were absent.

| Preset | Dimensions (points) | Fixture pages |
|---|---|---|
| Standard | 594.96 × 841.92 | 6 |
| Desktop | 510 × 723.12 | 7 |
| Mobile | 298.08 × 529.92 | 11 |

Page counts describe the test fixture, not fixed document limits. PDF evidence is under `test-output/pdf-layout-1789247305151/`.

## Actual Codex connection

The v0.4 live smoke test reused the saved Codex account and configured chat model, **GPT-5.6 Sol**. One `remove_empty_paragraphs` tool call removed three empty/whitespace paragraphs across two synthetic chapters and preserved nonempty text and bold marks. The request matched the user's screenshot. Elapsed time was 10.5 seconds; evidence is `test-output/v04-live-agent.json`.

A v0.3 live agent smoke test reused the saved Codex account and the configured chat model, **GPT-5.6 Sol**, without opening sign-in or a terminal. Two model turns and one `normalize_spaces` tool call removed five repeated-space runs across three passages in two synthetic chapters. Wording, bold/italic marks, paragraph breaks/alignment and the original snapshot were preserved; private notes were excluded. Elapsed time was 9.7 seconds. This is a small smoke test, not a latency benchmark.

The earlier v0.2 live tests also verified GPT-6-Astra correction, Swedish-to-English selection translation, and reference-based continuation. Anthropic, OpenAI API and compatible adapters use local mock regression tests; those external services were not exercised live for this release.

## Actual local engines and GGUF

Offline discovery found eight complete installed Ollama model tags. Installed-engine inference with `llama3.2:1b` passed on an NVIDIA RTX 3080 with 10 GiB VRAM. The engine used its own loopback port and stopped after the request.

The official Ollama v0.34.0 Windows x64 archive was downloaded in full, **1,469,375,054 bytes**, and checked against SHA-256 `a7dd1b174f39d3d1b8a25d4cbc86045d0e190b17187bfdcbe2f2ee3b5a11470e` before real Windows extraction. The resulting portable executable then passed `tests/local-live.cjs`: public model pull with preseeded isolated blob copies, real standalone GGUF registration under a new name, actual text generation, loaded-model detection, explicit unload and owned-process shutdown. The GGUF source's size and modification time were preserved. This checks the real pull protocol and cache reuse; it does not redownload all model weights from the network.

Evidence: `test-output/portable-live-dJuQQJ/result.json` and `test-output/local-live-full-CcLQW8/report.json`. Live pull/import/inference/unload took 44.8 seconds, excluding the engine download and initial QA copies. Live catalog size lookup also passed for `llama3.2:1b` and `qwen3:0.6b`. These are smoke tests, not benchmarks or a claim that every GGUF architecture works. AMD/ARM64 inference has not been tested on hardware.

## Release and visual review

Portable artifact: `release/WRAITER-0.4.0-Windows.exe`, **100,379,640 bytes**, product version **0.4.0**.

SHA-256: `0b9eb9f7986cf06cd803f291d39ef8bbb7b667f6a42662d05f68fa410f3e3709`.

Reviewed the clean Story document, agent actions and undo control, open searchable font picker, generated office pages, mobile PDF, themes, and minimum window size. Native Windows menu behavior is checked through Electron and native input; renderer screenshots exclude operating-system chrome.

Reports/screenshots are local QA output in `test-output/`: `integration-results.json`, `v03-app-results.json`, `v04-app-results.json`, `history-recovery-ui-results.json`, `live-codex-agent-results.json`, `v04-live-agent.json`, `v04-local-models.png`, `v04-empty-paragraphs.png`, and `writer-font-picker.png`.

## Limits

This is an unsigned Windows preview. Direct ODT/DOCX editing does not preserve every Word/Writer feature: unsupported named styles, page sections, headers/footers, comments, tracked changes, footnotes, fields or floating content may be simplified after compatibility review. Originals and preceding-save backups are retained. Review complex office documents and publication exports.

Undo history begins with edits made in v0.3 and stays in local application data; copying an office/text file alone does not transfer its history or private notes. Atomic history works without Git; Git checkpoints require Git. Neither is an off-device backup. The agent has bounded document tools, not an unrestricted computer agent. Live print pagination, direct Claude Code/Grok Build connections, and macOS/Linux builds remain unimplemented.
