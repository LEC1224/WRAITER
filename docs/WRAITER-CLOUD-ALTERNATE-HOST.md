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
WRAITER_ALIAS_STATIC_DIR=D:/Sites/wraiter-cloud/dist-web-alternate
```

Set `WRAITER_ALIAS_RESEND_KEY` to a send-only key for a verified Resend sender on
the alternate domain. The default sender is `noreply` at the alternate hostname.
`WRAITER_ALIAS_MAIL_FROM` can select a different address on that domain. Leave
click tracking disabled on account emails. After verifying delivery, stage the
web build without `--login-only`.

Terminate TLS for each hostname at the reverse proxy and preserve the requested Host header when forwarding to WRAITER.
