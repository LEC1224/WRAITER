# WRAITER overnight improvements · 2026-10-12–13

Requested working window: continue until **03:00 Europe/Stockholm on 13 October 2026**. Focus on measured performance and practical writing workflows, with isolated synthetic tests and small reversible Git commits. Move on when an experiment does not help.

## Starting point

The working tree already contains the tested scrolling/paragraph-numbering fix, image imports, and the seven interaction improvements recorded in `UX-AUDIT.md`. Those changes are retained as an initial Git checkpoint before the overnight work. They are prior work, rather than new overnight improvements.

- Starting branch: `codex/project-tabs-and-startup`; base release commit: `5bf31ca`; initial local-work checkpoint: `113c2cc`.
- Overnight branch: `codex/overnight-2026-10-12`.
- Local comparison tags: `codex/overnight-start-2026-10-12` preserves checkpoint `113c2cc`, including the earlier scrolling fix; `codex/overnight-preview-2026-10-13` names the first packaged runtime `193ba96`; `codex/overnight-final-2026-10-13` names final runtime `ccc82a3`. The previous project branch remains at its release commit, so use the start tag when comparing with the fixed scrolling baseline.
- Baseline `npm test`: 287 passing tests; `npm run build`: passed.
- Author manuscripts, account settings and the installed application are outside the experiment profiles.
- Baseline scrolling remains stable with real paragraph heights. The earlier large-chapter typing tradeoff is the first performance investigation.

## Completed improvements

### Large-manuscript Find regression check

The older long-document check assumed Enter in Find focuses the editor. The current interaction improvements deliberately preserve the query field's focus. The check now verifies that the distant highlighted passage is inside the writing viewport, then verifies the original selected passage after closing Find. Three fresh-profile desktop runs passed without changing production behavior or relaxing the timing budgets.

Baseline measurements on the current local source: startup 1,160–1,327 ms, 32-character typing 374–397 ms, and warm tab return 1,818–1,854 ms. These are fresh measurements for this overnight session; machine load differs from the earlier packaged comparison. Evidence: `test-output/overnight-typing-before.json`.

### Stable editor configuration while typing

The React editor component now retains its configuration while its parent publishes live document snapshots. Current callbacks still come from refs; changes to spelling and document language update the editor normally. Project, chapter and undo replacements continue to use the existing remount key.

An instrumented 32-character typing run in a 1,500-paragraph chapter made **36 `setOptions` calls before and zero after**. Three quiet candidate runs took 349–364 ms, compared with the starting 374–397 ms. An immediate instrumented comparison was 370 ms versus 364 ms, so the timing benefit is modest and sensitive to conditions; the avoided view updates are the firmer result. One candidate run overlapped the unit suite and is excluded from the quiet comparison.

Validation: 287 unit tests, production build, large-manuscript typing/search/tab checks, nine image-import groups, eleven document-interaction groups, and settings workflows passed. The settings regression now checks language and spelling attributes after changing them and typing again, to catch stale configuration.

### Reuse Find highlights for cursor movements

Find highlights now reuse their decoration set while the immutable chapter and query/options are unchanged. Typing, deleting, changing case/whole-word options and closing Find invalidate the cache. Each editor owns just its latest cached result.

In a focused benchmark with 1,500 paragraphs and 1,500 highlights, 200 selection updates took 771–844 ms before and 0.75–1.44 ms after. This measures the search plugin, not total desktop interaction time. Four new regression groups cover selection/metadata updates, edits, option changes/clearing, editor isolation and the existing 2,000-highlight limit. All 291 unit tests and the production build passed. The real desktop search, replace-all, stale-preview rejection, comments, formatting, minimum-window and restart checks also passed.

### Reuse the live chapter when locating comments

Comment reconciliation now receives the actual editor document that produced the chapter snapshot. It also uses that editor's schema, so an open comment panel can reuse the reconciliation result. Inactive chapters keep their existing cache and imported/reloaded documents still follow the original parsing path.

The regression verifies exact anchor positions after insertion, detachment after deletion, and that only an uncached inactive chapter is parsed; opening the comment rows causes no second parse. All 292 unit tests, the build and the desktop revision/comment workflows passed. A 120,000-word synthetic manuscript with 400 comments took 385 ms before and 380 ms after for 32 typed characters: no substantial stopwatch improvement is claimed from that single comparison. The small change removes a proven redundant parse without changing saved document data.

