# WRAITER 0.2 validation

Verified on Windows on 2026-09-12. Synthetic documents and isolated test application data were used. Existing author manuscripts and the LibreCompleteAI source were not edited.

## Automated checks

- `npm test`: 59 passing unit/integration checks. Includes document validation, recovery and external-edit protection; prompt boundaries; original-selection whitespace; forward-only completion context; real ProseMirror revision/undo and pending-request equivalence; provider cancellation; task profiles and encrypted-key scoping; actual Git repositories; linked-reference refresh and limits.
- `npm run test:io`: 10 passing browser import/export groups plus native validation of three imported projects. Covers ODT/DOCX structure, formatting, images, lists, tables, Unicode, safe HTML, document font/size/language, paragraph spacing, and export privacy.
- `npm run test:app`: 13 passing end-to-end groups with 9 requests to a local mock Ollama server. Covers native menus, saved/recovered text, chapter operations, find/replace, installed fonts, point sizes, Git checkpoints/restores, selection Tab previews, Escape/retry, partial acceptance, matching and stale typing during generation, task-specific models, translation, PDF export, custom hotkeys, compact layout, and relaunch.
- `npm run test:settings`: passed actual settings interactions for task models, languages, AI controls, all three themes, shortcut remapping and conflicts. Native Ctrl+S/Ctrl+O capture is tested using Electron input events; browser-only keyboard simulation does not test Windows menu accelerators.
- `npm run test:desktop`: passed native IPC checks for per-task model routing, credentials, font enumeration, languages, and Git history.

## Actual Codex connection

The existing saved account and native model catalog were discovered without signing in or opening a terminal. Persistent reference-session creation, injection, fork, and cleanup were checked against the installed Codex protocol.

Three short live requests through GPT-6-Astra passed:

| Task | Result | Time |
|---|---|---|
| Correct `She opend the door.` | `She opened the door.` | 4.9 s |
| Rephrase/translate selected `god morgon`, native Swedish, content English | `good morning` | 5.3 s |
| Continue synthetic garden prose with a reference note | Coherent continuation, within the 12-word cap | 5.4 s |

These timings are a small smoke test, not a latency benchmark. Provider generation tests otherwise use local mocks; Anthropic, OpenAI API, compatible APIs and installed Ollama models were not exercised with paid/live generation.

## Visual review

The portable Windows release compiled successfully. The packaged application (`release/win-unpacked/WRAITER.exe`, using the shipped ASAR) passed the same 13 interaction groups as the source build. Portable artifact: `release/WRAITER-0.2.0-Windows.exe`, 100,308,906 bytes, version 0.2.0. SHA-256: `15359ee239e96daff42450e998b23f4f4ebc8e53e9dc313434dd82f678dde59c`.

Reviewed the editor in Light and Dark, task-model Settings, shortcut Settings, High contrast, and the minimum window size. The native Windows menu is checked through Electron's menu API and native input. Screenshots of the renderer exclude the operating system's title/menu chrome.

Evidence is in `test-output/`: `integration-results.json`, `live-codex-results.json`, `01-paper.png`, `02-dark.png`, `03-compact.png`, `design-light.png`, `design-dark.png`, and `writer-*.png`.

## Limits

This remains an unsigned development preview. Basic ODT/DOCX compatibility does not equal complete office-format round-trip fidelity. Live print pagination, comments, tracked changes, footnotes, EPUB, direct Claude Code/Grok Build connections, and macOS/Linux builds are not implemented. Git versions are local, depend on an available Git executable, and do not replace off-device backup. Real-account generation latency and model output quality vary.
