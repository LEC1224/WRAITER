# WRAITER Microsoft Store submission

Updated 4 November 2026. WRAITER is reserved in Partner Center as an **MSIX/PWA app**. Version **0.17.0** is live in the Store. **Submission 2** is a draft for application **0.20.2**, Store package **1.20.2.0**; its reviewer notes are saved, but the new MSIX has not been uploaded or submitted. The package below uses the exact publisher identity. Registered Store-installation and Windows App Certification Kit checks remain outstanding for this update. Existing pricing and audience settings were not changed.

## Files ready to use

| Item | Location |
| --- | --- |
| Upload package | `release/store/v0.20.2/WRAITER-0.20.2-Store-x64.msix` |
| Package validation and SHA-256 | `release/store/v0.20.2/STORE-PACKAGE-RESULTS.json` |
| SDK packaging/validation log | `release/store/v0.20.2/MAKEAPPX.log` |
| Listing text and reviewer instructions | [store/LISTING.md](store/LISTING.md) |
| Four real app screenshots and 300 × 300 tile | [store/images/](store/images/) |
| Privacy policy, also accessible inside the app | [PRIVACY.md](PRIVACY.md) |
| Exact public package identifiers | [../build/store-identity.json](../build/store-identity.json) |

This unsigned MSIX is intended for **Partner Center upload**. Microsoft supplies Store signing; a commercial code-signing certificate is not needed for this route. Downloaded EXE installers are a separate distribution route. Sending this unsigned MSIX directly to a friend does not supply Windows trust. [Microsoft packaging and signing guidance](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements).

## What the owner needs to do

1. Finish any outstanding account verification. Set the initial release's **Base price to Free**, with no paid market overrides or scheduled paid price changes. Tax/payout setup can wait until paid sales are enabled; it is not required for a free app with no in-app purchases. [Microsoft payout requirements](https://learn.microsoft.com/en-us/partner-center/account-settings/set-up-your-payout-account).
2. Enter the published privacy URL **https://github.com/LEC1224/WRAITER/blob/main/docs/PRIVACY.md** in Partner Center. The policy was published to `main` on 15 October 2026 and verified accessible without signing in, with contents identical to `docs/PRIVACY.md`. A custom domain is unnecessary.
3. Open draft **Submission 2**, upload the **0.20.2** `.msix` above and wait for package validation. Check that the new **1.20.2.0** package is selected before submitting. The earlier 0.17.0 release remains live. Future package changes need a new version; a pricing or listing change alone does not require rebuilding the MSIX.
4. Complete **Properties**, **Age ratings**, **Store listings**, **Pricing and availability** and **Submission options** using the prepared listing. Declare optional live generative AI accurately. Enter support email **carl.1224@outlook.com**, website **https://github.com/LEC1224**, support URL **https://github.com/LEC1224/WRAITER/issues**, and the live privacy URL.
5. For initial installation testing, a **Private audience** containing your own and your friend's personal Microsoft accounts is recommended. Use its private link after approval. At the chosen **Free** price, testers are not charged. The current audience was not visible in the certification overview and has not been changed by this work. [Microsoft private-audience guidance](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/visibility-options).
6. The reviewer notes and capability explanation are in the listing file. After approval, install through the Store on a clean consumer PC, perform the checks below and run WACK. Resolve failures before broader distribution. Once a product has been submitted as Public, Microsoft does not allow switching it back to Private. [Visibility rules](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/visibility-options).

The privacy policy is published on GitHub. Source, listing assets and the unsigned MSIX are also included with the GitHub 0.20.2 release. GitHub publication does not upload or submit a Partner Center draft.

## Price and product settings

- Launch with **Base price: Free** in every selected market, with no subscription, in-app purchases or scheduled paid price changes. Paid pricing is deferred until future features justify it; no later paid price or launch date is committed. Microsoft supports later base-price changes and market overrides. [Pricing and overrides](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/schedule-pricing-changes).
- Leave **Free trial** disabled for the first release. WRAITER has no implemented trial-expiry interface.
- WRAITER is initially free. Cloud AI accounts, subscriptions, API charges and model access are separate. Do not imply that the app includes unlimited AI or provider credits.
- Before enabling paid sales later, complete tax/payout setup and review Microsoft's commerce terms. A later acquisition price is not a charge for users who already acquired the app; plan future monetization around existing Store licenses.
- Suggested category: **Productivity**. Interface/listing language: **English (United States)**. Target **Windows desktop x64**, Windows 10 build 19041 or later / Windows 11. Do not claim ARM, mobile, Xbox, macOS or Linux packages.
- Complete the age-rating questionnaire based on the product's actual behavior, including optional AI. Private manuscripts are not a public sharing service; do not invent a rating or suppress the AI disclosure.
- WRAITER currently remains MIT-licensed with public source. The free-launch decision does not change its license or repository visibility; any later proprietary release needs a separate licensing decision.

## AI disclosure and reporting

The setup guide explains manuscript/reference sharing before AI is enabled. Core writing, saving and exporting work with AI off. Store helper installation buttons open official provider guides. **Help → Privacy and AI data** explains processing and **Help → Report an AI concern** opens private email or a public issue form without attaching writing.

