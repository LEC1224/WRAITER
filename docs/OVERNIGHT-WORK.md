# WRAITER overnight improvements · 2026-10-12–13

Requested working window: continue until **03:00 Europe/Stockholm on 13 October 2026**. Focus on measured performance and practical writing workflows, with isolated synthetic tests and small reversible Git commits. Move on when an experiment does not help.

## Starting point

The working tree already contains the tested scrolling/paragraph-numbering fix, image imports, and the seven interaction improvements recorded in `UX-AUDIT.md`. Those changes are retained as an initial Git checkpoint before the overnight work. They are prior work, rather than new overnight improvements.

- Starting branch: `codex/project-tabs-and-startup`; base release commit: `5bf31ca`; initial local-work checkpoint: `113c2cc`.
- Overnight branch: `codex/overnight-2026-10-12`.
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

Seven new native-state groups cover notes/history/fidelity/source changes, fresh restart, deleted/corrupt/external state, optional read locks, failed flush/retry, destination changes and external source edits. All 321 unit tests and the production build passed. Native desktop workflows are queued after the frozen packaged soak.

### Keep Find paging aligned with the selected result

Refreshing the Find results could leave the status at result 2,405 while resetting the list to page one. A focused browser regression reproduced that mismatch. Result refresh and active-match changes now choose their page together; manual paging remains available until the results or selection change. Replacement previews still begin at page one and allow reviewing every page.

The list also retains chapter counts and the current page's grouping when only the active result or replacement text changes, rather than regrouping the full results array on every render. No desktop latency claim is made for this small reduction.

Four headless browser groups cover equivalent refreshes, query/options, manual paging, replacement text, active-result changes/removal, empty lists, repopulation and replacement previews. All 321 unit tests and the build passed. The late-result desktop regression now additionally checks that its selected passage appears on the correct results page; that run is queued after the soak.

### Recalculate only the page estimate in Statistics

Changing the words-per-page input used to repeat vocabulary, character, paragraph and sentence analysis for the whole manuscript. The dialog now retains its analysis until the project changes and calculates the page estimate directly from the selected length. A 120,000-word fixture's full analysis took 35–59 ms per call in three samples; that redundant work is avoided for each estimate adjustment. This is a small interaction improvement, not a claimed startup or typing gain.

All 321 unit tests and the production build passed. The existing proofreading/statistics desktop workflow is queued after the soak.

### Keep the font picker usable by keyboard and in short windows

Choosing a font by keyboard left focus on the document body when the caller did not focus the editor. The preceding component reproduces that failure in an isolated browser. Choosing or dismissing now returns focus to the picker button before the caller applies its own focus policy. Tab/Shift+Tab closes the list and continues through the surrounding form; keyboard reopening clears stale filters.

The popup opens above controls when there is more room there, follows form scrolling and viewport resize, and keeps its bounds inside the viewport. Filtering reveals the current option even if the preceding list had been scrolled far down. The available font names and filtered list are also retained while their inputs are unchanged, avoiding full-font-list work during ordinary toolbar rerenders.

Four headless browser groups cover keyboard choice/escape/tab order, the caller's editor-focus policy, 502-font lists and filtering at 960×650, upward/downward placement, form scrolling, resize and reopening. All 321 unit tests and the build passed. The real desktop font/settings workflows and visual checks are queued after the soak.

### Parse ODT chapter XML together

ODT encoding reparsed an XML namespace wrapper for every top-level manuscript node. It now parses each chapter together while retaining the exact serialized XML block boundaries used by chapter metadata. In a 120,000-word, 6,000-paragraph fixture, parser calls fell from 6,000 to four. Three samples took 535–660 ms before and 322–436 ms after. The generated `content.xml` digest and archive size were identical. The packaged soak was running separately, so these measurements describe the codec rather than complete autosave latency.

The parser now rejects invalid visible XML characters instead of putting parser-error content into an office file. Two new import/export groups check multi-paragraph quotations, an empty chapter, the following chapter, emphasis, Unicode and invalid XML characters. All 25 browser import/export groups, 321 unit tests and the production build passed. Independent LibreOffice rendering passed for ODT and DOCX with lists, a merged table, an embedded image, Arial text and a manual page break. The rendered ODT first page was visually inspected.

Native codec-error recovery and close/restart behavior are being checked separately below before the final build.

## Experiments and observations

Record benchmark conditions, rejected approaches and unresolved findings here, so a faster result is not mistaken for a general guarantee.

- Desktop benchmarks run sequentially with isolated synthetic profiles. Build and unit-test loads should finish before timing runs.
- No off-screen unloading, estimated paragraph heights, persistence delays or journal durability changes were introduced.
- An initial prototype cancelling only the queued toolbar refresh gave no render-count improvement and was removed. Later measurements identified a second source of duplicate work in unchanged status setters; the tested combination is described above.
- A first 45-minute packaged soak stopped after 37 cycles (13.7 minutes) when two height samples differed by approximately the zoom ratio. The harness had not awaited the asynchronous zoom setting or native resize. A rapid diagnostic completed 18 cycles in two minutes without reproducing it. The corrected harness awaits the requested zoom and renderer viewport, verifies equal zoom/viewport for both measurements, and retains the exact same-height assertion. A synchronized short packaged trial passed; the extended repeat is recorded below when complete.

## Final validation and local build

Record the final checks and artifact paths here at the end of the working window.
