# Additional WRAITER Cloud hostname

Both hostnames use one server process and one document store. The server accepts
only the configured Host values and checks browser writes against the origin
that received the request. Browser sessions use host-only cookies.

Stage a separate public build from the approved release. This strips source maps
and checks for references to the original domain across the staged files.

```powershell
node cloud/ops/stage-alternate-web.cjs dist-web tmp/alternate-web https://write.example.net https://write.example.org noreply@example.net
```

Pass `--login-only` when the alternate site has no mail sender yet. That build
hides the email actions for signup and password reset, and the server refuses
those requests without sending mail. Existing accounts can sign in.

Place the staged files outside the original public directory. Set these values
in the protected `config/alternate-site.env` on the server, then restart the
WRAITER Cloud task and check `/api/health` under each hostname.

```dotenv
WRAITER_ALIAS_ORIGIN=https://write.example.org
WRAITER_ALIAS_STATIC_DIR=C:/ProgramData/WRAITER/cloud/dist-web-alternate
```

Set `WRAITER_ALIAS_RESEND_KEY` to a send-only key for a verified Resend sender on
the alternate domain. The default sender is `noreply` at the alternate hostname.
`WRAITER_ALIAS_MAIL_FROM` can select a different address on that domain. Leave
click tracking disabled on account emails. After verifying delivery, stage the
web build without `--login-only`.

Terminate TLS for each hostname at the reverse proxy and preserve the requested Host header when forwarding to WRAITER.

## Enable account mail on a second hostname

Both sites share verified accounts and documents. Each site has its own sign-in session, sender and email links. Confirm that the sender belongs to the alternate domain before enabling registration and password recovery there.

For the Windows deployment example, run the alternate IIS script with the chosen hostname and `-Action Prepare`. After DNS points to the proxy and WRAITER answers for the hostname, run it with `-Action Enable`. See the [cloud operations guide](WRAITER-CLOUD-OPERATIONS.md).

To update a login-only deployment, stage `cloud/ops/enable-alternate-account-mail.ps1` in a new protected directory under `%ProgramData%\WRAITER\operator`. Configure the three settings `WRAITER_ALIAS_ORIGIN`, `WRAITER_ALIAS_STATIC_DIR` and `WRAITER_ALIAS_MAIL_FROM` in the alternate settings file. The script expects the alternate build in `dist-web-alternate`. An example invocation follows.

```powershell
$sites = @{ PrimaryHost = 'write.example.org'; AlternateHost = 'books.example.net'; Sender = 'noreply@example.net' }
.\enable-alternate-account-mail.ps1 @sites -Action Configure
```

Supply the alternate sender’s send-only key on standard input from a private source. Confirm delivery and verify that `/api/health` reports `emailConfigured: true` on each site. Run `-Action Publish` from the same directory to show signup, confirmation resend and password reset. The script keeps the previous settings and both entry pages there for `-Action Rollback`.

Check the account forms at desktop and mobile widths with `node tests/web-production-account-links.cjs https://write.example.org https://books.example.net`. The check reads the forms without creating an account or sending email.