### Reduce duplicate typing renders

The autosave effect now skips state setters when save status and session word count already have their displayed values. A real content update also cancels the separately queued toolbar refresh, because publishing that content updates the toolbar in the same transaction. Cursor, stored-mark and metadata-only changes retain their refresh.

The combination matters: cancelling the frame alone and guarding status setters alone both still executed the parent component 64 times for 32 characters typed with a 30 ms gap. Together they reduced that count to **36**, with zero extra toolbar refreshes. Fast typing changed from 36 to 34 renders. Paced elapsed time includes deliberately inserted delays and remained about 1.5 seconds; the claim is reduced render work, not a timing gain from those delays.

All 292 unit tests, the build, large-manuscript typing/search/tab checks, formatting/highlight checks and the complete desktop integration workflow passed. That includes locally mocked AI previews, partial acceptance, cancellation, checkpoints, exports, custom keys and full restart. The long-document check now verifies session word count and the durable recovery text as well. Autosave timing and journal durability are unchanged.

### Go directly to a numbered paragraph

The Edit menu and Ctrl+G now open a small paragraph picker with the current number, the chapter's range and a prose preview. It follows the same text-block order as the margin, including headings, lists, quoted paragraphs, table cells and empty paragraphs. It leaves prose and editing history unchanged. Existing custom Ctrl+G assignments are preserved during preference migration; the new action remains unassigned if that key is already taken.

Testing this exposed an existing dialog issue: restoring focus through the contenteditable DOM element reset a distant cursor to paragraph one. Dialogs now restore focus through the editor view, preserving its selection, and give their first editable field initial focus. The number field selects its current value so typing immediately replaces it.

Validation: all 296 unit tests and the build passed. Five new desktop groups cover keyboard and native menu navigation, late paragraphs, invalid inputs, cancellation without selection/history changes, all three themes at 960×650 and existing link-dialog focus. The broader document-interaction, settings and undo/scroll workflows also passed. One earlier interaction run caught a transient Windows file-replacement failure; that reliability finding is investigated separately below.

### Recover from brief Windows replacement locks

A desktop interaction run reached the correct undone image state and saved it to recovery, but Windows refused the final rename with `EPERM`. The unchanged rerun passed. The exact source of the transient lock is unknown.

Atomic replacement now retries permission/busy failures up to five times, with waits totalling at most 620 ms. It retains the flushed staging file and preceding backup, never removes the destination to force a replacement, and still reports permanent or unrelated failures. Native and WRAITER document saves recheck the original fingerprint after staging and before each retry, so a change or newly created destination during the wait is preserved. The check does not make filesystem replacement a compare-and-swap operation; there remains the ordinary tiny interval between the final check and rename.

Six new regression groups simulate replacement and backup locks, permanent errors, unrelated disk errors, an external manuscript edit, a new Save-as destination and an external native-text edit. They verify original bytes, backups, cleanup and recovery. All 302 unit tests, the build, the full document-interaction workflow and both damaged-history/restart scenarios passed. Autosave scheduling and write flushing remain unchanged.

Four additional Windows workflows passed with real OS sharing locks, using a hidden PowerShell helper on synthetic WRAITER and TXT files. A 600 ms lock caused actual `EPERM` failures followed by a successful retry with the preceding backup retained. A 1,800 ms lock exhausted the initial replacement plus five retries, kept the original bytes and complete recovery/private notes, then saved normally after release. The helper only holds a read handle; it does not inject rename errors or modify source data. Evidence: `test-output/windows-locks-results.json`.

### Reveal every selected Find result

Find listed matches beyond the 2,000-decoration limit but did not highlight those late passages. The selected result now receives one additional decoration if needed; ordinary results retain the limit and reuse the existing base decoration set. Clearing Find, changing its options, editing the passage and collapsing the selection remove invalid active highlights.

The new desktop regression exposed a second issue: ProseMirror deliberately skips its scroll routine when the DOM selection is outside the editor. A freshly opened Find field could select paragraph 2,405 logically while leaving the manuscript at paragraph one. WRAITER now reveals the selected passage explicitly while preserving Find input focus. Restored chapter selections reuse the same reveal helper.

Find also reuses text extracted from unchanged immutable paragraphs across query changes. Six alternating-order Node benchmark pairs with 1,500 formatted paragraphs and 160 searches per sample took 84–106 ms before and 39–51 ms after, with identical 420,000 total matches. Repeat text extraction calls fell from 240,000 to zero after warming. This measures the search function, not desktop latency; the packaged soak ran separately in the background.

