# Offline spelling and grammar

The live English checker combines WRAITER's conservative rules, selected rules
from Harper 2.13 (WebAssembly), a filtered set of LanguageTool 6.8 rules,
a compact model trained to score contextual English edits, and a bundled
GECToR neural model that proposes additional corrections from sentence context.
Harper and LanguageTool's bundled OpenNLP tagger use trained components to
identify parts of speech and sentence structure on the device. A smaller
allowlist of LanguageTool rules checks Swedish adjective agreement and some
verb forms.

Bundled US, UK, Australian and Canadian Hunspell dictionaries expand English
spelling coverage. The checker ranks Harper's corrections and gives preference
to suggestions accepted by the selected dictionary. The application also
includes Chromium dictionaries for Danish, Dutch, French,
German, Hindi, Italian, Korean, Norwegian Bokmål, Polish, Portuguese, Russian,
Spanish, Swedish, and Ukrainian. These support the existing Windows/Chromium
spelling path; local grammar checks support English and Swedish. Other languages
depend on support and dictionaries already available to Windows or Chromium.
Checking requires no account, service, separately installed Java runtime, or
network connection. WRAITER does not download dictionaries automatically. This
checker is separate from the optional generative AI tools and works when those
tools are turned off. Its neural model uses local CPU inference and no cloud
allowance.

The renderer sends bounded passages to a shared worker and, for the additional
rules, to a local Java child process over standard input. The child is restricted
from opening sockets. The worker and child are started lazily; their results are
checked against exact UTF-16 ranges in the original editor node before they can
appear. A changed block is checked again, and suggestions never edit text until
the user selects one. The renderer retains results for unchanged blocks, checks
the active passage first, and caps displayed decorations in large chapters.
The neural model runs in a shared background worker with two CPU inference
threads, bounded text chunks and a bounded request queue. It starts on demand
for English and unloads after two idle minutes. Shutdown lets active native
inference finish and releases the model session; it does not forcibly terminate
a worker during inference. App exit waits for shutdown after saving, with a
ten-second bound. Established rule suggestions
take precedence over overlapping compact-model suggestions, which take
precedence over neural suggestions; grammar takes precedence over spelling.
Pending tracked-change blocks and code are skipped. The chapter review reports
when an engine cannot start, and retries after a delay. Other checks remain
available while it recovers. Swedish spelling uses the native editor menu;
the local review includes Swedish grammar, and English spelling and grammar.

The neural layer leaves quoted dialogue to the existing checks and filters out
case-only changes, broad vocabulary rewrites, some article insertions, and
uncertain edits near truncated sentence boundaries. Existing checks also leave
recognizable informal quoted verb forms and the optional less/fewer distinction
to the author. Quote detection is heuristic, so it cannot identify every form
of intentional voice.
Noun-number corrections use known inflection pairs and abstain on ambiguous
endings when the singular spelling cannot be determined safely.

These are suggestions, not an assurance of correctness. The rules deliberately
avoid some ambiguous article, repetition, agreement, name, and style guesses,
but can still miss mistakes or flag valid prose. The [model notes](../tools/grammar-model/README.md)
describe the synthetic fiction tests, their limits, and how to replay them.

## Building and maintaining the bundled rules

`npm run build` and Windows packaging prepare `build/offline-grammar/payload`.
If the build cache is missing, this **build-time** step downloads pinned
LanguageTool artifacts, Chromium dictionary sources, and a Windows x64 Eclipse
Temurin Java 21 runtime from their upstream sources and verifies pinned SHA-256
digests. The Chromium source archive may be repacked upstream, so every included
dictionary, source file, and notice is checked individually against
`tools/local-grammar/hunspell-checksums.json`. Once populated, the cache can be
reused offline. The English LanguageTool JAR is repacked to remove an unused
spelling model, and both the original download and resulting JAR are checked
against pinned hashes. Installed applications
contain the resulting files and do not download them. At startup, WRAITER copies
versioned Chromium dictionaries into the profile's normal `Dictionaries`
cache without replacing existing files or personal words. The generated build
folder is not committed.

The same build also prepares `build/neural-grammar` through
`tools/prepare-neural-grammar.cjs`. It fetches
`deepquillapp/gector-grammar` at pinned revision
`2232e0ef109dd12e11e2c74b565b7318e36379e4` only when the verified cache is missing.
Weights, tokenizer, labels, verb forms, and model card have pinned sizes and
SHA-256 digests. The installed application reads the bundled files without
downloading a model. The publisher declares the model Apache-2.0; its complete
model card, license, RoBERTa MIT notice, and training-source attributions are
included with the resources. WRAITER redistributes the weights unchanged and
adds its own suggestion filters. These attributions record the publisher's
claims, rather than an independent audit of its training corpora.

The dependency coordinates, hashes, source archives, license notices, bridge
source, and precompiled bridge live in `tools/local-grammar/`. After editing
`WraiterGrammar.java`, prepare the dependencies and run
`node tools/rebuild-offline-grammar-bridge.cjs` with a JDK 21 or newer on PATH.
Then run `node tools/prepare-offline-grammar.cjs` and the IPC tests to stage and
exercise the new bridge. The bundled Java runtime is a JRE, not a compiler.

Useful checks include `npm test`, `npm run test:offline-grammar`,
`npm run test:offline-grammar-large`, `npm run test:offline-grammar-paragraph`,
and `npm run test:large`. The desktop
tests use isolated synthetic profiles; `npm run test:offline-dictionaries`
checks Swedish and Polish, and `npm run test:offline-network` records attempted
HTTP(S) requests from Chromium startup. The local-process test also verifies
that the socket restriction is active. `tests/offline-grammar-soak-ui.cjs` exercises
repeated offline checks, replacements, stale-hint removal, and memory sampling
in a hidden synthetic desktop session.

`tools/extract-grammar-examples.py` and `tools/benchmark-grammar-corpus.mjs`
provide a diagnostic using LanguageTool's own rule examples. The examples are
not independent of the bundled engine, and an example labeled correct for one
rule can contain a different issue. `tools/extract-typo-examples.py` can also
select a deterministic sample from the independently assembled [GitHub Typo
Corpus](https://github.com/mhagiwara/github-typo-corpus); its labels are
machine-classified and its technical text often contains names or other errors.
The local `offline-grammar-writing-pairs.json` set is authored for development.
These diagnostics help find regressions but do not establish precision, recall,
or a comparison with commercial checkers. An independently adjudicated fiction
corpus and the same tests run against those products would be needed for that.
