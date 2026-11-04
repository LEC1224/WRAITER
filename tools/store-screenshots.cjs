// Real application screenshots with synthetic prose. No provider account or AI calls.
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

async function main() {
  const executablePath = process.env.WRAITER_EXECUTABLE || path.join(root, 'release/store', 'v' + require('../package.json').version, 'win-unpacked/WRAITER.exe');
  await fs.access(executablePath);
  const output = path.join(root, 'docs/store/images'); await fs.mkdir(output, { recursive: true });
  const working = path.join(root, 'test-output'); await fs.mkdir(working, { recursive: true });
  const userData = await fs.mkdtemp(path.join(working, 'store-screenshots-'));
  const project = (await import('../src/document.js')).newProject(true);
  project.id = 'store-listing-sample'; project.title = 'The quiet hours';
  project.notes = 'Try a different opening later. Keep the blackbird.';
  project.style = 'Quiet, observant prose. Give the reader room to notice the small things.';
  project.chapters.push({ id: 'store-chapter-third', title: 'A letter in the rain', status: 'Notes', content: { type: 'doc', content: [{ type: 'paragraph' }] } });
  const manuscript = path.join(userData, 'The quiet hours.wraiter'); await fs.writeFile(manuscript, JSON.stringify(project));
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ ...require('../electron/preferences.cjs').defaults, setupComplete: true, tutorialComplete: true, enabled: false, spellcheck: false, keys: {}, fontSize: 19 }));
  const env = { ...process.env, WRAITER_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  let app, page;
  const menu = (group, label) => app.evaluate(({ Menu }, [group, label]) => {
    Menu.getApplicationMenu().items.find(item => item.label.replaceAll('&', '') === group).submenu.items.find(item => item.label.replaceAll('&', '') === label).click();
  }, [group, label]);
  const capture = async name => {
    await page.locator('.save-indicator').getByText('Saving', { exact: true }).waitFor({ state: 'hidden' });
    await page.screenshot({ path: path.join(output, name), animations: 'disabled' });
  };
  try {
    app = await _electron.launch({ executablePath, args: [manuscript], env, timeout: 60000 }); page = await app.firstWindow();
    await page.getByRole('textbox', { name: 'Manuscript editor', exact: true }).waitFor();
    await page.getByRole('textbox', { name: 'Manuscript editor', exact: true }).getByText('Perhaps that was all a beginning needed to be.').waitFor();
    if ((await page.evaluate(() => window.wraiter.boot())).prefs.distribution !== 'microsoft-store') throw new Error('Use the Store build for Store screenshots.');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 1000));
    await page.evaluate(() => document.fonts.ready);
    await capture('01-writing.png');
    await page.getByRole('button', { name: /^Notes & voice/ }).click();
    await page.getByRole('textbox', { name: 'Writing voice' }).waitFor();
    await capture('02-notes-and-voice.png');
    await menu('Help', 'Set up AI…');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByText(/Cloud AI receives relevant manuscript passages/).waitFor();
    await capture('03-optional-ai.png');
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await menu('Help', 'Privacy and AI data…');
    await page.getByRole('heading', { name: 'Your writing stays on your computer' }).waitFor();
    await capture('04-privacy.png');
    console.log('Four Store screenshots saved to docs/store/images using the real Store runtime and synthetic sample text.');
  } finally {
    await page?.evaluate(() => window.wraiter.finishClose()).catch(() => {}); await app?.close().catch(() => {});
  }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