Four new unit groups cover late selected results, stale selections/options, literal Unicode matching, whole-word boundaries, marks, hard breaks and inline objects. The production build and full unit suite passed. Four new desktop groups verify result 2,405, wraparound/F3, focus retention, replacement/undo, cross-chapter navigation, minimum-window themes and closing Find. The broader revision, document-interaction and undo/scroll workflows passed as well.

### Reuse unchanged editing-history status

The toolbar, native editor menu and history panel now share the status calculation for the same immutable journal. An edit, undo, redo, branch or reload produces a different journal and a fresh calculation. Returned objects remain independent, so a caller cannot alter a cached label or count.

In a focused helper benchmark, 200 status calls for a 10,000-entry journal took 332–357 ms before caching and 0.01–0.02 ms after warming. This avoids repeated maps and entry scans; it does not measure complete typing or undo latency. The journal format, recording and flushing are unchanged.

A new regression checks current labels/counts across typing, undo, redo, branching, reload, older journal snapshots, unrelated manuscripts and caller mutations. All 307 unit tests and the build passed, along with the large Find, revision, document-interaction and undo/scroll desktop checks.

### Avoid rewriting an already durable recovery snapshot

A tab-return profile took about 1.8 seconds, with roughly 50 ms of renderer script work and 53 ms of layout. A separate filesystem trace found seven flushes taking 28–102 ms each. Repeated autosaves were rewriting identical recovery snapshots, including legacy session mirrors.

Each document store now remembers only the digest of its last successfully flushed recovery. It can skip an identical rewrite after reading and verifying the current bytes. Changed text, metadata, editing-history sequence, path or expected source fingerprint still takes the existing atomic writer and flush path. A missing/corrupt file is rewritten, an optional read failure falls back to writing, and a fresh process performs its first write normally. Named-source conflict checks still run on every save. The journal format, journal flushing and autosave interval are unchanged.

Two alternating-order benchmark pairs used a 120,000-word synthetic novel and ten cloned unchanged saves per sample. Unnamed saves took 810–885 ms before and 219–233 ms after; named saves took 1,483–1,548 ms before and about 310–311 ms after. Recovery replacements dropped from ten (unnamed) or twenty (named) to zero. These are repeated-save measurements, not total tab-switch timings.

Seven new regression groups cover identical cloned snapshots/backups, history-only and binding changes, missing/corrupt/externally changed recovery, read locks, failed writes, restart and injected flush failures. All 314 unit tests and the build passed. Damaged-history recovery, tab workflows with native files and background chat, and the complete app workflow passed with isolated local mocks. Every changed recovery still waits for its flush; failed flushes retain the preceding manuscript and can be retried.

### Reuse unchanged native-document state

Native-document saves also rewrote the format-state file containing private notes, editing-history sequence, comments and the source binding. Recovery and native format state now share the same verified snapshot writer. Each owner remembers only its latest path and digest; a changed destination, changed content or private metadata, a missing/altered file, or a fresh process takes the flushed write path. Optional verification failures fall back to writing. Source-document conflict checks still run before reusing native state.

Two alternating-order comparisons used a 120,000-word synthetic TXT document and ten unchanged cloned saves. They took 1,132–1,158 ms before and 343–374 ms after; format-state replacements fell from ten to zero. Recovery reuse was already present in both versions. The packaged soak was running in the background, so these are scoped backend measurements rather than desktop timing claims.

Seven new native-state groups cover notes/history/fidelity/source changes, fresh restart, deleted/corrupt/external state, optional read locks, failed flush/retry, destination changes and external source edits. All 321 unit tests and the production build passed. The genuine desktop native workflow passed with ODT saveback, DOCX conversion, scoped exports, PDF/EPUB, persistent undo and native binding after restart.

### Keep Find paging aligned with the selected result

Refreshing the Find results could leave the status at result 2,405 while resetting the list to page one. A focused browser regression reproduced that mismatch. Result refresh and active-match changes now choose their page together; manual paging remains available until the results or selection change. Replacement previews still begin at page one and allow reviewing every page.

The list also retains chapter counts and the current page's grouping when only the active result or replacement text changes, rather than regrouping the full results array on every render. No desktop latency claim is made for this small reduction.

