// Synthetic text, an isolated desktop profile, and no AI requests.
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'test-output');
const waitFor = async (run, label) => { const until = Date.now() + 15000; while (Date.now() < until) { if (await run()) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error('Timed out: ' + label); };
const all = node => [node, ...(node.content || []).flatMap(all)];
const words = node => all(node).filter(node => node.type === 'text').map(node => node.text).join('');
const para = (text, marks = []) => ({ type: 'paragraph', content: [{ type: 'text', text, marks }] });
const pickers = [
  { kind: 'text', button: 'Text colour', dialog: 'Text colours', input: 'Custom text colour', suffix: 'text colour', passage: 'Colour these words.', mark: 'textStyle', primary: '#fff29b', secondary: '#123456', presets: [['Black', '#000000'], ['White', '#ffffff'], ['Grey', '#808080'], ['Red', '#d32f2f'], ['Orange', '#ed6c02'], ['Green', '#2e7d32'], ['Blue', '#1565c0'], ['Purple', '#7b1fa2']] },
  { kind: 'highlight', button: 'Highlight colour', dialog: 'Highlight colours', input: 'Custom highlight colour', suffix: 'highlight', passage: 'Highlight these words.', mark: 'highlight', primary: '#1565c0', secondary: '#abcdef', presets: [['Yellow', '#fff29b'], ['Green', '#8de5a1'], ['Blue', '#8bc7ff'], ['Pink', '#ff9ecb'], ['Orange', '#ffbe79'], ['Purple', '#c6adff'], ['Red', '#ff9292'], ['Grey', '#b9c0ca']] }
];

(async () => {
  await fs.mkdir(output, { recursive: true });
  const userData = await fs.mkdtemp(path.join(output, 'color-pickers-')), file = path.join(userData, 'Custom colour palettes.wraiter'), errors = [], checks = [];
  const fixture = { format: 'wraiter', version: 1, id: 'colour-picker-fixture', title: 'Custom colour palettes', chapters: [{ id: 'chapter-one', title: 'Palette examples', content: { type: 'doc', content: [
    para('Colour these words.', [{ type: 'bold' }]),
    para('Highlight these words.', [{ type: 'underline' }]),
    para('Keep this passage unchanged.', [{ type: 'italic' }, { type: 'textStyle', attrs: { color: '#aa1122' } }])
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
    await waitFor(async () => (await editor.innerText()).includes('Colour these words.'), 'fixture rendered');
  };
  const close = async () => { await page?.evaluate(() => window.wraiter.finishClose()).catch(() => {}); await application?.close().catch(() => {}); application = null; };
  const saved = async () => JSON.parse(await fs.readFile(file, 'utf8'));
  const passage = text => editor.locator('p').filter({ hasText: text });
  const button = picker => page.getByRole('button', { name: picker.button, exact: true });
  const dialog = picker => page.getByRole('dialog', { name: picker.dialog, exact: true });
  const group = (picker, name) => dialog(picker).getByRole('group', { name, exact: true });
  const swatch = (picker, colour) => dialog(picker).getByRole('button', { name: `${colour} ${picker.suffix}`, exact: true });
  const paletteColours = async (picker, name) => (await group(picker, name).getByRole('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')))).filter(label => /^#[\da-f]{6} /.test(label)).map(label => label.slice(0, 7));
  const stored = picker => page.evaluate(kind => JSON.parse(localStorage.getItem(`wraiter.colour-palette.${kind}.v1`) || '{"locked":[],"recent":[]}'), picker.kind);
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
  const open = async picker => { await button(picker).click(); await dialog(picker).waitFor(); };
  const dismiss = async picker => { await dialog(picker).getByRole('button').first().focus(); await page.keyboard.press('Escape'); await dialog(picker).waitFor({ state: 'hidden' }); assert.ok(await button(picker).evaluate(element => element === document.activeElement)); };
  const custom = (picker, colour, commit = true) => page.getByLabel(picker.input, { exact: true }).evaluate((input, { colour, commit }) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, colour);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    if (commit) input.dispatchEvent(new Event('change', { bubbles: true }));
  }, { colour, commit });
  const applied = async (picker, colour) => waitFor(async () => all((await saved()).chapters[0].content).some(node => node.text === picker.passage && node.marks?.some(mark => mark.type === picker.mark && mark.attrs?.color === colour)), `${picker.kind} colour ${colour} saved on selected words`);
  const withinViewport = async picker => {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const bounds = await dialog(picker).boundingBox(), viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width + 1 && bounds.y + bounds.height <= viewport.height + 1, JSON.stringify({ bounds, viewport }));
  };
  try {
    await launch();
    const untouched = await passage('Keep this passage unchanged.').innerHTML();
    for (const picker of pickers) {
      const other = pickers.find(item => item !== picker), otherBefore = await stored(other);
      await select(picker.passage); await open(picker);
      assert.equal(await group(picker, 'Default colours').getByRole('button').count(), 8);
      assert.deepEqual(await paletteColours(picker, 'Recent custom colours'), []);
      for (const [name, colour] of picker.presets) {
        await dialog(picker).getByRole('button', { name: `${name} ${picker.suffix}`, exact: true }).click();
        await applied(picker, colour); await open(picker);
        assert.deepEqual(await paletteColours(picker, 'Recent custom colours'), []);
      }
      // Native input previews may arrive repeatedly; only the native change commits history.
      await custom(picker, '#102030', false); await custom(picker, picker.primary, false);
      await applied(picker, picker.primary);
      assert.deepEqual(await paletteColours(picker, 'Recent custom colours'), []);
      await page.getByLabel(picker.input, { exact: true }).evaluate(input => input.dispatchEvent(new Event('change', { bubbles: true })));
      assert.deepEqual(await paletteColours(picker, 'Recent custom colours'), [picker.primary]);
      await custom(picker, picker.secondary);
      assert.deepEqual(await paletteColours(picker, 'Recent custom colours'), [picker.secondary, picker.primary]);
      await custom(picker, picker.primary);
      assert.deepEqual(await paletteColours(picker, 'Recent custom colours'), [picker.primary, picker.secondary]);
      await custom(picker, picker.presets[0][1]); await applied(picker, picker.presets[0][1]);
      assert.deepEqual(await paletteColours(picker, 'Recent custom colours'), [picker.primary, picker.secondary]);
      checks.push(`${picker.kind}: defaults stay out of history, committed custom choices are unique and newest first, and intermediate previews do not become history entries.`);

      const beforeLock = await editor.innerHTML();
      const lock = () => dialog(picker).getByRole('button', { name: `Lock ${picker.primary}`, exact: true });
      const unlock = () => dialog(picker).getByRole('button', { name: `Unlock ${picker.primary}`, exact: true });
      await lock().focus(); await lock().press('Enter');
      assert.deepEqual(await paletteColours(picker, 'Locked colours'), [picker.primary]);
      assert.deepEqual(await paletteColours(picker, 'Recent custom colours'), [picker.secondary]);
      assert.equal(await editor.innerHTML(), beforeLock);
      const defaultsBox = await group(picker, 'Default colours').boundingBox(), lockedBox = await group(picker, 'Locked colours').boundingBox();
      assert.ok(lockedBox.y > defaultsBox.y + defaultsBox.height, 'Locked colours appear below the default palette.');
      await unlock().focus(); await unlock().press('Enter');
      assert.deepEqual(await paletteColours(picker, 'Locked colours'), []);
      assert.deepEqual(await paletteColours(picker, 'Recent custom colours'), [picker.primary, picker.secondary]);
      assert.equal(await editor.innerHTML(), beforeLock);
      await lock().click();
      assert.equal(await editor.innerHTML(), beforeLock);
      await custom(picker, picker.primary);
      assert.deepEqual(await paletteColours(picker, 'Recent custom colours'), [picker.secondary]);
      await swatch(picker, picker.secondary).click(); await applied(picker, picker.secondary); await open(picker);
      await swatch(picker, picker.primary).click(); await applied(picker, picker.primary); await open(picker);
      assert.deepEqual(await paletteColours(picker, 'Locked colours'), [picker.primary]);
      assert.deepEqual(await paletteColours(picker, 'Recent custom colours'), [picker.secondary]);
      assert.deepEqual(await stored(other), otherBefore);
      await withinViewport(picker);
      await page.screenshot({ path: path.join(output, `color-pickers-${picker.kind}.png`) });
      await dismiss(picker);
      checks.push(`${picker.kind}: keyboard and pointer locking move colours without formatting edits; unlocked colours return to history, locked choices stay excluded, and swatches still apply to the selected passage.`);
    }
    const textPicker = pickers[0], highlightPicker = pickers[1];
    await select(textPicker.passage); await open(textPicker);
    await dialog(textPicker).getByRole('button', { name: 'Automatic text colour', exact: true }).click();
    await waitFor(async () => !all((await saved()).chapters[0].content).some(node => node.text === textPicker.passage && node.marks?.some(mark => mark.type === 'textStyle' && mark.attrs?.color)), 'automatic text colour saved');
    assert.equal(await passage(textPicker.passage).locator('strong').innerText(), textPicker.passage);
    assert.equal(await passage(highlightPicker.passage).locator('u').innerText(), highlightPicker.passage);
    assert.equal(await passage('Keep this passage unchanged.').innerHTML(), untouched);
    checks.push('Automatic text colour removes only the explicit font colour; surrounding bold, underline and unrelated passages stay unchanged.');

    await open(textPicker);
    const recent = [];
    for (let index = 1; index <= 14; index++) { const colour = '#' + (0x110000 + index).toString(16); recent.unshift(colour); await custom(textPicker, colour); }
    assert.deepEqual(await paletteColours(textPicker, 'Recent custom colours'), recent.slice(0, 12));
    assert.deepEqual(await paletteColours(textPicker, 'Locked colours'), [textPicker.primary]);
    await applied(textPicker, recent[0]);
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 650));
    await withinViewport(textPicker);
    await page.screenshot({ path: path.join(output, 'color-pickers-minimum.png') });
    const expected = await Promise.all(pickers.map(stored));
    await dismiss(textPicker); await close(); await launch();
    for (let index = 0; index < pickers.length; index++) {
      const picker = pickers[index]; await open(picker);
      assert.deepEqual(await stored(picker), expected[index]);
      assert.deepEqual(await paletteColours(picker, 'Locked colours'), expected[index].locked);
      assert.deepEqual(await paletteColours(picker, 'Recent custom colours'), expected[index].recent);
      await withinViewport(picker); await dismiss(picker);
    }
    // A large saved palette must keep keyboard focus visible when a colour moves
    // between the top locked section and history at the bottom of the popup.
    const manyLocked = Array.from({ length: 40 }, (_, index) => '#' + (0x220001 + index).toString(16));
    await page.evaluate(locked => localStorage.setItem('wraiter.colour-palette.text.v1', JSON.stringify({ locked, recent: ['#abcdef'] })), manyLocked);
    await page.reload(); await editor.waitFor({ timeout: 30000 });
    await waitFor(async () => (await editor.innerText()).includes(textPicker.passage), 'fixture rendered after palette reload');
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 650));
    await open(textPicker); await withinViewport(textPicker);
    assert.ok(await dialog(textPicker).evaluate(element => element.scrollHeight > element.clientHeight), 'Large palettes scroll within the popup.');
    const beforeOverflowLock = await editor.innerHTML();
    const visibleAction = async name => {
      const action = dialog(textPicker).getByRole('button', { name, exact: true });
      assert.ok(await action.evaluate(element => {
        const bounds = element.getBoundingClientRect(), popup = element.closest('[role="dialog"]').getBoundingClientRect();
        return document.activeElement === element && bounds.top >= popup.top && bounds.bottom <= popup.bottom && bounds.left >= popup.left && bounds.right <= popup.right;
      }), `${name} remains focused and visible after moving.`);
    };
    await dialog(textPicker).getByRole('button', { name: `Unlock ${manyLocked[0]}`, exact: true }).press('Enter');
    await visibleAction(`Lock ${manyLocked[0]}`);
    assert.equal(await editor.innerHTML(), beforeOverflowLock);
    await page.screenshot({ path: path.join(output, 'color-pickers-overflow.png') });
    await page.keyboard.press('Enter'); await visibleAction(`Unlock ${manyLocked[0]}`);
    assert.equal(await editor.innerHTML(), beforeOverflowLock);
    await dismiss(textPicker);
    assert.equal(words((await saved()).chapters[0].content), words(fixture.chapters[0].content));
    assert.equal(await passage('Keep this passage unchanged.').innerHTML(), untouched);
    assert.deepEqual(errors, []);
    checks.push('Histories retain the latest 12 custom colours; font and highlight palettes stay independent, fit the minimum window, and survive a full application restart without text changes.');
    checks.push('A 40-colour locked palette scrolls within the minimum window; keyboard lock/unlock moves focus into view without changing manuscript formatting.');
    const report = { passed: true, packaged: !!process.env.WRAITER_EXECUTABLE, checks, userData };
    await fs.writeFile(path.join(output, process.env.WRAITER_EXECUTABLE ? 'color-pickers-packaged-results.json' : 'color-pickers-results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) { await page?.screenshot({ path: path.join(output, 'color-pickers-failure.png') }).catch(() => {}); console.error('Renderer errors:', errors); throw error; }
  finally { await close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
