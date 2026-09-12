const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const FALLBACK_FONTS = ['Arial', 'Calibri', 'Cambria', 'Consolas', 'Courier New', 'Georgia', 'Palatino Linotype', 'Segoe UI', 'Times New Roman', 'Verdana'];
function normalizeFonts(values) {
  return [...new Set(values.map(value => String(value).trim()).filter(value => value && value.length < 200 && !value.startsWith('@') && !/[\x00-\x1f]/.test(value)))].sort((a, b) => a.localeCompare(b));
}
async function listFonts() {
  try {
    if (process.platform === 'win32') {
      const script = "Add-Type -AssemblyName System.Drawing; $wraiterFonts = New-Object System.Drawing.Text.InstalledFontCollection; @($wraiterFonts.Families | ForEach-Object { $_.Name }) | ConvertTo-Json -Compress; $wraiterFonts.Dispose()";
      const result = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 20000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' });
      const parsed = JSON.parse(result.stdout.replace(/^\uFEFF/, ''));
      return normalizeFonts(Array.isArray(parsed) ? parsed : [parsed]);
    }
    const result = await execute('fc-list', ['--format', '%{family}\n'], { windowsHide: true, timeout: 10000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' });
    return normalizeFonts(result.stdout.split(/[\r\n,]+/));
  } catch { return FALLBACK_FONTS; }
}
function spellLanguage(language, available) {
  if (typeof language !== 'string' || !/^[a-z]{2,3}(?:-[a-zA-Z]{2,8}){0,2}$/.test(language)) throw new Error('Choose a valid document language.');
  const exact = available.find(value => value.toLowerCase() === language.toLowerCase());
  if (exact) return exact;
  const base = language.split('-')[0];
  return available.find(value => value.toLowerCase() === base) || null;
}
function menuTemplate(send, close, shortcuts = {}) {
  // Native document commands own their accelerators. Editor/AI shortcuts stay in the renderer.
  const nativeKeys = { new: 'new', open: 'open', save: 'save', 'save-copy': 'saveCopy', find: 'find', replace: 'replace', focus: 'focus', snapshot: 'snapshot', 'settings-appearance': 'preferences' };
  const item = (label, command) => ({ label, accelerator: nativeKeys[command] ? shortcuts[nativeKeys[command]] || undefined : undefined, registerAccelerator: true, click: () => send(command) });
  const separator = { type: 'separator' };
  return [
    { label: '&File', submenu: [item('&New manuscript', 'new', 'Ctrl+N'), item('&Open…', 'open', 'Ctrl+O'), item('Recent manuscripts…', 'recent'), separator, item('&Save', 'save', 'Ctrl+S'), item('Save a &copy…', 'save-copy', 'Ctrl+Shift+S'), item('&Export…', 'export', 'Ctrl+Shift+E'), separator, item('Show in File Explorer', 'reveal'), separator, { label: 'E&xit', click: close }] },
    { label: '&Edit', submenu: [item('&Undo', 'undo'), item('&Redo', 'redo'), separator, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, item('Select &all', 'select-all'), separator, item('&Find…', 'find'), item('&Replace…', 'replace'), separator, item('Suggest / rephrase selection', 'complete'), item('Rephrase selected text', 'rewrite'), item('Correct selected text', 'correct'), item('Accept suggestion', 'accept'), item('Dismiss suggestion', 'dismiss'), separator, item('Enable / disable AI', 'toggle-ai'), item('Automatic suggestions', 'toggle-continuous')] },
    { label: '&View', submenu: [item('Focus mode', 'focus', 'F11'), item('Chapter outline', 'toggle-outline'), item('Writing assistant', 'toggle-assistant'), item('Page view', 'page-view'), separator, item('Git version history', 'history'), item('Create version checkpoint', 'snapshot'), separator, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, separator, { role: 'togglefullscreen', accelerator: '' }] },
    { label: '&Settings', submenu: [item('Appearance and typography…', 'settings-appearance'), item('AI connections and task models…', 'settings-connections'), item('Writing assistance…', 'settings-ai'), item('Language and translation…', 'settings-language'), item('Keyboard shortcuts…', 'settings-hotkeys')] }
  ];
}
module.exports = { listFonts, normalizeFonts, spellLanguage, menuTemplate };
