# WRAITER Cloud operations

WRAITER Cloud serves the browser editor, account and mail flows, encrypted document library, and suggestion review. The server and browser build use the same release. The data directory contains the SQLite database, including account metadata, encrypted documents, key wrappers, sessions and any legacy records awaiting migration.

## Run locally

Use Node.js 24. Install the locked dependencies with `npm ci`, then run the following from the checkout.

```powershell
npm run build:web
node --env-file=cloud/.env.example cloud/server.cjs
```

Open `http://127.0.0.1:3020`. To enable registration and password reset, set a transactional mail transport and a verified sender in a private environment file. Configure the initial suggestion administrator and relay as described in the [suggestion guide](SUGGESTIONS.md).

## Configure a hosted service

Set `WRAITER_ORIGIN` to the site's HTTPS origin, `WRAITER_SECURE_COOKIES=1`, and `WRAITER_DATA_DIR` and `WRAITER_STATIC_DIR` to the database and built browser directories. Terminate TLS at the reverse proxy, preserve the Host header and set `WRAITER_TRUST_PROXY=1` when the service accepts traffic only from that proxy. The `/api/health` response reports service and mail readiness. A second origin can share the account store with its own assets, cookies and sender. See [alternate hostname configuration](WRAITER-CLOUD-ALTERNATE-HOST.md).

For a distributable server archive, run `npm run package:cloud` after the browser build. Extract it into the application directory, install the package's runtime dependencies, and supply the protected configuration separately.

## Windows deployment example

The included PowerShell helpers use dedicated directories under `%ProgramData%\WRAITER`. The startup helper expects the application under `cloud`, browser assets in `cloud\dist-web`, and private settings in `cloud\config\server.env`. The proxy directories are `proxy` and `proxy-alternate`. Store operator-only staging and rollback files under `operator`. Give the operator, Administrators and SYSTEM access to that staging directory before placing credentials there.

From Windows PowerShell, run `cloud/ops/windows-cloud-startup.ps1 -Action Install` on the prepared server to register the limited service account and startup task. The same script accepts `Start`, `Stop` and `Status`. The supervisor writes service state and rotates logs in the application's `.runtime` directory. Keep the data and configuration outside the proxy document root.

For IIS, configure URL Rewrite and ARR to forward the original Host. Run the primary proxy helper with the intended DNS name and the path to an existing proxy configuration containing the approved direct-origin restriction. Use `-IssueCertificate` and `-WinAcme` when issuing a certificate with win-acme. The alternate helper uses the primary proxy’s restriction and its own hostname and certificate.

```powershell
.\cloud\ops\windows-cloud-iis.ps1 -SiteHost write.example.org -OriginRestrictionTemplate $trustedProxyConfig
.\cloud\ops\windows-cloud-alternate-iis.ps1 -SiteHost books.example.net -Action Prepare
```

## Back up and restore

For a consistent online SQLite snapshot, run `node cloud/backup.cjs --data-dir <data-directory> --output <backup-file>`. It checks SQLite integrity and writes the byte count and SHA-256 digest alongside the snapshot. Keep the database, configuration and key material in protected storage.

The Windows backup helper can pull one verified copy daily over SSH. In the example layout, the server uses `C:\ProgramData\WRAITER\cloud` and `C:\ProgramData\WRAITER\proxy`. Install the helper on the backup machine with a dedicated SSH identity and a known-hosts file containing the verified server host key.

```powershell
.\cloud\ops\windows-cloud-backup.ps1 -Action Install -Server 'operator@backup-origin.example.org' -IdentityFile $identity -KnownHostsFile $knownHosts
```

The helper saves the connection settings in the protected backup directory and uses them for scheduled runs. The snapshot includes the database, primary server environment and proxy configuration. Back up any separate alternate-site and suggestion configuration in protected storage as well. Check the task’s `Status`, latest successful completion, and snapshot digest. A task installed as SYSTEM needs access to the supplied SSH identity and known-hosts file.

Before restoring, verify the hashes and SQLite integrity on a copy, stop the service, and retain a rollback copy of the existing database and configuration. Restore a matching database and schema version, preserving wrapped document keys. Restart and check health and sign-in with a test account. A restored database includes its saved sessions.
