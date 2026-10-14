# WRAITER 0.17.0 release validation — 2026-10-14

This release includes the scrolling and margin-numbering repair, image import and interaction improvements, and measured performance/recovery work from 12–13 October. Application source in `src/`, `electron/`, `assets/` and `build/` is unchanged from final overnight runtime `ccc82a3`; the release preparation commit `d602b53` updates the application version, lockfile and public documentation. The source is published under `v0.17.0`, with [release notes](docs/releases/v0.17.0.md), updated download links and the current user guide.

## Fresh release checks

- `npm test`: **321 passing tests**, zero failures, cancellations or skips.
- `npm run package -- --publish never --config.directories.output=release/v0.17.0`: passed. Regenerated notices for 109 locked application dependencies without changing the notices file; built the frontend and both unsigned Windows x64 packages.
- `npm run test:io`: **26 passing groups**; 19 imported projects satisfy native save validation, including office metadata and invalid XML character checks.
- **13 sequential release workflow suites** passed: onboarding, tutorial, installer associations, image import, document interactions, large Find results, paragraph navigation, desktop font picker, scrolling, reload/numbering, native-save failures, forced-crash recovery and native formats. Twelve suites run the packaged `release/v0.17.0/win-unpacked/WRAITER.exe`; the installer suite exercises the actual NSIS wizard/registry macros in a private test registry.
- Scrolling: **1,500 paragraphs, 51 wheel samples**, zero document-height and tail-position changes; p95 frame sample 7.0 ms. The numbering suite checks real text placement after zoom/resize and external reloads. These are workload-specific observations, not universal timing guarantees.
- Forced exits recovered the durable journal tail for WRAITER and ODT, preserved private notes, resumed named saves, and retained undo/redo across a further restart. Native-save failure checks preserve the preceding ODT and full recovery when body or title XML cannot be encoded.
- A separate packaged launch reports **0.17.0**, Windows x64 and the intended isolated profile. Installer and portable executable resources both report file/product version **0.17.0**. Verified 41 packaged files against source hashes, plus runtime package metadata and locked dependency versions. SHA-256 hashes were rechecked after the workflow tests.
- `git diff --check`: passed. All test manuscripts/profiles are synthetic; provider interactions use local mocks. The installed app, personal profiles and author manuscripts were not changed by release checks.

The longer development checks remain documented in [OVERNIGHT-WORK.md](docs/OVERNIGHT-WORK.md), including 45 minutes of WRAITER endurance, 60 minutes of real ODT saveback on an earlier preview, and 40 minutes / 113 cycles / five launches on the final application source before the version bump. These are prior development runs, separate from this release's fresh checks. The matched 120,000-word desktop benchmark improved median large-tab return from 1,744 to 1,202 ms; typing ranges overlap and median startup was 54 ms slower.

## Exact release artifacts

Build folder: `release/v0.17.0/`.

- `WRAITER-0.17.0-Setup.exe`: **113,018,689 bytes**, SHA-256 `7bf5319e0d40a4703c6d1633980a8bee0a34dd5a1e477513504d8704b4ddfe24`.
- `WRAITER-0.17.0-Windows.exe`: **112,771,549 bytes**, SHA-256 `2936a69007bb6f22de3467b8adc1ee3036ccc3888bd726e656c0547738d598a9`.
- `WRAITER-0.17.0-SHA256SUMS.txt` contains the hashes of the exact executable files. `BUILD-MANIFEST.json` and `VALIDATION-RESULTS.json` retain local source/package verification and complete workflow outcomes.

Evidence logs: `test-output/release-0.17.0-unit.log`, `release-0.17.0-build.log`, `release-0.17.0-io.log`, `release-0.17.0-manifest.log`, the thirteen per-suite logs with the same prefix, and `test-output/release-0.17.0-packaged-results.json`. Fresh-PC installation, code signing and live-provider output quality remain outside these checks. The portable wrapper is built and its resource version is checked; automated application workflows use its packaged executable directly.

---

# Seven intuitive UX improvements — 2026-10-12

All seven findings from [UX-AUDIT.md](docs/UX-AUDIT.md) are implemented. Image controls and Find were handled first: selected images have proportional corner resizing and a description/dimensions dialog; Find seeds selected prose, refocuses/selects its query on Ctrl+F, preserves field focus across chapters, supports Enter/Shift+Enter and F3/Shift+F3, and returns to the passage on Escape. Closed Find retains its query without searching the novel on each keystroke.

Documents dropped from Explorer use the existing import/native-save path and open project tabs; Markdown/text dropped into the reference panel attach enabled references. Mixed drops report accepted/rejected file names. Chapter drag order and outline double-click/F2 rename are undoable. Links support Ctrl+click, Ctrl+K and native Open/Edit/Remove actions, with HTTP/HTTPS/mailto validation. Tabs support middle-click closing, native clicked-tab actions, persistent drag order and keyboard reorder. Native menu, keyboard, percentage and Ctrl+wheel controls share document zoom and preserve reading position while keeping interface scale at 1.

Image properties commit together in one undo action. Explicit width, height and description round-trip through WRAITER, ODT and DOCX. The office encoders retain edited dimensions; DOCX import restores drawing extents/descriptions and ODT import uses the image description. Right-click still preserves selected prose for formatting/comment actions. Browser-only IO harnesses no longer attempt the desktop context-menu bridge.

