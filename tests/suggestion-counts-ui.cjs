const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..'), output = path.join(root, 'test-output');
const paragraphs = ['The uppåtvindar carried her over the ridge.', 'She had chosen a quiet route through the valley.', 'She seen the clouds moving.'];
const options = (texts, description) => texts.map((text, index) => ({ text, rating: index === 0 ? 3 : 2, description: `${description} Choice ${index + 1}.` }));
const translations = options(['updrafts', 'rising air currents', 'rising air', 'upward currents', 'ascending air', 'upward-moving air', 'rising currents', 'currents of rising air'], 'Describes rising air in this sentence.');
const rephrasings = options(['a peaceful route', 'a tranquil route', 'a calm route', 'a quiet path', 'a peaceful path', 'a tranquil path', 'a calm path', 'a quiet way'], 'Changes the emphasis of her route.');
const corrections = [
  { text: 'She saw', rating: 3, description: 'Uses the simple past form of see.' },
  { text: 'She had seen', rating: 2, description: 'Uses a past perfect form that places the sighting earlier.' },
  { text: 'She has seen', rating: 1, description: 'Uses a present perfect form.' }
];
const waitFor = async (check, message) => {
  const until = Date.now() + 15000;
  while (Date.now() < until) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(message);
};

(async () => {
  await fs.mkdir(output, { recursive: true });
  const userData = await fs.mkdtemp(path.join(output, 'suggestion-counts-'));
  const requests = [], errors = [], checks = [];
  let forcedResponse = null, legacyCorrection = false;
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET') return res.end('{"models":[{"name":"test-rewriter"},{"name":"test-corrector"}]}');
    let source = ''; for await (const chunk of req) source += chunk;
    const request = JSON.parse(source), prompt = request.messages.find(message => message.role === 'user').content;
    const selection = prompt.match(/SELECTED TEXT:\n([\s\S]*?)\n\nTEXT AFTER CURSOR:/)?.[1];
    requests.push({ request, prompt, selection });
    const kind = selection === 'uppåtvindar' ? 'translation' : selection === 'She seen' ? 'correction' : 'rephrase';
    const answer = legacyCorrection ? 'She saw' : JSON.stringify(forcedResponse || { kind, currentRating: 1, alternatives: kind === 'translation' ? translations : kind === 'correction' ? corrections : rephrasings });
    res.end(JSON.stringify({ message: { content: JSON.stringify({ completion: answer }) } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const settingsFile = path.join(userData, 'settings.json');
  // An older settings file deliberately omits all three new preferences.
  await fs.writeFile(settingsFile, JSON.stringify({ setupComplete: true, tutorialComplete: true, provider: 'ollama', baseUrl: `http://127.0.0.1:${server.address().port}`, model: 'test-rewriter', taskProfiles: { correct: { model: 'test-corrector' } }, enabled: true, continuous: false, nativeLanguage: 'sv-SE', theme: 'dark', spellcheck: false, ollamaMode: 'guided', tokenCap: 4096 }));
  const fixture = { format: 'wraiter', version: 1, id: 'counts-' + Date.now(), title: 'Suggestion targets', language: 'en-US', chapters: [{ id: 'opening', title: 'Opening', status: 'Draft', content: { type: 'doc', content: paragraphs.map(text => ({ type: 'paragraph', content: [{ type: 'text', text }] })) } }] };
  await fs.writeFile(path.join(userData, 'recovery.json'), JSON.stringify({ project: fixture, path: null, expectedHash: null }));
  const env = { ...process.env, WRAITER_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  let app, page;
  const launch = async () => {
    app = await _electron.launch(process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [], env } : { args: [root], env }); page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('textbox', { name: 'Manuscript editor', exact: true }).waitFor();
  };
  const stop = async () => { await app?.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app?.close().catch(() => {}); app = null; };
  try {
    await launch();
    const command = name => app.evaluate(({ BrowserWindow }, name) => BrowserWindow.getAllWindows()[0].webContents.send('command', name), name);
    const editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true });
    const settings = page.getByRole('heading', { name: 'Settings', exact: true });
    const field = name => page.getByRole('spinbutton', { name, exact: true });
    const savedSettings = async () => JSON.parse(await fs.readFile(settingsFile, 'utf8'));
    const recover = async () => JSON.parse(await fs.readFile(path.join(userData, 'recovery.json'), 'utf8')).project;
    const savedText = async () => (await recover()).chapters[0].content.content.map(block => (block.content || []).map(node => node.text || '').join('')).join('\n');
    const expectSavedText = async expected => {
      // Wait for atomic saving to finish before opening its target on Windows.
      await page.waitForFunction(expected => [...document.querySelector('.manuscript').querySelectorAll(':scope > p')].map(node => node.textContent).join('\n') === expected && document.querySelector('.save-indicator')?.textContent.trim() === 'Autosaved', expected);
      assert.equal(await savedText(), expected);
    };
    const originalText = paragraphs.join('\n');
    const menu = page.locator('.rephrase-menu'), list = menu.getByRole('listbox');
    const promptFits = async () => {
      const bounds = await menu.boundingBox(), viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height, JSON.stringify({ bounds, viewport }));
    };
    const select = async word => {
      await editor.evaluate((element, word) => {
        element.focus(); const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const start = walker.currentNode.textContent.indexOf(word); if (start < 0) continue;
          const range = document.createRange(); range.setStart(walker.currentNode, start); range.setEnd(walker.currentNode, start + word.length);
          const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event('selectionchange')); return;
        }
        throw new Error(`Missing selection: ${word}`);
      }, word);
      await page.mouse.move(0, 0); await page.waitForTimeout(150);
    };
    const dismiss = async () => { await editor.press('Escape'); await menu.waitFor({ state: 'hidden' }); };

    await command('settings-ai'); await settings.waitFor();
    assert.equal(await field('Translation suggestions').inputValue(), '3');
    assert.equal(await field('Correction suggestions').inputValue(), '1');
    assert.equal(await field('Rephrasing suggestions').inputValue(), '3');
    await field('Translation suggestions').fill('0'); await page.getByRole('button', { name: 'Apply', exact: true }).click();
    assert.match(await page.getByRole('alert').innerText(), /displayed range/);
    await field('Translation suggestions').fill('4'); await field('Correction suggestions').fill('2.5');
    await page.getByRole('button', { name: 'Apply', exact: true }).click(); assert.match(await page.getByRole('alert').innerText(), /whole numbers/);
    await field('Correction suggestions').fill('2'); await field('Rephrasing suggestions').fill('5');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 650));
    for (const theme of ['dark', 'paper', 'contrast']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      await field('Rephrasing suggestions').scrollIntoViewIfNeeded(); await page.waitForTimeout(150);
      const bounds = await page.locator('.modal').boundingBox(), viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height);
      await page.screenshot({ path: path.join(output, `suggestion-count-settings-${theme}-min.png`) });
    }
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 850));
    await page.locator('.settings-content').evaluate(node => { node.scrollTop = 0; }); await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(output, 'suggestion-count-settings.png') });
    await page.getByRole('button', { name: 'Save settings', exact: true }).click(); await settings.waitFor({ state: 'hidden' });
    let persisted = await savedSettings(); assert.equal(persisted.translationSuggestions, 4); assert.equal(persisted.correctionSuggestions, 2); assert.equal(persisted.rephraseSuggestions, 5);
    checks.push('Older preferences get 3/1/3 defaults; three independent fields reject invalid targets, save 4/2/5, and fit both window sizes and all themes.');

    await select('uppåtvindar'); await editor.press('Tab'); await list.waitFor();
    assert.equal(await list.getAttribute('aria-label'), 'Translation alternatives'); assert.equal(await list.getByRole('option').count(), 4);
    assert.match(requests.at(-1).prompt, /aim for 4 distinct translations/); assert.match(requests.at(-1).prompt, /aim for 5 distinct natural rephrasings/);
    assert.equal(requests.length, 1); assert.equal(await savedText(), originalText);
    const beforeRetry = requests.length; await page.getByRole('button', { name: 'More alternatives', exact: true }).click();
    await waitFor(() => requests.length === beforeRetry + 1, 'The translation retry was not sent.'); await list.waitFor();
    assert.equal(await list.getByRole('option').count(), 4); assert.match(requests.at(-1).prompt, /aim for 4 distinct translations/); await dismiss();
    await select('a quiet route'); await editor.press('Tab'); await list.waitFor();
    assert.equal(await list.getAttribute('aria-label'), 'Rephrasing alternatives'); assert.equal(await list.getByRole('option').count(), 5);
    assert.deepEqual(await list.locator('.rephrase-option-description').allTextContents(), rephrasings.slice(0, 5).map(item => item.description));
    await editor.press('ArrowUp'); assert.equal(await list.locator('[aria-selected=true] .rephrase-option-text').textContent(), rephrasings[4].text);
    await promptFits(); await page.screenshot({ path: path.join(output, 'five-rephrasing-suggestions.png') }); await dismiss();
    checks.push('Translation and rephrasing targets produce four and five ranked choices from one request each, including retries and scrolling to the last option.');

    await select('She seen'); await editor.press('Control+Alt+g'); await list.waitFor();
    assert.equal(await list.getAttribute('aria-label'), 'Correction alternatives'); assert.equal(await list.getByRole('option').count(), 2);
    assert.equal(requests.at(-1).request.model, 'test-corrector');
    assert.match(requests.at(-1).prompt, /aim for 2 distinct minimal corrections/); assert.match(requests.at(-1).prompt, /do not offer stylistic rephrasings to fill the list/);
    assert.equal(await page.getByRole('button', { name: 'Describe your vibe', exact: true }).count(), 0);
    await page.screenshot({ path: path.join(output, 'two-correction-suggestions.png') });
    await list.getByRole('option', { name: 'She saw', exact: true }).click();
    await expectSavedText(originalText.replace('She seen', 'She saw'));
    assert.ok(!JSON.stringify(await recover()).includes(corrections[0].description));
    await command('undo'); await expectSavedText(originalText);
    forcedResponse = { kind: 'correction', currentRating: 3, alternatives: [] };
    await select('She seen'); await editor.press('Control+Alt+g'); await list.waitFor();
    assert.equal(await list.getByRole('option').count(), 0); const historySequence = (await recover()).historySequence;
    await editor.press('Enter'); await menu.waitFor({ state: 'hidden' }); assert.equal((await recover()).historySequence, historySequence);
    forcedResponse = null; legacyCorrection = true;
    await editor.press('Control+Alt+g'); await list.waitFor(); assert.equal(await list.getByRole('option').count(), 1);
    assert.equal(await list.locator('.rephrase-rating').textContent(), 'Unrated'); await dismiss(); legacyCorrection = false;
    checks.push('Correction uses its own model and two-option target; acceptance saves only the replacement, undo is atomic, and no-change or legacy responses remain usable.');

    await select('uppåtvindar'); await editor.press('Control+Alt+g'); await list.waitFor();
    assert.equal(await list.getByRole('option').count(), 4); assert.equal(await list.getAttribute('aria-label'), 'Translation alternatives'); await dismiss();
    await command('settings-ai'); await settings.waitFor(); await field('Rephrasing suggestions').fill('8');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click(); await settings.waitFor({ state: 'hidden' });
    await select('a quiet route'); await editor.press('Tab'); await list.waitFor();
    assert.equal(await list.getByRole('option').count(), 8); assert.match(requests.at(-1).prompt, /aim for 8 distinct natural rephrasings/);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 650)); await page.waitForTimeout(150);
    await editor.press('ArrowUp'); assert.equal(await list.locator('[aria-selected=true] .rephrase-option-text').textContent(), rephrasings[7].text);
    await promptFits(); await page.screenshot({ path: path.join(output, 'eight-suggestions-min.png') }); await dismiss();
    assert.equal(await savedText(), originalText); persisted = await savedSettings();
    assert.equal(persisted.translationSuggestions, 4); assert.equal(persisted.correctionSuggestions, 2); assert.equal(persisted.rephraseSuggestions, 8);
    await stop(); await launch();
    const boot = await page.evaluate(() => window.wraiter.boot());
    assert.equal(boot.prefs.translationSuggestions, 4); assert.equal(boot.prefs.correctionSuggestions, 2); assert.equal(boot.prefs.rephraseSuggestions, 8);
    checks.push('Foreign-language correction uses the translation target; eight choices remain keyboard-accessible at minimum size, and settings persist after restart.');
    assert.deepEqual(errors, []);
    const report = { passed: true, checks, userData }; await fs.writeFile(path.join(output, 'suggestion-count-results.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  } catch (error) { await page?.screenshot({ path: path.join(output, 'suggestion-count-failure.png') }).catch(() => {}); throw error; }
  finally { await stop(); await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
