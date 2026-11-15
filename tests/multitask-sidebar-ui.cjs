// Real document switching with synthetic files, an isolated profile and no AI calls.
const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { GitHistory } = require('../electron/git-history.cjs');
const root = path.resolve(__dirname, '..');
const waitFor = async (check, message = 'Sidebar state did not settle') => {
  const end = Date.now() + 20000;
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 60)); }
  throw new Error(message);
};

(async () => {
  const output = path.join(root, 'test-output'); await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(output, 'multitask-sidebar-'));
  await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, theme: 'dark', startup: 'restore', spellcheck: false, localGrammar: false }));
  const names = ['Orchard', 'Harbour', 'Mountain'], files = [], date = new Date().toISOString();
  const { addComment } = await import('../src/comments.js');
  const history = new GitHistory(profile);
  for (const name of names) {
    let project = { format: 'wraiter', version: 1, id: `sidebar-${name}`, title: name,
      notes: `${name} private notes`, style: `${name} writing voice`,
      references: [{ id: 'reference', name: `${name} reference`, text: `${name} reference context`, enabled: true }],
      chats: [{ id: 'conversation', title: `${name} conversation`, createdAt: date, updatedAt: date,
        messages: [{ id: 'question', role: 'user', text: `${name} question` }, { id: 'answer', role: 'assistant', text: `${name} assistant response` }] }], activeChatId: 'conversation',
      chapters: [{ id: 'opening', title: `${name} opening`, content: { type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: `${name} has its own manuscript and sidebar context.` }] },
        { type: 'paragraph', content: [{ type: 'text', text: `${name} proposed addition`, marks: [{ type: 'trackedChange', attrs: { id: 'revision', kind: 'insert', author: name, date } }] }] }
      ] } }] };
    project = addComment(project, { chapterId: 'opening', from: 1, to: name.length + 1, text: `${name} comment`, id: 'comment' }).project;
    const file = path.join(profile, `${name}.wraiter`); await fs.writeFile(file, JSON.stringify(project)); files.push(file);
    await history.record(project, `${name} checkpoint`, true);
  }
  const env = { ...process.env, WRAITER_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  let app, page;
  const errors = [], checks = [];
  try {
    app = await _electron.launch({ ...(process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: files } : { args: [root, ...files] }), env, timeout: 60000 });
    page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await page.locator('.manuscript').waitFor({ timeout: 30000 });
    await waitFor(async () => {
      const tabs = (await page.evaluate(() => window.wraiter.boot())).workspace.tabs;
      return names.every(name => tabs.some(tab => tab.title === name)) && !await page.locator('.workspace').evaluate(element => element.inert);
    });
    await app.evaluate(({ BrowserWindow, Menu }) => {
      BrowserWindow.getAllWindows()[0].setSize(1600, 1000);
      Menu.prototype.popup = function() { global.sidebarTabMenu = this; };
    });
    const boot = await page.evaluate(() => window.wraiter.boot());
    const ids = Object.fromEntries(boot.workspace.tabs.map(tab => [tab.title, tab.id]));
    const tab = name => page.locator(`[data-project-tab="${ids[name]}"]`);
    const pane = name => page.locator(`[data-pane-id="${ids[name]}"]`);
    const editor = name => pane(name).locator('.manuscript');
    const ready = async name => waitFor(async () => await pane(name).getAttribute('data-active') === 'true' && !await page.locator('.workspace').evaluate(element => element.inert) && await editor(name).getAttribute('contenteditable') === 'true');
    const chooseTab = async name => { await tab(name).getByRole('tab').click(); await ready(name); };
    const focusPane = async name => {
      await editor(name).locator('p').first().click(); await ready(name);
      await waitFor(() => editor(name).evaluate(element => element === document.activeElement), `Keyboard focus did not follow ${name}`);
    };
    const command = name => app.evaluate(({ BrowserWindow }, name) => BrowserWindow.getAllWindows()[0].webContents.send('command', name), name);
    const menu = async (name, id) => {
      await app.evaluate(() => { global.sidebarTabMenu = null; });
      await tab(name).getByRole('tab').click({ button: 'right' });
      await waitFor(() => app.evaluate(() => !!global.sidebarTabMenu));
      await app.evaluate(({ BrowserWindow }, id) => {
        const item = global.sidebarTabMenu.getMenuItemById(id);
        if (!item?.enabled) throw new Error(`Unavailable ${id}`);
        item.click(undefined, BrowserWindow.getAllWindows()[0], {});
      }, id);
    };
    const assertPanel = async title => {
      assert.equal(await page.locator('.inspector').count(), 1, `${title} sidebar disappeared`);
      assert.equal(await page.locator('.inspector-title').innerText(), title);
      assert.equal(await page.getByRole('button', { name: `Toggle ${title.toLowerCase()}`, exact: true }).getAttribute('aria-pressed'), 'true');
    };
    const openPanel = async title => {
      const button = page.getByRole('button', { name: `Toggle ${title.toLowerCase()}`, exact: true });
      if (await button.getAttribute('aria-pressed') !== 'true') await button.click();
      await assertPanel(title);
    };
    // Create independent journals through the editor before arranging the panes.
    for (const name of names) {
      await chooseTab(name); await editor(name).locator('p').first().click();
      await page.keyboard.press('End'); await page.keyboard.insertText(` ${name} journal edit.`);
    }
    await chooseTab('Orchard'); await openPanel('Revision history');
    await page.evaluate(() => {
      window.sharedInspector = document.querySelector('.inspector'); window.inspectorRemoved = false;
      window.inspectorObserver = new MutationObserver(() => { if (!window.sharedInspector.isConnected) window.inspectorRemoved = true; });
      window.inspectorObserver.observe(document.querySelector('.workspace'), { childList: true, subtree: true });
    });
    await menu('Harbour', 'tab-multitask-right'); await ready('Harbour'); await assertPanel('Revision history');
    await menu('Mountain', 'tab-multitask-left'); await ready('Mountain'); await assertPanel('Revision history');
    assert.equal(await page.locator('[data-pane-id]').count(), 3);
    await page.locator('.manuscript').evaluateAll(elements => { window.sidebarEditors = elements.map(element => element.editor); });

    // All six sidebars keep their mode while their document context changes.
    for (const title of ['Revision history', 'Writing assistant', 'Comments', 'Reference library', 'Notes & voice', 'Review edits']) {
      await openPanel(title);
      for (const name of names) {
        await focusPane(name); await assertPanel(title);
        if (title === 'Revision history') {
          const text = await page.locator('.history-timeline').innerText();
          assert.ok(text.includes(`${name} opening`), `${name} journal is missing`);
          for (const other of names.filter(other => other !== name)) assert.ok(!text.includes(`${other} opening`));
        } else if (title === 'Writing assistant') {
          const text = await page.locator('.chat-message').allTextContents();
          assert.ok(text.some(message => message.includes(`${name} assistant response`)));
          for (const other of names.filter(other => other !== name)) assert.ok(!text.some(message => message.includes(`${other} assistant response`)));
          await page.getByRole('textbox', { name: 'Ask the writing assistant', exact: true }).fill(`${name} unsent question`);
        } else if (title === 'Comments') {
          assert.deepEqual(await page.locator('.comment-body').allTextContents(), [`${name} comment`]);
        } else if (title === 'Reference library') {
          assert.equal(await page.locator('.reference-card strong').innerText(), `${name} reference`);
        } else if (title === 'Notes & voice') {
          assert.equal(await page.getByRole('textbox', { name: 'Private manuscript notes', exact: true }).inputValue(), `${name} private notes`);
          assert.equal(await page.getByRole('textbox', { name: 'Writing voice instructions', exact: true }).inputValue(), `${name} writing voice`);
        } else {
          assert.equal(await page.locator('.review-change').count(), 1);
          assert.equal(await page.locator('.review-change ins').innerText(), `${name} proposed addition`);
        }
      }
      checks.push(`${title} stays open and follows focus across three documents`);
    }
    assert.equal(await page.locator('.manuscript').evaluateAll(elements => elements.every(element => window.sidebarEditors.includes(element.editor))), true, 'Sidebar switching rebuilt an editor');
    // Existing document-specific chat drafts remain isolated.
    await openPanel('Writing assistant');
    for (const name of names) {
      await focusPane(name);
      assert.equal(await page.getByRole('textbox', { name: 'Ask the writing assistant', exact: true }).inputValue(), `${name} unsent question`);
    }
    // Sidebar editing actions address the newly focused manuscript only.
    await openPanel('Notes & voice'); await focusPane('Harbour');
    await page.getByRole('textbox', { name: 'Private manuscript notes', exact: true }).fill('Harbour updated notes');
    await focusPane('Orchard');
    assert.equal(await page.getByRole('textbox', { name: 'Private manuscript notes', exact: true }).inputValue(), 'Orchard private notes');
    await focusPane('Harbour');
    assert.equal(await page.getByRole('textbox', { name: 'Private manuscript notes', exact: true }).inputValue(), 'Harbour updated notes');
    await openPanel('Comments'); await page.getByRole('button', { name: 'Resolve', exact: true }).click();
    await waitFor(async () => await page.locator('.comment-body').count() === 0);
    await focusPane('Orchard'); assert.deepEqual(await page.locator('.comment-body').allTextContents(), ['Orchard comment']);
    // An earlier Add comment focus request must not hijack a later pane click.
    await command('add-comment'); await waitFor(() => page.getByRole('textbox', { name: 'New comment text', exact: true }).evaluate(element => element === document.activeElement));
    await focusPane('Mountain'); await assertPanel('Comments');
    await openPanel('Review edits'); await focusPane('Harbour');
    await page.getByRole('button', { name: 'Accept change', exact: true }).click();
    await waitFor(async () => await page.locator('.review-change').count() === 0);
    await focusPane('Orchard'); assert.equal(await page.locator('.review-change ins').innerText(), 'Orchard proposed addition');
    checks.push('Chat drafts, note edits, comment resolution and review actions stay document-specific; pane clicks retain keyboard focus');

    await openPanel('Revision history');
    await page.getByRole('tab', { name: /^Checkpoints/ }).click();
    for (const name of names) {
      await focusPane(name); await assertPanel('Revision history');
      assert.equal(await page.getByRole('tab', { name: /^Checkpoints/ }).getAttribute('aria-selected'), 'true');
      await waitFor(async () => (await page.locator('.checkpoint-title').allTextContents()).includes(`${name} checkpoint`));
      const checkpoints = await page.locator('.checkpoint-title').allTextContents();
      for (const other of names.filter(other => other !== name)) assert.ok(!checkpoints.includes(`${other} checkpoint`));
    }
    // Hold a real history response after it has read the previous context.
    // The new document must show loading, then ignore this late response.
    await app.evaluate(({ ipcMain }) => {
      global.originalSidebarHistory = ipcMain._invokeHandlers.get('git:list');
      global.holdSidebarHistory = true; global.sidebarHistoryHeld = false;
      ipcMain.removeHandler('git:list');
      ipcMain.handle('git:list', async (...args) => {
        const hold = global.holdSidebarHistory; global.holdSidebarHistory = false;
        const result = await global.originalSidebarHistory(...args);
        if (hold) { global.sidebarHistoryHeld = true; await new Promise(resolve => { global.releaseSidebarHistory = resolve; }); }
        return result;
      });
    });
    await focusPane('Harbour');
    await waitFor(() => app.evaluate(() => global.sidebarHistoryHeld));
    assert.equal(await page.locator('.checkpoint-node').count(), 0, 'Previous document checkpoints remained actionable');
    assert.equal(await page.locator('.history-empty').innerText(), 'Loading checkpoints…');
    await focusPane('Orchard');
    await waitFor(async () => (await page.locator('.checkpoint-title').allTextContents()).includes('Orchard checkpoint'));
    await app.evaluate(() => global.releaseSidebarHistory()); await page.waitForTimeout(250);
    assert.ok(!(await page.locator('.checkpoint-title').allTextContents()).includes('Harbour checkpoint'));
    await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('git:list'); ipcMain.handle('git:list', global.originalSidebarHistory); });
    checks.push('Checkpoint subview follows focus; old checkpoints clear during loading and late responses cannot replace the current context');

    assert.equal(await page.evaluate(() => window.inspectorRemoved), false, 'Sidebar was unmounted during switching');
    assert.equal(await page.locator('.inspector').evaluate(element => element === window.sharedInspector), true);
    await page.evaluate(() => window.inspectorObserver.disconnect());
    // Bright active line, muted Multitask lines, and no line on hidden tabs.
    const assertIndicators = async () => {
      const visible = await page.locator('[data-pane-id]').evaluateAll(elements => elements.map(element => element.dataset.paneId));
      const marked = await page.locator('.project-tab.multitasking').evaluateAll(elements => elements.map(element => element.dataset.projectTab));
      assert.deepEqual(marked.sort(), visible.length > 1 ? visible.sort() : []);
      if (visible.length > 1) {
        const colours = await page.locator('.project-tab.multitasking').evaluateAll(elements => elements.map(element => ({ active: element.classList.contains('selected'), color: getComputedStyle(element).borderTopColor, description: element.querySelector('[role=tab]').getAttribute('aria-description') })));
        assert.ok(colours.every(item => item.description === 'Open in Multitask'));
        assert.ok(colours.some(item => !item.active && item.color !== colours.find(item => item.active).color));
      }
    };
    await assertIndicators();
    await page.screenshot({ path: path.join(output, 'multitask-sidebar-dark.png') });
    await command('settings-appearance');
    await page.getByRole('button', { name: 'Light', exact: true }).click();
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'paper');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await waitFor(async () => !await page.locator('.workspace').evaluate(element => element.inert) && await tab('Orchard').getByRole('tab').isEnabled());
    await assertIndicators();
    await page.screenshot({ path: path.join(output, 'multitask-sidebar-light.png') });
    // Deliberately closing the sidebar is also workspace-wide.
    await page.getByRole('button', { name: 'Close side panel', exact: true }).click();
    await focusPane('Harbour'); assert.equal(await page.locator('.inspector').count(), 0);
    await chooseTab('Mountain'); assert.equal(await page.locator('.inspector').count(), 0);
    await page.getByRole('button', { name: 'Remove Mountain from multitask', exact: true }).click();
    await waitFor(async () => await page.locator('[data-pane-id]').count() === 2); await assertIndicators();
    await menu('Harbour', 'tab-multitask-remove');
    await waitFor(async () => await page.locator('[data-pane-id]').count() === 1); await assertIndicators();
    await openPanel('Notes & voice'); await chooseTab('Mountain'); await assertPanel('Notes & voice');
    assert.equal(await page.getByRole('textbox', { name: 'Private manuscript notes', exact: true }).inputValue(), 'Mountain private notes');
    for (const [index, name] of names.entries()) {
      const saved = JSON.parse(await fs.readFile(files[index], 'utf8'));
      assert.deepEqual(saved.chats[0].messages.map(message => message.text), [`${name} question`, `${name} assistant response`]);
    }
    checks.push('Muted tab overlines match visible Multitask documents in both themes and clear when removed; normal tab switches also preserve open/closed sidebar state');
    assert.deepEqual(errors, []);
    const report = { passed: true, packaged: !!process.env.WRAITER_EXECUTABLE, profile, checks };
    await fs.writeFile(path.join(output, process.env.WRAITER_EXECUTABLE ? 'multitask-sidebar-packaged-results.json' : 'multitask-sidebar-results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(await page?.evaluate(() => ({ focused: document.activeElement?.outerHTML.slice(0, 400), panes: [...document.querySelectorAll('[data-pane-id]')].map(pane => ({ id: pane.dataset.paneId, active: pane.dataset.active, editable: pane.querySelector('.manuscript')?.contentEditable, destroyed: pane.querySelector('.manuscript')?.editor?.isDestroyed })) })).catch(() => null));
    await page?.screenshot({ path: path.join(output, 'multitask-sidebar-failure.png') }).catch(() => {}); throw error;
  }
  finally { await app?.evaluate(() => global.releaseSidebarHistory?.()).catch(() => {}); await page?.evaluate(() => window.wraiter.finishClose()).catch(() => {}); await app?.close().catch(() => {}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