## Validation

- `npm test`: **287 passing unit tests**, including reordering validation/rollback, native object/tab menus, link/drop validation, zoom steps, image dimensions and the earlier image-import tests.
- `npm run test:ux`: **11 passing desktop groups**, in the development app and packaged app. Covers actual pointer resize at 100%/125%, one-step properties/resize undo, descriptions, Find focus/keyboard across chapters, chapter drag/rename/undo, native link actions, shared zoom/reading position, Explorer-style document/reference drops, clicked-tab menus, middle-click, persistent tab order and restart. No renderer errors.
- `npm run test:images`: **9 passing groups**, in development and packaged apps, including native file-transfer events, clipboard images, supported formats, mixed/error cases, margins/focus/divided pages, stale picker cancellation, internal image moves, restart and durable undo.
- `npm run test:context-menu`: **5 passing groups**, retaining selected prose, formatting/comments, native input menus, local AI actions, stale callbacks and Shift+F10.
- `npm run test:app`: **13 passing groups**, including normal saves/recovery/history, Find/replace, formatting, custom shortcuts, AI previews and restart; 11 local mock requests.
- `npm run test:v03`: **8 passing groups**, including native ODT save, DOCX Save As, scoped exports, PDF/EPUB, agent edits and restart history; 2 local mock requests.
- `npm run test:io`: **23 passing checks**; 18 imported projects pass native validation. Includes edited-image office round trips and existing format/privacy/fidelity checks, without browser renderer errors.
- `npm run test:scrolling`: 1,500 paragraphs, 51 wheel samples, no document-height/tail movement, p95 frame time 7.1 ms.
- `npm run test:v05`: **8 passing groups**; all 194 measured text rectangles stay within the five divided-page content areas.
- `npm run build` and `git diff --check`: passed. Desktop suites ran sequentially, using isolated profiles and synthetic material. No paid AI calls.

Evidence: `test-output/document-ux-dO7W4v/` (final development UX), `test-output/document-ux-ejCzej/` (packaged UX), `test-output/image-import-Th5jdD/` (development imports), `test-output/image-import-mtYyW2/` (packaged imports), `test-output/context-menu-BNmhdB/`, `test-output/session-p3H0FH/`, `test-output/v03-desktop-BdFZ9C/`, `test-output/scrolling-b79k4b/`, and `test-output/v05-ui-8YsuJJ/`. Image handles, Find and minimum-window screenshots were inspected. File drags use Chromium's native file-transfer pipeline; these tests do not physically drive File Explorer. Link launches are captured in the isolated test app.

## Files and local build

New implementation files: `src/images.js`, `src/ImageProperties.jsx`, `src/ChapterOutline.jsx`, `src/ProjectTabs.jsx`, `src/document-ux.js`, and `electron/document-ux.cjs`. Integration changes are in `src/App.jsx`, `src/Editor.jsx`, `src/SearchPanel.jsx`, `src/hotkeys.js`, `src/styles.css`, `src/io.js`, `src/formats/odt.js`, and Electron's menu/preferences/preload/main/workspace files. Tests, scripts, contributor guidance, the user guide and the UX audit were updated. The earlier image-import work remains included. Existing unrelated scrolling/numbering changes are preserved; no author manuscripts were edited.

Local Windows x64 artifacts are under `tmp/ux-improvements-2026-10-12/`; the application version remains **0.16.0**, with **UX-Improvements** filename suffixes distinguishing this build. They include the current working tree and its earlier scrolling changes.

- `WRAITER-0.16.0-UX-Improvements-Setup.exe`: **113,018,081 bytes**, SHA-256 `320305a7d1c6f07c09b9c3ec7d0530e91a2837d5a8b52afeacbb7344335188cc`.
- `WRAITER-0.16.0-UX-Improvements.exe`: **112,770,956 bytes**, SHA-256 `8598ac0a994625ad1786f753e3c8fb9b3e444d770e0587ddff6f0f512fa9c28f`.

Install/reopen this local build to use the changes. Existing office compatibility review and original-file preservation still apply.

---

# WRAITER validation

## Image import and expected interactions · Local development fix · 2026-10-12

The image extension displayed image nodes and the toolbar opened a picker, but the manuscript had no external file-drop or clipboard-image handler. File Explorer drops now read and embed image bytes at the pointer. Clipboard screenshots and the picker use a captured, mapped cursor/selection. A file batch inserts in one durable undo action, with progress, a dashed drop target and actionable failure messages. Imports cannot follow a chapter/project switch into another editor. Ordinary internal image moves remain with ProseMirror. Linked or unsupported HTML images become labelled placeholders while copied wording/formatting remain saveable. The picker also normalizes uppercase JPG extensions.

