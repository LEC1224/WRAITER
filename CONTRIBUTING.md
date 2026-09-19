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
| Interactive tutorial or inline AI | `npm run test:tutorial` |
| Settings, themes or hotkeys | `npm run test:settings` |
| Native menus, IPC or provider routing | `npm run test:desktop` |
| General editor workflows | `npm run test:app` |
| Project tabs and startup | `npm run test:v06` |
| Pagination and rephrasing alternatives | `npm run test:v05` |
| Proofreading review, statistics or spelling tools | `npm run test:proofreading` |
| Save/import/export | `npm run test:io` and `npm run test:v03` |
| Clipboard export | `npm run test:clipboard` |
| Persistent undo and recovery | `npm run test:history-recovery` |
| Local-model interface | `npm run test:v04` |

Use synthetic manuscripts in tests. Do not weaken validation, replace production AI with canned tutorial output, or send real manuscripts to providers in automated checks. Add a focused regression test for a consequential bug or new behaviour; documentation-only changes do not need new tests.

`npm run test:pdf` also needs Python with PyMuPDF. `npm run test:office` needs LibreOffice for independent format validation. See the test scripts for environment-specific prerequisites.

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
$env:WRAITER_EXECUTABLE = Join-Path $PWD 'release/win-unpacked/WRAITER.exe'
npm run test:onboarding
npm run test:tutorial
Remove-Item Env:WRAITER_EXECUTABLE
```

`npm run package` builds an assisted NSIS installer and a portable executable for Windows x64. Release builds are currently unsigned. Verify the packaged app, update release notes and validation results, and calculate SHA-256 hashes for the exact files to be uploaded. Publishing GitHub releases is a maintainer action; opening a pull request does not publish an installer.
