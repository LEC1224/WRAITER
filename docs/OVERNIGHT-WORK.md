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

## Experiments and observations

Record benchmark conditions, rejected approaches and unresolved findings here, so a faster result is not mistaken for a general guarantee.

- Desktop benchmarks run sequentially with isolated synthetic profiles. Build and unit-test loads should finish before timing runs.
- No off-screen unloading, estimated paragraph heights, persistence delays or journal durability changes were introduced.

## Final validation and local build

Record the final checks and artifact paths here at the end of the working window.