- `npm test`: **279 passing tests**, including 12 new image-transfer checks.
- `npm run build` and `git diff --check`: passed.
- `npm run test:images`: **9 passing desktop workflow groups**, against both the development app and the packaged `win-unpacked/WRAITER.exe`. Covers actual Chromium file-transfer events; screenshot selection/caret paste; PNG/JPEG/GIF/WebP and blank MIME; multiple/mixed files; errors; page margins/focus/divided pages; stale picker cancellation; internal movement; minimum-window layout; embedding after source-file movement; restart undo/redo; and linked HTML image placeholders. No desktop renderer errors were recorded.
- `npm run test:app`: **13 passing general desktop workflow groups**, including formatting, durable saves/recovery/history, chapter navigation, search, custom shortcuts, AI previews and restart. All 11 provider requests used a local mock service.
- `npm run test:io`: **22 passing import/export checks**, with 16 imported projects passing native validation. Its headless browser harness also emitted the pre-existing desktop-only boot error at `api.onEditorMenu` when no Electron bridge exists; this did not fail the IO checks and was absent from the desktop runs.
- A separate isolated desktop gesture pass reproduced missing selected-phrase Find seeding/refocus, Enter moving focus into the editor, Ctrl+click/Ctrl+K link actions, middle-click tab closing, and outline title/drag gestures. The prioritized source-backed findings and acceptance checks are in [UX-AUDIT.md](docs/UX-AUDIT.md). Synthetic Ctrl+= did not change either zoom scale, so native zoom accelerators/wheel behavior remain unverified in that audit.

Evidence: `test-output/image-import-cJf5Qb/` (development), `test-output/image-import-ItDcpi/` (packaged), `test-output/session-LJrlGN/` (general desktop), and `test-output/ux-observations-zE1o6m/observations.json`. The image desktop tests use protocol file drags and synthetic clipboard events; they do not physically drive File Explorer or overwrite the system clipboard. Minimum-size and larger-window screenshots were inspected. All manuscripts and images were synthetic, with isolated profiles and no paid AI calls.

Changed files for this task: `src/image-import.js`, `src/Editor.jsx`, `src/App.jsx`, `src/styles.css`, `electron/main.cjs`, `tests/image-import.test.mjs`, `tests/image-import-ui.cjs`, `package.json`, `CONTRIBUTING.md`, `docs/USER-GUIDE.md`, `docs/UX-AUDIT.md`, and this report. Existing scrolling/numbering work and unrelated local changes were preserved. No story manuscripts were edited.

Built local Windows x64 installer and portable artifacts under `tmp/image-import-2026-10-12/`. Their `Image-Import` filename suffix distinguishes this development build from public 0.16.0 artifacts; application version remains 0.16.0. The build contains the current working tree, including the earlier local scrolling fixes. The running installed app was left open; installing/reopening the new build is needed to use the fix.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `WRAITER-0.16.0-Image-Import-Setup.exe` | 113,011,881 | `09865e41413e280a93364dfaec4a76d838e96ff4c9f2062e3318d289b3479716` |
| `WRAITER-0.16.0-Image-Import.exe` | 112,764,744 | `93cc8f65d297dd784ec21a3d0b1c5ff1897f132a532ee84b7c91c88fa016b6f5` |

## Stable scrolling and paragraph numbering · Local development fix · 2026-10-12

The installed 0.16.0 app reproduced the reported numbering drift with a synthetic 480-paragraph chapter. Scrolling to paragraph 480 left its label more than 5,300 CSS pixels from its text. All 480 labels existed: there is no 220-paragraph cutoff. The gutter retained measurements taken before offscreen paragraphs acquired their actual heights. Fractional sheet widths also introduced accumulating zoom error because the old scale calculation divided by rounded `offsetWidth`.

