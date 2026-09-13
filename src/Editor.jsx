import React, { useEffect, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyleKit } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import { GhostText, SearchHighlight, ParagraphFormat, ghostKey } from './extensions.js';
import { DEFAULT_HOTKEYS, shortcutFromEvent } from './hotkeys.js';
import { HISTORY_SELECTION_META } from './history.js';
import { Pagination, paginationKey, removePageBreakAtCursor } from './pagination.js';

export const extensions = [
  StarterKit.configure({ undoRedo: false, heading: { levels: [1, 2, 3] }, link: { openOnClick: false, autolink: false } }),
  TextStyleKit, TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Highlight.configure({ multicolor: true }), Image.configure({ allowBase64: true }), TableKit.configure({ table: { resizable: true } }),
  Placeholder.configure({ placeholder: 'Start writing…' }), ParagraphFormat, GhostText, SearchHighlight, Pagination
];
export default function ManuscriptEditor({ chapter, prefs, layoutSignature, onReady, onChange, onSelection, onAction }) {
  const callbacks = useRef({ onReady, onChange, onSelection, onAction, prefs });
  callbacks.current = { onReady, onChange, onSelection, onAction, prefs };
  const editor = useEditor({
    extensions, content: chapter.content,
    editorProps: {
      attributes: { class: 'manuscript', 'aria-label': 'Manuscript editor', role: 'textbox', 'aria-multiline': 'true', spellcheck: String(prefs.spellcheck), lang: prefs.language },
      handleKeyDown(view, event) {
        const ghost = ghostKey.getState(view.state);
        const keys = { ...DEFAULT_HOTKEYS, ...callbacks.current.prefs.hotkeys }, pressed = shortcutFromEvent(event);
        if (!pressed) return false;
        if (pressed === 'Backspace' && removePageBreakAtCursor(view)) { event.preventDefault(); return true; }
        let action;
        if (['Ctrl+Z', 'Meta+Z'].includes(pressed)) action = 'undo';
        else if (['Ctrl+Y', 'Ctrl+Shift+Z', 'Shift+Meta+Z'].includes(pressed)) action = 'redo';
        else if (ghost?.alternatives && ['ArrowDown', 'ArrowUp'].includes(pressed)) action = pressed === 'ArrowDown' ? 'option-next' : 'option-previous';
        else if (ghost?.alternatives && ['Enter', 'Tab'].includes(pressed)) action = 'accept';
        else if (ghost?.text && pressed === keys.accept) action = 'accept';
        else if (ghost?.text && ghost.kind !== 'revision' && pressed === keys.acceptCharacter) action = 'accept-character';
        else if (ghost?.text && ghost.kind !== 'revision' && pressed === keys.acceptWord) action = 'accept-word';
        else if (ghost && pressed === keys.dismiss) action = 'dismiss';
        else if (callbacks.current.prefs.enabled && pressed === keys.complete) action = view.state.selection.empty ? 'continue' : 'rewrite';
        else if (callbacks.current.prefs.enabled && pressed === keys.correct) action = 'correct';
        else if (callbacks.current.prefs.enabled && pressed === keys.rewrite) action = 'rewrite';
        else if (pressed === keys.pageBreak) action = 'page-break';
        if (action) { event.preventDefault(); callbacks.current.onAction(action); return true; }
        return false;
      },
      handleDOMEvents: {
        beforeinput(view, event) {
          if (!['historyUndo', 'historyRedo'].includes(event.inputType)) return false;
          event.preventDefault();
          callbacks.current.onAction(event.inputType === 'historyUndo' ? 'undo' : 'redo');
          return true;
        }
      },
      handleTextInput(view, from, to, text) {
        const item = ghostKey.getState(view.state);
        // A revision is only a preview. Typing resumes after the untouched selection.
        if (item?.kind !== 'revision') return false;
        view.dispatch(view.state.tr.insertText(text, item.to, item.to).setMeta(ghostKey, null));
        return true;
      }
    },
    onUpdate: ({ editor, transaction, appendedTransactions }) => callbacks.current.onChange(editor.getJSON(), editor, transaction, { appendedTransactions }),
    onSelectionUpdate: ({ editor }) => callbacks.current.onSelection(editor.state.selection),
    onTransaction: () => callbacks.current.onAction('toolbar-refresh')
  });
  useEffect(() => {
    if (!editor) return;
    const captureSelection = ({ transaction }) => transaction.setMeta(HISTORY_SELECTION_META, editor.state.selection.toJSON());
    editor.on('beforeTransaction', captureSelection);
    callbacks.current.onReady(editor);
    return () => { editor.off('beforeTransaction', captureSelection); callbacks.current.onReady(null); };
  }, [editor]);
  useEffect(() => { editor?.setOptions({ editorProps: { ...editor.options.editorProps, attributes: { ...editor.options.editorProps.attributes, spellcheck: String(prefs.spellcheck), lang: prefs.language } } }); }, [editor, prefs.spellcheck, prefs.language]);
  useEffect(() => { if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(paginationKey, { enabled: prefs.pageMode === 'pages', revision: JSON.stringify([prefs.zoom, prefs.measure, layoutSignature]) }).setMeta('addToHistory', false)); }, [editor, prefs.pageMode, prefs.zoom, prefs.measure, layoutSignature]);
  return <EditorContent editor={editor} />;
}
