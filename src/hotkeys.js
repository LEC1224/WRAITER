export const DEFAULT_HOTKEYS = {
  complete: 'Tab', accept: 'Tab', acceptCharacter: 'ArrowRight', acceptWord: 'Ctrl+ArrowRight', dismiss: 'Escape',
  toggleAI: 'Ctrl+Shift+Space', toggleContinuous: 'Ctrl+Alt+Space', correct: 'Ctrl+Alt+G', rewrite: 'Ctrl+Alt+R',
  save: 'Ctrl+S', saveCopy: 'Ctrl+Shift+S', open: 'Ctrl+O', new: 'Ctrl+N', find: 'Ctrl+F', replace: 'Ctrl+H', preferences: 'Ctrl+,', focus: 'F11', snapshot: 'Ctrl+Alt+S'
};
export const HOTKEY_LABELS = { complete: 'Suggest / rephrase selection', accept: 'Accept suggestion', acceptCharacter: 'Accept next character', acceptWord: 'Accept next word', dismiss: 'Dismiss / cancel', toggleAI: 'Toggle AI assistance', toggleContinuous: 'Toggle continuous suggestions', correct: 'Correct selection', rewrite: 'Rephrase selection', save: 'Save', saveCopy: 'Save as', open: 'Open', new: 'New document', find: 'Find', replace: 'Replace', preferences: 'Settings', focus: 'Focus view', snapshot: 'Save version' };
export function shortcutFromEvent(event) {
  if (['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'Dead', 'Process'].includes(event.key) || event.isComposing) return '';
  const key = event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  return [event.ctrlKey ? 'Ctrl' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', event.metaKey ? 'Meta' : '', key].filter(Boolean).join('+');
}
export const formatShortcut = shortcut => String(shortcut || 'Unassigned').replace(/ArrowRight/g, '→').replace(/ArrowLeft/g, '←').replace(/Escape/g, 'Esc').replace(/\+/g, ' + ');
export function shortcutConflicts(hotkeys) {
  const entries = Object.entries(hotkeys).filter(([, value]) => value);
  const conflicts = [];
  for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
    if (entries[i][1] === entries[j][1] && !([entries[i][0], entries[j][0]].every(key => ['complete', 'accept'].includes(key)))) conflicts.push(`${HOTKEY_LABELS[entries[i][0]]} and ${HOTKEY_LABELS[entries[j][0]]} use ${formatShortcut(entries[i][1])}.`);
  }
  return conflicts;
}
export function appendedDuringRequest(request, editor) {
  if (!request || request.mode !== 'continue' || editor.isDestroyed || !editor.state.selection.empty || editor.state.selection.from < request.from) return null;
  const end = editor.state.selection.from;
  try {
    if (!editor.state.tr.delete(request.from, end).doc.eq(request.originalNode)) return null;
    return editor.state.doc.textBetween(request.from, end, '\n', '\n');
  } catch { return null; }
}
