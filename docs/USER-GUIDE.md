# WRAITER user guide

Detailed controls and behaviour for version 0.10.0. For the download and a short introduction, start with the [README](../README.md). If you get stuck, see [troubleshooting](TROUBLESHOOTING.md).

## Projects and startup

**File → Open recent** lists the last 12 opened or saved documents, including preserved unnamed drafts. Selecting a file that is already open activates its tab. Clear recent list removes the list entries without deleting files.

**New**, **Open**, and the **+** beside the tabs add a project in the same window. Each tab has independent chapters, formatting, notes, file format, recovery and editing history. The assistant conversation stays with its tab while the app is open. Switching projects cancels unfinished AI requests and saves current edits first. Save As and Export cannot overwrite another tab's open file.

Use **Ctrl+Tab** / **Ctrl+Shift+Tab** to cycle projects, and **Ctrl+W** or a tab's **×** to close it. These shortcuts can be changed in Settings. Closing an unnamed draft preserves it in Open Recent; named files remain on disk. Closing the last tab leaves a blank project.

**Settings → General → When WRAITER starts** offers:

- **Restore all open project tabs** (default): restores the tab order, last active project, chapter and reading position, including unnamed drafts. Each project's atomic undo history remains available.
- **Open a clean new project**: starts with one blank tab. Named documents remain saved, and unnamed drafts or unreviewed native edits are preserved in Open Recent.

Each tab has a separate recovery file in application data. Restoring projects does not require Git. A copied WRAITER document opened alongside its original receives an independent project identity so its future undo history cannot mix with the original's.

## Writing and formatting

- Chapter outline, titles, ordering, status, and word counts; optional notes, references, history, and assistant panels.
- A searchable installed-font picker renders every font name in its own font. Direct controls cover point sizes, text colour, bold/italic/underline, highlighting, alignment, lists, images, links, and tables.
- Paragraph spacing and first-line indentation; document default font/size/line spacing. Document formatting is saved and carried into supported exports.
- Light, Dark, and High contrast themes, document zoom, continuous/divided-page views, and focus mode.
- Find/replace, undo/redo, local spellchecking, and a content-language selector on the status bar.
- Automatic recovery, preceding-save `.bak` backups, and Git versions. External edits are detected before overwriting a named document.

Choose **Story**, **Article**, **Submission manuscript**, **Report**, or **Notes** from the status bar. Story is the default and hides reading statistics beneath the chapter title. Article shows them. Layouts set document typography and spacing; the paragraph settings dialog also provides an independent reading-statistics checkbox. Word counts remain available in the outline and status bar.

Use the paragraph settings button at the right of the formatting toolbar for document defaults. A toolbar font change affects selected text or newly typed text, like a conventional word processor. Zoom changes only the view.

**Settings → Appearance → Document view** chooses Continuous (the default infinite page) or Divided pages. Both provide almost one viewport of workspace below the document, so the last line can sit higher on screen. The status-bar view button and View menu also switch modes; the choice survives restart. Divided pages use A4 proportions at the current column width and flow wrapped paragraphs automatically. Page gaps and numbers are view decorations, so switching views does not add text, paragraph breaks or undo actions. Oversized tables/objects stay intact on an expanded sheet. Export pagination follows its selected paper preset and can differ from the editing view.

**Ctrl+Enter** inserts a manual page break at the cursor, also available under **Edit → Insert page break**. It splits the current paragraph and starts the following paragraph on a new page. Backspace at that paragraph's start removes the break. Manual breaks remain visible as markers in Continuous view and persist through save, restart, undo/redo, ODT, DOCX, HTML and PDF. Plain text and Markdown disclose the formatting loss before native save. Page-break insertion has a customizable shortcut; an existing Ctrl+Enter binding is preserved during upgrade instead of being reassigned.

## Proofreading and statistics

Open **Tools → Proofread** for a non-destructive review of selected text, the current chapter, or the whole manuscript. Proofreading has its own provider/model assignment under **Settings → Connections → Proofreading review**; the dialog also lists the models available through that connection. A long scope is divided into bounded passages and the progress indicator shows each batch. The selected text, document language, and writing-voice instructions are sent to that model. Private notes are excluded.

