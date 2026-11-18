const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createApplication } = require('./server.cjs');
const { stageAlternateWeb } = require('./ops/stage-alternate-web.cjs');

const primary = 'https://write.private.example', alternate = 'https://write.second.example';
const privateHost = 'write.private.example', alternateHost = 'write.second.example';

async function setup(t, alternateKey, { alternateEnabled = true } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wraiter-origins-'));
  const staticDir = path.join(directory, 'primary'), aliasDir = path.join(directory, 'alternate');
  await fs.mkdir(staticDir);
  await fs.writeFile(path.join(staticDir, 'index.html'), `Sign in at ${primary}`);
  await fs.writeFile(path.join(staticDir, 'privacy.html'), 'Email is sent from noreply@private.example through a mail provider.');
  await fs.writeFile(path.join(staticDir, 'bundle.js.map'), privateHost);
  await stageAlternateWeb(staticDir, aliasDir, primary, alternate, 'noreply@private.example');
  const env = {
    WRAITER_ORIGIN: primary,
    WRAITER_ALIAS_ORIGIN: alternateEnabled ? alternate : undefined,
    WRAITER_STATIC_DIR: staticDir,
    WRAITER_ALIAS_STATIC_DIR: aliasDir,
    WRAITER_DATA_DIR: path.join(directory, 'data'),
    WRAITER_RESEND_KEY: 'mock-primary-key',
    WRAITER_ALIAS_RESEND_KEY: alternateKey
  };
  const { server, store } = createApplication({ env });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  function request(host, pathname, { origin, body, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1', port: server.address().port, path: pathname, method: body ? 'POST' : 'GET',
        headers: { Host: host, 'X-Wraiter-Request': '1', ...(origin ? { Origin: origin } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }
      }, res => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', fragment => { text += fragment; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
      });
      req.on('error', reject);
      req.end(body ? JSON.stringify(body) : undefined);
    });
  }
  return { request, store };
}

test('alternate entry serves its own assets and cannot use the original mail configuration', async t => {
  const { request, store } = await setup(t);
  const alternatePage = await request(alternateHost, '/');
  assert.equal(alternatePage.status, 200);
  assert.match(alternatePage.text, /write\.second\.example/);
  assert.equal(alternatePage.headers['x-robots-tag'], 'noindex');
  assert.doesNotMatch((await request(alternateHost, '/privacy.html')).text, /private\.example/);
  assert.equal((await request(alternateHost, '/bundle.js.map')).status, 404);
  assert.equal((await request(privateHost, '/bundle.js.map')).status, 200);
  assert.equal((await request('unlisted.example', '/', { headers: { 'X-Forwarded-Host': alternateHost } })).status, 421);
  assert.equal((await request(alternateHost, '//write.private.example/api/health')).status, 400);
  assert.equal(JSON.parse((await request(alternateHost, '/api/health')).text).emailConfigured, false);
  assert.equal(JSON.parse((await request(privateHost, '/api/health')).text).emailConfigured, true);
  const sample = { email: 'new@example.com', password: 'wraiter1234' };
  assert.equal((await request(alternateHost, '/api/auth/register', { origin: primary, body: sample })).status, 403);
  const registration = await request(alternateHost, '/api/auth/register', { origin: alternate, body: sample });
  assert.equal(registration.status, 503);
  assert.equal(JSON.parse(registration.text).code, 'ACCOUNT_EMAIL_UNAVAILABLE');
  assert.ok(!store.user(sample.email));
});

test('both sites share accounts but use their own confirmation and reset mail', async t => {
  const { request } = await setup(t, 'mock-alternate-key');
  const messages = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails');
    messages.push({ authorization: options.headers.Authorization, ...JSON.parse(options.body) });
    return new Response('{}', { status: 200 });
  });
  const account = { email: 'writer@example.com', password: 'wraiter1234' };
  assert.equal((await request(alternateHost, '/api/auth/register', { origin: alternate, body: account })).status, 202);
  assert.equal(messages[0].from, 'WRAITER <noreply@write.second.example>');
  const token = messages[0].text.match(/\/verify#token=([\w-]{43})/)[1];
  const verified = await request(alternateHost, '/api/auth/verify', { origin: alternate, body: { token } });
  assert.equal(verified.status, 200);
  assert.match(verified.headers['set-cookie'][0], /^__Host-wraiter=.+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+; Secure$/);
  const signedIn = await request(privateHost, '/api/auth/login', { origin: primary, body: account });
  assert.equal(signedIn.status, 200);
  assert.equal(JSON.parse(signedIn.text).user.id, JSON.parse(verified.text).user.id);
  assert.equal((await request(alternateHost, '/api/auth/forgot', { origin: alternate, body: { email: account.email } })).status, 202);
  assert.match(messages[1].text, /https:\/\/write\.second\.example\/reset#token=/);
  for (const message of messages) {
    assert.equal(message.authorization, 'Bearer mock-alternate-key');
    assert.doesNotMatch(JSON.stringify(message), /private\.example/);
  }
});

test('an HTTPS site does not serve the original web files when the alternate configuration is absent', async t => {
  const { request } = await setup(t, undefined, { alternateEnabled: false });
  assert.equal((await request(privateHost, '/')).status, 200);
  const response = await request(alternateHost, '/');
  assert.equal(response.status, 421);
  assert.doesNotMatch(response.text, /private\.example/);
});
