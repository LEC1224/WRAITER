const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const origin = process.env.WRAITER_SMOKE_ORIGIN || 'https://wraiter.lecani.se';
  const output = path.resolve(__dirname, '../test-output/web-cloud/production'); fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: process.env.WRAITER_TEST_BROWSER || 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage(), errors = [], mutations = [], checks = [], responses = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', req => { if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) mutations.push({ method: req.method(), url: req.url() }); });
  page.on('response', response => { if (response.status() >= 400 && !response.url().endsWith('/api/auth/me')) responses.push({ status: response.status(), url: response.url() }); });
  const noOverflow = async name => { assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: no horizontal overflow`); checks.push(`${name}: no horizontal overflow`); };
  const shot = name => page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
  try {
    const landing = await page.goto(origin, { waitUntil: 'networkidle' }); assert.equal(landing.status(), 200); assert.equal(new URL(page.url()).protocol, 'https:');
    await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
    await page.getByText('Documents and titles are encrypted on your device before upload. Signing in also opens your documents.', { exact: true }).waitFor();
    assert.doesNotMatch(await page.locator('body').innerText(), /separate document passphrase|Save your recovery key|Set up document encryption/);
    assert.equal(await page.locator('input[name=email]').getAttribute('type'), 'email'); assert.equal(await page.locator('input[name=password]').getAttribute('type'), 'password');
    await page.getByRole('button', { name: 'Forgot your password?', exact: true }).waitFor(); await page.getByRole('button', { name: 'Resend confirmation email', exact: true }).waitFor(); await noOverflow('desktop login'); await shot('login-desktop'); checks.push('Desktop login, password reset and confirmation resend discoverable');
    await page.getByRole('button', { name: 'Create an account', exact: true }).click(); await page.getByRole('button', { name: 'Create account', exact: true }).waitFor();
    assert.equal(await page.locator('input[name=password]').getAttribute('minlength'), '10'); assert.equal(await page.locator('input[name=password-confirmation]').getAttribute('minlength'), '10');
    await page.getByText('10+ characters, with letters and numbers. Capitals and symbols are optional.', { exact: true }).waitFor(); await noOverflow('desktop registration'); await shot('register-desktop'); checks.push('Registration has minimum 10 characters and letter/number hint; capitals/symbols optional');
    await page.getByRole('button', { name: 'Back to sign in', exact: true }).click(); await page.getByRole('button', { name: 'Forgot your password?', exact: true }).click(); await page.getByRole('button', { name: 'Send reset link', exact: true }).waitFor(); assert.equal(await page.locator('input[name=password]').count(), 0); checks.push('Forgot-password email form reachable without submitting');
    await page.getByRole('button', { name: 'Back to sign in', exact: true }).click(); await page.getByRole('button', { name: 'Resend confirmation email', exact: true }).click(); await page.getByRole('button', { name: 'Resend confirmation', exact: true }).waitFor(); checks.push('Resend-confirmation email form reachable without submitting');
    await page.goto(origin + '/verify#token=read-only-smoke-test', { waitUntil: 'networkidle' }); await page.getByRole('button', { name: 'Confirm my email', exact: true }).waitFor(); assert.equal(await page.locator('input').count(), 0); checks.push('Verification fragment link opens explicit confirmation screen; no automatic token consumption');
    await page.goto(origin + '/reset#token=read-only-smoke-test', { waitUntil: 'networkidle' }); await page.getByRole('button', { name: 'Reset password', exact: true }).waitFor(); assert.equal(await page.locator('input[name=password]').getAttribute('minlength'), '10'); checks.push('Reset fragment link opens new-password form without submission');
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto(origin, { waitUntil: 'networkidle' }); await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor(); await noOverflow('mobile login'); await shot('login-mobile');
    await page.getByRole('button', { name: 'Create an account', exact: true }).click(); await page.getByRole('button', { name: 'Create account', exact: true }).waitFor(); await noOverflow('mobile registration'); await shot('register-mobile');
    await page.setViewportSize({ width: 320, height: 568 }); await noOverflow('small phone registration'); await page.locator('input[name=password-confirmation]').focus(); await shot('register-small-phone');
    await page.goto(origin + '/privacy.html', { waitUntil: 'networkidle' }); await page.getByRole('heading', { name: 'Your writing and your data', exact: true }).waitFor();
    const privacy = await page.locator('body').innerText(); for (const phrase of ['backup drive', 'salted account password hash', '1 GB', '64 MB', 'current browser session', 'Account deletion', 'AES-GCM', 'recovery key', 'directly from your browser', 'decrypted documents', 'historical database pages']) assert.ok(privacy.includes(phrase), 'Privacy contains ' + phrase);
    await noOverflow('mobile privacy'); await shot('privacy-mobile'); checks.push('Privacy describes client encryption, recovery loss, historical plaintext, direct own AI, decrypted ZIP, backup and deletion');
    const healthResponse = await context.request.get(origin + '/api/health'); assert.equal(healthResponse.status(), 200); const health = await healthResponse.json(); assert.equal(health.ok, true); assert.equal(health.version, require('../package.json').version); checks.push('Public health endpoint returns healthy current release');
    assert.deepEqual(errors, []); assert.deepEqual(mutations, []); assert.deepEqual(responses, []);
    const report = { checkedAt: new Date().toISOString(), origin, browser: 'Microsoft Edge via Playwright', result: 'pass', checks, health, mutationRequests: mutations, unexpectedResponses: responses, pageErrors: errors, limitations: ['No account registration, email sending, login, document write or AI generation was performed against production.', 'On-device iOS/Android keyboard behavior was covered by local browser emulation, not physical devices.'] };
    fs.writeFileSync(path.join(output, 'smoke-report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  } catch (error) { await shot('smoke-failure').catch(() => {}); fs.writeFileSync(path.join(output, 'smoke-failure.json'), JSON.stringify({ error: error.message, errors, mutations, responses, checks }, null, 2)); throw error; }
  finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
