# WRAITER — Store listing draft

Copy the customer-facing fields below into the English (United States) listing. The reviewer notes and owner checklist are separate from the product description.

## Name

WRAITER

## Short description

Write and revise your stories with chapters, local documents and optional AI help you control.

## Description

AI assistance is optional and requires your own compatible AI account/helper, API access, or a separately downloaded local engine and model. Provider subscriptions, usage limits and charges apply; WRAITER includes no AI credits. Git is needed only for optional version checkpoints. Writing, ordinary saving, recovery and export work without an AI account or Git.

WRAITER is a desktop writing app for keeping your manuscript, chapters and revision tools together. Start with your own words, then ask for help when you want it.

Organize several manuscripts in tabs. Format passages, add private notes and comments, find and replace across chapters, and use focus mode when you want room to write. Save local WRAITER documents, work with Word and LibreOffice formats, and export PDF or EPUB for sharing.

When you connect AI, WRAITER uses live generative AI to offer continuations, alternative phrasings, translations, corrections and proofreading. Compare suggestions before accepting them, or ask the project assistant about your writing. Accepted edits can be undone. AI output can be wrong; you decide what belongs in your manuscript.

Choose Codex, Claude Code, API connections or local models. Give the assistant your writing-voice instructions and enabled references. Cloud requests send the relevant writing to your chosen provider. Private notes and passage comments are excluded from AI prompts, and assistant chats are excluded from manuscript exports.

The application stores manuscripts, preferences, conversations and recovery history on your computer. Save important drafts as named files and keep your own backups. Help → Privacy and AI data explains processing, and Help → Report an AI concern provides a way to contact the publisher about inappropriate output.

WRAITER is free to download for this initial release. AI subscriptions and credits are separate. Basic text revisions, plain-text footnotes/endnotes and page headers are supported; complex Word/LibreOffice formatting, fields and advanced page layouts may be simplified or omitted. Review the compatibility notice and keep your originals. This package supports Windows desktop on x64 Intel/AMD computers.

## Features

- Chapters, manuscript tabs, word counts and focus mode.
- Rich text formatting, images, links, tables and document layouts.
- Whole-manuscript find/replace and private passage comments.
- Tracked text review, footnotes/endnotes, named styles, templates and bookmarks.
- Saved page setup, PDF print preview and remembered export settings with Reset to defaults.
- Local recovery and editing history; optional Git version checkpoints.
- WRAITER, DOCX, ODT, Markdown, text and HTML documents; PDF/EPUB export.
- Optional AI continuations, rephrasing, translation, correction and proofreading.
- Optional AI grammar underlines with hover explanations and right-click corrections.
- Project assistant with writing-voice instructions and enabled references.
- AI off by default, suggestion previews, cancellation and undo.

## Search terms

writing; manuscript; novel; chapters; proofreading; text editor; AI writing

## Contact fields

| Field | Value |
| --- | --- |
| Publisher | LEC1224 |
| Support email | carl.1224@outlook.com |
| Product website | https://github.com/LEC1224 |
| Support URL | https://github.com/LEC1224/WRAITER/issues |
| Privacy URL | https://github.com/LEC1224/WRAITER/blob/main/docs/PRIVACY.md — published and verified publicly accessible on 15 October 2026 |

## Screenshots and captions

All screenshots show the actual packaged Store runtime with synthetic sample prose and no simulated AI results. Images are 1600 × 1000 PNG files. Upload them in this order:

| File | Caption |
| --- | --- |
| [images/01-writing.png](images/01-writing.png) | Keep chapters, formatting and your manuscript together. Write with AI turned off whenever you choose. |
| [images/02-notes-and-voice.png](images/02-notes-and-voice.png) | Keep private notes separate from the writing-voice instructions you share with your selected AI. |
| [images/03-optional-ai.png](images/03-optional-ai.png) | Connect your own AI account and review what information is shared before enabling assistance. |
| [images/04-privacy.png](images/04-privacy.png) | Read the privacy policy inside WRAITER and contact the publisher about AI-content concerns. |

Use [images/AppTile300.png](images/AppTile300.png) as the optional 300 × 300 app tile. The package also contains correctly sized WRAITER logos. [Microsoft image requirements](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/screenshots-and-images).

## What's new

