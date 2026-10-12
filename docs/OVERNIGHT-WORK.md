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

## Experiments and observations

Record benchmark conditions, rejected approaches and unresolved findings here, so a faster result is not mistaken for a general guarantee.

- Desktop benchmarks run sequentially with isolated synthetic profiles. Build and unit-test loads should finish before timing runs.
- No off-screen unloading, estimated paragraph heights, persistence delays or journal durability changes were introduced.
- Rejected a prototype that cancelled the queued toolbar refresh after a content update. Instrumented desktop runs still executed the parent component 36 times for 32 fast characters and 64 times for paced typing, with no timing improvement. The prototype was removed; selection/formatting refresh behaviour remains intact.

## Final validation and local build

Record the final checks and artifact paths here at the end of the working window.
