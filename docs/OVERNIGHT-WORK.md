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

## Experiments and observations

Record benchmark conditions, rejected approaches and unresolved findings here, so a faster result is not mistaken for a general guarantee.

## Final validation and local build

Record the final checks and artifact paths here at the end of the working window.