Microsoft's published policy version 7.20 takes effect **22 October 2026**. Its live-AI section requires disclosure in metadata/submission, compliant output and a reporting path. Report handling remains the publisher's responsibility: monitor the support inbox and issues, investigate using synthetic reproductions, review the involved provider/model and take appropriate action, including app fixes, provider configuration changes or disabling an affected integration if necessary. The reporting UI does not establish that every possible provider/model output complies. Review the applicable policy when submitting, including any restrictions on your chosen AI services. [Store AI policy](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies#1116-live-generative-ai-content).

Do not provide personal provider credentials to reviewers. The listing includes a local-model route to test optional AI without a cloud account. If reviewers require a cloud demo, arrange a provider-permitted test account or limited test API access specifically for review and put those details only in the private certification notes.

## Check the actual Store installation

Use a spare PC or an isolated Windows test account with no earlier WRAITER installation. Save real writing outside the test first. These checks concern the Store-installed package, not `win-unpacked/WRAITER.exe`:

- Install and launch from the Store and Start menu using an ordinary Windows account. Confirm **WRAITER 0.20.2**, Store package **1.20.2.0**, and the privacy/reporting menus after this update is approved.
- Choose **Set up later**, end the walkthrough, write a made-up manuscript, save it to a named file, close and reopen. Writing, undo, recovery, import and export should work without AI accounts or Git.
- Double-click a `.wraiter` file in a path containing spaces and Swedish characters. Confirm it opens in the running app, including when setup or Settings is open. Set the Windows default app through **Open with** if needed; the manifest does not force the user's default choice.
- Test DOCX/ODT import and saveback with ordinary sample documents, then PDF/EPUB export. Check both a 960 × 650 app window and a larger window.
- Test the real provider setup and sign-in you intend to recommend. Ask for a short synthetic suggestion, accept/dismiss it and undo. Also verify private notes/comments are excluded and the AI-off state makes no writing requests. Test local-model management if advertising it.
- Test Store update delivery using a later package version. Named manuscript files must survive updates. Windows reset/uninstall may remove private settings, recovery and unnamed drafts; check this using disposable data.
- Run the installed **Windows App Certification Kit** against the registered WRAITER package. Retain its report, investigate failures and repeat only after relevant fixes. [WACK instructions](https://learn.microsoft.com/en-us/windows/uwp/debug-test-perf/windows-app-certification-kit).

No Windows security settings, certificate trust stores or real WRAITER profiles were changed to obtain a test install. The private Store route supplies the signed package needed for these remaining checks.

## Build and verify another package

Prerequisites: the repository's Node/npm dependencies and a Windows SDK with **MakeAppx.exe**. The build selects the newest installed x64 SDK tool. `WRAITER_MAKEAPPX` can specify an absolute SDK tool path. `npm run store:assets` regenerates logos using installed Microsoft Edge; ordinary builds use the checked-in PNGs.

```powershell
npm ci
npm run package:store
$projectVersion = (Get-Content .\package.json -Raw | ConvertFrom-Json).version
$storePackage = Join-Path $PWD "release/store/v$projectVersion/WRAITER-$projectVersion-Store-x64.msix"
npm run verify:store -- $storePackage
$env:WRAITER_EXECUTABLE = Join-Path $PWD "release/store/v$projectVersion/win-unpacked/WRAITER.exe"
npm run test:store
npm run test:onboarding
npm run test:file-open
Remove-Item Env:WRAITER_EXECUTABLE
```

`npm run package:store` rebuilds the frontend, packs the application without Authenticode signing, stages a fresh MSIX layout, validates/packs it using Microsoft's native SDK and checks the exact embedded manifest, runtime metadata, privacy/reporting text, archive CRCs, required files and branded PNG dimensions. It writes SHA-256 in the validation report and never publishes. `--identity C:\path\identity.json` or `WRAITER_STORE_IDENTITY` overrides the checked-in public identity; preview/example identifiers are rejected for real submissions.

`npm run package:store:preview` uses a separate synthetic identity and `release/store-preview/v<version>/`. It is for development, cannot be submitted as this reserved product, and also remains unsigned. Direct Windows releases still use their separate signed/unsigned-preview commands.

### Identity and version mapping

| Manifest value | Partner Center value |
| --- | --- |
| Package/Identity/Name | `LEC1224.WRAITER` |
| Package/Identity/Publisher | `CN=0F8F5317-D963-40BC-AA83-A870AC9737A9` |
| Package/Properties/PublisherDisplayName | `LEC1224` |
| Application Id | `WRAITER` |

Microsoft requires a positive major version and a fourth component of zero for Store uploads. WRAITER maps application **a.b.c** to Store **(a + 1).b.c.0**: 0.20.2 → 1.20.2.0, 0.20.3 → 1.20.3.0, and 1.0.0 → 2.0.0.0. Increment the application version before uploading a changed package after an earlier submission; do not reuse a version already ingested by the Store. Each component must fit in 16 bits. [Version requirements](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements).

The manifest requests only `runFullTrust`, declares `.wraiter` activation with a quoted filename parameter, and uses the existing WRAITER logo. It declares no administrator, autostart or unrestricted AppData capabilities. Files and settings use the existing user-data path, which Windows virtualizes under MSIX; the app does not write to its installation directory. Registered package activation, virtualization, reset/uninstall and updates remain part of the Store-install checks above.
