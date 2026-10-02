const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { contextMenuTemplate, editorMenuContext, installContextMenu } = require('../electron/context-menu.cjs');
const params = { x: 20, y: 40, menuSourceType: 'mouse', isEditable: true, dictionarySuggestions: [], editFlags: {} };
const selected = { editor: true, hasSelection: true, hasTextSelection: true, canUndo: true, canRedo: true, canCopyFormatting: true, canPasteFormatting: true, aiEnabled: true };
const callbacks = () => { const calls = []; return { calls, command: value => calls.push(['command', value]), replaceMisspelling: value => calls.push(['spelling', value]), addToDictionary: value => calls.push(['dictionary', value]) }; };
const byId = (menu, id) => menu.find(item => item.id === id);
const settled = () => new Promise(resolve => setImmediate(resolve));

test('selected-passage menu routes formatting, comments and AI without registering global shortcuts', () => {
  const handlers = callbacks(), menu = contextMenuTemplate(params, selected, handlers, { rewrite: 'Ctrl+Alt+R', correct: 'Ctrl+Alt+G' });
  for (const id of ['undo', 'redo', 'copy-format', 'paste-format', 'clear-format', 'add-comment', 'rewrite', 'correct', 'context-assistant']) {
    assert.equal(byId(menu, id).enabled, true, id); byId(menu, id).click();
  }
  assert.deepEqual(handlers.calls.map(call => call[1]), ['undo', 'redo', 'copy-format', 'paste-format', 'clear-format', 'add-comment', 'rewrite', 'correct', 'context-assistant']);
  assert.equal(byId(menu, 'complete'), undefined);
  assert.equal(byId(menu, 'rewrite').accelerator, 'Ctrl+Alt+R');
  assert.equal(byId(menu, 'correct').registerAccelerator, false);
  assert.equal(byId(menu, 'undo').accelerator, 'Ctrl+Z');
  assert.equal(byId(menu, 'undo').registerAccelerator, false);
  assert.equal(byId(menu, 'select-all').accelerator, 'Ctrl+A');
  assert.match(byId(menu, 'context-assistant').label, /selection/);
});

test('caret, empty format buffer, disabled AI, pending requests and previews change available actions', () => {
  const handlers = callbacks(), caret = contextMenuTemplate(params, { ...selected, hasSelection: false, hasTextSelection: false, canPasteFormatting: false }, handlers);
  assert.equal(byId(caret, 'complete').enabled, true);
  for (const id of ['rewrite', 'correct', 'add-comment', 'paste-format']) assert.equal(byId(caret, id).enabled, false, id);
  assert.equal(caret.find(item => item.role === 'copy').enabled, false);
  const off = contextMenuTemplate(params, { ...selected, aiEnabled: false }, handlers);
  assert.equal(byId(off, 'rewrite').enabled, false); assert.equal(byId(off, 'toggle-ai').checked, false);
  assert.equal(byId(off, 'copy-format').enabled, true);
  const waiting = contextMenuTemplate(params, { ...selected, blocked: true }, handlers);
  for (const id of ['rewrite', 'correct', 'paste-format', 'clear-format', 'undo']) assert.equal(byId(waiting, id).enabled, false, id);
  assert.equal(byId(waiting, 'stop-ai').enabled, true);
  const preview = contextMenuTemplate(params, { ...selected, hasSuggestion: true }, handlers);
  assert.equal(byId(preview, 'accept').enabled, true); assert.equal(byId(preview, 'dismiss').enabled, true);
});

test('ordinary inputs use native text undo and clipboard permissions without manuscript actions', () => {
  const menu = contextMenuTemplate({ ...params, editFlags: { canUndo: false, canCopy: false, canPaste: false } }, null, callbacks());
  assert.equal(menu.find(item => item.role === 'undo').enabled, false);
  assert.equal(menu.find(item => item.role === 'copy').enabled, false);
  assert.equal(menu.find(item => item.role === 'paste').enabled, false);
  assert.equal(menu.some(item => item.id), false);
  assert.equal(contextMenuTemplate({ ...params, isEditable: false }, null, callbacks()).find(item => item.role === 'paste').enabled, false);
  assert.deepEqual(editorMenuContext({ ...selected, privateBody: 'never forward', canRedo: 'yes' }), { editor: true, hasSelection: true, hasTextSelection: true, blocked: false, canUndo: true, canRedo: false, canCopyFormatting: true, canPasteFormatting: true, aiEnabled: true, hasSuggestion: false });
  assert.equal(editorMenuContext([]), null);
});

