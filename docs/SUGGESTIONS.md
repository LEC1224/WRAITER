# WRAITER suggestions

Verified cloud accounts can submit from the browser library, browser editor, or desktop tab bar. Desktop writers can sign in from the dialog with their draft open. The service takes the return address from the session. The developer can edit the prompt in `/admin`. The original wording is retained for the decline email.

## Cloud service

The service creates its suggestion tables on startup in the existing SQLite database. Set `WRAITER_SUGGESTION_ADMIN_EMAIL` to a verified account to enable initial administrator access. The service records its immutable user ID. A later registration with that address cannot inherit the administrator role. Account deletion also deletes that writer’s stored suggestions and pending mail.

Keep `config/suggestions.env` alongside the protected server configuration. These values apply to the suggestion service.

| Setting | Purpose |
| --- | --- |
| `WRAITER_SUGGESTION_ADMIN_EMAIL` | Existing verified owner account for the initial binding |
| `WRAITER_SUGGESTION_RELAY_KEY` | At least 32 random bytes encoded as base64url, shared exclusively with the developer PC |
| `WRAITER_SUGGESTION_ALIAS_RESEND_KEY` | Optional send-only credential dedicated to suggestions on the alternate domain |
| `WRAITER_SUGGESTION_ALIAS_FROM` | Verified alternate sender associated with that credential |

The primary site uses its configured transactional mail transport. Each decision uses the origin captured at submission. A durable outbox retries failed mail and uses a stable idempotency key with Resend. The admin list shows when an email is pending. Include the protected settings in operator recovery procedures, or rotate the relay and mail credentials when restoring a service.

## Developer PC

Install from the WRAITER checkout registered in the developer’s Codex project. Supply the same relay key in a secure prompt. The installer uses Windows user protection for the key and installs a private copy of the relay that runs as a limited current-user task at logon.

```powershell
$relaySecret = Read-Host 'Suggestion relay key' -AsSecureString
.\tools\windows-suggestion-relay.ps1 -Action Install -Origin 'https://your-wraiter-site.example' -RelayKey $relaySecret
```

The relay uses the local Codex sign-in and publishes the available models, reasoning levels and speed tiers to the admin panel. An outbound long poll wakes on approval. Approvals remain queued while the PC is offline. The relay pins the working directory and project locally. It attaches selected diagnostic files, includes their contents as untrusted context, and records the chat ID before starting the turn. A delivery retry reconciles that same chat and prompt ID.

Diagnostic copies live under `%LOCALAPPDATA%\WRAITER\Suggestion relay\attachments` so file references remain available when reopening a chat. The relay’s lifetime follows the Windows user session. Task Scheduler lists it as `WRAITER suggestion relay`. The private relay directory contains a `status.json` file with the last successful cloud connection.
