const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const repeated = 'At noon, she packed the the map. Later, she packed the the bag.';
const pastPerfect = [
  'A year ago we were two couriers who had happened upon a silver locket at an auction in Durham.',
  'The bell-ringer stood where a caretaker once had uncovered a hidden lock on a door in the mill.',
  'She put away the letters that her sister had written before the move.',
  ...(process.env.WRAITER_TEST_PAST_PERFECT ? [process.env.WRAITER_TEST_PAST_PERFECT] : [])
];
const timeout = 45000;

async function test() {
  const output = path.join(root, 'test-output');
  await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(output, 'grammar-ignore-edits-'));
  const file = path.join(profile, 'Local grammar regression.wraiter');
  const paragraphs = [repeated, ...pastPerfect];
  await fs.writeFile(file, JSON.stringify({
    format: 'wraiter', version: 1, id: 'local-grammar-regression', title: 'Local grammar regression', language: 'en-US',
    chapters: [{ id: 'one', title: 'Samples', content: { type: 'doc', content: paragraphs.map(text => ({
      type: 'paragraph', content: [{ type: 'text', text }]
    })) } }]
  }));
  await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({
    setupComplete: true, tutorialComplete: true, enabled: false, localGrammar: true,
    spellcheck: false, startup: 'new', pageMode: 'continuous'
  }));
  const env = { ...process.env, WRAITER_USER_DATA: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath: process.env.WRAITER_EXECUTABLE || require('electron'),
    args: process.env.WRAITER_EXECUTABLE ? [file] : [root, file], env, timeout
  });
  try {
    const page = await app.firstWindow();
    const editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true });
    await page.waitForFunction(text => document.querySelector('.manuscript')?.textContent.includes(text), repeated, { timeout });
    await page.waitForFunction(() => {
      const state = document.querySelector('.manuscript')?.editor?.state;
      return state?.plugins.find(p => p.key.startsWith('localGrammar$'))?.getState(state).status === 'ready';
    }, null, { timeout });

    const failures = [];
    // A missing native model must not make all the quiet examples pass.
    const [nativeHints] = await page.evaluate(() => window.wraiter.offlineGrammar({
      language: 'en-US', texts: ['The soldiers lost there way.']
    }));
    assert.ok(nativeHints.some(h => h.rule?.startsWith('neural:') && h.original === 'there' && h.replacement === 'their'),
      'Bundled neural inference must return a contextual correction');
    const pastPerfectMarks = await editor.evaluate((el, samples) => {
      const state = el.editor.state;
      const hints = state.plugins.find(p => p.key.startsWith('localGrammar$')).getState(state).hints;
      const marked = [], checked = [];
      state.doc.descendants((node, pos) => {
        if (!node.isTextblock || !samples.includes(node.textContent)) return;
        checked.push(node.textContent);
        const start = pos + 1 + node.textContent.indexOf(' had ') + 1;
        for (const hint of hints.filter(h => h.from < start + 3 && h.to > start)) {
          marked.push({ text: node.textContent, rule: hint.rule, original: hint.original, replacement: hint.replacement });
        }
        return false;
      });
      if (checked.length !== samples.length) throw new Error('Missing past-perfect test paragraphs');
      return marked;
    }, pastPerfect);
    console.log('Past perfect marks:', JSON.stringify(pastPerfectMarks));
    if (pastPerfectMarks.length) failures.push('Valid past-perfect auxiliary was marked');

    const duplicate = editor.locator('.local-grammar-hint').filter({ hasText: /^the the$/ });
    assert.equal(await duplicate.count(), 2, 'Both duplicate-word occurrences must initially be visible');
    await app.evaluate(({ Menu }) => {
      Menu.prototype.popup = function () { global.grammarTestMenu = this; };
    });
    await duplicate.first().click({ button: 'right' });
    let chosen = false;
    for (let tries = 0; tries < 100 && !chosen; tries++) {
      chosen = await app.evaluate(({ BrowserWindow }) => {
        const item = global.grammarTestMenu?.getMenuItemById('ignore-local-hint');
        if (!item?.enabled) return false;
        item.click(undefined, BrowserWindow.getAllWindows()[0], {});
        return true;
      });
      if (!chosen) await new Promise(resolve => setTimeout(resolve, 30));
    }
    assert.ok(chosen, 'Native Ignore this suggestion action must be available');
    await page.waitForFunction(() => document.querySelectorAll('.local-grammar-hint').length > 0 &&
      [...document.querySelectorAll('.local-grammar-hint')].filter(n => n.textContent === 'the the').length === 1, null, { timeout });

    // Observe completed background checks so transient absence of a mark cannot pass the test.
    await editor.evaluate(el => {
      const current = el.editor;
      window.rechecks = 0;
      current.on('transaction', ({ transaction }) => {
        const plugin = current.state.plugins.find(p => p.key.startsWith('localGrammar$'));
        if (transaction.getMeta(plugin)?.status === 'ready') window.rechecks++;
      });
    });
    const setSelection = async (needle, length = 0) => editor.evaluate((el, { needle, length }) => {
      const current = el.editor;
      let position;
      current.state.doc.descendants((node, pos) => {
        if (!node.isTextblock || position !== undefined) return;
        const at = node.textContent.indexOf(needle);
        if (at >= 0) position = pos + at + 1;
        return false;
      });
      if (position === undefined) throw new Error('Missing text: ' + needle);
      current.chain().focus().setTextSelection({ from: position, to: position + length }).run();
    }, { needle, length });
    const recheckAfter = async action => {
      const before = await page.evaluate(() => window.rechecks);
      await action();
      await page.waitForFunction(n => window.rechecks > n, before, { timeout });
    };
    const visibleCopies = () => duplicate.evaluateAll(spans => spans.map(span => {
      const suffix = document.createRange();
      suffix.selectNodeContents(span.closest('p'));
      suffix.setStartAfter(span);
      return suffix.toString().trimStart().split(/[ .]/)[0];
    }));
    const expectOnlyBag = async label => {
      const visible = await visibleCopies();
      console.log(label, JSON.stringify(visible));
      if (visible.length !== 1 || visible[0] !== 'bag') failures.push(label);
    };
    await expectOnlyBag('Ignore applies to the first occurrence only');
    await setSelection('At noon');
    await recheckAfter(() => page.keyboard.insertText('Yesterday was bright. '));
    await expectOnlyBag('Dismissal survives typing earlier in the same paragraph');
    await setSelection(' map.');
    await recheckAfter(() => page.keyboard.insertText(' old'));
    await expectOnlyBag('Dismissal survives typing immediately after the marked span');
    await setSelection('she packed');
    await recheckAfter(() => page.keyboard.press('Enter'));
    await expectOnlyBag('Dismissal follows the occurrence across a paragraph split');

    await setSelection('the the old map', 'the the'.length);
    await recheckAfter(() => page.keyboard.insertText('the'));
    await setSelection(' old map');
    await recheckAfter(() => page.keyboard.insertText(' the'));
    assert.equal(await duplicate.count(), 2, 'Newly typed duplicate must be checked after replacing the dismissed text');
    assert.deepEqual(failures, []);
    console.log('PASS local grammar dismissal through edits, occurrence replacement and valid past perfect');
  } finally {
    try { await (await app.firstWindow()).evaluate(() => window.wraiter.finishClose()); } catch {}
    await app.close();
  }
}
test().catch(error => { console.error(error); process.exitCode = 1; });