test('spelling suggestions retain their original word and dictionary action before the new groups', () => {
  const handlers = callbacks(), menu = contextMenuTemplate({ ...params, misspelledWord: 'wrod', dictionarySuggestions: ['word', 'R&D', 'ward', 'wood', 'world', 'ignored'] }, selected, handlers);
  assert.deepEqual(menu.slice(0, 6).map(item => item.label), ['word', 'R&&D', 'ward', 'wood', 'world', 'Add to dictionary']);
  menu[1].click(); menu[5].click(); assert.deepEqual(handlers.calls, [['spelling', 'R&D'], ['dictionary', 'wrod']]);
  assert.equal(menu[6].type, 'separator'); assert.equal(menu[7].label, 'Undo');
});

function bridge(t, timeout = 1000) {
  const contents = new EventEmitter(), ipc = new EventEmitter(), sends = [], menus = [];
  contents.send = (channel, value) => sends.push({ channel, value });
  contents.session = { addWordToSpellCheckerDictionary() {} }; contents.replaceMisspelling = () => {};
  const window = { webContents: contents, isDestroyed: () => false };
  const dispose = installContextMenu(window, { ipcMain: ipc, Menu: { buildFromTemplate: template => ({ popup: options => menus.push({ template, options }) }) }, getPreferences: () => ({ hotkeys: { correct: 'Ctrl+Alt+G' } }), timeout });
  t.after(dispose);
  return { contents, ipc, sends, menus, window, dispose };
}

test('native gesture obtains fresh capabilities and replies/actions are tied to that window and request', async t => {
  const app = bridge(t); app.contents.emit('context-menu', {}, { ...params, selectionText: 'private text must stay in renderer' });
  const request = app.sends[0]; assert.equal(request.channel, 'editor-menu:request');
  assert.deepEqual(Object.keys(request.value).sort(), ['id', 'source', 'x', 'y']);
  app.ipc.emit('editor-menu:reply', { sender: new EventEmitter() }, { id: request.value.id, context: selected }); await settled(); assert.equal(app.menus.length, 0);
  app.ipc.emit('editor-menu:reply', { sender: app.contents }, { id: request.value.id, context: selected }); await settled();
  assert.equal(app.menus.length, 1); assert.equal(app.menus[0].options.window, app.window);
  byId(app.menus[0].template, 'paste-format').click();
  assert.deepEqual(app.sends.at(-1), { channel: 'editor-menu:action', value: { id: request.value.id, command: 'paste-format' } });
});

test('a newer gesture supersedes an unanswered one and rejects its late reply', async t => {
  const app = bridge(t); app.contents.emit('context-menu', {}, params); const first = app.sends[0].value.id;
  app.contents.emit('context-menu', {}, params); const second = app.sends[1].value.id;
  app.ipc.emit('editor-menu:reply', { sender: app.contents }, { id: first, context: selected }); await settled(); assert.equal(app.menus.length, 0);
  app.ipc.emit('editor-menu:reply', { sender: app.contents }, { id: second, context: null }); await settled();
  assert.equal(app.menus.length, 1); assert.equal(app.menus[0].template.some(item => item.id), false);
});

test('an unavailable renderer falls back to standard editing and a closed window cancels pending menus', async t => {
  const app = bridge(t, 15); app.contents.emit('context-menu', {}, params);
  await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(app.menus.length, 1);
  assert.equal(app.menus[0].template.some(item => item.id), false);
  app.contents.emit('context-menu', {}, params); app.contents.emit('destroyed'); await settled();
  assert.equal(app.menus.length, 1); assert.equal(app.ipc.listenerCount('editor-menu:reply'), 0);
});
