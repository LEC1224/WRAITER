# Windows distribution and signing

The public 0.17.0 installer and portable app are unsigned. Their GitHub asset digests match the local release files. Windows can block an unsigned download or a program extracted during installation, even when the installer is run as administrator. The generic “Windows cannot access the specified device, path, or file” message alone does not identify which Windows policy or antivirus action caused a block.

A reported installation failure on 15 October 2026 names the downloaded installer. No event log from that machine is available yet, so a Windows trust/security block remains the leading hypothesis, not a confirmed diagnosis. Signing does not override an antivirus malware verdict or an administrator's application-control policy, and a new signed publisher can still receive a SmartScreen reputation warning.

Microsoft documents [Smart App Control's trust requirements](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/overview) and [trusted code signing](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/code-signing-for-smart-app-control). A self-signed development certificate does not supply public Windows trust.

For the planned paid Microsoft Store edition, use the separate [MSIX build and submission checklist](MICROSOFT-STORE.md). Microsoft provides signing for Store-distributed MSIX packages. The direct EXE release commands below still require their own trusted Windows signing identity.

## Post-install launch repair

The full installer regression test reproduced a separate launch failure: with a Start menu shortcut present, the stock post-install shell launch failed to start the installed probe. Without that shortcut, direct executable launch succeeded. WRAITER's custom install macro now selects the installed executable as the launch target for both the Finish-page action and silent `--force-run`; the normal Start menu and desktop shortcuts are still created. The same test then passed installation, reinstallation, non-elevated launch and uninstall with a Start menu shortcut present.

This repairs a reproducible installer problem, but it does not establish the cause of the screenshot from another PC. Its error names the downloaded installer, and no logs from that machine are available.

## Build a signed release

`npm run package` now requires an explicitly configured Windows signing identity before rebuilding or packaging. It enables `forceCodeSigning`, signs executable and DLL files, and packages the app, uninstaller, installer and portable executable. After packaging, Windows must report valid, timestamped Authenticode signatures for both distribution executables and every executable/DLL in `win-unpacked`. Verification also writes `WINDOWS-SIGNATURES.json`. Only a successful signed build writes new SHA-256 checksums.

Default output is `release/signed/v<version>/`. The command never publishes to GitHub. Preserve existing release artifacts and publish a separately versioned, verified release after testing its exact signed installer on a clean Windows machine.

For a Windows code-signing certificate, use electron-builder's `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` environment variables, or provide `win.signtoolOptions.certificateSha1` in a local signing configuration. Keep private certificates, passwords and account credentials outside the repository.

For [Microsoft Artifact Signing](https://learn.microsoft.com/en-us/azure/artifact-signing/), copy [the Azure signing example](../build/windows-signing-azure.example.json) to a file outside the repository, replace the account/profile/publisher fields with an identity-validated **Public Trust** profile, and configure `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET` using [Azure's environment credential instructions](https://learn.microsoft.com/en-us/dotnet/api/azure.identity.environmentcredential). Set `WRAITER_SIGNING_CONFIG` to that JSON file, then run:

```powershell
$env:WRAITER_SIGNING_CONFIG = 'C:\path\outside-the-repository\windows-signing.json'
npm run package
```

Obtaining the signing identity requires the owner's signing-provider account, identity verification and any applicable payment. Neither the project nor its build scripts create an identity, enroll in a paid service, change certificate trust stores, or disable Windows protection.

Microsoft's [Basic plan](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-change-sku) lists USD $9.99/month. Its [Public Trust eligibility](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart#prerequisites) includes EU organizations, but individual developers must be located in the United States or Canada. A Swedish developer therefore needs an eligible verified business for this route, or a different signing provider. Complete identity validation and grant the signing identity access to the certificate profile before running the build.

[SignPath Foundation](https://signpath.org/) also offers free signing for eligible open-source projects. Its [conditions](https://signpath.org/terms) require approval and verifiable project reputation and exclude commercial dual licensing. Eligibility is not guaranteed; its signing integration must be configured separately.

## Local unsigned previews

Use `npm run package:preview` deliberately for development. Its output is separate: `release/unsigned-preview/v<version>/`. It disables signing even if a signing provider is configured. It remains unsuitable as a general solution for PCs enforcing signature or reputation checks.

To inspect a build independently:

```powershell
npm run verify:windows-release -- release/signed/v0.17.0
```

## Installer checks and their limits

- `npm run test:installer` checks the production NSIS pages and association/upgrade logic in a private registry.
- `npm run test:installer-package` builds a full NSIS package using the real custom installer with a small synthetic executable. It installs into an isolated path containing spaces and Swedish characters, checks associations in a private registry, reinstalls, exercises the actual post-install launch, and runs its generated uninstaller. It does not use the installed WRAITER app, personal profiles or manuscripts.
- The synthetic package is deliberately unsigned and uses a distinct app identity. Passing here does not prove that a fresh PC with Smart App Control or another antivirus will accept the public installer.
- Before distribution, test the **exact signed release artifact** on a clean Windows machine with ordinary protections enabled. Check installation, first launch, sign-in, saving, upgrade and uninstall. Retest after rebuilding or signing; those operations change the artifact hash.

If a tester still sees the generic Windows error, collect Windows Security's Protection history and relevant Code Integrity/Defender events around the attempt, plus the exact downloaded file's SHA-256 hash. Check whether WRAITER's installer pages were reached at all. Do not ask the tester to disable antivirus, Smart App Control, or system-wide application-control policy.
