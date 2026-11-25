// Real scrolling with synthetic manuscripts and isolated profiles. No AI calls.
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'test-output');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const paragraph = (label, attrs = {}) => ({ type: 'paragraph', attrs, content: [{ type: 'text', text: `${label}. The river turned through the valley under the quiet evening sky.` }] });
const heading = label => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: label }] });

async function runScenario(complex) {
  const userData = await fs.mkdtemp(path.join(output, `numbering-structures-${complex ? 'complex' : 'flat'}-`));
  const blocks = Array.from({ length: 600 }, (_, index) => index % 100 === 50 ? heading(`Heading ${index + 1}`) : paragraph(`Paragraph ${index + 1}`));
  if (complex) {
    blocks[120] = { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('List item one')] }, { type: 'listItem', content: [paragraph('List item two')] }] };
    blocks[240] = { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph('Table text')] }] }] };
    blocks[360] = { type: 'blockquote', content: [paragraph('Quoted paragraph')] };
    blocks[480] = paragraph('Negative spacing', { spaceBefore: -8 });
  }
  const project = { format: 'wraiter', version: 1, id: `numbering-structures-${complex}`, title: 'Numbering structures', language: 'en-US', documentStyle: { fontFamily: 'Cambria', fontSize: 12, lineHeight: 1.5 }, chapters: [{ id: 'one', title: 'A chapter', content: { type: 'doc', content: blocks } }], references: [], notes: '', style: '', snapshots: [] };
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ setupComplete: true, tutorialComplete: true, enabled: false, startup: 'restore', pageMode: 'continuous', showParagraphNumbers: true, spellcheck: false }));
  await fs.writeFile(path.join(userData, 'recovery.json'), JSON.stringify({ project, path: null, expectedHash: null }));
  const env = { ...process.env, WRAITER_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  const options = process.env.WRAITER_EXECUTABLE ? { executablePath: process.env.WRAITER_EXECUTABLE, args: [], env, timeout: 60000 } : { args: [root], env, timeout: 60000 };
  let app;
  try {
    app = await _electron.launch(options); const page = await app.firstWindow(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const editor = page.getByRole('textbox', { name: 'Manuscript editor', exact: true }); await editor.waitFor();
    await page.locator('.paragraph-numbers .text-number').first().waitFor();
    const check = async label => {
      const target = editor.locator('p,h1,h2,h3,pre').filter({ hasText: label }).first();
      await target.evaluate(element => element.scrollIntoView({ block: 'start' }));
      let result;
      for (let attempt = 0; attempt < 60; attempt++) {
        result = await target.evaluate(element => {
          const editor = element.closest('.manuscript');
          const blocks = [...editor.querySelectorAll('p,h1,h2,h3,pre')];
          const number = blocks.indexOf(element) + 1;
          const label = [...document.querySelectorAll('.paragraph-numbers .text-number')].find(item => Number(item.textContent) === number);
          if (!label || !element.firstChild) return { number, aligned: false };
          const range = document.createRange(); range.setStart(element.firstChild, 0); range.setEnd(element.firstChild, 1);
          const textBox = range.getBoundingClientRect(), labelBox = label.getBoundingClientRect();
          return { number, aligned: Math.abs((textBox.top + textBox.bottom - labelBox.top - labelBox.bottom) / 2) < 5 };
        });
        if (result.aligned) break;
        await pause(50);
      }
      assert.ok(result.aligned, `${complex ? 'Complex' : 'Flat'} ${label}: ${JSON.stringify(result)}`);
    };
    for (const label of complex ? ['Paragraph 1.', 'Heading 51', 'List item one', 'List item two', 'Paragraph 242.', 'Quoted paragraph', 'Negative spacing', 'Paragraph 600.'] : ['Paragraph 1.', 'Heading 51', 'Paragraph 241.', 'Heading 351', 'Paragraph 600.']) await check(label);
    assert.deepEqual(errors, []);
    return { complex, passed: true, userData };
  } finally { await app?.close().catch(() => {}); }
}
(async () => { await fs.mkdir(output, { recursive: true }); console.log(JSON.stringify([await runScenario(false), await runScenario(true)], null, 2)); })().catch(error => { console.error(error); process.exitCode = 1; });
