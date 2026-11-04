# Getting unstuck

## Double-clicking a .wraiter file does not open it

The Microsoft Store edition declares `.wraiter` file opening in its package. If Windows asks for an app or retains another default, choose **Open with → Choose another app → WRAITER**. The Store package respects your default-app choice.

Install WRAITER 0.14.2 or later and leave **Associate .wraiter files with WRAITER** checked in the installer. This registers the document icon and the command Windows uses to open the file. If Windows retains a default app you previously selected, right-click the file, choose **Open with → Choose another app**, select **WRAITER**, and choose **Always**. Windows keeps the final default-app choice under your control.

If WRAITER is showing setup or another dialog, close or finish it first; the requested manuscript waits until the editor is available. The portable application can open files passed to its executable, but does not install a Windows file association.

## Which download should I open?

For the Microsoft Store edition, install from its approved Store listing. A locally built unsigned `.msix` is intended for Partner Center upload; it is not a trusted direct download for another PC. See [Microsoft Store preparation](MICROSOFT-STORE.md) for the current submission status and owner steps.

Choose **WRAITER-0.17.0-Setup.exe** from the [release page](https://github.com/LEC1224/WRAITER/releases/latest). It is the guided Windows installer. The file ending in **Windows.exe** is the portable version. GitHub's **Source code** archives contain development files, not an installed application.

This release is for Windows on a 64-bit Intel or AMD computer. It has not been packaged for macOS, Linux or Windows on ARM.

## Windows says the publisher is unknown

The current preview has not been digitally signed. Windows can therefore show an unknown-publisher or reputation warning. Confirm that your download came from the official [LEC1224/WRAITER releases](https://github.com/LEC1224/WRAITER/releases). A workplace or school device may require its administrator to allow new software. You do not need to disable antivirus protection to use WRAITER.

## Windows cannot access the specified device, path, or file

This Windows message can mean a blocked executable, a missing file, or a file-access problem. The current 0.17.0 preview is unsigned, and some Windows security configurations refuse unsigned downloads or files extracted by an installer. Running as administrator does not bypass every security policy.

If this happens, [report the installation failure](https://github.com/LEC1224/WRAITER/issues/new/choose) with the WRAITER version, Windows version, and whether you reached WRAITER's own Simple/Advanced and installation-folder pages. If **Windows Security → Protection history** lists WRAITER, include the block's name and affected filename without personal information. A managed work or school device may need its administrator's help. Keep Windows protection enabled; a signed release is the intended distribution solution for signature-related blocks.

## The AI setup cannot find my account

Open **Help → Set up AI**. Choose the provider you want and select **Check my account**. If the helper application is missing, use the guide's install action. If sign-in is missing, follow the provider's sign-in prompts, return to WRAITER, and check again.

In the Store edition, **Get Codex / Get Claude Code** opens the official setup guide in your browser. Install using that guide, then return to **Check my account**. AI subscriptions and usage are separate from the app purchase.

Claude Code sign-in may open a separate command window as well as your browser. Complete that flow before checking again. You should enter passwords only in the provider's own sign-in flow.

You need an eligible account with available usage. A successful browser login alone does not confirm that a particular model can generate text; **Run writing test** checks that. If an installation was interrupted, retry it while connected to the internet. You can also choose **Set up later** and continue writing.

## The writing test or a tutorial request fails

Read the error shown in WRAITER. Check your internet connection, account access and remaining provider allowance. In Advanced setup, check that the selected model is available to your account. Try the short writing test again once the underlying issue is resolved.

The tutorial uses your actual AI connection. It cannot invent a successful result while a provider is unavailable. You can pause the tour, fix the connection through **Help → Set up AI**, and return through **Help → Writing tutorial**.

## Tab does not produce a suggestion

Click inside the manuscript and place the cursor after some text. Check that AI is enabled in the toolbar. With no selection, **Tab** requests a continuation; with text selected, it requests alternatives. If a suggestion is already showing, Tab accepts it instead.

If you changed shortcuts, open **Settings → Keyboard shortcuts** to check the active bindings. For just the next suggested word, use **Ctrl + Right arrow** by default. **Esc** cancels a request or dismisses a preview.

## Where did my original manuscript go during the tutorial?

It remains in its own project tab. The tutorial uses a separate practice manuscript. Switch to your original tab whenever you like; the guide pauses its work in the practice document. **Return to walkthrough** takes you back. **End tour** stops the guide without deleting the practice story.

## My Word or LibreOffice document looks different

WRAITER supports common text and formatting, but complex office features may be simplified. Read the compatibility notice before saving changes. Keep the original and compare an export if advanced formatting matters. Use the WRAITER format when you want to retain WRAITER's full project structure.

The complete original is preserved in application data before the first reviewed native-format save; a preceding-save `.bak` is also kept beside the document. These are recovery aids, not a substitute for your own backups. See [the user guide](USER-GUIDE.md#formats-and-present-limits).

## Where are my drafts and settings?

Files you name and save go to the folder you choose. Recovery drafts, settings and local editing history stay in WRAITER's Windows user profile, normally `%APPDATA%\WRAITER`. The portable app uses a user profile too; it is not a completely self-contained folder that carries all settings and history to another computer.

Do not delete or post that folder while troubleshooting. It may contain private writing and connection settings. Saving a manuscript does not create an online backup.

## Checkpoints say Git is missing

Git is an optional tool for named version checkpoints. You can still save, use recovery, and undo or redo edits without it. It is not required to get started with WRAITER.

## Where can I find diagnostic logs?

Open **Settings → Logging → Open log folder**. WRAITER saves local activity and error logs, normally under `%APPDATA%\WRAITER\Logs`. Match the time of the problem to the timestamped entries. Logs include settings changes, panels/windows, document operations, error source locations and detected renderer crashes, while excluding typing and private writing. A `previous-session-interrupted` entry means the last session did not finish normally; it cannot distinguish a crash from a power loss or forced close.

Automatic cleanup keeps one calendar month by default. In **Settings → Logging**, change the retention to 1–24 months or turn **Automatically delete old logs** off, then apply/save. If you want to keep evidence for longer, copy the relevant log files elsewhere before they expire. Logs are stored locally and are not sent with a bug report automatically.

## I still need help

[Open a help request or bug report](https://github.com/LEC1224/WRAITER/issues/new/choose). Include the app version, Windows version, what you clicked, and the error message. You do not need technical vocabulary. Use a made-up sentence if an example helps, and remove private text and account details from screenshots.
