# WRAITER

**A writing app with AI help, whenever you want it.**

Write your story, organise it into chapters, and get help finishing a sentence or finding the right word. WRAITER brings your AI connection into the manuscript, so you can keep writing in one place.

You do not need to know how to code. A guided setup helps you connect **Codex** or **Claude Code**, and a hands-on tutorial teaches you inside a practice story.

## Download WRAITER

**[Download the Windows installer](https://github.com/LEC1224/WRAITER/releases/download/v0.16.0/WRAITER-0.16.0-Setup.exe)** · [All downloads and release notes](https://github.com/LEC1224/WRAITER/releases/latest)

Version **0.16.0** is the current public preview for **Windows 10/11 on a 64-bit Intel or AMD computer**. macOS, Linux and Windows on ARM are not yet supported release targets.

This release includes the wording descriptions, vibe guidance, phrase ratings and suggestion-count settings shown below, alongside the latest manuscript revision tools. See the [0.16.0 release notes](docs/releases/v0.16.0.md) for what changed since 0.13.0.

| Choose a download | Who it is for |
| --- | --- |
| **[Installer — recommended](https://github.com/LEC1224/WRAITER/releases/download/v0.16.0/WRAITER-0.16.0-Setup.exe)** | Guides you through installation, lets you choose a folder, and adds shortcuts. |
| [Portable app](https://github.com/LEC1224/WRAITER/releases/download/v0.16.0/WRAITER-0.16.0-Windows.exe) | Runs without installing WRAITER. Settings and recovery files still stay in your Windows user profile. |

Download one of these `.exe` files. GitHub's **Source code** downloads are for developers; they are not the installer.

The preview is **not digitally signed**, so Windows may display an unknown-publisher or reputation warning. Release files are published only under [LEC1224/WRAITER](https://github.com/LEC1224/WRAITER/releases); checksums are included for people who want to verify their download.

WRAITER is free under the MIT license. An eligible Codex or Claude Code account is separate, and AI requests use that provider's allowance or billing. Internet access is needed to connect those services. You can also write with AI turned off, or use a local AI model through the advanced settings.

## See WRAITER in action

These screenshots show the real interface with a fictional sample manuscript, *The Long Way Home*, and example AI responses. The tutorial uses its own practice story.

### Keep the story and its context together
<img src="docs/images/writing-workspace.png" alt="WRAITER with three chapters on the left, a manuscript in the centre, and private notes and writing-voice instructions on the right" width="1000">

Move between chapters, format your prose, and keep references and revision notes beside the manuscript. **Notes & voice** separates private notes from the instructions you choose to share with AI, such as viewpoint, spelling or writing style.

### Keep writing when you get stuck
<img src="docs/images/inline-suggestion.png" alt="A chapter with an italic continuation preview after the words Mara turned toward the orchard" width="980">

Press **Tab** at the cursor to request a continuation. The faint italic words preview what could come next. Press **Tab** again to accept them or **Esc** to dismiss them; you can also accept just one word or character at a time.

### Compare wording, meaning and tone
<img src="docs/images/selection-rephrase.png" alt="Alternatives for rising air, with a short explanation under each choice and a three-star current phrase rating marked Tied highest" width="760">

Select a word or passage and press **Tab** to find another phrasing, or translate a word from your native language into the manuscript's language. Each option can include a short model-written description of its emphasis, tone or meaning, so you can see why you might choose it.

The **Current phrase rating** uses the same three-star scale as the alternatives. **Highest rated** or **Tied highest** indicates when the model considers your existing wording as strong as the suggestions. Stars reflect the model's judgement of this context; omitted ratings appear as **Unrated**.

WRAITER previews a replacement inside your sentence. Use **Up / Down** to compare choices, **Enter** or **Tab** to accept, and **Esc** to keep your original wording. **More alternatives** requests another set.

### Describe the feeling you want
<img src="docs/images/describe-vibe.png" alt="Describe your vibe text field filled with a request for the reader to experience avian navigation through the character's eyes" width="440">

Choose **Describe your vibe** beside **More alternatives** and write what you are looking for. For example: “I want the reader to feel the sense of avian navigation through her eyes.”

**Find alternatives** asks the model for fresh choices guided by that direction. You can describe a viewpoint, mood, level of formality or detail you want to bring out, then compare the results in the same sentence.

### Choose how many suggestions you want
<img src="docs/images/suggestion-count-settings.png" alt="Writing AI settings with separate targets of four translation suggestions, two correction suggestions and five rephrasing suggestions" width="860">

In **Settings → Writing AI → Selection suggestions**, set separate targets of **1–8** for translations, corrections and rephrasings. The defaults are **3 translations, 1 correction and 3 rephrasings**. The model may return fewer useful choices; corrections stay focused on spelling, punctuation and necessary grammar.

### Ask questions with the whole project in view
<img src="docs/images/project-assistant.png" alt="A manuscript beside a saved assistant conversation about Mara's viewpoint, with an action showing that eight passages were read" width="1000">

Chapters stay organised on the left while the writing assistant opens on the right. It can answer questions or make requested edits using the manuscript, your writing-voice instructions and enabled references. Conversations stay with the project, and assistant edits remain undoable.

### Proofread selectively
<img src="docs/images/proofreading-review.png" alt="Proofreading review with spelling and grammar findings, before-and-after diffs and an Apply 2 selected button" width="956">

Proofread a selection, the current chapter or the whole manuscript. WRAITER groups findings by type, shows each proposed change beside the original and lets you apply only the fixes you choose.

## Your first few minutes

1. **Install and open WRAITER.** Choose **Simple** for the recommended setup. **Advanced** also lets you choose the AI model, helper application and automatic-suggestion behaviour. Both let you choose where WRAITER is installed.
2. **Choose Codex or Claude Code.** The guide checks whether its helper application is installed and offers to install it if needed.
3. **Sign in with your provider.** Follow its sign-in prompts, return to WRAITER, and check the connection. WRAITER does not ask for your account password.
4. **Try the short writing test.** It checks that your AI can respond before calling the connection ready. This sends a sample sentence and uses a small amount of your provider's allowance.
5. **Start the writing tutorial.** Practise in a separate manuscript, then start your own story or open an existing document.

Already want to write? Choose **Set up later**. You can return through **Help → Set up AI**.

## Learn by writing
<img src="docs/images/writing-tutorial.png" alt="WRAITER's separate practice manuscript with an inline continuation and the tutorial lesson beneath the editor" width="1000">

The tutorial opens a short story that has already begun. You create its next chapter, and WRAITER adds an opening for you to continue. Press **Tab** and your connected AI suggests what could happen next.

The guide stays beneath the workspace and highlights the controls you are learning. You use the real editor and real AI, including selecting a word for alternatives, trying correction, and asking the assistant to help with an edit. AI exercises use your provider's normal allowance; nothing is generated until you ask during the tour.

You will also explore chapters, undo and redo, notes, references, history, finding text, saving and exporting. Pause whenever you like. Your own projects stay in their tabs. Revisit the walkthrough through **Help → Writing tutorial**.

| While writing | Try this default shortcut |
| --- | --- |
| Ask for the next part of a sentence | **Tab** at the cursor |
| Accept the whole suggestion | **Tab** again |
| Accept just the next suggested word | **Ctrl + Right arrow** |
| Accept one suggested character | **Right arrow** |
| Dismiss a suggestion or cancel a request | **Esc** |
| Find another way to say something | Select text, then **Tab** |
| Choose a suggested alternative | **Up / Down**, then **Enter** or **Tab** |
| Undo the last change | **Ctrl + Z** |
| Save | **Ctrl + S** |

Shortcuts can be changed in **Settings → Keyboard shortcuts**. The tutorial follows your current bindings.

## What you can do

- **Keep your writing organised.** Work with chapters and several manuscripts in tabs, with word counts, focus mode, themes and familiar formatting.
- **Format without breaking your flow.** Copy and paste formatting between passages, clear formatting from the toolbar, and choose preset or custom highlight colours. Translucent text backgrounds stay readable in every theme.
- **Act on a passage with a right-click.** Copy/paste or clear its formatting, add a comment, rephrase or correct selected text, ask the writing assistant, or continue from the cursor. Accept or dismiss AI previews from the same menu.
- **Revise across chapters.** Search the whole manuscript or current chapter, match case or whole words, and jump through results grouped by chapter. Preview every replacement before applying a batch with one undo step.
- **Keep revision notes beside the text.** Attach private comments to passages, return to their locations, and resolve or reopen them. Comments follow edits and travel with a saved `.wraiter` manuscript.
- **Stay in control of AI suggestions.** Compare continuations, rephrasings, translations and corrections before accepting them. Direct editing requests can revise prose, apply formatting and restructure paragraphs or chapters. Each completed request is one undoable batch with a saved before-and-after report and a revert control. Assistant conversations are saved per project, with a dropdown for returning to earlier chats.
- **Proofread without surrendering the pen.** Review selected text, a chapter or the manuscript by severity and error type; edit, select and apply only the fixes you want. Detailed document statistics and local spelling underlines live in the same Tools menu.
- **Give AI useful background.** Share writing-voice instructions and selected reference files. Keep private notes for yourself.
- **Keep editing history.** Ctrl+Z/Y group typing into word-sized edits and survive restarts. Recovery saves and preceding-save backups help protect your work. With Git installed, the history sidebar shows your current path newest first, while a complete tree shows every branch; a model chosen in Settings can summarize meaningful changes.
- **Use familiar documents.** Open and save WRAITER, Word (`.docx`), LibreOffice (`.odt`), plain text, Markdown and HTML files. Export PDF, EPUB, office documents or text for publishing and sharing.
- **Choose your AI.** Start with Codex or Claude Code; advanced connections include local models, Ollama, OpenAI and Claude APIs, and compatible services. Autocomplete, correction, rephrasing, proofreading and project assistance can use different models.

### Your writing and privacy

Manuscripts, assistant chats and recovery files are stored on your computer. When you request cloud AI help, WRAITER sends the text needed for that task, any vibe guidance you enter, recent messages from the selected conversation, enabled references and writing-voice instructions to your selected provider. The writing assistant can read relevant manuscript passages to answer an editing request. **Private notes and passage comments are excluded from AI requests and exports.** Chats are also excluded from manuscript exports.

API keys, when used, are encrypted in your Windows user profile and are not saved in manuscripts. Your provider's own terms and data handling still apply. Local inference can work offline after its engine and model have been downloaded. Local recovery is not a cloud backup: keep a separate backup of important writing.

### A few preview limitations

Complex Word or LibreOffice features, such as tracked changes, footnotes, headers and advanced page layouts, may be simplified or omitted. Review the compatibility notice when opening those documents, and keep your originals. The editing page view is not an exact preview of every export layout.

Codex has been tested with real writing requests. Claude Code integration has automated coverage, but a live Claude Code response and installation/sign-in on a completely fresh PC still need wider testing. AI availability and output depend on your account and chosen model.

## Help, ideas and feedback

Read the **[user guide](docs/USER-GUIDE.md)** for more detail, or **[troubleshooting](docs/TROUBLESHOOTING.md)** if setup gets stuck.

**[Ask for help or report a problem](https://github.com/LEC1224/WRAITER/issues/new/choose)** · **[Suggest an improvement](https://github.com/LEC1224/WRAITER/issues/new?template=feature_request.yml)**

You do not have to be a programmer to help. Tell us where an instruction was confusing, which step you expected next, or what got in the way of writing. Screenshots with sample text are welcome. GitHub issues are public, so please leave out private manuscripts, account details and keys.

---

## For contributors

Contributions are welcome, including clearer wording, accessibility improvements, Windows testing, documentation and code. The priority is a writing experience that someone without technical knowledge can understand and trust.

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for the workflow, test guidance and suggested areas to help. For a larger change, open an issue first so we can agree on the user experience and scope.

### Run from source

Use **Node.js 24 LTS**, npm and Git on Windows. Dependency versions are recorded in `package-lock.json`.

```powershell
git clone https://github.com/LEC1224/WRAITER.git
cd WRAITER
npm ci
npm run build
npm start
```

Rebuild after changing the renderer. `npm run dev` serves the browser UI only; native files, menus and AI connections require the Electron application. Source builds normally use WRAITER's regular application data. For a separate development profile, set `$env:WRAITER_USER_DATA` to an absolute scratch-folder path before `npm start`.

### How the application fits together

| Location | Responsibility |
| --- | --- |
| `src/` | React interface, TipTap editor, inline previews, walkthrough, formatting and exports |
| `electron/main.cjs`, `electron/preload.cjs` | Desktop lifecycle and the bridge between the interface and native operations |
| `electron/providers.cjs`, `electron/*-bridge.cjs` | AI requests, saved-account connections and provider responses |
| `electron/setup.cjs`, `build/installer.nsh` | AI setup and the assisted Windows installer |
| `electron/workspace-session.cjs`, `document-files.cjs`, `edit-journal.cjs` | Project tabs, native saves, recovery and persistent undo |
| `electron/writing-agent.cjs` | Bounded document tools and validated assistant edit batches |
| `electron/proofreading.cjs`, `src/proofreading.js` | Bounded proofreading prompts, exact-range findings and formatting-preserving fixes |
| `src/tutorial.js`, `src/WritingWalkthrough.jsx` | Practice manuscript, lessons and progress driven by editor actions |
| `tests/` | Unit checks, synthetic document fixtures and Electron workflow tests |

The renderer uses an isolated preload bridge. AI edits are validated against the document state before application; the assistant's document tools cannot run shell commands or operate arbitrary files. Keep privacy boundaries and recovery behaviour intact when extending the app.

### Test and package

```powershell
npm test
npm run build
npm run test:onboarding
npm run test:tutorial
npm run test:proofreading
npm run test:settings
npm run package
```

Unit tests and these desktop suites use synthetic data and local test services. Run desktop suites sequentially. Packaging produces the Windows x64 installer and portable executable under `release/`. Desktop tests accept `WRAITER_EXECUTABLE` to exercise a packaged build.

**Live tests are opt-in:** `npm run test:tutorial:live` sends two requests through your saved Codex account and uses its allowance. It is not part of CI. See the contributor guide for local-model, PDF and office-format test prerequisites.

The [validation report](TEST-REPORT.md) records checks and remaining limitations. [0.16.0 release notes](docs/releases/v0.16.0.md) describe the current version; [0.13.0 release notes](docs/releases/v0.13.0.md) cover the previous public release. CI runs unit tests and the frontend build on Windows; it does not sign executables or validate paid-provider accounts.

## License and acknowledgements

WRAITER is released under the **[MIT license](LICENSE)**. Its name and this repository do not imply endorsement by OpenAI, Anthropic or any other provider.

WRAITER uses Electron, React, TipTap/ProseMirror and other community projects. Their notices are collected in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md); the Windows distribution also includes Electron and Chromium notices. Optional AI helpers, runtimes and downloaded models retain their own licenses and terms.
