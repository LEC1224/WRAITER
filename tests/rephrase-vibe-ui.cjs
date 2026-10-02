const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-output');
const sentence = 'As the day came to an end and the ground cooled, the uppåtvindar that had carried her weakened.';
const desiredVibe = 'I want the reader to feel the sense of avian navigation through her eyes';
const normalOptions = [
  { text: 'updrafts', rating: 3, description: 'Concise weather terminology for rising air.' },
  { text: 'rising air currents', rating: 2, description: 'More descriptive, emphasizing the movement of the air.' },
  { text: 'upward-moving air', rating: 1, description: 'Plain wording that makes the direction of movement explicit.' }
];
const guidedOptions = [
  { text: 'thermals', rating: 3, description: 'Frames rising air as lift she can read and ride.' },
  { text: 'columns of lift', rating: 2, description: 'Makes the air feel like a route she can navigate.' },
  { text: 'rising currents', rating: 2, description: 'Emphasizes her bodily sense of the air carrying her.' }
];
const waitFor = async (check, message) => {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(message);
};

(async () => {
  await fs.mkdir(output, { recursive: true });
  const userData = await fs.mkdtemp(path.join(output, 'rephrase-vibe-'));
  const requests = [], errors = [], checks = [];
  let legacyResponse = false, customResponse = null;
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET') return res.end('{"models":[{"name":"test-rewriter"}]}');
    let source = ''; for await (const chunk of req) source += chunk;
    const request = JSON.parse(source); requests.push(request);
    const guided = JSON.stringify(request).includes(desiredVibe), alternatives = guided ? guidedOptions : normalOptions;
    const answer = customResponse ? JSON.stringify(customResponse) : legacyResponse ? 'updrafts' : JSON.stringify({ currentRating: guided ? 2 : 1, alternatives });
    res.end(JSON.stringify({ message: { content: JSON.stringify({ completion: answer }) } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const fixture = { format: 'wraiter', version: 1, id: 'vibe-' + Date.now(), title: 'Rephrasing direction', language: 'en-US', chapters: [{ id: 'opening', title: 'Opening', status: 'Draft', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: sentence }] }] } }] };
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, provider: 'ollama', baseUrl: `http://127.0.0.1:${server.address().port}`, model: 'test-rewriter', ollamaMode: 'guided', enabled: true, continuous: false, nativeLanguage: 'sv-SE', theme: 'dark', spellcheck: false }));
  await fs.writeFile(path.join(userData, 'recovery.json'), JSON.stringify({ project: fixture, path: null, expectedHash: null }));
  const env = { ...process.env, WRAITER_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  let app, page;
  try {
    app = await _electron.launch(process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [], env } : { args: [root], env });
    page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    const editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true }); await editor.waitFor();
    const command = name => app.evaluate(({ BrowserWindow }, name) => BrowserWindow.getAllWindows()[0].webContents.send('command', name), name);
    const recover = async () => JSON.parse(await fs.readFile(path.join(userData, 'recovery.json'), 'utf8')).project;
    const savedText = async () => (await recover()).chapters[0].content.content.map(block => (block.content || []).map(node => node.text || '').join('')).join('\n');
    const expectSavedText = async expected => {
      // Reading the recovery file during atomic replacement can lock it on Windows.
      await page.waitForFunction(expected => [...document.querySelector('.manuscript').querySelectorAll(':scope > p')].map(node => node.textContent).join('\n') === expected && document.querySelector('.save-indicator')?.textContent.trim() === 'Autosaved', expected);
      assert.equal(await savedText(), expected);
    };
    const list = page.getByRole('listbox', { name: 'Rephrasing alternatives', exact: true });
    const currentRating = page.getByRole('group', { name: 'Current phrase rating', exact: true });
    const vibeLink = page.getByRole('button', { name: 'Describe your vibe', exact: true });
    const vibeField = page.getByRole('textbox', { name: 'Describe your vibe', exact: true });
    const find = page.getByRole('button', { name: 'Find alternatives', exact: true });
    const selectOriginal = async (word = 'uppåtvindar') => {
      await editor.evaluate((element, word) => {
        element.focus(); const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const start = walker.currentNode.textContent.indexOf(word); if (start < 0) continue;
          const range = document.createRange(); range.setStart(walker.currentNode, start); range.setEnd(walker.currentNode, start + word.length);
          const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event('selectionchange')); return;
        }
        throw new Error('The selected word was missing.');
      }, word);
      await page.mouse.move(0, 0); await page.waitForTimeout(150);
    };
    const menuFits = async () => {
      const bounds = await page.locator('.rephrase-menu').boundingBox();
      const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height, JSON.stringify({ bounds, viewport }));
      assert.ok(await find.isVisible());
    };

    await selectOriginal(); await editor.press('Tab'); await list.waitFor();
    assert.equal(await list.getByRole('option').count(), 3); assert.equal(requests.length, 1);
    assert.equal(await currentRating.locator('.rephrase-rating').textContent(), '★☆☆');
    assert.equal(await currentRating.locator('.rephrase-rating').getAttribute('aria-label'), '1 of 3 stars for context fit');
    assert.equal(await page.locator('.rephrase-rating-standing').count(), 0);
    assert.equal(await savedText(), sentence);
    await vibeLink.click(); await vibeField.waitFor();
    assert.equal(await vibeField.evaluate(node => node === document.activeElement), true);
    assert.equal(await vibeLink.getAttribute('aria-expanded'), 'true'); assert.equal(await find.isDisabled(), true);
    await vibeField.fill('  '); assert.equal(await find.isDisabled(), true);
    const activeBeforeTyping = await list.locator('[aria-selected=true]').getAttribute('id');
    await vibeField.fill(desiredVibe); await vibeField.press('ArrowUp');
    assert.equal(await list.locator('[aria-selected=true]').getAttribute('id'), activeBeforeTyping);
    assert.equal(requests.length, 1); assert.equal(await savedText(), sentence);
    await vibeField.press('Escape'); await vibeField.waitFor({ state: 'hidden' });
    assert.equal(await editor.evaluate(node => node === document.activeElement), true);
    await vibeLink.click(); assert.equal(await vibeField.inputValue(), ''); await vibeField.fill(desiredVibe);
    await page.locator('.rephrase-vibe-form').getByRole('button', { name: 'Cancel', exact: true }).click();
    await vibeField.waitFor({ state: 'hidden' }); assert.equal(requests.length, 1);
    checks.push('The link focuses a field; typing, arrow keys, Escape and Cancel preserve the manuscript and make no AI request.');

    await vibeLink.click(); await vibeField.fill(desiredVibe);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 650));
    for (const theme of ['dark', 'paper', 'contrast']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme); await page.waitForTimeout(250); await menuFits();
      await page.screenshot({ path: path.join(output, `describe-vibe-${theme}-min.png`) });
    }
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 850));
    await page.waitForTimeout(250); await menuFits(); await page.screenshot({ path: path.join(output, 'describe-vibe.png') });
    checks.push('The form and its submit button fit the minimum and larger windows in all three themes.');
    assert.ok(!JSON.stringify(await recover()).includes(desiredVibe));
    await vibeField.press('Tab'); await page.keyboard.press('Tab'); assert.equal(await find.evaluate(node => node === document.activeElement), true);
    await find.press('Enter'); await list.getByRole('option', { name: 'thermals', exact: true }).waitFor();
    assert.equal(requests.length, 2);
    assert.equal(await currentRating.locator('.rephrase-rating').textContent(), '★★☆');
    assert.deepEqual(await page.locator('.rephrase-option-description').allTextContents(), guidedOptions.map(option => option.description));
    const prompt = requests.at(-1).messages.find(message => message.role === 'user').content;
    assert.ok(prompt.includes(desiredVibe)); assert.ok(prompt.includes('SELECTED TEXT:\nuppåtvindar'));
    assert.ok(prompt.includes('As the day came to an end')); assert.ok(prompt.includes('that had carried her weakened'));
    assert.ok(prompt.includes('preserving the selected text\'s meaning')); assert.equal(await savedText(), sentence);
    assert.ok(prompt.includes('"currentRating":')); assert.ok(prompt.includes('on the same scale'));
    await vibeLink.click(); assert.equal(await vibeField.inputValue(), desiredVibe); await vibeField.press('Escape');
    const beforeRetry = requests.length; await page.getByRole('button', { name: 'More alternatives', exact: true }).click();
    await waitFor(() => requests.length === beforeRetry + 1, 'The guided retry was not sent.');
    await list.getByRole('option', { name: 'thermals', exact: true }).waitFor();
    assert.equal(await currentRating.locator('.rephrase-rating').textContent(), '★★☆');
    assert.equal(JSON.stringify(requests.at(-1)).split(desiredVibe).length - 1, 1);
    await page.screenshot({ path: path.join(output, 'vibe-alternatives.png') });
    checks.push('Submitting sends one request with the vibe and original context; editing and More alternatives retain the guidance without duplication.');

    await list.getByRole('option', { name: 'thermals', exact: true }).click();
    await expectSavedText(sentence.replace('uppåtvindar', 'thermals'));
    assert.ok(!JSON.stringify(await recover()).includes(desiredVibe));
    await command('undo'); await expectSavedText(sentence);
    legacyResponse = true; await selectOriginal(); await editor.press('Tab'); await list.waitFor();
    assert.ok(!JSON.stringify(requests.at(-1)).includes(desiredVibe));
    await vibeLink.click(); assert.equal(await vibeField.inputValue(), ''); await vibeField.press('Escape');
    assert.equal(await list.getByRole('option').count(), 1); assert.equal(await page.locator('.rephrase-option-description').count(), 0);
    assert.equal(await list.locator('.rephrase-rating').textContent(), 'Unrated');
    assert.equal(await currentRating.locator('.rephrase-rating').textContent(), 'Unrated'); await editor.press('Escape');
    checks.push('Only the chosen replacement is saved, undo restores the original, and fresh requests clear the vibe while preserving plain-response compatibility.');

    const comparisonOptions = [
      { text: 'earth cooled', rating: 2, description: 'A broader, slightly less immediate sense of the cooling surface.' },
      { text: 'ground grew cold', rating: 1, description: 'Suggests a colder endpoint than the original wording.' }
    ];
    customResponse = { currentRating: 3, alternatives: comparisonOptions };
    await selectOriginal('ground cooled'); await editor.press('Tab'); await list.waitFor();
    assert.equal(await currentRating.locator('.rephrase-rating').textContent(), '★★★');
    assert.equal(await page.locator('.rephrase-rating-standing').textContent(), 'Highest rated');
    await editor.press('ArrowDown'); assert.equal(await list.locator('[aria-selected=true]').textContent(), comparisonOptions[1].text + comparisonOptions[1].description + '★☆☆');
    assert.equal(await savedText(), sentence);
    await page.mouse.move(0, 0); await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(output, 'current-phrase-rating.png') });
    await editor.press('Escape'); await list.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.getSelection().toString()), 'ground cooled');
    customResponse = { currentRating: 3, alternatives: [{ ...comparisonOptions[0], rating: 3 }] };
    await editor.press('Tab'); await list.waitFor();
    assert.equal(await page.locator('.rephrase-rating-standing').textContent(), 'Tied highest');
    await editor.press('Escape'); await list.waitFor({ state: 'hidden' });
    customResponse = { currentRating: 3, alternatives: [{ text: 'earth cooled', rating: null }] };
    await editor.press('Tab'); await list.waitFor();
    assert.equal(await page.locator('.rephrase-rating-standing').count(), 0);
    await editor.press('Escape'); await list.waitFor({ state: 'hidden' });
    checks.push('The original phrase uses the same accessible stars, refreshes with guidance, and indicates highest or tied ratings only when all alternatives are rated.');

    for (const alternatives of [[], [{ text: 'ground cooled', rating: 3 }]]) {
      customResponse = { currentRating: 3, alternatives };
      await editor.press('Tab'); await list.waitFor();
      assert.equal(await currentRating.locator('.rephrase-rating').textContent(), '★★★');
      assert.equal(await list.getByRole('option').count(), 0);
      assert.equal(await page.locator('.rephrase-no-alternatives').count(), 1);
      assert.equal(await editor.getAttribute('aria-activedescendant'), null);
      assert.equal(await editor.locator('.ghost-text, .revision-source').count(), 0);
      assert.equal(await page.locator('.ghost-controls, .revision-card').count(), 0);
      const historySequence = (await recover()).historySequence;
      await editor.press('ArrowDown'); await editor.press('ArrowUp');
      await vibeLink.click(); await vibeField.fill(desiredVibe); await vibeField.press('Escape');
      assert.equal(await list.isVisible(), true);
      await page.screenshot({ path: path.join(output, 'current-phrase-no-change.png') });
      await editor.press(alternatives.length ? 'Tab' : 'Enter'); await list.waitFor({ state: 'hidden' });
      assert.equal(await savedText(), sentence); assert.equal((await recover()).historySequence, historySequence);
    }
    customResponse = { currentRating: 3, alternatives: [] };
    await editor.press('Tab'); await list.waitFor();
    customResponse = { currentRating: 3, alternatives: comparisonOptions };
    const beforeRatedRetry = requests.length;
    await page.getByRole('button', { name: 'More alternatives', exact: true }).click();
    await list.getByRole('option', { name: 'earth cooled', exact: true }).waitFor();
    assert.equal(requests.length, beforeRatedRetry + 1);
    await editor.press('Escape'); await list.waitFor({ state: 'hidden' });
    customResponse = { currentRating: 3, alternatives: [] };
    await editor.press('Tab'); await list.waitFor();
    await vibeLink.click(); await vibeField.fill('Make the cooling ground feel immediate through her senses.');
    customResponse = { currentRating: 2, alternatives: comparisonOptions };
    const beforeRatedVibe = requests.length;
    await find.click(); await list.getByRole('option', { name: 'earth cooled', exact: true }).waitFor();
    assert.equal(requests.length, beforeRatedVibe + 1);
    const ratedPrompt = requests.at(-1).messages.find(message => message.role === 'user').content;
    assert.ok(ratedPrompt.includes('Make the cooling ground feel immediate through her senses.'));
    assert.ok(ratedPrompt.includes('SELECTED TEXT:\nground cooled'));
    assert.equal(await currentRating.locator('.rephrase-rating').textContent(), '★★☆');
    await editor.press('Escape'); await list.waitFor({ state: 'hidden' });
    customResponse = { currentRating: 3, alternatives: [] };
    await editor.press('Tab'); await list.waitFor();
    await editor.press('ArrowRight'); await list.waitFor({ state: 'hidden' });
    assert.equal(await savedText(), sentence);
    checks.push('An empty or unchanged alternatives list still shows the original rating; keeping it adds no edit or undo entry, and retry, vibe, and selection dismissal remain usable.');
    assert.deepEqual(errors, []);
    const report = { passed: true, checks, userData }; await fs.writeFile(path.join(output, 'rephrase-vibe-results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    await page?.screenshot({ path: path.join(output, 'rephrase-vibe-failure.png') }).catch(() => {}); throw error;
  } finally {
    await app?.close().catch(() => {});
    await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