Four headless browser groups cover equivalent refreshes, query/options, manual paging, replacement text, active-result changes/removal, empty lists, repopulation and replacement previews. All 321 unit tests and the build passed. The final four-group late-result desktop regression also passed, including the selected passage's correct results page, replacement/undo and navigation across chapters.

### Recalculate only the page estimate in Statistics

Changing the words-per-page input used to repeat vocabulary, character, paragraph and sentence analysis for the whole manuscript. The dialog now retains its analysis until the project changes and calculates the page estimate directly from the selected length. A 120,000-word fixture's full analysis took 35–59 ms per call in three samples; that redundant work is avoided for each estimate adjustment. This is a small interaction improvement, not a claimed startup or typing gain.

All 321 unit tests and the production build passed. A browser interaction check adjusted a 120,000-word document to five page lengths, verified correct estimates and unchanged other statistics, and confirmed that its initial sentence analysis was reused. The final proofreading/statistics desktop workflow passed, including review, batch correction/undo, model selection and spelling controls.

### Keep the font picker usable by keyboard and in short windows

Choosing a font by keyboard left focus on the document body when the caller did not focus the editor. The preceding component reproduces that failure in an isolated browser. Choosing or dismissing now returns focus to the picker button before the caller applies its own focus policy. Tab/Shift+Tab closes the list and continues through the surrounding form; keyboard reopening clears stale filters.

The popup opens above controls when there is more room there, follows form scrolling and viewport resize, and keeps its bounds inside the viewport. Filtering reveals the current option even if the preceding list had been scrolled far down. The available font names and filtered list are also retained while their inputs are unchanged, avoiding full-font-list work during ordinary toolbar rerenders.

Four headless browser groups cover keyboard choice/escape/tab order, the caller's editor-focus policy, 502-font lists and filtering at 960×650, upward/downward placement, form scrolling, resize and reopening. All 321 unit tests and the build passed. The final native format, general app and settings desktop workflows passed. An additional real desktop check used a selected word at paragraph 600 and the document-default font inside the formatting dialog. It verified keyboard choice, both Tab directions, Escape closing only the popup, retained selection, native minimum/enlarged windows and all three themes, with no renderer errors. The minimum-size dark-theme screenshot was visually inspected. Evidence: `test-output/overnight-font-desktop.json` and `test-output/font-desktop-1cswlJ/`.

### Parse ODT chapter XML in bounded batches

ODT encoding reparsed an XML namespace wrapper for every top-level manuscript node. It now parses bounded batches within each chapter while retaining the exact serialized XML block boundaries used by chapter metadata. Combined batches are limited to 512K XML characters; an individually larger node follows the same parsing path as before. In a 120,000-word, 6,000-paragraph fixture, parser calls fell from 6,000 to eight. Initial samples took 535–660 ms before and 336–395 ms after, before the additional metadata guard below. The generated `content.xml` digest and archive size were identical. The packaged soak was running separately, so these measurements describe the codec rather than complete autosave latency.

The parser now rejects invalid visible XML characters instead of putting parser-error content into an office file. Three new import/export groups check multi-paragraph quotations, an empty chapter, following chapters, a chapter exceeding the batch limit, emphasis, Unicode, invalid XML characters and emitted metadata. All 26 browser import/export groups, 321 unit tests and the production build passed. Independent LibreOffice rendering passed for ODT and DOCX with lists, a merged table, an embedded image, Arial text and a manual page break. The rendered ODT first page was visually inspected.