The first gutter fix refreshed nearby labels while retaining offscreen layout skipping. The subsequent scrolling test reproduced the underlying movement even with all numbering disabled: `content-visibility: auto` and an estimated intrinsic height of `2.6em` changed the document height as distant paragraphs entered view. The final fix removes those CSS rules and their obsolete state-change listener and numbering override. Manuscript blocks keep their real heights. Paragraph numbering still counts in document order, measures nearby starts, refreshes on scrolling/resizing, and uses actual CSS zoom. The manuscript and editing history remain unchanged by view operations. Browser references: [CSS containment and content visibility](https://www.w3.org/TR/css-contain-2/) and [effective CSS zoom](https://developer.mozilla.org/en-US/docs/Web/API/Element/currentCSSZoom).

- `npm test`: **267 passing tests**. `npm run build` and `git diff --check` passed.
- New `npm run test:scrolling`: passed against development and packaged builds with **1,500 paragraphs / 68,945 words**, varied paragraph lengths and line heights, real wheel input down/up, and jumps to distant positions. It takes 51 geometry samples and checks manuscript and editing-journal preservation. In all three packaged baseline trials the document height changed by **11,416 CSS pixels** and the last paragraph's document-relative position changed by **11,410.03 pixels**. In all three fixed-build trials both changes were **zero**. Fixed document height was consistently **136,338 pixels**.
- `npm run test:long-numbering`: passed against development and packaged builds. Its 18 checks cover paragraph 220 and beyond, the last paragraph, upward scrolling, 150% zoom, the minimum 960 × 650 window, middle-paragraph insertion, undo/redo, and simultaneous row/paragraph numbering. Each target needs a single scroll request; visible labels stay within **1 CSS pixel** of the first text line. Paragraph-only mode creates fewer than 100 nearby labels while all manuscript text retains real layout.
- `npm run test:reload-numbering`: passed persistent numbering toggles, continuous/divided alignment, zoom, resizing, history exclusion, external native/WRAITER reload, draft preservation and subsequent saves.
- `npm run test:undo-scroll`: passed development and packaged runs. Undo/redo retained the same scroll position and kept the caret visible.
- Packaged `npm run test:v05`: passed continuous/divided flow, zoom, manual breaks, undo/redo, restart and synthetic rephrasing. All **194 text rectangles** avoided the **4 gaps** between **5 pages**. Provider responses came from a local mock.
- `npm run test:large`: passed three packaged trials for each build with a roughly **120,000-word manuscript**, a **30,000-word / 1,500-paragraph active chapter**, tail typing/search, warm project switching and Select All. All runs stayed within the existing startup, typing and tab-switch budgets.

The comparison below uses medians of three fresh-profile trials per packaged build, alternating execution order. The baseline is the preserved first-stage gutter-fix package, which still uses offscreen layout skipping. These are local measurements, including desktop/test-driver overhead.

| Measurement | With offscreen layout skipping | Fixed build |
| --- | ---: | ---: |
| 68,945-word chapter startup, including font readiness | 3,117 ms | 3,001 ms |
| Chromium layout work during the wheel/jump exercise | 109.132 ms | 0.382 ms |
| Animation-frame interval, 95th percentile | 7.2 ms | 7.1 ms |
| 30,000-word active chapter startup | 2,997 ms | 2,695 ms |
| Automated typing of 32 characters | 576 ms | 985 ms |
| Warm project-tab return | 1,822 ms | 1,899 ms |

Removing layout skipping eliminated the geometry jumps and reduced layout work during scrolling. Automated typing was slower, so the former optimization did provide a typing benefit in this fixture. Separate three-trial prototypes with layout-only and content containment did not improve typing and were not added to production. The fix does not claim a universal performance improvement.

The final development package is `test-output/scrolling-package/win-unpacked/WRAITER.exe`. It retains base version **0.16.0** and has not been installed or published. The earlier `test-output/paragraph-numbering-package/` build is preserved for comparisons. All profiles and text were synthetic; no author manuscripts or installed-app files were modified.

Visual QA: `test-output/long-numbering-scroll.png` and `test-output/long-numbering-minimum.png`, including visual inspection of the minimum window. Results: `test-output/scrolling-comparison.json`, `scrolling-results.json`, `long-numbering-results.json`, and `large-manuscript-results.json`. Packaged workflow logs are `test-output/scrolling-long-numbering-packaged.log`, `scrolling-undo-packaged.log`, and `scrolling-pagination-packaged.log`. Earlier numbering reproduction: `test-output/long-numbering-baseline.json` and `long-numbering-baseline.png`.

Files changed: `src/pagination.js`, `src/styles.css`, `tests/long-numbering-ui.cjs`, new `tests/scrolling-ui.cjs`, `tests/large-manuscript-ui.cjs`, `package.json`, `CONTRIBUTING.md`, and this report. Test filenames follow the repository's existing desktop-test convention. Existing user files and named release builds were preserved.

## Version 0.16.0 · Wording guidance and revision tools · 2026-10-02

- `npm test`: **267 passing tests**. `npm run build` and `npm run package` passed. The package contains notices for 109 installed application dependencies; its 30 main-process modules match the source, with no settings, recovery or temporary project files in the archive.
- Package metadata, lockfile, packaged metadata and the two Windows executable product/file versions report **0.16.0**. The About window now reads the package version rather than a stale hard-coded number; a packaged launch verified **WRAITER · 0.16.0**.
- Final packaged `test:onboarding`, `test:tutorial`, `test:rephrase-vibe` and `test:suggestion-counts` passed. The selection checks cover model-written descriptions, vibe requests and retries, three-star original ratings and highest/tied comparisons, no-change responses, compatibility with plain replies, independent 1–8 targets, task models, correction scope, atomic acceptance/undo, restart persistence, and minimum-window layout in all three themes. Notes, ratings and vibe guidance never enter the manuscript.
- Packaged `test:settings`, `test:desktop`, `test:context-menu`, `test:revision-tools`, `test:formatting`, `test:file-open`, `test:version-tree`, `test:undo-scroll`, `test:proofreading`, `test:v06`, `test:history-recovery`, `test:app` and `test:v05` passed. These checks ran before the final rebuild, whose only subsequent application change was the About version display. They cover the revision features included since 0.13.0, project isolation, recovery, durable undo, checkpoint branches, file opening, context menus and paginated selection previews. Highlight contrast remains at least **4.865:1** across tested themes and colours.
- `test:io`: **22 passing checks** and **16 validated imported projects**, including comment privacy, office/text roundtrips, EPUB, PDF presets and manual page breaks. `test:installer` passed NSIS compilation and registration checks in an isolated registry subtree, including association defaults, quoted open commands, upgrades, opt-out and uninstall cleanup.
- Updated older desktop fixtures without removing their checks: the tutorial begins with an existing synthetic original instead of typing it while version-summary AI is enabled; the version-tree fixture includes empty comment metadata; formatting waits for Settings to close before selecting a passage; the general editor test uses the current checkpoint controls; and keyboard selection tests move the mouse away from the alternatives menu. The original-document and private-note assertions remain intact.
- The README retains the author's requested introduction, adds eight current interface screenshots with fictional prose and example responses, explains the new controls, and links to 0.16.0 downloads. All **17 local README links** resolve. The screenshots were visually reviewed, and `git diff --check` passed.
- All AI workflow checks used synthetic manuscripts, isolated profiles and local mock providers. No paid AI request, author manuscript change or installed-app update was performed. Packaged UI checks launch `release/win-unpacked/WRAITER.exe`; a direct Playwright launch of the portable wrapper timed out. Fresh-PC installation and live-provider judgement remain outside this release validation.
- `WRAITER-0.16.0-Setup.exe`: **113,009,515 bytes**, SHA-256 `50b825fa66083ab61ca6009ba5d358d4d291e25d50f99631be5cde4e6bdbe792`.
- `WRAITER-0.16.0-Windows.exe`: **112,762,387 bytes**, SHA-256 `397bd21471148564f52820fb451cf3742e3f51da63e3c755612dc3d72466c301`.
- Checksums are in `release/WRAITER-0.16.0-SHA256SUMS.txt`. Both Windows x64 executables are unsigned previews. Release notes are in [docs/releases/v0.16.0.md](docs/releases/v0.16.0.md).

## Version 0.15.1 · Right-click editing actions · 2026-10-02

- Package metadata and lockfile report **0.15.1**. The guided installer and portable executable report product/file version **0.15.1**; the unpacked application reports product version **0.15.1.0** and file version **0.15.1**. `npm run build`, `npm run package`, and `git diff --check` passed. Older named release executables remain available.
- `npm test`: **256 passing tests**. Seven new unit tests cover selection/cursor capabilities, formatting and AI availability, ordinary text-field editing, spelling suggestions, displayed shortcuts without new accelerator registration, sender/request isolation, superseded requests, renderer fallback and window cleanup.
- New `test:context-menu` passed against the development application and final packaged `release/win-unpacked/WRAITER.exe`. Five workflow groups use real right-click and Shift+F10 gestures, actual native menu objects and production callbacks. The first popup is shown and closed through Electron's native menu lifecycle; later popups are intercepted to invoke their real menu items deterministically.
- Those groups verify preserved selections; copy/paste and clear formatting; persistent undo/redo; target words, links and comment anchors; comment composer focus; ordinary private-field menus; assistant composer focus without sending a request; configured correction/rephrasing/continuation models; cancellation and preview acceptance/dismissal; clicking outside a selection; and rejection of stale menu callbacks. All fixtures and profiles are synthetic and isolated, provider responses come from a local HTTP server, and private comment bodies/IDs are checked against every AI request.
- Testing caught and fixed two selection problems: right-clicking a comment anchor opened its sidebar, and an unnecessary selection transaction dismissed the AI preview before menu acceptance. Right-click now retains the passage without opening the comment panel, and actions avoid resetting an unchanged selection.
- `test:desktop` passed, covering native menus, IPC, per-task provider routing, encrypted endpoint-scoped credentials, font enumeration, content language and Git history. Development `test:revision-tools` also passed its eight groups, covering manuscript search/replace, comments, formatting paste, durable undo/restart, project isolation and light/dark minimum-window layout.
- Reports and the editor screenshot are in `test-output/context-menu-results.json`, `context-menu-packaged-results.json`, `context-menu-editor.png`, and `revision-tools-results.json`. Earlier sections document an unrelated tutorial assertion failure concerning checkpoint-summary context; `test:tutorial` was not rerun for this release.
- `WRAITER-0.15.1-Setup.exe`: **113,007,098 bytes**, SHA-256 `c1c1024ffb5eb355ef7ef2785551d97d4a1243c26c8d27e486c03150fa8afb04`.
- `WRAITER-0.15.1-Windows.exe`: **112,759,966 bytes**, SHA-256 `6968ad96c02e1f83d794f20789acf219fcce49114b8e8e8ce27de829c2693d1d`.
- Checksums are in `release/WRAITER-0.15.1-SHA256SUMS.txt`. No GitHub release or installed-app update was performed.

Files changed for this update: `electron/context-menu.cjs`, native main/preload integration, `src/App.jsx`, `src/Editor.jsx`, two focused menu test files, package metadata/lockfile, contribution guidance, README, user guide, these validation results, and `docs/releases/v0.15.1.md`. Existing unrelated working-tree changes were preserved; no manuscripts or writing assets were modified.

## Version 0.15.0 · Manuscript revision tools · 2026-10-01

- Package metadata, lockfile, and Windows executable product/file versions report **0.15.0**. `npm run build`, `npm run package`, and `git diff --check` passed. The guided installer and portable executable were rebuilt; older named release executables remain available.
- `npm test`: **249 passing tests**. New coverage includes manuscript search without a 2,000-result replacement limit, case and Unicode word boundaries, stale batch rejection, formatting preservation, overlapping comment anchors, detached notes, code annotations, chapter moves/splits/merges, validation, snapshot copying, persistent batch undo/redo with selections, and private-comment safeguards in the writing assistant's tools.
- New `test:revision-tools` passed against the development application and final packaged `release/win-unpacked/WRAITER.exe`. Its eight packaged groups cover chapter-grouped search and navigation, whole/current-chapter scope, case and word filters, preview without changes, stale preview rejection, one-step replace-all undo/redo through restart, same-text replacements without changing history, comment CRUD and passage navigation, anchors through typing and clear formatting, linked and annotated formatting paste, copying inherited defaults between differently styled projects, project isolation, and restart persistence. Synthetic standard-copy events preserve public rich text without revealing private IDs or changing the system clipboard.
- Dark and light screenshots were inspected at 1280 × 850 and the minimum native 960 × 650 window. Search and comments stay within the content viewport; the compact search layout retains space for the manuscript. Screenshots and results are in `test-output/revision-tools-*.png`, `revision-tools-results.json`, and `revision-tools-packaged-results.json`.
- `test:io`: **22 passing checks** and **16 validated imported projects**. Comment privacy is checked across 48 export combinations, including manuscript/selection scope and native-save modes, plus direct publication HTML and rich clipboard. Office and EPUB ZIP parts omit private comment bodies, IDs and styling while retaining words, fonts, colours, highlighting and links. Exporting leaves the native project and selected source JSON unchanged.
- `test:app` passed against the development app. `test:v03` passed against the final packaged executable, including fonts, manuscript-wide assistant edits, durable undo/redo, selected/chapter/manuscript exports, real PDF and EPUB output, native ODT saves, DOCX conversion and restart bindings. All fixtures and profiles are synthetic; provider requests use local mocks.
- Packaged `test:formatting` and `test:file-open` also passed during this release. Highlight backgrounds retain 26% opacity, with a minimum measured text contrast of **4.865:1** across the tested light, dark and high-contrast colours. File opening checks cover cold and second-process launches, Unicode paths, existing tabs, multiple files, minimized windows, pending dialogs, invalid files and first-run setup. `test:installer` passed the NSIS compilation and registry simulation, including checked-by-default associations, quoted commands, Open with registration, opt-out persistence and uninstall cleanup.
- Comments are saved in `.wraiter` files and companion state for other formats. External changes to another format invalidate its companion state and trigger re-import. Imported Office comments continue to become project notes. Earlier sections document an unrelated tutorial assertion failure concerning checkpoint-summary context; `test:tutorial` was not rerun for this release.
- `WRAITER-0.15.0-Setup.exe`: **113,005,289 bytes**, product/file version **0.15.0**, SHA-256 `190f883ca6f0c2b84daf8f3563e1ae0ae8401b2c390b43d831f852e51c9cd4da`.
- `WRAITER-0.15.0-Windows.exe`: **112,758,168 bytes**, product/file version **0.15.0**, SHA-256 `0aae4b7aea361dfc1b6253a7f99208985160120e0b297e9700ff47dc9c5f1e3c`.
- Checksums are in `release/WRAITER-0.15.0-SHA256SUMS.txt`. No GitHub release or installed-app update was performed.

Files changed for these features: search helpers and panel, comment helpers/panel/schema/validation, formatting helpers and toolbar controls, app/editor/history/snapshot integration, private-comment projection in exports and editorial tools, native menus, styles, package metadata and test script, focused unit/desktop/IO tests, contribution guidance, README, user guide, these validation results, and `docs/releases/v0.15.0.md`. Existing unrelated working-tree changes were preserved; no manuscripts or writing assets were modified.

## Version 0.14.3 · Toolbar formatting and highlight colours · 2026-10-01

- Package metadata, lockfile, and executable product/file versions report **0.14.3**. Both local Windows x64 executables were rebuilt with `npm run package`; earlier release executables remain available under their existing names.
- `npm test`: **213 passing tests**. `npm run build`, `npm run package`, and `git diff --check` passed.
- New `test:formatting` passed against the development app and final `release/win-unpacked/WRAITER.exe`. It checks toolbar clear formatting, resetting headings and paragraph spacing, selected and surrounding words, partial selections, plain typing after clearing at a cursor, undo/redo, eight highlight presets, custom colours, removing imported backgrounds while retaining other marks, the main toggle, keyboard highlighting, Escape, the minimum window, and persistence through a full application restart. All data and profiles are synthetic and isolated; AI is disabled.
- The contrast checks sample all eight presets plus custom white, black and blue in Light, Dark and High contrast. Actual computed backgrounds have **26% opacity**, text remains opaque, and the minimum measured text contrast is **4.865:1** against the page. Imported background colours use the same treatment. Screenshots: `test-output/formatting-paper.png`, `formatting-dark.png`, `formatting-contrast.png`, and `formatting-minimum.png`.
- `test:io`: **20 passing checks**, including a new colour roundtrip through HTML, ODT and DOCX. Original colours and wording remain intact; the editor's blend does not enter publication HTML or office shading. Named and RGB imported colours still parse correctly. All 13 imported projects pass native save validation.
- `test:v03` passed: existing fonts, manuscript-wide edits, persistent undo/redo, selected/chapter/manuscript exports, all three PDF presets, EPUB, and native ODT/DOCX saveback. Its export helper now waits for the export dialog to close before checking the explicit Export details notice, avoiding the race between the file write and IPC completion without weakening assertions.
- `test:file-open` passed again against the final packaged app, preserving the 0.14.2 Explorer-opening fixes. Installer association macros are unchanged from the isolated registration and wizard checks recorded below.
- `WRAITER-0.14.3-Setup.exe`: **112,994,424 bytes**, product/file version **0.14.3**, SHA-256 `2a7c274a5ce8dd11dfe2fd49e5e834512eaa43adfd4a54c004209aa15153f4e4`.
- `WRAITER-0.14.3-Windows.exe`: **112,747,304 bytes**, product/file version **0.14.3**, SHA-256 `e640ccecaf986d817fb848fb61c55f8a828b9184339357ec70d7f73582c3ff78`.
- Checksums are in `release/WRAITER-0.14.3-SHA256SUMS.txt`. No GitHub release or installed-app update was performed. The earlier tutorial assertion failure recorded below was not rerun for this toolbar change.

Files changed for this update: `src/App.jsx`, new `src/HighlightPicker.jsx`, `src/styles.css`, `electron/editor-schema.mjs`, package metadata/lockfile, new `tests/formatting-ui.cjs`, `tests/io-browser.fixture.js`, the export wait in `tests/v03-app.cjs`, `CONTRIBUTING.md`, `README.md`, the user guide, these validation results, and new `docs/releases/v0.14.3.md`. Existing unrelated working-tree changes were preserved.

## Version 0.14.2 · Windows file opening · 2026-10-01

- Package metadata, lockfile, and executable product/file versions report **0.14.2**. The new version keeps the preceding release executables available under their existing names.
- `npm test`: **213 passing tests**. `npm run package` passed; the NSIS installer was rebuilt after the final checkbox navigation fix.
- `test:file-open` passed against both the development app and `release/win-unpacked/WRAITER.exe`. Real second processes verified cold starts, relative paths, spaces and Unicode, preserving current typing, reusing existing tabs, multiple files, minimized windows, waiting for dialogs, malformed/missing files, and a first-run request retained through setup. All manuscripts were synthetic and profiles isolated.
- `test:installer` passed using the actual NSIS initialization, wizard, installation, and removal macros in an isolated HKCU registry subtree. It verified default selection, quoted executable/file commands, icons, Open with, Default Apps capabilities, saved opt-out, upgrades, restoration of the preceding association, and preservation of other applications' registry values. It did not change the user's real associations.
- The final `WRAITER-0.14.2-Setup.exe` was inspected through the Windows computer-use skill: the association option starts checked, can be unchecked, and retains that choice across Back/Next. The wizard was closed before installation.
- `test:v06` passed against the development app; `test:onboarding` passed against the packaged app with synthetic connections. `git diff --check` passed.
- **Existing broader test failure:** packaged `test:tutorial` fails at `tests/tutorial-ui.cjs:117`, which checks that mock requests exclude the original manuscript and private practice note. The same assertion also failed against the preceding **0.14.1** packaged application extracted from its preserved portable executable. Background checkpoint summaries are outside this file-association change. Logs: `tmp/file-association-tutorial.log` and `tmp/file-association-tutorial-baseline.log`.
- `WRAITER-0.14.2-Setup.exe`: **112,993,232 bytes**, product/file version **0.14.2**, SHA-256 `de2a6518f53831f63a642bf564769eaa405bfff879649eafa26bd382ba7ff58b`.
- `WRAITER-0.14.2-Windows.exe`: **112,746,109 bytes**, product/file version **0.14.2**, SHA-256 `c62d88de09f18843e3676ba21f8c06df5a56e1fd8b38fa9f5f2da644031e4486`.
- Checksums are in `release/WRAITER-0.14.2-SHA256SUMS.txt`. No GitHub release or installed-app update was performed.

Files changed for this fix: `build/installer.nsh`, new `build/file-associations.nsh`, `electron/main.cjs`, `electron/preload.cjs`, new `electron/file-open.cjs`, `src/App.jsx`, package metadata/lockfile, three new file-opening/installer test scripts, `CONTRIBUTING.md`, `README.md`, the user guide, troubleshooting, these validation results, and new `docs/releases/v0.14.2.md`. Existing unrelated working-tree changes were preserved.

## Version 0.14.1 · Local Windows installer · 2026-09-28

- Package metadata, lockfile, About dialog, and executable product/file versions report **0.14.1**.
- `npm test`: **209 passing tests**. `npm run package`: passed, producing the Windows x64 NSIS installer and portable executable.
- `test:version-tree` passed against `release/win-unpacked/WRAITER.exe` using an isolated profile. It verified the current path newest first, alternate branches in a separate connected graph, preview and branch restoration, AI summaries, and durable labels.
- `test:undo-scroll` passed against `release/win-unpacked/WRAITER.exe` at a 1050 × 680 viewport. Undo and redo kept the caret visible and preserved the writing pane's scroll position.
- `WRAITER-0.14.1-Setup.exe`: **112,991,159 bytes**, product/file version **0.14.1**, SHA-256 `79b6b5295e90407063c9f9f7dbd820fc6c7ef6a9b173be055d91cc9e0deca579`.
- `WRAITER-0.14.1-Windows.exe`: **112,745,012 bytes**, product/file version **0.14.1**, SHA-256 `0f4a70ac56186ed5762f19b067463bcb1db7cbf03344712f8477270325988656`.
- Checksums are in `release/WRAITER-0.14.1-SHA256SUMS.txt`. These local builds are unsigned; no GitHub release or installed-app update was performed.

## Version 0.14.0 · Local Windows installer · 2026-09-28

- Package metadata, lockfile, About dialog, and executable product/file versions report **0.14.0**.
- `npm test`: **208 passing tests**. `npm run package`: passed, producing the Windows x64 NSIS installer and portable executable with refreshed third-party notices.
- `test:version-tree` passed against `release/win-unpacked/WRAITER.exe` using an isolated profile, synthetic manuscript, and local scripted AI model. It verified branching after restoring an earlier version, preview without changing the active draft, model-selected checkpoint summaries, and durable factual labels when closing during a slow AI request.
- `WRAITER-0.14.0-Setup.exe`: **112,989,780 bytes**, product/file version **0.14.0**, SHA-256 `f6a83ee65ee1406c77ebd9aea7f19ccd60bdb2e6801f3f5394f4e1f0c9d05753`.
- `WRAITER-0.14.0-Windows.exe`: **112,743,708 bytes**, product/file version **0.14.0**, SHA-256 `bfed82b1d0d76108b77b2589e64be140ac5d792539ae7150895073eaf1b46f36`.
- Checksums are in `release/WRAITER-0.14.0-SHA256SUMS.txt`. These local builds are unsigned; no GitHub release or installed-app update was performed.

## Version 0.13.0 · Release verification · 2026-09-27

- Fresh `npm test`: **195 passing tests**. `npm run package` passed, rebuilding the production frontend, Windows x64 installer, portable application, and third-party notices.
- Packaged `test:editorial`, `test:large`, `test:history-recovery`, `test:v06`, `test:onboarding`, and `test:tutorial` passed using isolated profiles, synthetic manuscripts, and local scripted providers. Editorial checks include reports at normal/minimum window sizes, reverting while preserving unrelated edits, persistence across restart, and chapter restructuring with undo.
- The large-manuscript fixture contains 120,000 words across four chapters. On this machine it opened in 2,395 ms, typed the test phrase in 327 ms, and returned to a warm project tab in 1,166 ms. Search and Select All retained offscreen content. These are local test measurements, not cross-machine guarantees.
- `WRAITER-0.13.0-Setup.exe`: **112,984,600 bytes**, product version **0.13.0**, SHA-256 `458330a6da1a3c132be201910b3c8b317076a85ad5e1285e8dc38e94e30ff10c`.
- `WRAITER-0.13.0-Windows.exe`: **112,738,548 bytes**, product version **0.13.0**, SHA-256 `3c399b779dbddacbb15014239828faa54c8501266a6f40978742514a9da4103c`.
- These rebuilt artifacts supersede the local September 24 builds below. Checksums are in `release/WRAITER-0.13.0-SHA256SUMS.txt`. Executables remain unsigned; fresh-PC installation and live-provider editorial judgment were not tested.

## Version 0.13.0 · Local Windows installer · 2026-09-24

- Package metadata, lockfile, packaged application metadata and the About dialog all report **0.13.0**.
- `npm run package`: passed. Built the Windows x64 NSIS installer and portable application, including notices for 109 application dependencies. Packaged editorial engine files match the source files.
- `npm run test:editorial`, `npm run test:onboarding` and `npm run test:tutorial`: passed against `release/win-unpacked/WRAITER.exe`, using isolated profiles, synthetic manuscripts and local simulated providers.
- The tutorial provider fixture now identifies the document-agent protocol instead of matching wording from the old system prompt. It also requires a complete read/edit/finish exchange so its context assertions cannot pass without agent requests. No application change was needed after packaging.
- `WRAITER-0.13.0-Setup.exe`: **112,984,599 bytes**, product/file version **0.13.0**, SHA-256 `67180d303e9b6aecbf56382354c042b51bd17b63c8fff452b9844afb74128d25`.
- `WRAITER-0.13.0-Windows.exe`: **112,738,553 bytes**, product/file version **0.13.0**, SHA-256 `0363870ca71fdff6bfd94019589008da259abdebbb4127485384056a385b64f2`.
- Checksums are recorded in `release/WRAITER-0.13.0-SHA256SUMS.txt`. These are unsigned local builds; no GitHub release or installed-app update was performed. A fresh-PC installation and live-provider editorial judgment were not tested.

## Editorial assistant · Local development validation · 2026-09-24

- `npm test`: **195 passing tests**. New coverage includes nested and cross-paragraph BBCode, inline formatting preservation, bulk revisions, paragraph and chapter restructuring, table validation, selection boundaries, reference paging, stale-edit rejection, and reverting a batch while preserving unrelated later work.
- `npm run build`: passed. The agent and renderer share the document schema and text-edit application logic; the main-process editor dependencies are included as production dependencies at their existing pinned versions.
- `npm run test:app`, `npm run test:desktop`, and `npm run test:v06`: passed editor workflows, native integration, saved conversations, background assistant completion, project tabs and restart behaviour.
- `npm run test:history-recovery`: passed both damaged-journal scenarios, preserved original manuscripts and journals, and verified new undo/redo history across restarts. Its fixture now skips first-run setup/tutorial so the recovery test edits its intended synthetic manuscript.
- `npm run test:editorial`: passed against source and the packaged Windows executable. Verified native nested formatting, saved before-and-after reports, minimum-window layout, reverting after an unrelated edit, undoing a revert, report persistence after restart, chapter splitting and deleting the displayed chapter with undo.
- `npx electron-builder --win --dir --config.directories.output=test-output/editorial-package`: passed. The local test executable is `test-output/editorial-package/win-unpacked/WRAITER.exe`; this is a development build, not a published release or installed update.
- Visual QA: `test-output/editorial-report.png` and `test-output/editorial-report-small.png`. Workflow results: `test-output/editorial-ui-report.json`.
- All AI workflow tests used synthetic manuscripts and local scripted provider responses. Live-provider editorial judgment and model choice of the new tools were not evaluated in this validation.

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
