// Isolated desktop profile, protocol file drags, synthetic clipboard events,
// generated pictures and fictional prose. Never changes the system clipboard.
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const paragraph = text => ({ type: 'paragraph', attrs: { textAlign: null, pageBreakBefore: null, lineHeight: null, spaceAfter: null, firstLineIndent: null }, content: [{ type: 'text', text }] });
const all = node => [node, ...(node.content || []).flatMap(all)];
const imageNodes = project => project.chapters.flatMap(chapter => all(chapter.content).filter(node => node.type === 'image'));
const waitFor = async (check, label) => { const until = Date.now() + 15000; while (Date.now() < until) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 60)); } throw new Error('Timed out: ' + label); };

(async () => {
  const output = path.join(root, 'test-output'); await fs.mkdir(output, { recursive: true });
  const userData = await fs.mkdtemp(path.join(output, 'image-import-'));
  const file = path.join(userData, 'Pictures in prose.wraiter'), checks = [], errors = [];
  const fixture = { format: 'wraiter', version: 1, id: 'image-fixture', title: 'Pictures in prose', chapters: [
    { id: 'opening', title: 'Opening', content: { type: 'doc', content: [paragraph('Before the image.'), paragraph('Drop into this paragraph.'), paragraph('After the image.')] } },
    { id: 'ending', title: 'Ending', content: { type: 'doc', content: [paragraph('Other chapter stays intact.')] } }
  ] };
  await fs.writeFile(file, JSON.stringify(fixture));
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, startup: 'restore', theme: 'paper', spellcheck: false }));
  const env = { ...process.env, WRAITER_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  let app, page, editor, cdp, picture, firstLaunch = true;
  const launch = async () => {
    const launchOptions = process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: firstLaunch ? [file] : [] } : { args: firstLaunch ? [root, file] : [root] };
    app = await _electron.launch({ ...launchOptions, env, timeout: 60000 }); firstLaunch = false;
    page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true });
    await editor.waitFor({ timeout: 30000 }); await editor.getByText('Before the image.', { exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('.workspace[inert]') && document.querySelector('.project-tabs [role="tab"]:not(:disabled)'));
    cdp = await page.context().newCDPSession(page);
  };
  const close = async () => { await page?.evaluate(() => window.wraiter.finishClose()).catch(() => {}); await app?.close().catch(() => {}); app = null; };
  const saved = async () => JSON.parse(await fs.readFile(file, 'utf8'));
  const command = name => app.evaluate(({ BrowserWindow }, name) => BrowserWindow.getAllWindows()[0].webContents.send('command', name), name);
  const count = async expected => { await waitFor(async () => imageNodes(await saved()).length === expected, 'saved image count ' + expected); assert.equal(await editor.locator('img').count(), expected); };
  const undo = async expected => { await command('undo'); await count(expected); };
  const select = async (text, collapse = false) => {
    const target = editor.locator('p').filter({ hasText: text }).first();
    await target.evaluate((element, { text, collapse }) => {
      const node = element.firstChild, start = node.textContent.indexOf(text), range = document.createRange();
      range.setStart(node, start); range.setEnd(node, start + text.length); if (collapse) range.collapse(false);
      element.closest('[contenteditable]').focus(); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    }, { text, collapse });
    await page.waitForTimeout(70);
  };
  const drag = async (paths, locator, hoverOnly = false) => {
    await locator.scrollIntoViewIfNeeded(); const bounds = await locator.boundingBox();
    const x = Math.round(bounds.x + Math.min(20, bounds.width / 2)), y = Math.round(bounds.y + bounds.height / 2);
    const data = { items: [], files: paths, dragOperationsMask: 1 };
    await cdp.send('Input.dispatchDragEvent', { type: 'dragEnter', x, y, data });
    await cdp.send('Input.dispatchDragEvent', { type: 'dragOver', x, y, data });
    if (!hoverOnly) await cdp.send('Input.dispatchDragEvent', { type: 'drop', x, y, data });
  };
  const paste = async (entries, plain = '') => editor.evaluate((element, { entries, plain }) => {
    const transfer = new DataTransfer();
    for (const { name, mime, base64 } of entries) transfer.items.add(new File([Uint8Array.from(atob(base64), character => character.charCodeAt(0))], name, { type: mime }));
    if (plain) transfer.setData('text/plain', plain);
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
  }, { entries, plain });
  try {
    await launch();
    await waitFor(async () => Boolean((await saved()).chapters[1].content.content[0].attrs), 'initial normalised save');
    const otherChapter = (await saved()).chapters[1];
    picture = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 180; canvas.height = 90;
      const context = canvas.getContext('2d'); context.fillStyle = '#89adc7'; context.fillRect(0, 0, 180, 90); context.fillStyle = '#426442'; context.fillRect(0, 60, 180, 30);
      return Object.fromEntries(['png', 'jpeg', 'webp'].map(type => [type, canvas.toDataURL('image/' + type).split(',')[1]]));
    });
    const png = path.join(userData, 'Landscape.PNG'), jpg = path.join(userData, 'Landscape.JPG');
    const webp = path.join(userData, 'Landscape.webp'), wrong = path.join(userData, 'Unsupported.bin');
    const damaged = path.join(userData, 'Damaged.png'), oversized = path.join(userData, 'Huge.png');
    await Promise.all([fs.writeFile(png, Buffer.from(picture.png, 'base64')), fs.writeFile(jpg, Buffer.from(picture.jpeg, 'base64')), fs.writeFile(webp, Buffer.from(picture.webp, 'base64')), fs.writeFile(wrong, 'This is a document, not a picture.'), fs.writeFile(damaged, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), fs.writeFile(oversized, Buffer.alloc(10 * 1024 * 1024 + 1))]);

    await select('After the image.');
    await drag([png], editor.locator('p').filter({ hasText: 'Drop into this paragraph.' }), true);
    assert.equal(await editor.getAttribute('data-image-drop'), 'ready');
    await page.screenshot({ path: path.join(userData, 'drop-highlight.png') });
    await drag([png], editor.locator('p').filter({ hasText: 'Drop into this paragraph.' })); await count(1);
    assert.equal(await editor.getAttribute('data-image-drop'), null);
    assert.equal(await editor.innerText(), 'Before the image.\n\nDr\n\nop into this paragraph.\n\nAfter the image.');
    const first = imageNodes(await saved())[0]; assert.ok(first.attrs.src.startsWith('data:image/png;base64,')); assert.equal(first.attrs.alt, 'Landscape.PNG');
    assert.deepEqual((await saved()).chapters[1], otherChapter);
    await undo(0); await command('redo'); await count(1); await undo(0);
    checks.push('Chromium protocol file drags show a drop target, insert at the pointer, preserve a different selected passage and persist as one undo/redo action.');

    await select('After the image.', true);
    await paste([{ name: 'Screenshot.png', mime: 'image/png', base64: picture.png }]); await count(1);
    assert.ok((await editor.innerText()).includes('After the image.')); await undo(0);
    await select('After the image.');
    await paste([{ name: 'Screenshot.png', mime: 'image/png', base64: picture.png }]); await count(1);
    assert.ok(!(await editor.innerText()).includes('After the image.')); await undo(0);
    checks.push('Synthetic clipboard screenshots insert at the caret or replace a selection; undo restores the original text without touching the system clipboard.');

    await drag([png, jpg, webp], editor.locator('p').filter({ hasText: 'Drop into this paragraph.' })); await count(3);
    assert.deepEqual(imageNodes(await saved()).map(node => node.attrs.alt), ['Landscape.PNG', 'Landscape.JPG', 'Landscape.webp']);
    assert.deepEqual(imageNodes(await saved()).map(node => node.attrs.src.match(/^data:([^;]+)/)[1]), ['image/png', 'image/jpeg', 'image/webp']); await undo(0);
    await select('After the image.', true);
    await paste([{ name: 'No MIME.PNG', mime: '', base64: picture.png }, { name: 'Pixel.gif', mime: 'image/gif', base64: 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' }]); await count(2); await undo(0);
    checks.push('Multiple PNG/JPEG/WebP files keep their order and undo together; clipboard GIF and missing MIME types are supported.');

    const url = page.url();
    for (const [target, message] of [[wrong, /not a supported image/], [damaged, /could not be read/], [oversized, /larger than 10 MB/]]) {
      await drag([target], editor.locator('p').filter({ hasText: 'Drop into this paragraph.' }));
      await page.getByRole('status').filter({ hasText: message }).waitFor(); await count(0); assert.equal(page.url(), url);
    }
    await drag([png, wrong], editor.locator('p').filter({ hasText: 'Drop into this paragraph.' })); await count(1);
    await page.getByRole('status').filter({ hasText: /not a supported image/ }).waitFor(); await undo(0);
    await drag([wrong], page.locator('.sidebar')); await page.getByRole('status').filter({ hasText: /Drop images onto the manuscript page/ }).waitFor(); assert.equal(page.url(), url);
    checks.push('Unsupported, unreadable and oversized files give visible feedback; valid files in mixed drops still import; off-page drops cannot navigate away.');

    await drag([png], page.locator('.writing-sheet'), false); await count(1); await undo(0);
    await command('focus'); await drag([png], editor.locator('p').filter({ hasText: 'Drop into this paragraph.' })); await count(1); await undo(0); await command('focus');
    await command('page-view'); await drag([png], editor.locator('p').filter({ hasText: 'Drop into this paragraph.' })); await count(1); await undo(0); await command('page-view');
    checks.push('Page margins, focus mode and divided-page mode all accept image drops.');

    await app.evaluate(({ dialog }, target) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] }); }, jpg);
    await select('After the image.', true); await page.getByRole('button', { name: 'Insert image', exact: true }).click(); await count(1);
    assert.ok(imageNodes(await saved())[0].attrs.src.startsWith('data:image/jpeg;')); await undo(0);
    await app.evaluate(({ dialog }, target) => { dialog.showOpenDialog = () => new Promise(resolve => { global.imageDialogFinish = () => resolve({ canceled: false, filePaths: [target] }); }); }, png);
    await page.getByRole('button', { name: 'Insert image', exact: true }).click(); await page.waitForFunction(() => document.querySelector('.manuscript').getAttribute('aria-busy') === 'true');
    await page.getByRole('button').filter({ hasText: 'Ending' }).first().click(); await editor.getByText('Other chapter stays intact.').waitFor();
    await app.evaluate(() => global.imageDialogFinish()); await page.waitForTimeout(350);
    assert.equal(imageNodes(await saved()).length, 0); assert.equal(await editor.locator('img').count(), 0);
    await page.getByRole('button').filter({ hasText: 'Opening' }).first().click(); await editor.getByText('Before the image.').waitFor();
    checks.push('The toolbar picker accepts uppercase JPG; completing an old picker after changing chapters cannot edit the new chapter.');

    await drag([png], editor.locator('p').filter({ hasText: 'Drop into this paragraph.' })); await count(1);
    const beforeMove = (await saved()).chapters[0].content;
    await editor.locator('img').dragTo(editor.locator('p').filter({ hasText: 'Before the image.' }), { targetPosition: { x: 12, y: 4 } });
    await waitFor(async () => JSON.stringify((await saved()).chapters[0].content) !== JSON.stringify(beforeMove), 'internal image move saved'); await count(1);
    await undo(1); await waitFor(async () => JSON.stringify((await saved()).chapters[0].content) === JSON.stringify(beforeMove), 'undo image move saved');
    checks.push('Dragging an embedded image inside the editor moves it without creating another import; undo restores its original position.');

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 650)); await page.waitForTimeout(150);
    await editor.locator('img').scrollIntoViewIfNeeded();
    const width = await editor.locator('img').evaluate(image => ({ image: image.getBoundingClientRect().width, editor: image.closest('.manuscript').getBoundingClientRect().width }));
    assert.ok(width.image <= width.editor + 1); await page.screenshot({ path: path.join(userData, 'image-minimum-window.png') });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1380, 900)); await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(userData, 'image-desktop.png') });
    await close(); await fs.rename(png, png + '.moved'); await launch(); await count(1);
    assert.equal(await editor.locator('img').evaluate(image => image.complete && image.naturalWidth === 180), true);
    await undo(0); await command('redo'); await count(1);
    checks.push('Embedded pictures fit the minimum window, survive restart after the source file moves, and retain durable undo/redo.');

    await select('After the image.', true);
    await editor.evaluate(element => {
      const data = new DataTransfer(); data.setData('text/html', '<p><strong>Copied text</strong> <img src="https://example.invalid/remote.png" alt="Web picture"></p>');
      data.setData('text/plain', 'Copied text'); element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    });
    await editor.getByText(/Image not embedded: Web picture/).waitFor();
    await page.getByRole('status').filter({ hasText: /Linked images were replaced with labels/ }).waitFor();
    await waitFor(async () => all((await saved()).chapters[0].content).some(node => node.text?.includes('Image not embedded: Web picture')), 'rich paste with linked image saved');
    assert.equal(await editor.locator('strong').filter({ hasText: 'Copied text' }).count(), 1);
    assert.equal(imageNodes(await saved()).length, 1); await undo(1);
    checks.push('Rich text retains its wording and formatting while linked/unsupported HTML images become labelled placeholders with guidance and save successfully.');

    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(userData, 'checks.json'), JSON.stringify({ checks, errors }, null, 2));
    console.log('PASS ' + checks.join('\nPASS ')); console.log('Screenshots and fixture: ' + userData);
  } finally { await close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
