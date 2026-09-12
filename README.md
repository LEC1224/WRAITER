# WRAITER

Windows desktop writing with integrated AI assistance. Version 0.2 adds a conventional native menu bar, document formatting, LibreCompleteAI-style keyboard behaviour, task-specific models, saved Codex account reuse, and Git version history.

## Run

Open `release/WRAITER-0.2.0-Windows.exe`. This is an unsigned portable preview; no installer is required. It preserves the earlier preview's application data. Use **File → New manuscript**, **Open**, **Save**, and **Export**. New documents start blank.

## Writing and formatting

- Chapter outline, titles, ordering, status, and word counts; optional notes, references, history, and assistant panels.
- Direct controls for installed fonts, point sizes, text colour, bold/italic/underline, highlighting, alignment, lists, images, links, and tables.
- Paragraph spacing and first-line indentation; document default font/size/line spacing. Document formatting is saved and carried into supported exports.
- Light, Dark, and High contrast themes, document zoom, continuous/page-width views, and focus mode.
- Find/replace, undo/redo, local spellchecking, and a content-language selector on the status bar.
- Automatic recovery, native `.wraiter` JSON documents, preceding-save `.bak` backups, and Git versions. External edits are detected before overwriting a named document.

Use the paragraph settings button at the right of the formatting toolbar for document defaults. A toolbar font change affects selected text or newly typed text, like a conventional word processor. Zoom changes only the view.

## AI behaviour

Enable AI using the toolbar or Ctrl+Shift+Space. All AI output is a preview until accepted.

| Action | Default shortcut |
|---|---|
| Request autocomplete at the cursor | Tab |
| Rephrase only selected text | Select text, then Tab |
| Accept the displayed suggestion/revision | Tab |
| Accept next suggested character | Right arrow |
| Accept next suggested word | Ctrl+Right |
| Reject a preview / cancel a request | Escape |
| Correct selected spelling and grammar | Ctrl+Alt+G |
| Rephrase selected text | Ctrl+Alt+R |
| Enable/disable AI | Ctrl+Shift+Space |
| Enable/disable automatic suggestions | Ctrl+Alt+Space |
| Save / save a copy | Ctrl+S / Ctrl+Shift+S |
| New / open | Ctrl+N / Ctrl+O |
| Find / replace | Ctrl+F / Ctrl+H |
| Settings / focus view | Ctrl+, / F11 |
| Save a version | Ctrl+Alt+S |

Change these in **Settings → Keyboard shortcuts**. Suggest and Accept deliberately share Tab because they operate in different states. Standard rich-text shortcuts such as Ctrl+B and Ctrl+Z remain available.

Autocomplete receives only text before the cursor. Its configurable context budget retains an opening excerpt and recent prose. Selection edits receive the selected text and up to ten nearby words on each side. Bracketed instructions within a selection are treated as editing guidance and excluded from the requested replacement. Escape retains the selection; requesting again discourages repetition of rejected alternatives without reducing suggestion length.

A three-dot indicator marks a pending request. When text typed during generation matches the start of a continuation, only its untyped remainder is shown. Incompatible edits invalidate the pending result. Typing over a displayed revision resumes after the original selected text. Previews do not affect word counts, saved files, or exports. Accepted revisions preserve unchanged marks where possible and can be undone.

Set the document's content language on the status bar. In **Settings → Language**, optionally select a native language; it starts unset. Selecting a native-language word or phrase and requesting a rephrase asks the model to translate it into the document language. No local language-detection claim is made: the selected model interprets the phrase in context.

## Connections and task models

**Settings → AI connections** assigns a separate provider and model to autocomplete, correction, rephrasing/translation, and writing chat.

- **Codex:** detects installed Codex, reuses its saved account, and starts a persistent hidden connection. No terminal or repeated login is needed when an account is already available. Model discovery is automatic. Browser sign-in is offered only when an account is missing. Reference context is cached and each request gets an isolated fork.
- **Ollama:** discovers installed models. Connect can start an installed local service automatically. Auto mode tries structured output and falls back to raw generation for unsupported models; Guided and Raw can be chosen explicitly. Context sizing, keepalive, temperature, token limit, and reasoning controls are supported.
- **OpenAI:** Responses API with an API key and model discovery.
- **Claude API:** Anthropic Messages API with an API key; this does not connect a Claude Code subscription.
- **Compatible API / xAI:** chat-completions compatible endpoints with an optional API key.

API keys are encrypted in per-user application settings and scoped to the provider endpoint; they are never stored in manuscripts. Connection checks discover availability without generating prose. Actual cloud requests use the selected account's allowance or billing. Codex offers reasoning effort, but its app-server does not expose temperature or token caps; the requested suggestion-word limit still applies. Some API providers/models do not implement reasoning controls.

Private notes are excluded from AI requests. Writing-voice instructions and enabled references are included. Reference attachments support Markdown and plain text, up to 20 files and 48,000 combined context characters. Linked files refresh saved edits; older embedded-only references continue to work. Missing or untrusted imported links are skipped with a notice instead of silently using stale content.

## Git versions

Source history is stored in this application's repository. Manuscript history is separate: each document receives a local Git repository beneath WRAITER's application-data directory. It records structured text, marks, chapter order, notes, and references without adding manuscript folders to the application's source repository.

Named saves, document switches, and editing checkpoints create versions. Automatic checkpoints occur after 20 seconds idle or two minutes of continuous editing. **View → Git version history** lists them; **Save version** creates a labelled checkpoint. Restore saves the current version first and creates a new revision, preserving the intervening history. Git must be installed; ordinary saving and recovery still work if it is unavailable. Git history is local and is not a remote backup.

## Formats and present limits

| Format | Support |
|---|---|
| WRAITER | Native editing, saving, recovery, reference links, metadata and formatting |
| ODT | Import as a copy; basic manuscript structure and formatting |
| DOCX | Basic import/export, including document typography and paragraph layout |
| PDF | A4 export, paginated separately from the writing view |
| HTML | Basic import; styled export with embedded images |
| Plain text / Markdown | Import/export; limited Markdown import |
| BBCode | Export |

Imports never write back to source ODT/DOCX files. Full office-format round trips, live print pagination, comments, tracked changes, footnotes/endnotes, EPUB, and direct Claude Code/Grok Build agent connections remain future work. Page view is a writing surface, not an exact print preview. Review publication exports, particularly imported complex office documents.

## Development

Use Node.js and npm. Dependencies are pinned in the lockfile.

```text
npm ci
npm run build
npm start
npm test
npm run test:io
npm run test:app
npm run package
```

Rebuild before starting Electron after renderer changes. `npm run dev` serves the frontend only; native file and AI features need the Electron shell. Tests use isolated application data and local mock services; an additional recorded smoke test verifies actual Codex with synthetic prose. Windows is packaged and exercised; macOS/Linux compatibility is not yet validated.
