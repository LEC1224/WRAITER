# Contributing to WRAITER

Useful contributions include testing the installer, explaining a confusing screen, improving accessibility, fixing bugs, writing documentation and adding carefully scoped features.

## Start with the writer's experience

- Use plain language and explain what an action will do before asking the writer to act.
- Keep common choices easy to find. Put specialist settings in the advanced path.
- Teach through the real interface, with real results and clear recovery from errors.
- Keep writers in control of AI requests, acceptance, cancellation and undo.
- Preserve manuscripts, private notes, source files and existing preferences.
- Make keyboard navigation, readable contrast and the minimum window size part of the design.

## Report a problem or propose a change

[Open an issue](https://github.com/LEC1224/WRAITER/issues/new/choose). Describe what you wanted to do, what happened, and what you expected. Include your WRAITER version and Windows version if possible. A small made-up example is more useful than a private manuscript.

Please discuss major features or architectural changes before implementing them. Small fixes and documentation improvements can go straight to a pull request.

Do not post credentials, account exports, personal documents or application-data folders. For a suspected security vulnerability, follow [SECURITY.md](SECURITY.md).

## Set up a development copy

Fork the repository and clone your fork. Install Node.js 24 LTS, npm and Git on Windows, then run:

```powershell
npm ci
npm run build
$env:WRAITER_USER_DATA = Join-Path $PWD 'tmp/dev-profile'
npm start
```

The separate profile keeps development drafts and settings away from your regular WRAITER installation. Cloud providers may still discover their own saved account credentials; use the local test services for routine development. Never copy your account files into the repository.

The frontend is React with TipTap/ProseMirror. Electron's main process handles native operations through the preload bridge. Rebuild the frontend before launching Electron after a renderer change. `npm run dev` alone does not provide native desktop features.

## Validate your change

Run `npm test` and `npm run build`, then the workflow tests relevant to your change. Desktop tests open isolated WRAITER windows; run them one at a time.

| Area changed | Relevant command |
| --- | --- |
| Installer guide or AI setup | `npm run test:onboarding` |
| Store packaging, privacy or AI reporting | `npm test`, `npm run package:store`, `npm run verify:store -- <MSIX path>` and `npm run test:store` with the Store `WRAITER_EXECUTABLE` |
| Interactive tutorial or inline AI | `npm run test:tutorial` and `npm run test:continuation` |
| Settings, themes or hotkeys | `npm run test:settings` |
| Diagnostic logs and retention | `npm run test:logging` |
| Selection descriptions, vibe guidance or phrase ratings | `npm run test:rephrase-vibe` |
| Translation, correction or rephrasing suggestion targets | `npm run test:suggestion-counts` |
| Native menus, IPC or provider routing | `npm run test:desktop` |
| Editor right-click menu and its selection, formatting or AI actions | `npm run test:context-menu` |
| General editor workflows | `npm run test:app` |
| Toolbar formatting, highlight colours or their theme contrast | `npm run test:formatting` |
| Whole-manuscript search, anchored comments or format copy/paste | `npm run test:revision-tools` |
| Assistant document tools, change reports or reverting edits | `npm run test:editorial` |
| Project tabs and startup | `npm run test:v06` |
| Explorer file opening and single-instance handling | `npm run test:file-open` |
| Windows installer file associations and installation/launch/uninstall | `npm run test:installer` and `npm run test:installer-package` |
| Pagination and rephrasing alternatives | `npm run test:v05` |
| Long-document scrolling and responsiveness | `npm run test:scrolling`, `npm run test:large` and `npm run test:undo-scroll` |
| Paragraph navigation and dialog keyboard focus | `npm run test:navigation` |
| Sustained large-manuscript save, undo, navigation and restart | `npm run test:soak -- --minutes=45`; add `--format=odt` for actual office saveback |
| Find highlights beyond the display limit | `npm run test:large-search` |
| Find result paging and replacement previews | `npm run test:search-panel` and `npm run test:large-search` |
| Font search, keyboard focus or popup placement | `npm run test:font-picker`, `npm run test:font-picker-desktop`, `npm run test:settings` and `npm run test:app` |
| External file reload and margin numbering | `npm run test:reload-numbering` and `npm run test:long-numbering` |
| Proofreading review, statistics or spelling tools | `npm run test:proofreading` |
| Save/import/export | `npm run test:io` and `npm run test:v03` |
| Native encoding failures and recovery | `npm run test:native-save-errors` |
| Windows replacement locks and durable snapshots | `npm run test:windows-locks` |
| Clipboard export | `npm run test:clipboard` |
| Image drop, clipboard image paste or image insertion | `npm run test:images` |
| Image controls, Find focus/keys, chapter/tab gestures, links, document/reference drops or zoom | `npm run test:ux` |
| Persistent undo and recovery | `npm run test:history-recovery` and `npm run test:crash-recovery` |
| Local-model interface | `npm run test:v04` |

Use synthetic manuscripts in tests. Do not weaken validation, replace production AI with canned tutorial output, or send real manuscripts to providers in automated checks. Add a focused regression test for a consequential bug or new behaviour; documentation-only changes do not need new tests.

`npm run test:pdf` also needs Python with PyMuPDF. `npm run test:office` needs LibreOffice for independent format validation. See the test scripts for environment-specific prerequisites.

`npm run test:installer` uses the cached electron-builder NSIS compiler (or `WRAITER_MAKENSIS`) and exercises the real wizard and registry macros in a private test registry subtree. It does not change your Windows file associations.

`npm run test:installer-package` builds and runs a complete NSIS installer with a synthetic launch probe and private installation/association registry keys. Run it from an ordinary user session on a Windows desktop. It checks installation and reinstallation into a path with spaces and Swedish characters, the real post-install launch without administrator rights, and the generated uninstaller. It leaves the installed WRAITER app and its profiles alone. Its unsigned test payload does not validate acceptance by Smart App Control or third-party antivirus.

The following tests are deliberately outside the default suite and CI:

- `npm run test:tutorial:live` uses the saved Codex account for two real AI requests. Only run it when you intend to use that account's allowance. It uses a synthetic tutorial and isolated WRAITER profile.
- `npm run test:local-live` requires installed Ollama and the downloaded `llama3.2:1b` model. It copies model data into isolated test storage, so allow extra disk space. `WRAITER_TEST_RUNTIME_ROOT` can point at a portable runtime to exercise that path.

For visual changes, check the actual application at its 960 × 650 minimum window size and at a comfortable larger size. Include a screenshot with sample text when it helps a reviewer.

## Make a pull request

Keep the change focused. Explain the user-visible problem, the resulting behaviour, how you checked it, and any remaining limitation. Include the issue number when one exists. Update the user guide if controls or behaviour change.

Do not commit `node_modules/`, builds, release executables, generated test output, personal application data or secrets. Dependency updates should include the lockfile. If a bundled dependency changes, regenerate its notices with `npm run notices` and include the resulting file.

Contributions are made under the project's [MIT license](LICENSE). Retain existing copyright notices and include required notices for third-party work.

## Build a Windows release

```powershell
npm run package
$projectVersion = (Get-Content .\package.json -Raw | ConvertFrom-Json).version
$env:WRAITER_EXECUTABLE = Join-Path $PWD "release/signed/v$projectVersion/win-unpacked/WRAITER.exe"
npm run test:onboarding
npm run test:tutorial
Remove-Item Env:WRAITER_EXECUTABLE
```

`npm run package` builds a signed assisted NSIS installer and portable executable for Windows x64 only after a signing identity is configured. It requires signing, verifies valid timestamped signatures on the distribution executables and runtime PE files, and writes checksums after successful verification. It never publishes. `npm run package:preview` explicitly creates unsigned local builds in a separate directory. See [Windows distribution and signing](docs/WINDOWS-DISTRIBUTION.md) for configuration and the remaining signing-provider enrollment step. Verify the exact packaged app on a clean Windows machine, update release notes and validation results, and publish the verified files with their checksums. Publishing GitHub releases is a maintainer action; opening a pull request does not publish an installer.

`npm run package:store` is the separate Microsoft Store route: an unsigned MSIX with exact public Partner Center identifiers, packed and validated by the installed Windows SDK. It does not use personal Authenticode credentials or change Windows certificate/security settings. `npm run test:store` needs `WRAITER_EXECUTABLE` set to its `win-unpacked/WRAITER.exe`; it uses an isolated profile with Git unavailable, synthetic writing and captured external links. It does not register/install the MSIX, send reports or call a live provider. See [Microsoft Store preparation](docs/MICROSOFT-STORE.md) for remaining registered-package, WACK, reviewer and owner steps.

Regenerate logos with `npm run store:assets` and screenshots with `npm run store:screenshots`. These use installed Microsoft Edge and the actual Store runtime respectively. Source screenshots contain only the app's synthetic sample and no fake AI results.
