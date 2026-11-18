# Offline grammar models

This is a sparse logistic scorer for proposed edits. Candidate generators use
bounded context and produce exact UTF-16 ranges. Training learns when to keep
those proposals from synthetic fiction, including matched correct sentences,
intentional dialogue, and grammatical lookalikes. Version 0.20.5 expands the
generators for agreement, demonstratives, pronoun case, homophones, adverbs,
and verb forms, and adds published-fiction negative examples. The scorer
cannot propose edits outside those generators. Its weights are bundled as a
JavaScript module in the existing local worker.

A second, pretrained model, `deepquillapp/gector-grammar`, proposes edits from
sentence context through ONNX Runtime. It is a GECToR token tagger based on
RoBERTa, not a free-form text generator. WRAITER uses the publisher's 0.6
sentence/error and edit-confidence thresholds, then restricts edits to preserve
names, quoted dialogue, punctuation, and some ambiguous constructions. The
decoder uses known noun inflection pairs and abstains on ambiguous reversals
instead of manufacturing singular spellings such as "movy" or "tomatoe". The
weights are unchanged. The model card declares Apache-2.0; bundled licenses and
publisher-provided training attribution are in `licenses/`.

WRAITER retains its existing rules, Harper, and LanguageTool. Established
grammar marks win over overlapping compact-model marks, then neural marks;
grammar marks win over spelling. Neural inference runs in a shared Node worker
on the CPU, with two inference threads, bounded chunks, at most 32 queued
requests, a 30-second request timeout, and disposal after two idle minutes.
Stopping skips queued checks, lets the active native operation finish, and
releases its ONNX session before closing the worker. App exit saves first and
waits for this shutdown with a ten-second bound; it does not terminate a worker
inside native initialization or inference.
Build scripts fetch pinned, hash-checked resources into `build/neural-grammar`.
This checker never downloads weights or sends passages to a service at runtime.

From the repository root:

```powershell
node tools/grammar-model/generate-lookalikes.mjs
node tools/grammar-model/generate-coverage.mjs
node tools/grammar-model/train.mjs
node tools/grammar-model/time.mjs
node tools/prepare-neural-grammar.cjs
```

The inputs are UTF-8 JSON Lines with `text`, `category`, and `edits` (objects
with UTF-16 `start`, `end`, and `replacement`). An empty `edits` array means
leave the passage alone. Matched training cases share a `group` so they
stay together during five-fold validation. Normalized duplicate passages and
their corrected forms also join their groups before splitting. Threshold
selection charges twice as much for an unsupported proposal as for a missed
one. No `eval-*.jsonl` file is loaded by the default training command.

`eval-terra.jsonl` and `eval-noise-terra.jsonl` began as independent evaluations,
but were inspected while developing version 0.20.5; treat them as development
sets now. The original 48-passage Google Docs race was also known during
development. The fresh `eval-astra-v2.jsonl` contains 120 synthetic passages
(60 labeled errors and 60 leave-alone controls), was frozen before the final
model settings, and was scored after packaging. Keep it out of training and
tuning; future tuning needs another unseen evaluation set.

To compare two packages, run the app harness on both with the same corpus
and score the rendered underlines. The harness opens a synthetic document
under a new local profile, disables optional AI, blocks network requests and
verifies that each underline matches the original text. Scoring ignores
spelling (including five typo-only controls in `eval-terra.jsonl`) and charges
one point per missed issue and two per unsupported
grammar underline. A highlight can match a gold issue without applying the
exact same correction; inspect the recorded replacements as well.

```powershell
node tools/grammar-model/benchmark-app.cjs PATH-TO-OLD-EXE tools/grammar-model/eval-terra.jsonl test-output/before.json
node tools/grammar-model/benchmark-app.cjs PATH-TO-NEW-EXE tools/grammar-model/eval-terra.jsonl test-output/after.json
node tools/grammar-model/score.mjs holdout tools/grammar-model/eval-terra.jsonl test-output/before.json test-output/after.json test-output/model-score.json
```

Use the same commands with `eval-noise-terra.jsonl` to stress-test false
underlines. To replay the original Google Docs race, use the original race
corpus in the app harness and the original results as the annotation argument
to `score.mjs race`; use `-` for the before argument because the original
results already include the old WRAITER and Google Docs scores. This reuses
the prior Google observations; it does not run Google Docs a second time.

The saved 0.20.5 packaged-app results are:

| Suite | Earlier WRAITER: hits / unsupported | 0.20.5: hits / unsupported |
|---|---:|---:|
| Fresh 120 passages, 60 labeled issues | 32 / 5 | 40 / 4 |
| Development Terra set, 55 grammar issues | 36 / 0 | 51 / 0 |
| Development noise set, 45 accepted passages | 0 / 2 | 0 / 1 |
| Original race, 21 labeled issues | 9 / 1 | 16 / 0 |

The fresh and Terra comparisons use the 0.20.4 compact-model package as their
baseline. The original race uses its older saved WRAITER result; saved Google
Docs observations caught 17 of 21 with no unsupported underlines. These scores
measure underlines overlapping labeled issues, not necessarily correct fixes.
They show improvement on these small sets, not broad parity with Google Docs.
Reports are in `test-output/grammar-v2-{fresh,old,noise,race}-score.json`.
The final r2 package replays of the fresh set and original race retained these
scores; their reports are `test-output/grammar-v2-r2-{fresh,race}-score.json`.