Version 0.20.2 adds tracked text review, footnotes/endnotes, named styles, page setup, templates, bookmarks and local writing tools. Optional AI grammar hints offer hover explanations and right-click corrections. Export choices are remembered across exports and restarts, with Reset to defaults in the popup. Includes continuation/context improvements, local diagnostics with retention controls and an installer launch fix. Full changelist: https://github.com/LEC1224/WRAITER/releases/tag/v0.20.2

## Notes for certification — private reviewer field

WRAITER is an Electron desktop writing app, application version 0.20.2, MSIX version 1.20.2.0. The UI language is English. It has no WRAITER account, publisher server, subscription or in-app purchase. Ordinary writing, named saves, recovery, editing history, import and export are available without login. No sample personal manuscripts or credentials are included.

Basic test:

1. Launch WRAITER. Choose Set up later, then End walkthrough in the writing walkthrough. This leaves AI off.
2. Type a short sample, use File → Save to create a `.wraiter` file, close and reopen the app, and verify the text. Try another chapter, text formatting, find/replace and undo.
3. Open ordinary sample DOCX/ODT files and use File → Export for PDF or EPUB. Change export settings, close/reopen the popup and confirm they are remembered. Reset to defaults restores the starting choices. Advanced office features may be simplified; the import compatibility notice explains this.
4. Open a `.wraiter` file through Windows. The manifest declares the association, but the user's default-app choice is respected.
5. Open Help → Privacy and AI data and Help → Report an AI concern. Reporting opens the user's email app or an unsent public issue form, without including the manuscript.

Optional AI testing without a cloud login: open Settings → Local models, obtain the official Ollama engine if needed, download a small supported model such as `llama3.2:1b`, and assign it to Autocomplete in AI connections. Enable AI, put the cursor after a short synthetic sentence and choose Suggest/Tab. Accept/dismiss the preview and use Undo. Engine/model downloads require internet access, disk space and suitable hardware; they enhance the disclosed writing assistance and do not install a publisher service. Cloud helpers are optional alternatives, installed using their official external guides. Account eligibility and usage limits belong to the selected provider.

Git is required only for version checkpoints and the checkpoint tree. It is not bundled. Ordinary saving, recovery and persistent undo/editing history still work when Git is absent.

Live generative AI is present when users enable a provider. Metadata and setup disclose it and the data-sharing implications. Reporting goes to carl.1224@outlook.com; the publisher investigates reports. The app has no public manuscript feed or user-to-user sharing service. Please review provider-dependent behavior and contact us if cloud demo access is required rather than using a reviewer's own account allowance.

The installation is a self-contained x64 MSIX. Only the `runFullTrust` restricted capability is requested. It enables the existing desktop editor's native file dialogs and document access, Electron PDF printing, and launching user-selected writing-AI helpers/local engines. It does not request elevation, install a driver/service, force a default app or modify the user's Windows security settings. Documents and app-private settings are written to user storage, not the package directory. Windows owns installation, updates and removal.

## Capability justification — if Partner Center asks

WRAITER is an Electron/Win32 desktop editor packaged as MSIX. runFullTrust is required to run the app, open/save user-selected documents, import/export, print PDFs, and launch optional AI helpers, local inference and Git. It runs with normal user permissions and does not request administrator elevation or install drivers or Windows services.

Keep this capability in the manifest: it is required for the packaged full-trust desktop executable. It does not grant administrator rights. [Microsoft capability guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/app-capability-declarations).

## Owner review before submission

- The privacy URL is published and verified publicly accessible. Enter it and the actual support/contact fields above.
- Use Base price **Free**, check all market overrides and leave paid price schedules unset. Confirm accurate age ratings, live-AI disclosure and account verification. Payout/tax setup is deferred until paid sales.
- Version 0.17.0 is live. Submission 2 is a draft for 0.20.2/1.20.2.0, with reviewer notes saved but the new package not yet uploaded. These prepared fields do not automatically change the live Store description.
- Check that reviewer steps match the current UI and that a genuine AI route is testable on a clean PC. Provide approved test access if requested.
- Choose Private audience for initial Store installation testing; review [../MICROSOFT-STORE.md](../MICROSOFT-STORE.md) before submitting or switching to public sales.
- Source and these listing assets accompany the GitHub 0.20.2 release. Publishing on GitHub does not submit the Store update.
