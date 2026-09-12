# Windows preview verification — 2026-09-12

WRAITER 0.1.0 was built and packaged on Windows x64 with Node.js 24.19.0 and Electron 44.3.0.

## Results

- **Production renderer build:** passed.
- **Unit/backend regression suite:** 22 tests passed.
- **Browser import/export suite:** 9 regression groups passed; three imported projects also passed native manuscript validation.
- **Packaged application interaction suite:** passed using `release/win-unpacked/WRAITER.exe` with a separate test-data directory.
- **Portable executable:** `release/WRAITER-0.1.0-Windows.exe` launched successfully; its WRAITER window was observed responding. The application was left open for the user.
- **Signature:** unsigned development preview. Product metadata reports WRAITER 0.1.0.

The portable build's SHA-256 is recorded in `release/SHA256SUMS.txt`.

## Exercised workflows

Typing → local recovery → native save; chapter creation/navigation; search/replace and undo; revision snapshots; ghost-text generation, partial acceptance, dismissal, full acceptance and undo; stale-response cancellation; correction preview and atomic acceptance/undo; PDF export; appearance preferences; minimum window layout; encrypted Windows API-key storage and endpoint isolation; closing and reopening the manuscript.

Backend tests also exercised malformed input rejection, external file changes/deletion, save-copy collisions, untitled recovery archival, delayed document saves, corrupt recovery fallback, provider redirect rejection, request cancellation, and Codex subprocess isolation.

Import/export fixtures covered ODT inherited formatting, numbered lists, embedded images, notes separation, DOCX formatting/list/image/link/table preservation, UTF-16/Unicode handling, Markdown/BBCode, sanitization, and explicit loss notices.

Screenshots from the packaged application are under `test-output/`: `01-paper.png`, `02-dark.png`, and `03-compact.png`. The interaction summary is `test-output/integration-results.json`.

## Limits of this verification

All AI generation tests used local mock HTTP services. No real cloud generation or Codex model call was performed; installed Codex command support was inspected locally. Model quality, live-account access, and provider-specific model behaviour require testing with the chosen connection.

Only synthetic manuscripts were used. No existing saga manuscripts or LibreCompleteAI files were changed. Import/export support is the documented subset, not full office-format round-trip compatibility. Sustained real-world writing, advanced pagination, accessibility with a screen reader, and macOS/Linux remain unvalidated.
