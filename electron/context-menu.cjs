const { randomUUID } = require('node:crypto');

const CONTEXT_FLAGS = ['hasSelection', 'hasTextSelection', 'blocked', 'canUndo', 'canRedo', 'canCopyFormatting', 'canPasteFormatting', 'aiEnabled', 'hasSuggestion'];
function editorMenuContext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.editor !== true) return null;
  return { editor: true, ...Object.fromEntries(CONTEXT_FLAGS.map(key => [key, value[key] === true])) };
}

function contextMenuTemplate(params, context, handlers, shortcuts = {}) {
  const editor = editorMenuContext(context), flags = params.editFlags || {}, separator = { type: 'separator' };
  const action = (label, command, enabled = true, shortcut) => ({
    id: command, label, enabled, click: () => handlers.command(command),
    ...(shortcut ? { accelerator: shortcut, registerAccelerator: false } : {})
  });
  const items = (params.dictionarySuggestions || []).slice(0, 5).map(word => ({ label: word.replace(/&/g, '&&'), click: () => handlers.replaceMisspelling(word) }));
  if (params.misspelledWord) items.push({ label: 'Add to dictionary', click: () => handlers.addToDictionary(params.misspelledWord) });
  if (items.length) items.push(separator);
  items.push(...(editor ? [action('Undo', 'undo', editor.canUndo && !editor.blocked, 'Ctrl+Z'), action('Redo', 'redo', editor.canRedo && !editor.blocked, 'Ctrl+Y')] : [{ role: 'undo', enabled: flags.canUndo !== false }, { role: 'redo', enabled: flags.canRedo !== false }]), separator,
    { role: 'cut', enabled: editor ? editor.hasSelection && !editor.blocked : flags.canCut !== false },
    { role: 'copy', enabled: editor ? editor.hasSelection : flags.canCopy !== false },
    { role: 'paste', enabled: Boolean(params.isEditable) && (!editor || !editor.blocked) && flags.canPaste !== false },
    editor ? action('Select all', 'select-all', true, 'Ctrl+A') : { role: 'selectAll', enabled: flags.canSelectAll !== false });
  if (!editor) return items;
  items.push(separator,
    action('Copy formatting', 'copy-format', editor.canCopyFormatting && !editor.blocked),
    action('Paste formatting', 'paste-format', editor.canPasteFormatting && !editor.blocked),
    action('Clear formatting', 'clear-format', !editor.blocked),
    action('Add comment…', 'add-comment', editor.hasTextSelection && !editor.blocked), separator);
  const aiAvailable = editor.aiEnabled && !editor.blocked;
  if (!editor.hasSelection) items.push(action('Continue writing here', 'complete', aiAvailable, shortcuts.complete));
  items.push(action('Rephrase / translate selection', 'rewrite', aiAvailable && editor.hasTextSelection, shortcuts.rewrite),
    action('Correct spelling and grammar', 'correct', aiAvailable && editor.hasTextSelection, shortcuts.correct),
    action(editor.hasTextSelection ? 'Ask assistant about selection…' : 'Ask writing assistant…', 'context-assistant', !editor.blocked));
  if (editor.hasSuggestion) items.push(action('Accept suggestion', 'accept', !editor.blocked, shortcuts.accept), action('Dismiss suggestion', 'dismiss', !editor.blocked, shortcuts.dismiss));
  if (editor.blocked) items.push(action('Stop generating', 'stop-ai'));
  items.push(separator, { ...action('Enable AI', 'toggle-ai', !editor.blocked), type: 'checkbox', checked: editor.aiEnabled }, action('AI settings…', 'settings-connections'));
  return items;
}

// The renderer owns the current passage, formatting buffer and persistent undo.
// Ask for capabilities at the gesture, rather than caching a stale focused field.
function installContextMenu(window, { Menu, ipcMain, getPreferences = () => ({}), timeout = 700 }) {
  const contents = window.webContents;
  let pending = null, currentId = null, disposed = false;
  function finish(context) {
    if (!pending) return;
    const request = pending; pending = null; clearTimeout(request.timer); request.resolve(context);
  }
  function reply(event, message) {
    if (event.sender !== contents || event.senderFrame?.parent || !pending || message?.id !== pending.id) return;
    finish(editorMenuContext(message.context));
  }
  async function open(_event, params) {
    finish(null);
    const id = randomUUID(); currentId = id;
    const context = await new Promise(resolve => {
      pending = { id, resolve, timer: setTimeout(() => finish(null), timeout) };
      contents.send('editor-menu:request', { id, x: params.x, y: params.y, source: params.menuSourceType });
    });
    if (disposed || currentId !== id || window.isDestroyed()) return;
    Menu.buildFromTemplate(contextMenuTemplate(params, context, {
      command: command => contents.send('editor-menu:action', { id, command }),
      replaceMisspelling: word => contents.replaceMisspelling(word),
      addToDictionary: word => contents.session.addWordToSpellCheckerDictionary(word)
    }, getPreferences().hotkeys)).popup({ window });
  }
  function dispose() {
    disposed = true; finish(null);
    ipcMain.removeListener('editor-menu:reply', reply); contents.removeListener('context-menu', open);
  }
  ipcMain.on('editor-menu:reply', reply); contents.on('context-menu', open); contents.once('destroyed', dispose);
  return dispose;
}

module.exports = { editorMenuContext, contextMenuTemplate, installContextMenu };
