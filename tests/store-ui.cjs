// The real packaged Store runtime; isolated profile and synthetic writing only.
const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const waitFor = async (fn, label) => {
  const until = Date.now() + 15000;
  while (Date.now() < until) { try { if (await fn()) return; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error('Timed out: ' + label);
};
(async () => {
  if (!process.env.WRAITER_EXECUTABLE) throw new Error('Set WRAITER_EXECUTABLE to the Store build win-unpacked/WRAITER.exe.');
  const directory = path.join(root, 'test-output'); await fs.mkdir(directory, { recursive: true });
  const output = await fs.mkdtemp(path.join(directory, 'store-ui-')), userData = path.join(output, 'profile');
  await fs.mkdir(userData);
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ ...require('../electron/preferences.cjs').defaults, tutorialComplete: true, spellcheck: false, keys: {} }));
  const env = { ...process.env, WRAITER_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  // A consumer PC may have no Git installed; ordinary saving/recovery must work.
  for (const key of Object.keys(env)) if (/^path$/i.test(key)) delete env[key];
  env.PATH = [path.join(process.env.SystemRoot, 'System32'), path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0'), process.env.SystemRoot].join(path.delimiter);
  const projectPath = path.join(output, 'Store writing – Åsa.wraiter'), checks = [], errors = [];
  let app, page;
  const launch = async () => {
    app = await _electron.launch({ executablePath: process.env.WRAITER_EXECUTABLE, args: [], env, timeout: 60000 });
    page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('textbox', { name: 'Manuscript editor', exact: true }).waitFor();
    await app.evaluate(({ shell }) => { global.storeTestLinks = []; shell.openExternal = async url => { global.storeTestLinks.push(url); }; });
  };
  const close = async () => { await page?.evaluate(() => window.wraiter.finishClose()).catch(() => {}); await app?.close().catch(() => {}); app = null; };
  const menu = (group, label) => app.evaluate(({ Menu }, [group, label]) => {
    const section = Menu.getApplicationMenu().items.find(item => item.label.replaceAll('&', '') === group);
    const entry = section.submenu.items.find(item => item.label.replaceAll('&', '') === label);
    if (!entry) throw new Error('Missing native menu ' + label); entry.click();
  }, [group, label]);
  const resize = async (width, height) => { await app.evaluate(({ BrowserWindow }, [width, height]) => BrowserWindow.getAllWindows()[0].setSize(width, height), [width, height]); };
  const screenshot = async name => { await page.screenshot({ path: path.join(output, name) }); };
  try {
    await launch();
    assert.equal((await page.evaluate(() => window.wraiter.boot())).prefs.distribution, 'microsoft-store');
    await page.getByRole('dialog', { name: 'Welcome to WRAITER' }).waitFor();
    await page.getByText('Windows installs and updates this edition through Microsoft Store.', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByText(/Cloud AI receives relevant manuscript passages/).waitFor();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Get Codex', exact: true }).click();
    await page.getByText('Install the helper using its official guide, then return to WRAITER and check your account.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'Claude Code Use your Claude Code account.' }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Get Claude Code', exact: true }).click();
    await page.getByText('Install the helper using its official guide, then return to WRAITER and check your account.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /^Install (Codex|Claude Code)$/ }).count(), 0);
    assert.deepEqual(await app.evaluate(() => global.storeTestLinks), ['https://learn.chatgpt.com/docs/codex/cli', 'https://code.claude.com/docs/en/setup']);
    await assert.rejects(page.evaluate(() => window.wraiter.setupInstall('unknown-provider')), /Choose Codex or Claude Code/);
    const location = page.url();
    await resize(960, 650); await screenshot('setup-store-minimum.png');
    await resize(1600, 1000); await screenshot('setup-store-large.png');
    checks.push('Real Store runtime identifies itself; helper buttons open only the official guides, with AI-data disclosure before connection.');

    await page.getByRole('button', { name: 'Set up later', exact: true }).click();
    await page.locator('.walkthrough[data-step="welcome"]').waitFor();
    await page.getByRole('button', { name: 'End walkthrough', exact: true }).click();
    await page.locator('.walkthrough').waitFor({ state: 'hidden' });
    assert.equal((await page.evaluate(() => window.wraiter.boot())).prefs.enabled, false);
    const editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true });
    await editor.click(); await page.keyboard.insertText('At dawn, Mira opened the small bookshop.\nA note lay beneath the door, folded into a paper bird.');
    await app.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); }, projectPath);
    await menu('File', 'Save');
    await waitFor(async () => (await fs.readFile(projectPath, 'utf8')).includes('paper bird'), 'named manuscript save');
    assert.equal((await page.evaluate(() => window.wraiter.listGitHistory())).available, false);
    checks.push('Writing, recovery and a named Unicode-path save work with AI off, no provider account and Git unavailable.');

    await menu('Help', 'Privacy and AI data…');
    const policy = page.getByRole('dialog', { name: 'Privacy and AI data', exact: true }); await policy.waitFor();
    await policy.getByRole('heading', { name: 'Your writing stays on your computer' }).waitFor();
    await policy.getByRole('button', { name: 'Close dialog', exact: true }).focus(); await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.tagName), 'A');
    await policy.getByRole('link', { name: 'OpenAI privacy policy', exact: true }).click();
    assert.equal(page.url(), location);
    assert.equal((await app.evaluate(() => global.storeTestLinks)).at(-1), 'https://openai.com/policies/privacy-policy/');
    await resize(960, 650); await screenshot('privacy-store-minimum.png');
    assert.equal(await policy.evaluate(element => element.getBoundingClientRect().right <= innerWidth && element.getBoundingClientRect().left >= 0), true);
    await resize(1600, 1000); await policy.evaluate(element => element.scrollTop = 0); await screenshot('privacy-store-large.png');
    await page.keyboard.press('Escape'); await policy.waitFor({ state: 'hidden' });
    checks.push('Privacy is available from Help, links remain keyboard accessible and open externally, and the dialog fits the minimum window.');

    await menu('Help', 'Report an AI concern…');
    const report = page.getByRole('dialog', { name: 'Report an AI concern', exact: true }); await report.waitFor();
    await report.getByRole('button', { name: 'Open email report', exact: true }).click();
    assert.equal((await app.evaluate(() => global.storeTestLinks)).at(-1), 'mailto:carl.1224@outlook.com?subject=WRAITER%20AI%20content%20concern');
    await report.getByRole('button', { name: 'Open public issue form', exact: true }).click();
    assert.equal((await app.evaluate(() => global.storeTestLinks)).at(-1), 'https://github.com/LEC1224/WRAITER/issues/new?title=AI%20content%20concern');
    assert.equal(page.url(), location);
    await screenshot('ai-report-store.png'); await page.keyboard.press('Escape');
    checks.push('AI reports open user-controlled private email or a public issue form without including any manuscript content.');

    await page.evaluate(() => window.wraiter.settings({ distribution: 'direct' }));
    assert.equal((await page.evaluate(() => window.wraiter.boot())).prefs.distribution, 'microsoft-store');
    await close(); await launch();
    await waitFor(async () => (await page.getByRole('textbox', { name: 'Manuscript editor', exact: true }).innerText()).includes('paper bird'), 'saved manuscript restored');
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal((await page.evaluate(() => window.wraiter.boot())).prefs.enabled, false);
    checks.push('Saved writing and setup choices survive restart; preferences cannot change the Store distribution marker.');
    assert.deepEqual(errors, []);
    const result = { passed: true, executable: process.env.WRAITER_EXECUTABLE, output, userData, checks, rendererErrors: errors, limits: ['The executable runs unregistered; signed MSIX deployment/activation and WACK remain untested.', 'Provider guides and report links were captured; no install, email, public issue or live AI request was sent.'] };
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(result, null, 2));
    await fs.writeFile(path.join(directory, 'store-ui-results.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { await screenshot('failure.png').catch(() => {}); console.error('Output:', output, 'Renderer errors:', errors); throw error; }
  finally { await close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
