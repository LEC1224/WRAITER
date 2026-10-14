# WRAITER privacy and AI data

Updated: 15 October 2026.

This policy describes WRAITER's current desktop application, published by LEC1224. For private support, privacy requests or AI-content concerns, contact [carl.1224@outlook.com](mailto:carl.1224@outlook.com). Source code and public support are available at [LEC1224/WRAITER](https://github.com/LEC1224/WRAITER); the publisher's profile is [LEC1224 on GitHub](https://github.com/LEC1224).

## Your writing stays on your computer

Manuscripts, saved assistant conversations, preferences, reference links and recovery history are stored on your computer. WRAITER does not operate a cloud manuscript service and does not include advertising, analytics or a publisher telemetry service. Documents you save to a folder synchronized by OneDrive or another service are handled by that service separately.

Save important manuscripts as named files in a folder you control. Those files remain after uninstalling WRAITER. Windows may remove the Store app's private settings, recovery history and unnamed drafts when you uninstall or reset it. Local backups and Windows account/disk security are your responsibility.

## Optional AI processing

You can write, save and export with AI turned off. When you enable and use cloud AI, WRAITER sends the text needed for the chosen task to your selected provider. This can include manuscript passages, writing-voice instructions, enabled reference content, recent messages from the selected assistant conversation, and instructions such as your requested writing vibe. The writing assistant can request relevant passages and references for an editing task. Private notes and passage comments are excluded from AI prompts; assistant conversations are excluded from manuscript exports.

Automatic suggestions and AI-generated checkpoint labels can make requests while AI is enabled. You can turn AI off, disable automatic suggestions, choose different task models or disable references in the app. The connection test sends a short sample sentence, not your manuscript. AI requests use your provider's account allowance or billing; buying WRAITER does not include an AI subscription or credits.

Your provider controls its own processing, retention and use of data. Review its terms and privacy information before sharing writing or personal information:

- [OpenAI privacy policy](https://openai.com/policies/privacy-policy/)
- [Anthropic privacy policy](https://www.anthropic.com/legal/privacy)
- [Ollama privacy information](https://ollama.com/privacy)
- For a custom API endpoint or local server, review the operator's policy and configuration.

A local model selected in WRAITER processes requests through its local engine. WRAITER's local-model manager uses local-only models and does not send their prompts to a publisher service. Downloading an engine or model still connects to the engine/model download provider. A server you configure yourself may forward data elsewhere.

## Credentials and installation

Codex and Claude Code own their sign-in flows and saved accounts. WRAITER does not ask for their account passwords. API keys entered in WRAITER are encrypted with Electron's operating-system-backed credential storage before being written to preferences. They are used for the configured provider and are not included in manuscript exports. These protections do not secure a compromised Windows account or computer.

Store builds open the provider's official installation guide when you choose to get an AI helper. Other builds can download and run a provider's official installer after you choose Install. Optional local-engine and model downloads contact their documented providers. Windows/Electron may download spellchecking dictionaries when required for your chosen language. Those downloads expose ordinary network metadata to the download service, but do not include manuscript text.

## Your controls and support

You can turn AI off, change providers, disable references, remove saved API keys in Connections, delete files you saved, or uninstall the app. Provider account data must be managed with that provider. To remove Store-managed local application data, use Windows Settings to reset or uninstall WRAITER after saving any drafts you want to keep. Reference files and manuscripts outside the app's data folder are not removed by a reset.

Use the email above for private requests. Help → Report an AI concern opens contact choices; WRAITER does not attach or upload your manuscript automatically. Share only the information you choose to include. Email reports are used to investigate and respond to the concern; the mail provider processes them under its own policies. [GitHub issues](https://github.com/LEC1224/WRAITER/issues) are public: do not post manuscripts, passwords, API keys or personal documents there. Windows and Microsoft Store may collect their own diagnostic, account, purchase and deployment information under Microsoft's policies.
