const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const origins = process.argv.slice(2);

async function checkAccountLinks(browser, origin) {
  const page = await browser.newPage();
  try {
    const health = await page.request.get(`${origin}/api/health`);
    assert.ok(health.ok());
    const { ok, emailConfigured } = await health.json();
    assert.ok(ok && emailConfigured, `${origin} must have account email enabled`);

    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const response = await page.goto(origin);
      assert.ok(response.ok());
      assert.equal(new URL(page.url()).origin, origin);

      for (const [link, submit] of [
        ['Forgot your password?', 'Send reset link'],
        ['Resend confirmation email', 'Resend confirmation'],
        ['Create an account', 'Create account']
      ]) {
        await page.getByRole('button', { name: link, exact: true }).click({ timeout: 10000 });
        await page.getByRole('button', { name: submit, exact: true }).waitFor({ timeout: 10000 });
        await page.getByRole('button', { name: 'Back to sign in', exact: true }).click();
      }
    }
    console.log(`${origin}: account email and all three sign-in links verified on desktop and mobile`);
  } finally {
    await page.close();
  }
}

async function main() {
  if (origins.length !== 2 || new Set(origins).size !== 2 || origins.some(origin => new URL(origin).origin !== origin)) {
    throw new Error('Pass two distinct site origins, for example https://write.example.org https://books.example.net.');
  }
  const browser = await chromium.launch({ channel: process.env.WRAITER_TEST_BROWSER || 'msedge' });
  try {
    for (const origin of origins) await checkAccountLinks(browser, origin);
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
