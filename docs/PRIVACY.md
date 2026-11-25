# WRAITER privacy and AI data

Updated: 11 November 2026.

This policy describes WRAITER's desktop application and the optional cloud beta introduced in version 0.21, published by LEC1224. For private support, privacy requests or AI-content concerns, contact [carl.1224@outlook.com](mailto:carl.1224@outlook.com). Source code and public support are available at [LEC1224/WRAITER](https://github.com/LEC1224/WRAITER); the publisher's profile is [LEC1224 on GitHub](https://github.com/LEC1224).

## Local manuscripts

Manuscripts, saved assistant conversations, preferences, reference links and recovery history in the desktop application are stored on your computer. Uploading a document through the optional Cloud library also stores a cloud copy as described below. WRAITER does not include advertising, analytics or a publisher telemetry service. Documents you save to a folder synchronized by OneDrive or another service are handled by that service separately.

Save important manuscripts as named files in a folder you control. Those files remain after uninstalling WRAITER. Windows may remove the Store app's private settings, recovery history and unnamed drafts when you uninstall or reset it. Local backups and Windows account/disk security are your responsibility.

## Optional cloud account and documents

The browser beta at [wraiter.lecani.se](https://wraiter.lecani.se) and the desktop Cloud library use a separate WRAITER email account. The publisher's server stores your email address, independently salted password hash, account settings and encrypted uploaded documents. Passwords are never stored as plaintext. Each account has a 1 GB quota, measured using the encrypted stored data. The desktop's uploads and updates are explicit; opening a cloud document makes a local copy rather than continuously synchronizing a desktop file.

Titles, manuscript content, notes, references, conversations and cloud editing history are encrypted on your device using AES-256-GCM before upload. From version 0.21.0-rc.4, signing in with your account password also opens your documents. The password wraps a random document key using PBKDF2-SHA-256 with 600,000 iterations and a random salt. The server stores the wrapped key and a separate salted scrypt authentication hash. The saved authentication hash cannot unwrap the document key. Your password is submitted over HTTPS for authentication; it is not logged or stored as plaintext. The unwrapped document key is not sent to the server.

The browser retains a browser-managed CryptoKey in IndexedDB, bound to your user, validated account session and vault descriptor, so reloading or opening another tab does not require an extra password prompt. Desktop sign-in can retain the document key inside operating-system-backed encrypted credential storage. Both clients validate the cloud session before restoring cached access. Signing out clears cached document access on that device. Protect the browser profile and Windows account on shared computers; cached keys are not protection against a compromised device or delivered application.

An account created under the earlier beta may need its separate document passphrase or saved recovery key once to connect its existing document key to the account password. This preserves the existing encrypted files. Password changes made in account settings rewrap that same key. A forgotten-password reset preserves the encrypted documents; it cannot decrypt them from server data alone. A trusted device that still has the key can preserve access through the reset. Otherwise the previous password, or an earlier saved recovery key when available, is required. The service never replaces an inaccessible library with a new key automatically.

Cloudflare handles the public HTTPS connection, and a transactional email provider delivers confirmation and password-reset messages from noreply@lecani.se. A scheduled backup copies cloud accounts, encrypted documents and settings to the publisher's other PC. Administrators can read account metadata, settings, document identifiers, sizes and timestamps, but stored encrypted document content requires the user's password or document key. Deleted data can remain in the current backup until its next successful replacement. Earlier plaintext beta documents are migrated when their owner opens the library; historical database pages, backups and storage snapshots can retain earlier plaintext and require separate maintenance. Users must trust the delivered web application and authentication service: an operator capable of changing them could capture secrets during use. Encryption protects stored files and backups rather than providing protection against a malicious operator changing the running service.

Browser AI uses the user's own supported cloud-provider API key. Provider API keys remain in browser-session memory, and requests go directly from the browser to the selected provider. Prompts, responses and provider API keys are not relayed through the manuscript server or saved in cloud settings or backups. The cloud service does not use the publisher's Codex allowance or run local generative models. English thesaurus lookup downloads a public dictionary and searches on the device. Desktop cloud-session credentials and cached document keys use operating-system-backed encryption.

The web library provides individual downloads, a ZIP of the whole library, document deletion and account deletion. Exports are decrypted local files: protect downloaded ZIPs and documents accordingly. ZIP archives contain desktop-compatible `.wraiter` documents and separate cloud history files. Browser recovery drafts are encrypted separately from cloud documents and can remain on that device after sign-out; earlier plaintext browser drafts are rewritten after successful unlock. Account deletion is available even when documents cannot be unlocked. See the [cloud privacy notice](https://wraiter.lecani.se/privacy.html) for browser recovery controls, cloud service details and deletion behavior.

## Local diagnostic logs

The Suggest dialog sends your description and WRAITER account email to the developer. If you select **Include recent logs and crash reports**, it also sends recent diagnostic records. Desktop attachments contain application logs and structured crash reports. The browser supplies error records from your current signed-in session. The service stores suggestions and attachments for review. Approved prompts and attachments go to the developer’s local Codex project and selected model. A transactional mail provider delivers new-suggestion notifications and decline explanations.

WRAITER keeps local diagnostic logs of settings changes, panels and windows opening or closing, explicit document/connection operations, operation timing, errors, and detected process crashes. Records include timestamps, a random app-session identifier, app/runtime versions and operating-system version. Typing, manuscript contents, chats, document names and paths, credentials and free-text setting values are excluded. Errors retain types, known codes and application source locations rather than raw messages or memory dumps.

Logs stay in the app's `Logs` folder and are not uploaded to the publisher or attached to reports automatically. **Settings → Logging → Open log folder** opens that folder. Automatic cleanup is on by default and deletes log files last written more than one calendar month ago. You can select 1–24 months or turn cleanup off. The app also keeps a small local marker to detect sessions that ended without a normal exit. Diagnostic cleanup does not delete manuscripts, settings, recovery files or editing history.

## Optional AI processing

You can write, save and export with AI turned off. When you enable and use cloud AI, WRAITER sends the text needed for the chosen task to your selected provider. This can include manuscript passages, writing-voice instructions, enabled reference content, recent messages from the selected assistant conversation, and instructions such as your requested writing vibe. The writing assistant can request relevant passages and references for an editing task. Private notes and passage comments are excluded from AI prompts; assistant conversations are excluded from manuscript exports.

Automatic suggestions and AI-generated checkpoint labels can make requests while AI is enabled. You can turn AI off, disable automatic suggestions, choose different task models or disable references in the app. The connection test sends a short sample sentence, not your manuscript. AI requests use your provider's account allowance or billing; buying WRAITER does not include an AI subscription or credits.

AI grammar hints while typing require a separate opt-in under Tools → Spelling and grammar → Spelling and grammar settings… and are off by default. When enabled alongside AI, a three-second typing pause can send the current paragraph (at most 4,000 characters) to the selected proofreading connection. These checks exclude chapter titles, private notes, comments, reference files, conversations and writing-voice instructions. Turning off AI or the grammar setting cancels pending checks. The separate bundled spelling and English and Swedish grammar checks run on your computer without sending text to a service. The English checker uses local trained components to recognize sentence structure. Words you add to your personal dictionary are saved locally.

Your provider controls its own processing, retention and use of data. Review its terms and privacy information before sharing writing or personal information:

- [OpenAI privacy policy](https://openai.com/policies/privacy-policy/)
- [Anthropic privacy policy](https://www.anthropic.com/legal/privacy)
- [Ollama privacy information](https://ollama.com/privacy)
- For a custom API endpoint or local server, review the operator's policy and configuration.

A local model selected in WRAITER processes requests through its local engine. WRAITER's local-model manager uses local-only models and does not send their prompts to a publisher service. Downloading an engine or model still connects to the engine/model download provider. A server you configure yourself may forward data elsewhere.

## Credentials and installation

Codex and Claude Code own their sign-in flows and saved accounts. WRAITER does not ask for their account passwords. API keys entered in WRAITER are encrypted with Electron's operating-system-backed credential storage before being written to preferences. They are used for the configured provider and are not included in manuscript exports. These protections do not secure a compromised Windows account or computer.

Store builds open the provider's official installation guide when you choose to get an AI helper. Other builds can download and run a provider's official installer after you choose Install. Optional local-engine and model downloads contact their documented providers. WRAITER bundles spelling dictionaries for English and several other languages and does not automatically download spelling dictionaries. Languages without a bundled dictionary rely on support and dictionaries already available to Windows or Chromium.

## Your controls and support

You can turn AI off, change providers, disable references, remove saved API keys in Connections, delete files you saved, or uninstall the app. Provider account data must be managed with that provider. To remove Store-managed local application data, use Windows Settings to reset or uninstall WRAITER after saving any drafts you want to keep. Reference files and manuscripts outside the app's data folder are not removed by a reset.

Use the email above for private requests. Help → Report an AI concern opens contact choices; WRAITER does not attach or upload your manuscript automatically. Share only the information you choose to include. Email reports are used to investigate and respond to the concern; the mail provider processes them under its own policies. [GitHub issues](https://github.com/LEC1224/WRAITER/issues) are public: do not post manuscripts, passwords, API keys or personal documents there. Windows and Microsoft Store may collect their own diagnostic, account, purchase and deployment information under Microsoft's policies.
