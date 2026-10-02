// Synthetic text, an isolated desktop profile, and no AI requests.
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'test-output');
const presets = [['Yellow', '#fff29b'], ['Green', '#8de5a1'], ['Blue', '#8bc7ff'], ['Pink', '#ff9ecb'], ['Orange', '#ffbe79'], ['Purple', '#c6adff'], ['Red', '#ff9292'], ['Grey', '#b9c0ca']];
const waitFor = async (run, label) => { const until = Date.now() + 15000; while (Date.now() < until) { if (await run()) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error('Timed out: ' + label); };
const para = (text, marks = [], type = 'paragraph', attrs = {}) => ({ type, attrs, content: [{ type: 'text', text, marks }] });
const all = node => [node, ...(node.content || []).flatMap(all)];
const words = node => all(node).filter(node => node.type === 'text').map(node => node.text).join('');

(async () => {
  await fs.mkdir(output, { recursive: true });
  const userData = await fs.mkdtemp(path.join(output, 'formatting-')), file = path.join(userData, 'Toolbar colours.wraiter'), errors = [], checks = [], contrast = [];
  const fixture = { format: 'wraiter', version: 1, id: 'formatting-fixture', title: 'Toolbar colours', chapters: [{ id: 'chapter-one', title: 'Formatting examples', content: { type: 'doc', content: [
    para('Erase these styles.', [{ type: 'bold' }, { type: 'italic' }, { type: 'underline' }, { type: 'strike' }, { type: 'link', attrs: { href: 'https://example.com' } }, { type: 'textStyle', attrs: { color: '#aa1122', fontFamily: 'Arial', fontSize: '22pt', backgroundColor: '#ffffff' } }, { type: 'highlight', attrs: { color: '#8bc7ff' } }], 'heading', { level: 2, textAlign: 'center', lineHeight: '2', spaceAfter: 20, firstLineIndent: 12 }),
    para('Leave this styled passage alone.', [{ type: 'italic' }, { type: 'highlight', attrs: { color: '#ff9ecb' } }]),
    para('Colour this passage.', [{ type: 'bold' }]),
    para('Imported background stays readable.', [{ type: 'textStyle', attrs: { backgroundColor: '#ffffff', fontFamily: 'Cambria' } }, { type: 'underline' }]),
    para('Keyboard highlighting.'),
    para('Keep bold around the middle.', [{ type: 'bold' }, { type: 'highlight', attrs: { color: '#fff29b' } }])
  ] } }] };
  await fs.writeFile(file, JSON.stringify(fixture));
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, startup: 'restore', theme: 'dark', spellcheck: false }));
  const env = { ...process.env, WRAITER_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  const launchOptions = process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [file], env } : { args: [root, file], env };
  let application, page, editor;
  const launch = async () => {
    application = await _electron.launch({ ...launchOptions, timeout: 60000 }); page = await application.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true }); await editor.waitFor({ timeout: 30000 });
    await waitFor(async () => (await page.evaluate(() => window.wraiter.boot())).path === file, 'fixture open');
    await waitFor(async () => (await editor.innerText()).includes('Colour this passage.'), 'fixture rendered');
  };
  const close = async () => { await page?.evaluate(() => window.wraiter.finishClose()).catch(() => {}); await application?.close().catch(() => {}); application = null; };
  const saved = async () => JSON.parse(await fs.readFile(file, 'utf8'));
  const command = name => application.evaluate(({ BrowserWindow }, name) => BrowserWindow.getAllWindows()[0].webContents.send('command', name), name);
  const passage = text => editor.locator('p, h2').filter({ hasText: text });
  const select = async target => {
    await editor.evaluate((element, target) => {
      element.focus(); const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      const start = nodes.map(node => node.textContent).join('').indexOf(target), end = start + target.length;
      if (start < 0) throw new Error('Missing selection: ' + target);
      const range = document.createRange(); let offset = 0, began = false;
      for (const node of nodes) { const length = node.textContent.length; if (!began && start < offset + length) { range.setStart(node, start - offset); began = true; } if (began && end <= offset + length) { range.setEnd(node, end - offset); break; } offset += length; }
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    }, target);
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.getSelection().toString()), target);
  };
  const picker = () => page.getByRole('button', { name: 'Highlight colour', exact: true });
  const choose = async (name, colour) => {
    await picker().click(); await page.getByRole('dialog', { name: 'Highlight colours', exact: true }).waitFor();
    if (name) await page.getByRole('button', { name: name + ' highlight', exact: true }).click();
    else {
      await page.getByLabel('Custom highlight colour', { exact: true }).evaluate((input, colour) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, colour); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); }, colour);
      await editor.click();
    }
    await waitFor(async () => await passage('Colour this passage.').locator('mark').getAttribute('data-color') === colour, 'highlight ' + colour);
  };
  const sampleContrast = selector => page.locator(selector).evaluate(element => {
    const context = document.createElement('canvas').getContext('2d'), rgba = colour => { context.clearRect(0, 0, 1, 1); context.fillStyle = colour; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data]; };
    const style = getComputedStyle(element), foreground = rgba(style.color), background = rgba(style.backgroundColor), canvas = rgba(getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim()), alpha = background[3] / 255;
    const blended = background.slice(0, 3).map((channel, index) => channel * alpha + canvas[index] * (1 - alpha));
    const luminance = colour => colour.slice(0, 3).map(channel => { const value = channel / 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const first = luminance(foreground), second = luminance(blended);
    return { theme: document.documentElement.dataset.theme, background: style.backgroundColor, foreground: style.color, alpha, ratio: (Math.max(first, second) + .05) / (Math.min(first, second) + .05) };
  });
  try {
    await launch();
    await select('Erase these styles.'); await page.getByRole('button', { name: 'Clear formatting', exact: true }).click();
    assert.equal(await passage('Erase these styles.').evaluate(element => element.tagName), 'P');
    assert.equal(await passage('Erase these styles.').locator('strong, em, u, s, a, span, mark').count(), 0);
    assert.equal(await passage('Leave this styled passage alone.').locator('em mark, mark em').count(), 1);
    await waitFor(async () => (await saved()).chapters[0].content.content[0].type === 'paragraph', 'clear formatting saved');
    const cleared = (await saved()).chapters[0].content.content[0];
    assert.ok(!cleared.attrs.lineHeight && cleared.attrs.spaceAfter == null && cleared.attrs.firstLineIndent == null && !cleared.attrs.textAlign);
    assert.equal(words((await saved()).chapters[0].content), words(fixture.chapters[0].content));
    await editor.focus(); await page.keyboard.press('Control+z'); await editor.locator('h2').waitFor();
    assert.ok(await editor.locator('h2 mark').count()); await page.keyboard.press('Control+Shift+z'); await passage('Erase these styles.').locator('mark').waitFor({ state: 'hidden' });
    checks.push('Toolbar Clear formatting removes selected inline and paragraph styling, preserves all words and surrounding formatting, and supports undo/redo.');

    for (const [theme, label] of [['paper', 'Light'], ['dark', 'Dark'], ['contrast', 'High contrast']]) {
      await command('settings-appearance'); await page.getByRole('dialog', { name: 'Settings', exact: true }).waitFor();
      await page.getByRole('button', { name: label, exact: true }).click(); await page.getByRole('button', { name: 'Save settings', exact: true }).click();
      await page.getByRole('dialog', { name: 'Settings', exact: true }).waitFor({ state: 'hidden' });
      await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
      for (const [name, colour] of [...presets, [null, '#ffffff'], [null, '#000000'], [null, '#12abef']]) {
        await select('Colour this passage.'); await choose(name, colour);
        const result = await sampleContrast('.manuscript p:has-text("Colour this passage.") mark');
        assert.ok(result.alpha > .24 && result.alpha < .28, JSON.stringify(result));
        assert.ok(result.ratio >= 4.5, JSON.stringify(result)); contrast.push({ colour, ...result });
        assert.equal(await passage('Colour this passage.').locator('strong').innerText(), 'Colour this passage.');
      }
      const imported = await sampleContrast('.manuscript [data-wraiter-background]'); assert.ok(imported.ratio >= 4.5 && imported.alpha < .28, JSON.stringify(imported));
      await select('Colour this passage.'); await choose('Blue', '#8bc7ff');
      await select('Colour this passage.'); await picker().click();
      await page.screenshot({ path: path.join(output, `formatting-${theme}.png`) });
      await page.keyboard.press('Escape'); assert.equal(await picker().getAttribute('aria-expanded'), 'false');
      assert.equal(await picker().evaluate(element => element === document.activeElement), true);
    }
    checks.push('Eight presets and three custom colours keep at least 4.5:1 text contrast in light, dark and high-contrast themes; imported backgrounds use the same translucency.');

    await select('the middle'); await page.getByRole('button', { name: 'Clear formatting', exact: true }).click();
    assert.deepEqual(await passage('Keep bold around the middle.').locator('strong').allTextContents(), ['Keep bold around ', '.']);
    assert.equal(await passage('Keep bold around the middle.').innerText(), 'Keep bold around the middle.');
    await select('Keep bold around the middle.'); await page.keyboard.press('ArrowRight');
    await page.getByRole('button', { name: 'Clear formatting', exact: true }).click(); await page.keyboard.insertText(' Plain continuation.');
    assert.equal(await passage('Keep bold around the middle.').locator('strong, mark').filter({ hasText: 'Plain continuation.' }).count(), 0);
    checks.push('Clearing a partial selection leaves surrounding marks intact; clearing at an empty cursor makes subsequent typing plain.');
    await select('Imported background stays readable.'); await picker().click(); await page.getByRole('button', { name: 'No highlight', exact: true }).click();
    assert.equal(await passage('Imported background stays readable.').locator('[data-wraiter-background], mark').count(), 0);
    assert.equal(await passage('Imported background stays readable.').locator('u').innerText(), 'Imported background stays readable.');
    await select('Colour this passage.'); await picker().click(); await page.getByRole('button', { name: 'No highlight', exact: true }).click();
    assert.equal(await passage('Colour this passage.').locator('mark').count(), 0);
    assert.equal(await passage('Colour this passage.').locator('strong').innerText(), 'Colour this passage.');
    await page.getByRole('button', { name: 'Highlight', exact: true }).click(); await passage('Colour this passage.').locator('mark').waitFor();
    assert.equal(await passage('Colour this passage.').locator('mark').getAttribute('data-color'), '#8bc7ff');
    await page.getByRole('button', { name: 'Highlight', exact: true }).click(); await passage('Colour this passage.').locator('mark').waitFor({ state: 'hidden' });
    checks.push('No highlight and the main toggle clear highlight or imported background without removing bold, underline or font choices; the main button reapplies the last chosen colour.');

    await select('Keyboard highlighting.'); await page.keyboard.press('Control+Shift+h');
    const keyboard = await sampleContrast('.manuscript p:has-text("Keyboard highlighting.") mark'); assert.ok(keyboard.ratio >= 4.5 && keyboard.alpha < .28);
    await select('Colour this passage.'); await choose(null, '#12abef');
    await waitFor(async () => all((await saved()).chapters[0].content).some(node => node.text === 'Colour this passage.' && node.marks?.some(mark => mark.type === 'highlight' && mark.attrs.color === '#12abef')), 'custom colour saved');
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 650));
    await select('Colour this passage.'); await picker().click();
    const bounds = await page.getByRole('dialog', { name: 'Highlight colours', exact: true }).boundingBox(), viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height);
    await page.screenshot({ path: path.join(output, 'formatting-minimum.png') }); await page.keyboard.press('Escape');
    await close(); await launch();
    assert.equal(await passage('Colour this passage.').locator('mark').getAttribute('data-color'), '#12abef');
    assert.equal(await passage('Erase these styles.').locator('mark, strong, em, u, a').count(), 0);
    assert.equal(words((await saved()).chapters[0].content), words(fixture.chapters[0].content) + ' Plain continuation.');
    checks.push('Keyboard highlights remain readable, the palette fits the minimum 960 × 650 window, and clear formatting and exact custom colours survive a full application restart.');
    assert.deepEqual(errors, []);
    const report = { passed: true, packaged: !!process.env.WRAITER_EXECUTABLE, checks, minimumContrast: Math.min(...contrast.map(result => result.ratio)), contrast, userData };
    await fs.writeFile(path.join(output, process.env.WRAITER_EXECUTABLE ? 'formatting-packaged-results.json' : 'formatting-results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...report, contrast: undefined }, null, 2));
  } catch (error) { await page?.screenshot({ path: path.join(output, 'formatting-failure.png') }).catch(() => {}); console.error('Renderer errors:', errors); throw error; }
  finally { await close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
