# WRAITER

A quiet place to write, with AI within reach.

WRAITER is an early Windows desktop writing application. It keeps manuscripts on your computer and connects to a provider you choose for continuations, corrections, and writing questions.

## Run the Windows preview

After packaging, open `release/WRAITER-0.1.0-Windows.exe`. This is a portable application and does not require an installer. It is an unsigned development preview.

The opening manuscript is fictional demonstration text. Use the document menu (three dots, upper right) to start a manuscript or open/import an existing one.

## Writing

- Chapters with editable titles, ordering, status, and word counts.
- Rich text: headings, emphasis, lists, quotes, links, images, and basic tables.
- Paper, warm dark, and high contrast themes; adjustable reading font, text size, spacing, and column width.
- Focus view, find/replace, and local spellchecking (English US/UK and Swedish).
- Local recovery, native `.wraiter` files, previous-save `.bak` copies, and up to 20 explicit revision snapshots.
- Private notes and separate writing-voice instructions.
- Markdown/text reference copies attached to the manuscript.

Save with **Ctrl+S** to choose a native document file. Subsequent edits are autosaved. An unnamed document is initially held in local recovery; when switching documents, recovered drafts are retained and available through Recent manuscripts. An externally modified native file is not silently overwritten.

The native `.wraiter` format is a versioned JSON document, with structured chapter content, references, notes, and snapshots. API keys live in encrypted application settings, not manuscript files.

## AI connections

Open Preferences → AI connections. Enable writing assistance, choose the provider and model, check the connection, then save the preferences.

- **Ollama:** use the host address of an existing Ollama server and an installed model.
- **OpenAI:** uses the Responses API with your API key.
- **Claude API:** uses Anthropic's Messages API with an API key. This is not a Claude Code subscription connection.
- **Compatible API:** uses a `/chat/completions` API, including compatible xAI endpoints.
- **Codex CLI:** uses an existing signed-in native Codex executable. Executable detection and manual selection are supported. Each request runs in a separate temporary directory; CLI startup is slower than a persistent model connection.

Provider and model availability depend on your own account or local installation. Connection checks do not generate text. Cloud text generation can consume provider credits or subscription allowance. No provider is contacted just by opening a manuscript.

Autocomplete uses text before the cursor. Correction/rephrasing uses selected text and surrounding context. Enabled references and writing-voice instructions accompany requests. Private notes are excluded. References are stored as copies; editing their original files does not automatically update these copies. Reference context is bounded to 48,000 characters total.

Unaccepted ghost text is never part of the saved document. Requests are cancelled/discarded when their context becomes stale. Reviewable replacements remain separate until accepted. Changes that alter paragraph structure may simplify formatting inside the selected passage; the review panel reports this before acceptance.

## File compatibility

| Format | Current preview support |
|---|---|
| WRAITER | Native editing, saving, recovery, references, and snapshots |
| ODT | Import as a copy; basic manuscript structure; review unsupported features |
| DOCX | Basic import/export; not full Word round-trip compatibility |
| PDF | A4 publication export, paginated separately from the writing view |
| HTML | Basic import; styled export with embedded images |
| Plain text | Import/export |
| Markdown | Basic heading/paragraph import; structural export |
| BBCode | Text/formatting export |

Import never writes back to the source ODT/DOCX. Advanced page layouts, office fields, tracked changes, comments, footnotes/endnotes, EPUB, live page editing, and Claude Code/Grok Build agent connections are not implemented in this preview. The page-width view is a reading surface, not a print-pagination preview. Always inspect a publication export before using it.

## Shortcuts

| Action | Shortcut |
|---|---|
| Save / save a copy | Ctrl+S / Ctrl+Shift+S |
| Find in chapter | Ctrl+F |
| Preferences | Ctrl+, |
| Bold / italic / underline | Ctrl+B / Ctrl+I / Ctrl+U |
| Undo / redo | Ctrl+Z / Ctrl+Shift+Z |
| Request a continuation | Ctrl+Enter |
| Accept ghost text | Tab |
| Accept next suggested word | Ctrl+Right |
| Dismiss / cancel | Escape |
| Focus view | F11 |

## Development

Requires Node.js and npm. The dependency lockfile records the versions used for this preview. The Electron shell uses a sandboxed renderer, context isolation, and a narrow preload API. Provider requests and file writes occur in the main process.

```text
npm ci
npm run build
npm start
npm test
npm run test:app
npm run package
```

If npm blocks Electron's installation script, run `node node_modules/electron/install.js` to install the pinned runtime. Build the renderer again after source changes before running Electron. `npm run dev` serves a browser-only view; file and AI capabilities require the Electron shell.

Application tests use separate data under `test-output/` and a local mock provider; they do not send manuscript text to a paid provider. Screenshots and test results remain there for review. The production application's data is stored in Electron's per-user application-data directory; use native Save to maintain manuscript files in a location you choose.

Windows is the only platform being packaged and exercised in this first preview. The architecture supports future macOS/Linux work, but those platforms are not yet validated.
