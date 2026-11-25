# Performance checks

The benchmarks use generated text, isolated profiles and no AI requests or author documents. They print measurements rather than enforcing machine-dependent timing limits:

```powershell
npm run build
node tools/benchmark-performance.mjs
node tools/benchmark-outline.cjs 500
```

The outline benchmark defaults to 500 chapters and accepts up to 2,000. It measures from each real `beforeinput` event to the next animation frame and reports renderer script and layout time. It creates its isolated profile under `test-output`. Set `WRAITER_EXECUTABLE` to a packaged application executable to measure that build. Compare results on the same machine; background load, display refresh rate, the operating system and Electron can change timings.

Useful behavior checks include `npm run test:large`, `npm run test:large-search`, `npm run test:long-numbering`, `node tests/large-replace-ui.cjs`, `node tests/paragraph-numbering-structures-ui.cjs`, and `node tests/bundled-thesaurus-ui.cjs`. They cover saved content, search and replacement, numbering, comments, selection, undo, redo and offline dictionary loading. `npm test` runs the unit suite.

## Investigation on 10 November 2026

The following are representative local measurements, not guarantees. Search, replacement, word count, history and grammar figures isolate the named work; they do not describe the latency of every interaction.

| Synthetic workload | Before | After |
| --- | ---: | ---: |
| Find 12,000 matches in 6,000 paragraphs | 281–306 ms | 5–14 ms |
| Find 12,000 bold matches in 6,000 paragraphs | 150–163 ms | 3–16 ms |
| Regex search after one edit in 6,000 paragraphs | 23 ms median | 1.6 ms median |
| Replace 12,000 matches in 6,000 paragraphs | 1.4 s | 0.66 s |
| Count chapters in a 120,000-result replacement preview | 10.6 ms median | 1.8 ms median |
| Snapshot an edit in 6,000 paragraphs | 1.26 ms median | 0.22 ms median |
| Update the word count in one 60,000-word paragraph | 3.67 ms median | 0.14 ms median |
| Update history status with 10,000 existing events | 1.87 ms median | 0.14 ms median |
| Refresh the timeline with 10,000 existing events | 6.19 ms median | 0.46 ms median |
| Check a 100,000-event journal's saved length | 1.36 ms median | <0.01 ms median |
| Filter 6,000 AI grammar hints against 6,000 checked passages | 25.3 ms | 0.33 ms |
| Scroll 60 positions in 3,000 numbered paragraphs | 2.07 s | 0.83 s |
| Input-to-frame p95 with 2,000 chapters | 29.7 ms | 9.5 ms |
| First bundled thesaurus lookup | 156 ms | 79 ms |

The numbered-scroll test spends two animation frames at each position, so its elapsed time includes the display's frame pacing. The thesaurus event-loop gap fell from approximately 157 ms to 15 ms in the measured run; the actual lookup still waits for disk access and decompression. A 120,000-word manuscript test measured 11.6 ms input-to-frame p95 on the tested build. Its longer automation wall time includes key-delivery overhead and should not be treated as editor input latency.

An experiment splitting optional startup modules produced no reliable launch improvement in local runs and was not kept. Paragraph numbering keeps the existing full traversal for nested or unusually spaced layouts, and automatic page and row numbering retain their existing measurement path.

Caching literal-search results for each paragraph improved repeated searches after an edit, but made a new query slower in local runs. That experiment was discarded; block-level caching remains limited to the more expensive regular-expression path.

WRAITER-format saves reuse the JSON produced during validation within the same save, and opening a document no longer repeats the same validation. Other native formats reuse their content fingerprint only within one save. Each later save is validated and fingerprinted again; conflict detection, recovery writes and backups remain in place. In a 12,000-paragraph synthetic save, the removed WRAITER serialization accounted for roughly 6–8 ms on this machine, while complete save times varied with disk and background activity.

Verification included 507 unit tests, including 60,000 generated word-count edits; independent LibreOffice ODT and DOCX rendering; and isolated desktop checks for editing, search, numbering, multitasking, grammar, crash recovery and the bundled thesaurus. Real Windows file locks and an invalid ODT encoding were also tested for preservation and recovery. Search and replacement were compared with their previous implementation across 1,800 generated projects and 49,139 matches, including replacement steps and position mapping. Endurance runs covered a 120,000-word synthetic manuscript for 35 minutes in development, then 12 minutes with a restart using the packaged application, plus a six-minute packaged ODT saveback run. All 145,866 bundled thesaurus entries matched the reference index. Three outline states and three search-panel states produced identical markup and pixel captures before and after the component changes. These checks do not predict performance on every device or document.