Findings are split into **Definite error**, **Likely problem**, and **Editorial choice**, then grouped by spelling, grammar, punctuation, wrong-word typo, wrong-word meaning, agreement/tense, phrasing, consistency, or capitalization. Each compact item uses a two-line diff: surrounding sentence text is muted, the source phrase is red, and the replacement is green. It also shows the chapter, paragraph, and a short reason. Edit any proposed replacement directly before applying it. Apply one finding, select several, select everything currently shown, or use the clearly labelled **Select all definite**, **Select all likely**, and **Select all editorial** buttons within a category. Each applied batch is one persistent undo step; unaccepted findings never enter the manuscript. WRAITER checks the exact source range before applying, preserves surrounding inline formatting, and refuses stale or overlapping replacements instead of guessing.

AI proofreading is editorial assistance, not an authority: models can miss errors or object to deliberate prose. The severity names describe the model's classification, not a guarantee. **Stop** cancels the active batch and leaves any findings already returned available for review.

**Tools → Word count and statistics** shows manuscript words, characters with and without spaces, chapters, paragraphs, sentences, estimated pages, reading/read-aloud time, vocabulary figures, average lengths, quoted-dialogue share, longest/shortest chapters, and a per-chapter table. Page count is explicitly an estimate; change the words-per-page assumption in the dialog. It is independent of export pagination.

**Tools → Spelling → Highlight spelling mistakes** controls Chromium's local dictionary underlines without sending text to AI. **Language and dictionaries** opens the language settings; the current document language remains selectable in the status bar. The AI proofreading review and local spelling underline are independent.

## Guided setup and first steps

Run `release/WRAITER-0.10.0-Setup.exe`. Choose **Simple** (recommended) or **Advanced**, then an installation folder. WRAITER installs for your Windows account, adds shortcuts and offers to open the app. Installation continues with account setup on first launch; the mode selected in the installer is carried into that guide. The portable app uses the same first-run guide.

1. Choose **Codex** or **Claude Code**.
2. **Check my account** looks for the installed helper and its saved sign-in. If missing, **Install** downloads and runs the provider's official Windows installer. No command typing is needed. Installation needs internet access and can be cancelled; an interrupted provider install may need a retry.
3. **Sign in** opens the provider's authentication flow. Claude Code uses a one-time interactive sign-in window; follow its browser prompts, return to WRAITER, and check the account again. WRAITER does not ask for your account password.
4. **Run writing test** sends a fixed short sample, using a small amount of provider allowance. It sends no manuscript. Setup cannot proceed to its ready screen without a successful response.
5. **Save and start tutorial** assigns the chosen connection to all five writing tasks and enables AI. Simple setup requests suggestions only when asked. Advanced setup exposes a custom helper executable, model selection and automatic suggestions.

An eligible provider account and its usage allowance are separate from WRAITER. **Set up later** lets you write without completing a new connection. Reopen setup from **Help → Set up AI**. Existing installations keep their saved connections and receive the tutorial without repeating setup.

The writing walkthrough lives beneath the actual workspace, with highlights on the real controls. **Help → Writing tutorial** opens a separate practice manuscript with a short first chapter. Your other projects remain in their tabs. The user creates chapter two, then the walkthrough types:

> There was once a software called Wraiter, that was used to integrate AI in authors' workflows. One day

Pressing the configured suggestion shortcut sends a real request to the configured autocomplete provider. The guide explains one-character acceptance (Right), one-word acceptance (Ctrl+Right), full acceptance (Tab), cancellation/dismissal (Escape), retry and free practice. It then selects “software” for a real rephrasing request. Subsequent lessons cover undo/redo, correction, private notes versus writing voice, enabled references, an actual assistant editing request, history, find, page/focus views, saving and export. The coach reads the current shortcut bindings. It advances from successful operations, with explicit skip options for most lessons; it does not substitute simulated AI when a connection fails.

