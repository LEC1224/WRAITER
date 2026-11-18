const path = require('node:path');
const fs = require('node:fs');
const { parseEnv } = require('node:util');
const { CloudError } = require('./store.cjs');

function httpsOrigin(value, name) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== value) {
    throw new Error(`${name} must be an HTTPS origin without a path.`);
  }
  return url;
}

function siteOrigins(env, staticDir) {
  const origin = env.WRAITER_ORIGIN || 'http://127.0.0.1:3020';
  const primary = { origin, host: new URL(origin).host, staticDir, mail: env };
  const configPath = path.join(__dirname, '../config/alternate-site.env');
  const settings = env === process.env && !env.WRAITER_ALIAS_ORIGIN && fs.existsSync(configPath)
    ? parseEnv(fs.readFileSync(configPath, 'utf8'))
    : env;
  const alternate = settings.WRAITER_ALIAS_ORIGIN ? alternateSite(primary, env, settings) : null;
  // Development can use an ephemeral port or a Vite proxy. HTTPS deployments
  // always reject unknown hosts, even when the alternate config is missing.
  if (!alternate && !origin.startsWith('https://')) return () => primary;

  return request => {
    const host = request.headers.host?.toLowerCase();
    if (alternate && host === alternate.host) return alternate;
    if (host === primary.host) return primary;
    const localHealth = request.url === '/api/health' && /^127\.0\.0\.1(?::\d+)?$/.test(host || '') && request.socket.remoteAddress === '127.0.0.1';
    if (localHealth) return primary;
    throw new CloudError(421, 'This hostname is not configured for WRAITER.');
  };
}

function alternateSite(primary, env, settings) {
  httpsOrigin(primary.origin, 'WRAITER_ORIGIN');
  const aliasUrl = httpsOrigin(settings.WRAITER_ALIAS_ORIGIN, 'WRAITER_ALIAS_ORIGIN');
  if (aliasUrl.host === primary.host || env.WRAITER_SECURE_COOKIES === '0' || !settings.WRAITER_ALIAS_STATIC_DIR) {
    throw new Error('The alternate site requires a distinct hostname, secure cookies and a web build.');
  }
  const staticDir = path.resolve(settings.WRAITER_ALIAS_STATIC_DIR);
  if (path.relative(primary.staticDir, staticDir) === '') throw new Error('The alternate site requires its own web build directory.');
  const sender = settings.WRAITER_ALIAS_MAIL_FROM || `noreply@${aliasUrl.hostname}`;
  const senderDomain = /^[a-z0-9._+-]+@([a-z0-9.-]+)$/i.exec(sender)?.[1].toLowerCase();
  if (!senderDomain || !(aliasUrl.hostname === senderDomain || aliasUrl.hostname.endsWith(`.${senderDomain}`))) {
    throw new Error('The alternate account sender must use the alternate domain.');
  }
  return {
    origin: aliasUrl.origin,
    host: aliasUrl.host,
    staticDir,
    mail: {
      WRAITER_MAIL_FROM: sender,
      WRAITER_RESEND_KEY: settings.WRAITER_ALIAS_RESEND_KEY
    },
    alternate: true
  };
}

module.exports = { siteOrigins };
