const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '../..');
const [appPath, fixture, result] = process.argv.slice(2);
if (!appPath || !fixture || !result) throw new Error('Usage: node benchmark-app.cjs EXECUTABLE CORPUS OUTPUT');
const executablePath = path.resolve(appPath), resultsPath = path.resolve(result);
(async () => {
  const data = (await fs.readFile(fixture, 'utf8')).trim();
  const corpus = (data.startsWith('[') ? JSON.parse(data) : data.split(/\r?\n/u).map(line => JSON.parse(line)))
    .map((item, index) => ({ id: item.id ?? String(index + 1), text: item.text }));
  assert.ok(corpus.length > 1);
  assert.equal(new Set(corpus.map(item => item.id)).size, corpus.length);
  for (const item of corpus) assert.ok(typeof item.text === 'string' && item.text.trim() && !/[\r\n]/u.test(item.text), 'Each item must be a nonempty single paragraph');
  const output = path.join(root, 'test-output'); await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(output, 'grammar-model-profile-'));
  const file = path.join(profile, 'Grammar race.wraiter');
  const content = corpus.map(item => ({ type: 'paragraph', content: [{ type: 'text', text: item.text }] }));
  const project = { format: 'wraiter', version: 1, id: 'grammar-race', title: 'Grammar race', language: 'en-US',
    chapters: [{ id: 'first', title: 'Race passages', content: { type: 'doc', content } }] };
  await fs.writeFile(file, JSON.stringify(project));
  await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, localGrammar: true, spellcheck: true, startup: 'new', pageMode: 'continuous' }));
  const env = { ...process.env, WRAITER_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath, args: [file, '--host-resolver-rules=MAP * ~NOTFOUND'], env, timeout: 60000 });
  let page;
  try {
    page = await app.firstWindow();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.hide(); win.webContents.setBackgroundThrottling(false);
      global.grammarRaceRequests = [];
      win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
        if (/^https?:/i.test(details.url)) { global.grammarRaceRequests.push(details.url); callback({ cancel: true }); }
        else callback({});
      });
    });
    const editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true });
    await editor.waitFor({ state: 'attached', timeout: 30000 });
    await page.waitForFunction(length => {
      const editor = document.querySelector('.manuscript[contenteditable="true"]');
      if (!editor?.editor || editor.querySelectorAll(':scope > p').length !== length) return false;
      const state = editor.editor.state;
      const plugin = state.plugins.find(item => item.key.startsWith('localGrammar$'));
      const grammar = plugin?.getState(state);
      return grammar?.enabled === true && grammar?.spelling === true && grammar?.language === 'en-US' && grammar?.status === 'ready';
    }, corpus.length, { timeout: 60000, polling: 125 });
    const { paragraphs, status, visibleHintCount, stateHintCount } = await editor.evaluate(element => {
      const state = element.editor.state;
      const grammar = state.plugins.find(item => item.key.startsWith('localGrammar$')).getState(state);
      const hintsById = new Map(grammar.hints.map(item => [item.id, item]));
      const paragraphs = Array.from(element.querySelectorAll(':scope > p'), para => {
        const byId = new Map();
        for (const span of para.querySelectorAll('.local-grammar-hint, .local-spelling-hint')) {
          const id = span.dataset.localGrammarId, item = hintsById.get(id);
          if (!item) throw new Error('Rendered hint has no matched checker state');
          const range = document.createRange();
          range.setStart(para, 0); range.setEnd(span, 0);
          const from = range.toString().length, to = from + span.textContent.length;
          const rendered = byId.get(id);
          if (rendered) {
            if (rendered.to !== from) throw new Error('Split hint is not contiguous');
            rendered.to = to;
            rendered.span += span.textContent;
          } else byId.set(id, {
            from, to, span: span.textContent,
            kind: span.classList.contains('local-spelling-hint') ? 'spelling' : 'grammar',
            reason: item.reason, replacement: item.replacement, rule: item.rule, title: span.title
          });
        }
        return { text: para.textContent, underlines: Array.from(byId.values()) };
      });
      return { paragraphs, status: grammar.status, visibleHintCount: paragraphs.reduce((total, para) => total + para.underlines.length, 0), stateHintCount: grammar.hints.length };
    });
    const results = corpus.map(({ id, text }, i) => {
      const { text: rendered, underlines } = paragraphs[i];
      assert.equal(rendered, text, `Text drift in passage ${id}`);
      for (const mark of underlines) assert.equal(text.slice(mark.from, mark.to), mark.span, `Span mismatch in passage ${id}`);
      return { id, text, underlines };
    });
    assert.equal(status, 'ready');
    assert.equal(visibleHintCount, stateHintCount, 'A checker hint did not map to a rendered span');
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(await app.evaluate(() => global.grammarRaceRequests), []);
    await fs.writeFile(resultsPath, JSON.stringify(results, null, 2) + '\n');
    console.log(JSON.stringify({ items: results.length, visibleHintCount, stateHintCount,
      grammarUnderlines: results.flatMap(item => item.underlines).filter(mark => mark.kind === 'grammar').length,
      results: resultsPath }, null, 2));
  } finally {
    try { if (page) await page.evaluate(() => window.wraiter.finishClose()); } catch {}
    await app.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