AI requests in the walkthrough use the chosen provider's normal allowance. Background automatic suggestions pause while a tutorial session owns that practice manuscript, without changing the saved preference. Only user-requested AI runs. Tutorial wording and background references are synthetic; other documents and private notes are excluded. Writing-voice preferences are now included in side-assistant requests as well as inline writing help.

**Pause** keeps the current lesson and practice text across restart. Switching to another project suspends the walkthrough and stops any introductory typing; **Return to walkthrough** resumes in the practice tab. Closing that tab or starting with a clean workspace preserves its draft through normal recovery; reopening the guide can create a fresh practice document if the tab is gone. **End tour** finishes without deleting the practice manuscript. At the end, keep writing there or return to the project you started from. Restart it anytime through Help. Existing users who already finished the former tutorial can open the new one from Help.

Claude Code uses its own saved account, with host tools, MCP servers and hooks disabled for writing requests. WRAITER's existing document agent validates and applies requested edits, which remain undoable. Claude model aliases are offered as suggestions, not a claim of account access; the writing test verifies the chosen model. Provider-specific temperature/token controls are not forwarded to the Claude Code CLI.

Official setup references: [Codex installation](https://learn.chatgpt.com/docs/codex/cli), [Claude Code installation](https://code.claude.com/docs/en/setup), [Claude Code CLI options](https://code.claude.com/docs/en/cli-reference). Setup uses fixed provider download addresses and does not run renderer-supplied commands.

## AI behaviour

Enable AI using the toolbar or Ctrl+Shift+Space. Inline suggestions and selection revisions remain previews until accepted. A direct editing request in the side chat applies the completed batch automatically, with an **Undo assistant edit** button and a single persistent undo entry.

| Action | Default shortcut |
|---|---|
| Request autocomplete at the cursor | Tab |
| Rephrase only selected text | Select text, then Tab |
| Choose a rephrasing alternative | Up / Down arrow |
| Accept the highlighted alternative | Enter / Tab |
| Accept the displayed suggestion/revision | Tab |
| Accept next suggested character | Right arrow |
| Accept next suggested word | Ctrl+Right |
| Reject a preview / cancel a request | Escape |
| Correct selected spelling and grammar | Ctrl+Alt+G |
| Rephrase selected text | Ctrl+Alt+R |
| Enable/disable AI | Ctrl+Shift+Space |
| Enable/disable automatic suggestions | Ctrl+Alt+Space |
| Save / save as | Ctrl+S / Ctrl+Shift+S |
| New / open | Ctrl+N / Ctrl+O |
| Find / replace | Ctrl+F / Ctrl+H |
| Settings / focus view | Ctrl+, / F11 |
| Save a version | Ctrl+Alt+S |
| Insert a manual page break | Ctrl+Enter |

Change these in **Settings → Keyboard shortcuts**. Suggest and Accept deliberately share Tab because they operate in different states. Standard rich-text shortcuts such as Ctrl+B and Ctrl+Z remain available.

Autocomplete receives only text before the cursor. Its configurable context budget retains an opening excerpt and recent prose. Correction receives the selected text and up to ten nearby words on each side; ranked rephrasing/translation receives up to eighty on each side to judge the surrounding sentence. Bracketed instructions within a selection are treated as editing guidance and excluded from the requested replacement. Escape retains the selection; requesting again discourages repetition of rejected alternatives without reducing suggestion length.

Selection rephrasing presents up to three distinct alternatives in a dropdown beside the selection. **Up/Down** changes the highlighted option, **Enter or Tab** accepts it, **Escape** dismisses the list, and clicking an option accepts it. **More alternatives** requests another set. One to three stars represent the model's editorial judgment of contextual fit, with ties allowed; they are not confidence probabilities. Models that return only a single plain replacement are shown as Unrated. Ratings and unaccepted alternatives never enter the manuscript. Acceptance replaces only the selected text and remains one undo action.

A three-dot indicator marks a pending request. When text typed during generation matches the start of a continuation, only its untyped remainder is shown. Incompatible edits invalidate the pending result. Typing over a displayed revision resumes after the original selected text. Previews do not affect word counts, saved files, or exports. Accepted revisions preserve unchanged marks where possible and can be undone.

Set the document's content language on the status bar. In **Settings → Language**, optionally select a native language; it starts unset. Selecting a native-language word or phrase and requesting a rephrase asks the model to translate it into the document language. No local language-detection claim is made: the selected model interprets the phrase in context.

The side chat can inspect chapters, search text, replace exact passages, normalize repeated spaces, rewrite passages, remove empty paragraphs, delete a requested complete paragraph, and rename chapters. For example, ask “Remove double spaces throughout the manuscript” or “Remove empty lines.” Empty-line cleanup removes the paragraph blocks themselves, preserving nonempty text and formatting. Required document, table-cell and list-item structure remains editable. Selecting text limits chat edits to that selection, including when the model requests a wider scope. Tool activity and the resulting changes appear in the panel. If the document changes while an editing request runs, its stale edits are discarded. Cancellation applies no partial batch. Ordinary questions can be answered without editing. The agent has document tools only; it cannot operate your filesystem or run shell commands. Complex tasks are bounded to eight model turns and twelve tool calls.

## Connections and task models

**Settings → AI connections** assigns a separate provider and model to autocomplete, correction, rephrasing/translation, proofreading review, and writing chat.

- **Codex:** detects installed Codex, reuses its saved account, and starts a persistent hidden connection. No terminal or repeated login is needed when an account is already available. Model discovery is automatic. Browser sign-in is offered only when an account is missing. Reference context is cached and each request gets an isolated fork.
- **Claude Code:** uses the helper application's saved account. Setup can install the helper, start sign-in and verify a real response. Writing requests disable host tools, hooks and MCP servers; WRAITER applies its own validated document edits.
- **Local models (managed):** WRAITER starts its own hidden engine when needed, using either an optional portable download or an installed Ollama executable. Reuses downloaded models and supports individual task assignments. No separate Ollama app or manually started service is required.
- **Ollama:** discovers installed models. Connect can start an installed local service automatically. Auto mode tries structured output and falls back to raw generation for unsupported models; Guided and Raw can be chosen explicitly. Context sizing, keepalive, temperature, token limit, and reasoning controls are supported.
- **OpenAI:** Responses API with an API key and model discovery.
- **Claude API:** Anthropic Messages API with an API key; this does not connect a Claude Code subscription.
- **Compatible API / xAI:** chat-completions compatible endpoints with an optional API key.

API keys are encrypted in per-user application settings and scoped to the provider endpoint; they are never stored in manuscripts. Connection checks discover availability without generating prose. Actual cloud requests use the selected account's allowance or billing. Codex offers reasoning effort, but its app-server does not expose temperature or token caps; the requested suggestion-word limit still applies. Some API providers/models do not implement reasoning controls.

Private notes are excluded from AI requests. Writing-voice instructions and enabled references are included. Reference attachments support Markdown and plain text, up to 20 files and 48,000 combined context characters. Linked files refresh saved edits; older embedded-only references continue to work. Missing or untrusted imported links are skipped with a notice instead of silently using stale content.

## Local models

Open **Settings → Local models**. Existing Ollama models are listed directly from their manifests and blobs, without starting the engine. WRAITER detects `OLLAMA_MODELS` from the process and Windows user/machine environment, then falls back to `%USERPROFILE%\.ollama\models`. Use the detected folder, WRAITER's own folder, or a folder selected through the native chooser. Switching folders does not move or delete files.

- **Engine and model storage:** automatic selection prefers a WRAITER portable runtime, then installed Ollama. Check the official engine's version and download size, then install it if desired. The standard Windows x64 v0.34.0 archive tested for this release is about 1.4 GiB; AMD ROCm libraries are an optional additional package. Runtime size is separate from model sizes. Downloads are streamed, checked against the official SHA-256 digest, and validated before ZIP extraction. A failed or cancelled installation preserves the previous active engine and removes only its newly created staging folder.
- **On this computer:** search downloaded models, inspect completeness and loaded GPU memory, unload a model, and assign it to autocomplete, correction, rephrase/translation, proofreading, chat, or all tasks. Save Settings keeps task assignments; storage and resource changes apply immediately.
- **Download models:** choose a small starting model or enter a public Ollama model name. Check its current size before downloading. Progress and cancellation are available. Downloads do not overwrite an already registered model name.
- **Add GGUF file:** choose a GGUF v2/v3 file and give it a model name. WRAITER hashes and registers it with the local engine, reusing identical blobs when available. Registration may require another on-disk copy; the selected original is preserved. The model architecture must be supported by the selected Ollama version. Arbitrary PyTorch/Safetensors files and multi-file GGUF sets are not supported by this chooser.
- **Memory and acceleration:** automatic GPU selection, a detected NVIDIA GPU, or CPU only; context size; idle unload delay; and one to three loaded models. Larger contexts need additional memory beyond the file size. Loading, generation and out-of-memory messages appear in the UI. Small models can be less reliable at structured agent actions.

The owned engine listens on a private loopback port, with cloud execution disabled. WRAITER stops that engine and its runners on normal exit without shutting down unrelated Ollama services. Models remain on disk. Once the engine and models are present, inference works offline; checking catalogs and downloading requires internet access. The existing **Ollama** connection remains available for independently managed or remote servers.

Runtime downloads come from [Ollama's official Windows releases](https://github.com/ollama/ollama/releases). See the official [Windows runtime documentation](https://docs.ollama.com/windows), [model storage FAQ](https://docs.ollama.com/faq), and [GGUF import documentation](https://docs.ollama.com/import). Ollama and its runtime dependencies retain their own licenses; model publishers set their model licenses. Windows x64 NVIDIA inference was tested here; AMD and ARM64 packages have not been tested on hardware, and WRAITER currently ships only a Windows x64 build.

## Editing history and Git versions

**View → Revision history → Every edit** lists text, formatting, chapter, and document-setting actions with timestamps and before/after details. Ctrl+Z, Ctrl+Y, and Ctrl+Shift+Z work across chapter switches and application restarts. Typing transactions stay separate; a multi-step replacement or assistant batch is one undo operation. New typing after undo starts a new branch, while abandoned edits remain visible in the audit trail. History begins with edits made in 0.3; earlier keystrokes cannot be reconstructed.

The journal appends immutable events and flushes them before a recovery snapshot can reference them. If an interruption occurs between those writes, startup replays the complete later events. A corrupt or mismatched journal is preserved alongside a document snapshot before a fresh undo chain begins; the app reports this instead of replaying unrelated edits. Atomic history does not depend on Git.

Source history is stored in this application's repository. Manuscript history is separate: each document receives a local Git repository beneath WRAITER's application-data directory. It records structured text, marks, chapter order, notes, and references without adding manuscript folders to the application's source repository.

Named saves, document switches, and editing checkpoints create versions. Automatic checkpoints occur after 20 seconds idle or two minutes of continuous editing. The **Checkpoints** tab lists them; **Save version** creates a labelled checkpoint. Restore saves the current version first and creates a new revision, preserving the intervening history. It is also undoable. Git must be installed for checkpoints; atomic editing history, ordinary saving, and recovery still work if it is unavailable.

History and native-file companion state live in WRAITER's per-user application-data directory, rather than inside office/text files. Copying a document alone to another computer does not carry its local undo history or private notes. These local records are not a remote backup.

## Formats and present limits

| Format | Support |
|---|---|
| WRAITER | Native editing, saving, recovery, reference links, metadata and formatting |
| ODT / DOCX | Open, edit, and save to the same file; Save as converts between supported formats |
| PDF | Standard A4, desktop-reading and mobile-reading exports; light or dark pages |
| EPUB | Reflowable EPUB 3 export with chapter navigation and embedded supported images |
| HTML | Open/save; styled output with embedded images |
| Plain text / Markdown | Open/save; CommonMark parsing, supported UTF-8/UTF-16 encoding and line-ending preservation |
| BBCode | Export |

Opening an office/text document keeps it attached to its original format. Save and autosave write that format directly; private notes, references and editing state are kept separately. Opening alone or changing private notes does not rewrite the source. WRAITER-generated office files carry non-private chapter boundary metadata, validated against their actual package content before reuse.

Unsupported office features are detected where possible and described on opening. Until the first compatibility review, changed content is staged safely in recovery. Saving after review preserves the complete original under **Format originals** in application data, plus the preceding-save `.bak` beside the document. New unsupported formatting in a text format also prompts for review before writing. This is direct file-format support, not lossless preservation of every Word/Writer feature: page sections, named styles, headers/footers, comments, tracked changes, footnotes/endnotes, fields, floating objects and advanced layouts may be simplified or omitted. Unrecognized office features can still require manual comparison.

**File → Export** offers full manuscript, one chapter, or selected text, with title/chapter-heading options. Formats include DOCX, ODT, all three PDFs, EPUB, plain text, BBCode `.txt`, Markdown and HTML. Exports exclude private notes, AI context and editing history. PDF export performs pagination; page view is a writing surface, not an exact print preview.

The export dialog also offers **Discord chat**, **Formatted text · Telegram / email**, and Telegram bot **MarkdownV2** and **HTML**. Choose **Destination → Export to Clipboard** for any text-based format, or **Create file** to save it. Clipboard export follows the same manuscript/chapter/selection scope and heading options. It does not open a save dialog or change the manuscript. PDF, DOCX, ODT and EPUB require files.

Discord exports basic chat markup to `.txt`. Telegram bot exports are escaped `.txt` payloads for the corresponding bot parse mode; ordinary chat does not interpret these as bot markup. For ordinary Telegram Desktop chats and email, choose **Formatted text** and the clipboard destination: it places HTML formatting and a readable plain-text fallback on the clipboard. Receiving apps determine which formatting survives. Its file destination creates a browser-readable `.html` document. The separate **HTML document** option copies literal HTML source. Chat formats simplify tables and replace images with labelled placeholders; long text is retained in full and may need splitting into several messages.

Formatting references: [Discord chat syntax](https://support.discord.com/hc/en-us/articles/210298617-Markdown-Text-101-Chat-Formatting-Bold-Italic-Underline), [Telegram bot formatting](https://core.telegram.org/bots/api#formatting-options), and [Telegram Desktop HTML clipboard support](https://telegramdesktop.github.io/tdesktop/changelog/). Run `npm run test:clipboard` for the synthetic desktop export regression; it intercepts clipboard writes so the user's clipboard remains intact.

Live print pagination, editing comments/tracked changes/footnotes, and direct Grok Build connections remain future work. macOS and Linux are not yet packaged or validated.

## Development

Use Node.js and npm. Dependencies are pinned in the lockfile.

```text
npm ci
npm run build
npm start
npm test
npm run test:io
npm run test:app
npm run test:v03
npm run test:v04
npm run test:v05
npm run test:v06
npm run test:proofreading
npm run test:tutorial
npm run test:history-recovery
npm run test:pdf
npm run test:office
npm run package
```

Rebuild before starting Electron after renderer changes. `npm run dev` serves the frontend only; native file and AI features need the Electron shell. Tests use isolated application data and local mock services; recorded smoke tests verify actual Codex and local inference with synthetic prose. `npm run test:local-live` is optional: it needs installed Ollama and an already downloaded `llama3.2:1b`, copies blobs into isolated QA storage, registers a standalone GGUF copy, generates text, and unloads the model. Set `WRAITER_TEST_RUNTIME_ROOT` to a tested Local AI runtime directory to exercise a portable engine. PDF QA needs PyMuPDF; independent office QA also needs LibreOffice. Desktop suites accept `WRAITER_EXECUTABLE` to test the packaged application.

`npm run test:tutorial` exercises the actual editor and provider HTTP path using a local test service. `npm run test:tutorial:live` is opt-in: it sends two short real requests through your saved Codex account, in an isolated WRAITER profile and synthetic manuscript.
