// Real desktop gestures in an isolated profile, using fictional manuscripts.
// Native popup menus and external link launches are captured inside this app.
const { _electron } = require('playwright');
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), paragraph = text => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const nodes = node => [node, ...(node.content || []).flatMap(nodes)];
const waitFor = async (check, label) => { const until = Date.now() + 15000; while (Date.now() < until) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 70)); } throw new Error('Timed out: ' + label); };
(async () => {
  await fs.mkdir(path.join(root, 'test-output'), { recursive: true });
  const userData = await fs.mkdtemp(path.join(root, 'test-output', 'document-ux-')), file = path.join(userData, 'UX manuscript.wraiter'), checks = [], errors = [];
  const fixture = { format: 'wraiter', version: 1, id: 'ux-fixture', title: 'UX manuscript', chapters: [
    { id: 'opening', title: 'Opening', content: { type: 'doc', content: [paragraph('Before needle, then needle.'), { type: 'paragraph', content: [{ type: 'text', text: 'Visit the example', marks: [{ type: 'link', attrs: { href: 'https://example.com/reading' } }] }] }, ...Array.from({ length: 65 }, (_, index) => paragraph(`Reading paragraph ${index + 1}. A calm river passes the quiet village under a pale sky.`))] } },
    { id: 'middle', title: 'Middle', content: { type: 'doc', content: [paragraph('A needle in the middle.')] } },
    { id: 'ending', title: 'Ending', content: { type: 'doc', content: [paragraph('The last needle.')] } }
  ] };
  await fs.writeFile(file, JSON.stringify(fixture));
  await fs.writeFile(path.join(userData, 'recovery.json'), JSON.stringify({ project: fixture, path: file, expectedHash: require('../electron/core.cjs').hash(JSON.stringify(fixture)) }));
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, startup: 'restore', spellcheck: false }));
  const env = { ...process.env, WRAITER_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  let app, page, editor, cdp;
  const launch = async () => {
    const options = process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [] } : { args: [root] };
    app = await _electron.launch({ ...options, env, timeout: 60000 }); page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true }); await editor.waitFor({ timeout: 30000 });
    await page.waitForFunction(() => !document.querySelector('.workspace[inert]') && document.querySelector('[role="tab"]:not(:disabled)'));
    cdp = await page.context().newCDPSession(page);
    await app.evaluate(({ Menu, shell }) => { globalThis.uxMenu = null; globalThis.uxLinks = []; const build = Menu.buildFromTemplate; Menu.buildFromTemplate = template => { const menu = build(template); menu.popup = () => { globalThis.uxMenu = template; }; return menu; }; shell.openExternal = async href => { globalThis.uxLinks.push(href); }; });
  };
  const close = async () => { await page?.evaluate(() => window.wraiter.finishClose()).catch(() => {}); await app?.close().catch(() => {}); app = null; };
  const command = name => app.evaluate(({ BrowserWindow }, name) => BrowserWindow.getAllWindows()[0].webContents.send('command', name), name);
  const saved = async () => JSON.parse(await fs.readFile(file, 'utf8'));
  const images = async () => (await saved()).chapters.flatMap(chapter => nodes(chapter.content).filter(node => node.type === 'image'));
  const idle = () => page.waitForFunction(() => !document.querySelector('.workspace[inert]') && document.querySelector('[role="tab"]:not(:disabled)'));
  const select = async text => {
    await editor.locator('p').filter({ hasText: text }).first().evaluate((element, text) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT); let node; while (walker.nextNode()) if (walker.currentNode.textContent.includes(text)) { node = walker.currentNode; break; }
      const start = node.textContent.indexOf(text), range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + text.length);
      element.closest('[contenteditable]').focus(); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    }, text); await page.waitForTimeout(80);
  };
  const fileDrag = async (files, locator) => { await locator.scrollIntoViewIfNeeded(); const box = await locator.boundingBox(), x = Math.round(box.x + Math.min(20, box.width / 2)), y = Math.round(box.y + Math.min(30, box.height / 2)), data = { items: [], files, dragOperationsMask: 1 }; for (const type of ['dragEnter', 'dragOver', 'drop']) await cdp.send('Input.dispatchDragEvent', { type, x, y, data }); };
  const reorderDrag = async (source, target, edge) => {
    const a = await source.boundingBox(), b = await target.boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 8, a.y + a.height / 2 + 8, { steps: 4 });
    await page.mouse.move(b.x + b.width * (edge === 'right' ? .85 : .5), b.y + b.height * (edge === 'bottom' ? .85 : .15), { steps: 12 }); await page.waitForTimeout(150); await page.mouse.up();
  };
  const popup = async locator => { await app.evaluate(() => { globalThis.uxMenu = null; }); await locator.click({ button: 'right' }); await waitFor(() => app.evaluate(() => !!globalThis.uxMenu), 'native context menu'); return app.evaluate(() => globalThis.uxMenu.map(item => ({ id: item.id, label: item.label, enabled: item.enabled }))); };
  const menuAction = async id => { await app.evaluate((_, id) => { const item = globalThis.uxMenu.find(item => item.id === id); if (!item || item.enabled === false) throw new Error('Unavailable menu action: ' + id); item.click(); }, id); await page.waitForTimeout(100); };
  try {
    await launch(); await editor.getByText('Before needle, then needle.', { exact: true }).waitFor();
    await waitFor(async () => !!(await saved()).chapters[0].content.content[0].attrs, 'normalized initial save');
    const png = path.join(userData, 'Landscape.png');
    const base64 = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 180; canvas.height = 90; const context = canvas.getContext('2d'); context.fillStyle = '#88aabb'; context.fillRect(0, 0, 180, 90); return canvas.toDataURL().split(',')[1]; });
    await fs.writeFile(png, Buffer.from(base64, 'base64'));
    await fileDrag([png], editor.locator('p').first()); await waitFor(async () => (await images()).length === 1, 'inserted image');
    await editor.locator('img').click(); await page.getByRole('toolbar', { name: 'Image controls' }).waitFor();
    const handle = editor.locator('[data-image-resize="bottom-right"]'), bounds = await handle.boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width / 2 + 60, bounds.y + bounds.height / 2 + 30, { steps: 8 }); await page.mouse.up();
    await waitFor(async () => (await images())[0].attrs.width === 240, 'resized image width'); assert.equal((await images())[0].attrs.height, 120);
    await command('undo'); await waitFor(async () => (await images())[0].attrs.width === null, 'one resize undo'); await command('redo'); await waitFor(async () => (await images())[0].attrs.width === 240, 'resize redo');
    checks.push('Image corner drag preserves proportions and has one durable undo step.');
    await editor.locator('img').click(); await page.getByRole('button', { name: 'Image properties…' }).click();
    await page.getByRole('textbox', { name: 'Image description' }).fill('A blue landscape beside a river'); await page.getByRole('spinbutton', { name: 'Image width' }).fill('300'); assert.equal(await page.getByRole('spinbutton', { name: 'Image height' }).inputValue(), '150');
    await page.getByRole('checkbox', { name: 'Keep proportions' }).uncheck(); await page.getByRole('spinbutton', { name: 'Image height' }).fill('200'); await page.getByRole('button', { name: 'Apply image properties' }).click();
    await waitFor(async () => (await images())[0].attrs.height === 200, 'properties save'); assert.equal((await images())[0].attrs.alt, 'A blue landscape beside a river');
    await command('undo'); await waitFor(async () => (await images())[0].attrs.height === 120, 'properties single undo'); assert.equal((await images())[0].attrs.alt, 'Landscape.png'); await command('redo'); await waitFor(async () => (await images())[0].attrs.height === 200, 'properties redo');
    assert.equal(await editor.locator('img').evaluate(element => element.clientHeight), 200);
    await editor.locator('img').click(); await page.screenshot({ path: path.join(userData, 'image-handles.png') });
    const imageMenu = await popup(editor.locator('img')); assert.ok(imageMenu.some(item => item.id === 'image-properties' && item.enabled)); await menuAction('image-properties'); await page.getByRole('dialog', { name: 'Image properties' }).waitFor(); await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    checks.push('Image description and explicit dimensions apply together, undo together, and open from the native menu.');
    await page.getByRole('combobox', { name: 'Document zoom' }).selectOption('125'); await page.waitForTimeout(100); await editor.locator('img').click();
    const scaledHandle = await handle.boundingBox(); await page.mouse.move(scaledHandle.x + scaledHandle.width / 2, scaledHandle.y + scaledHandle.height / 2); await page.mouse.down(); await page.mouse.move(scaledHandle.x + scaledHandle.width / 2 + 75, scaledHandle.y + scaledHandle.height / 2 + 50, { steps: 8 }); await page.mouse.up();
    await waitFor(async () => (await images())[0].attrs.width === 360, 'resize at document zoom'); assert.equal((await images())[0].attrs.height, 240); await command('undo'); await waitFor(async () => (await images())[0].attrs.width === 300, 'scaled resize undo'); await page.getByRole('combobox', { name: 'Document zoom' }).selectOption('100');
    checks.push('Resize accounts for document zoom and preserves explicitly edited proportions.');

    await select('needle'); await page.keyboard.press('Control+f'); const find = page.getByRole('textbox', { name: 'Find text', exact: true }); await find.waitFor();
    assert.equal(await find.inputValue(), 'needle'); assert.equal(await find.evaluate(element => document.activeElement === element && element.selectionEnd - element.selectionStart === element.value.length), true);
    await page.screenshot({ path: path.join(userData, 'find-panel.png') });
    await find.press('Enter'); assert.equal(await find.evaluate(element => document.activeElement === element), true); await find.press('Enter'); await find.press('Enter');
    await page.waitForFunction(() => document.querySelector('.chapter-title').value === 'Middle'); assert.equal(await find.evaluate(element => document.activeElement === element), true);
    await find.press('Shift+Enter'); await page.waitForFunction(() => document.querySelector('.chapter-title').value === 'Opening'); assert.equal(await find.evaluate(element => document.activeElement === element), true);
    await editor.locator('p').last().click(); await page.keyboard.press('Control+f'); assert.equal(await find.evaluate(element => document.activeElement === element), true);
    await find.press('Escape'); await find.waitFor({ state: 'hidden' }); assert.equal(await editor.evaluate(element => document.activeElement === element), true);
    await page.keyboard.press('F3'); await page.waitForFunction(() => document.querySelector('.chapter-title').value === 'Middle'); await page.keyboard.press('Shift+F3'); await page.waitForFunction(() => document.querySelector('.chapter-title').value === 'Opening');
    checks.push('Find seeds selected prose, refocuses on Ctrl+F, keeps input focus across chapters, and supports Escape/F3/Shift+F3.');

    await page.locator('.chapter-select').filter({ hasText: 'Middle' }).dblclick(); let rename = page.getByRole('textbox', { name: 'Rename chapter Middle', exact: true }); await rename.fill('Middle revised'); await rename.press('Escape'); assert.equal(await page.locator('.chapter-select').filter({ hasText: 'Middle revised' }).count(), 0);
    const middle = page.locator('.chapter-select').filter({ hasText: 'Middle' }); await middle.focus(); await middle.press('F2'); rename = page.getByRole('textbox', { name: 'Rename chapter Middle', exact: true }); await rename.fill('Middle revised'); await rename.press('Enter'); await waitFor(async () => (await saved()).chapters[1].title === 'Middle revised', 'chapter rename');
    await command('undo'); await waitFor(async () => (await saved()).chapters[1].title === 'Middle', 'rename undo');
    await reorderDrag(page.locator('.chapter-item').first(), page.locator('.chapter-item').last(), 'bottom'); await waitFor(async () => (await saved()).chapters[2].id === 'opening', 'chapter drag order'); assert.deepEqual((await saved()).chapters.map(item => item.id), ['middle', 'ending', 'opening']);
    await command('undo'); await waitFor(async () => (await saved()).chapters[0].id === 'opening', 'chapter reorder undo'); await page.locator('.chapter-select').filter({ hasText: 'Opening' }).click();
    checks.push('Outline double-click/F2 rename supports Enter/Escape; dragging chapters reorders once and undoes once.');

    const link = editor.locator('a').filter({ hasText: 'Visit the example' }); await link.click(); assert.deepEqual(await app.evaluate(() => globalThis.uxLinks), []);
    await link.click({ modifiers: ['Control'] }); assert.deepEqual(await app.evaluate(() => globalThis.uxLinks), ['https://example.com/reading']);
    await select('Visit the example'); await page.keyboard.press('Control+k'); const address = page.getByRole('textbox', { name: 'Link address' }); await address.waitFor(); assert.equal(await address.inputValue(), 'https://example.com/reading'); await address.fill('https://example.com/revised'); await page.getByRole('button', { name: 'Apply link' }).click(); await waitFor(async () => (await saved()).chapters[0].content.content.some(node => nodes(node).some(child => child.marks?.some(mark => mark.type === 'link' && mark.attrs.href === 'https://example.com/revised'))), 'edited link');
    const linkMenu = await popup(editor.locator('a').filter({ hasText: 'Visit the example' })); for (const id of ['open-link', 'edit-link', 'remove-link']) assert.ok(linkMenu.some(item => item.id === id && item.enabled));
    await menuAction('open-link'); assert.equal((await app.evaluate(() => globalThis.uxLinks)).at(-1), 'https://example.com/revised');
    await popup(editor.locator('a').filter({ hasText: 'Visit the example' })); await menuAction('remove-link'); await waitFor(async () => await editor.locator('a').count() === 0, 'removed link'); await command('undo'); await editor.locator('a').waitFor();
    await select('Reading paragraph 1.'); await page.keyboard.press('Control+k'); await address.fill('file:///C:/secret'); await page.getByRole('button', { name: 'Apply link' }).click(); assert.equal(await page.getByRole('dialog', { name: 'Link to something' }).count(), 1); await page.getByRole('button', { name: 'Close dialog' }).click();
    checks.push('Normal link clicks edit; Ctrl+click, Ctrl+K and native Open/Edit/Remove work, while unsafe addresses are refused.');

    await page.locator('.writing-scroll').evaluate(element => { element.scrollTop = 1300; }); await page.waitForTimeout(150);
    const anchor = await editor.locator('p').nth(20).evaluate(element => ({ top: element.getBoundingClientRect().top, text: element.textContent }));
    const beforeChrome = await page.locator('.project-tabs-bar').boundingBox();
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find(item => item.label === '&View').submenu.items.find(item => item.label === 'Zoom document in').click());
    const zoom = page.getByRole('combobox', { name: 'Document zoom' }); await waitFor(async () => await zoom.inputValue() === '110', 'native document zoom');
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor()), 1);
    await page.keyboard.press('Control+-'); await waitFor(async () => await zoom.inputValue() === '100', 'keyboard zoom out');
    await page.locator('.writing-scroll').dispatchEvent('wheel', { ctrlKey: true, deltaY: -100 }); await waitFor(async () => await zoom.inputValue() === '110', 'Ctrl wheel zoom');
    await zoom.selectOption('125'); await waitFor(async () => JSON.parse(await fs.readFile(path.join(userData, 'settings.json'), 'utf8')).zoom === 125, 'percentage persisted');
    assert.equal(Math.round((await page.locator('.project-tabs-bar').boundingBox()).height), Math.round(beforeChrome.height));
    await page.keyboard.press('Control+0'); await waitFor(async () => await zoom.inputValue() === '100', 'zoom reset'); await page.waitForTimeout(180);
    const afterAnchor = await editor.locator('p').nth(20).evaluate(element => element.getBoundingClientRect().top); assert.ok(Math.abs(afterAnchor - anchor.top) < 40, `Reading position moved ${afterAnchor - anchor.top}px`);
    checks.push('Menu, keyboard, Ctrl+wheel and percentage share document zoom, preserve reading position, and leave interface scale at 1.');

    const reference = path.join(userData, 'Reference.md'), bad = path.join(userData, 'Unsupported.exe'); await fs.writeFile(reference, '# Research\nA reference only.'); await fs.writeFile(bad, 'Synthetic unsupported file.');
    await page.getByRole('button', { name: /Reference library/ }).click(); await fileDrag([reference, bad], page.locator('.reference-panel')); await waitFor(async () => (await saved()).references?.length === 1, 'reference drop'); assert.equal((await saved()).references[0].enabled, true); assert.equal(await page.getByRole('tab').count(), 1); assert.ok((await page.locator('.toast').innerText()).includes('Unsupported.exe')); assert.equal((await saved()).chapters[0].id, 'opening');
    checks.push('Reference panel accepts Markdown drops, enables attached context, and reports unsupported files without opening a document.');
    const textFile = path.join(userData, 'Dropped.txt'), third = path.join(userData, 'Third.wraiter'); await fs.writeFile(textFile, 'A separately dropped document.'); await fs.writeFile(third, JSON.stringify({ ...fixture, id: 'third-fixture', title: 'Third manuscript' }));
    await fileDrag([textFile, bad, third], page.locator('.document-topbar')); await waitFor(async () => await page.getByRole('tab').count() === 3, 'dropped document tabs'); await idle(); assert.ok((await page.locator('.toast').innerText()).includes('Unsupported.exe'));
    assert.ok((await saved()).chapters[0].content.content.some(node => nodes(node).some(child => child.type === 'image')));
    checks.push('Mixed document drops open each supported file in its own tab and report unsupported names while preserving the original project.');
    const tabs = page.locator('.project-tab'); await reorderDrag(tabs.first(), tabs.last(), 'right'); await waitFor(async () => (JSON.parse(await fs.readFile(path.join(userData, 'open-projects.json'), 'utf8'))).tabs[2].id === await page.getByRole('tab', { name: /UX manuscript/ }).evaluate(element => element.closest('[data-project-tab]').dataset.projectTab), 'tab drag persisted');
    assert.deepEqual(await page.locator('.project-tab [role="tab"] > span:first-of-type').allTextContents(), ['Dropped', 'Third manuscript', 'UX manuscript']);
    const tabMenu = await popup(page.getByRole('tab', { name: 'Dropped', exact: true })); assert.ok(tabMenu.some(item => item.id === 'tab-close')); assert.equal(await page.getByRole('tab', { name: /^Third manuscript/ }).getAttribute('aria-selected'), 'true');
    await menuAction('tab-right'); await waitFor(async () => (await page.locator('.project-tab [role="tab"] > span:first-of-type').allTextContents())[1] === 'Dropped', 'native tab reorder');
    await page.getByRole('tab', { name: 'Dropped', exact: true }).click({ button: 'middle' }); await waitFor(async () => await page.getByRole('tab').count() === 2, 'middle click closes background tab');
    const retainedOrder = await page.locator('.project-tab [role="tab"] > span:first-of-type').allTextContents(); await close(); await launch(); assert.deepEqual(await page.locator('.project-tab [role="tab"] > span:first-of-type').allTextContents(), retainedOrder);
    checks.push('Tab drag and clicked-tab native menus persist order; middle-click closes the intended tab; restart restores it.');
    await page.getByRole('tab', { name: /UX manuscript/ }).click(); await idle(); await page.locator('.chapter-select').filter({ hasText: 'Opening' }).click(); await editor.locator('img').waitFor(); assert.equal((await images())[0].attrs.height, 200); assert.equal((await images())[0].attrs.alt, 'A blue landscape beside a river');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 650)); await page.screenshot({ path: path.join(userData, 'minimum-window.png') });
    assert.deepEqual(errors, []); checks.push('Image size/description and tab state survive app restart with no renderer errors.');
    await fs.writeFile(path.join(userData, 'report.json'), JSON.stringify({ checks, errors }, null, 2)); console.log(JSON.stringify({ userData, checks, errors }, null, 2));
  } catch (error) { await page?.screenshot({ path: path.join(userData, 'failure.png') }).catch(() => {}); console.error(JSON.stringify({ userData, checks, errors }, null, 2)); throw error; }
  finally { await close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