A further check reproduced invalid ODT XML from NUL characters in document/chapter titles or default/run font names. Raw block batches and each XML package part now check the [XML 1.0 character range](https://www.w3.org/TR/xml/#charsets), including isolated surrogate rejection before a parser can replace it. Valid supplementary Unicode and whitespace remain accepted. A hidden chapter title stored only in JSON remains intact. The 42-document output-equivalence corpus passed again after this change; the original packaged ODT endurance build predates this additional guard.

The full Unicode check initially added noticeable scanning work. A conservative UTF-16 precheck now sends possible invalid characters or surrogate pairs through the full check. Equivalence was checked for all 1,114,112 code points and malformed-surrogate combinations. Thirty scans of the synthetic ODT's 4.2-million-character XML changed from 457–478 ms to 92 ms for ordinary BMP text. A final alternating codec comparison measured 387–453 ms before the added guard and 400–438 ms after it, with medians of 421 and 426 ms across three samples each; every content digest and archive size matched. These are codec observations with the separate endurance run active, without an end-to-end autosave claim. Evidence: `test-output/overnight-xml-guard-measure.json` and `test-output/overnight-odt-guard-comparison.json`.

A further 42-document browser corpus compared the previous and final encoders. Every uncompressed package part was byte-identical, including office XML and chapter-structure metadata; warnings were identical too. Cases include mixed formatting/namespaces, nested quotations and lists, merged tables, embedded images, headings/code/rules, Unicode and XML literals, whitespace, title options, empty/following chapters, multiple batches and an individual quote node larger than a batch. This is output-equivalence verification, without a timing claim. Evidence: `test-output/overnight-odt-corpus.json`.

### Preserve recovery when native-file encoding fails

An office encoder could fail before its save reached the recovery writer, and closing repeated the same failure before contacting the main process. Save and autosave now stage the complete captured project and journal through the normal durable backend when encoding fails, then report the original encoding error. Closing can submit that recovery-only save; the main process still confirms persistence before it closes the window. The last valid native file remains intact.

Four genuine ODT desktop groups passed with invalid visible text or title metadata. They verify automatic and explicit save failures, identical original office bytes, durable complete recovery and private notes, close/restart, persistent undo/redo, later valid ODT saveback, valid package XML after title undo, and the native binding after another restart. All 321 unit tests and the production build passed. The broader eight-group native format workflow passed with real ODT/DOCX files, scoped exports, PDF/EPUB and cross-session undo/redo; its three provider requests used the local mock. Both suites also passed against the final packaged preview.

### Exercise actual ODT files in the endurance harness

The optional `--format=odt` mode begins by saving the synthetic novel through the real application. Each save/undo/redo checks recovery, the companion state's source digest and the actual 6,000 paragraphs extracted from the ODT package. Restarts and the final check compare every paragraph against the intended edits. The default WRAITER mode retains its complete named-JSON checks.

A 90-second source trial passed four cycles with real ODT saveback, zoom/resize, Find, paragraph navigation and tab returns. The final packaged endurance run uses this mode for longer validation.

## Experiments and observations

Record benchmark conditions, rejected approaches and unresolved findings here, so a faster result is not mistaken for a general guarantee.

- Desktop benchmarks run sequentially with isolated synthetic profiles. Build and unit-test loads should finish before timing runs.
- No off-screen unloading, estimated paragraph heights, persistence delays or journal durability changes were introduced.
- Cache lifetimes were reviewed: Find's editor plugin retains one document/query result, text/history/navigation caches use weak object keys, and each persistence owner retains one path/digest marker. Changed data still invalidates or replaces those entries. The endurance reports record collected heap, DOM nodes and listeners; they are evidence for the exercised workload, rather than a guarantee for every document.
- An initial prototype cancelling only the queued toolbar refresh gave no render-count improvement and was removed. Later measurements identified a second source of duplicate work in unchanged status setters; the tested combination is described above.
- A first 45-minute packaged soak stopped after 37 cycles (13.7 minutes) when two height samples differed by approximately the zoom ratio. The harness had not awaited the asynchronous zoom setting or native resize. A rapid diagnostic completed 18 cycles in two minutes without reproducing it. The corrected harness awaits the requested zoom and renderer viewport, verifies equal zoom/viewport for both measurements, and retains the exact same-height assertion. The synchronized 45-minute repeat passed: 127 cycles, six launches, no renderer errors and all intended manuscript text retained. That frozen build was commit `5d3d239`; later native-state, Find-paging, font, statistics and ODT improvements are validated separately and in the final packaged run.

## Final validation and local build

The final source checks passed for large Find, paragraph navigation, settings, proofreading/statistics, document interaction, the general app workflow, project tabs/startup and native formats. Encoding-failure recovery also passed separately. Synthetic AI interactions used local mock services. Unit validation stands at **321 passing tests**, up from the initial 287. The final production build passed.

### Quiet desktop comparison

Six sequential source-desktop runs alternated the starting checkpoint `113c2cc` and final runtime `ccc82a3` in before/after/after/before/before/after order. Both used the same Electron 44.3.0 binary, fresh synthetic profiles and the same 120,000-word novel with a 30,000-word active chapter. No other GUI test or build was running. Both variants retain the earlier scrolling fix.

| Operation | Starting median (range), ms | Final median (range), ms |
| --- | ---: | ---: |
| Launch to editor | 972 (966–988) | 1,026 (1,008–1,081) |
| Type 32 characters | 339 (335–382) | 349 (334–379) |
| Return to large tab | 1,744 (1,721–1,820) | 1,202 (1,173–1,213) |

Large-tab return improved by about 31% in this workload. Typing ranges overlap; no overall stopwatch typing gain is claimed. Startup was 54 ms slower at the median in these three samples per variant. The measured reductions in repeated editor/render/search work above remain separate claims. Evidence: `test-output/overnight-desktop-comparison.json`.

The final packaged font check passed three groups: toolbar selection/focus, document-default keyboard choice and both Tab directions, and popup bounds at native minimum/enlarged sizes across all three themes. The first execution used the wrong internal key for the Light theme (`light` instead of `paper`); the corrected wait passed without changing application code. Evidence: `test-output/font-picker-ui-results.json`.

Forced-crash checks passed for both WRAITER and actual ODT files. Each delays only the isolated test window's ordinary autosave timer, waits for the real editing journal to flush, verifies that both source and recovery still predate the edit, then exits immediately with code 91. Restart recovered the unsaved journal tail, private notes and other chapter; normal named saving, undo/redo and a further restart all passed. Evidence: `test-output/crash-recovery-ui-results.json`.

All nine final packaged workflow suites passed sequentially: font controls, forced crashes, native encoding failures, native formats/exports, distant Find, paragraph navigation, scrolling, external reload/numbering, and undo viewport restoration. Scrolling retained identical document height and tail position, manuscript text and journal event count. The font popup screenshots at minimum size were visually checked in all three themes. Evidence: `test-output/overnight-packaged-checks.json` and its per-suite logs.

The temporary benchmark checkout remains at `tmp/overnight-baseline-compare-2026-10-13/`, detached at `113c2cc`, with a verified junction to the main checkout's dependencies. It has no tracked changes. Automatic approval rejected both cleanup attempts with only “blocked by policy”; no deletion ran. It remains available to reproduce the comparison.

Final Windows x64 preview artifacts are in `tmp/overnight-final-2026-10-13/`:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `WRAITER-0.16.0-Overnight-Windows.exe` | 112,772,866 | `69fc51df75cbf197fa9363eb73ccfe3d82dc2b50cfea65c9f7cf061db808aa38` |
| `WRAITER-0.16.0-Overnight-Setup.exe` | 113,019,985 | `459aa4de51110d823045476135da2f288ea58654fe98d8feb2db5904285c7595` |

The final preview's runtime source is commit **`ccc82a30d953ed3690a22823087ec718e8c2d7bf`**. All 42 checked packaged files match their source hashes, including renderer assets, editor schema, native persistence files, artwork and license notices. Runtime package metadata and dependency versions also match; electron-builder removes development/build metadata as expected. `BUILD-MANIFEST.json` beside the executables records that verification. Later test/documentation commits do not change the packaged code.

The first overnight preview is preserved in `tmp/overnight-preview-2026-10-13/` at commit `193ba96`. Its 60-minute packaged ODT endurance run passed **157 cycles and seven launches**, retaining all 6,000 paragraphs and intended edits with no renderer errors. Evidence: `test-output/soak-YIB4ZK/report.json`. It predates the additional invalid-metadata guard.

The final runtime's 40-minute WRAITER endurance run passed **113 cycles and five launches**, retaining every paragraph and intended edit with no renderer errors. Scrolling height and margin alignment stayed stable within each requested zoom/viewport. Its final collected heap was 16.1 MiB, with 3,785 DOM nodes and 344 listeners; this describes the exercised workload, without a general leak guarantee. Evidence: `test-output/soak-k0nAWI/report.json`. The preceding 45-minute WRAITER soak passed 127 cycles and six launches on the earlier frozen build described above.

`VALIDATION-RESULTS.json` beside the final executables records all nine packaged suites, 321 unit tests, 26 import/export groups, the 42-document output-equivalence corpus, real Windows locking and both forced-crash formats. It distinguishes all three endurance runtimes and includes the matched timing data. Both executable sizes and SHA-256 digests were reverified while assembling it.

The preview has not been installed or published. Close the current WRAITER window before launching the portable preview with regular settings, because the application's single-instance handling otherwise forwards to the running copy. All overnight GUI checks use separate private profiles. Manuscripts and the existing installed application were not modified.
