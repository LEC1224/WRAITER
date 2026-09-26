import { documentExtensions } from '../electron/editor-schema.mjs';
import React, { useEffect, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';

import Placeholder from '@tiptap/extension-placeholder';
import { GhostText, SearchHighlight, ghostKey } from './extensions.js';
import { DEFAULT_HOTKEYS, shortcutFromEvent } from './hotkeys.js';
import { associateHistoryContent, HISTORY_SELECTION_META } from './history.js';
import { Pagination, paginationKey, removePageBreakAtCursor } from './pagination.js';
import { WordCount, wordCountKey } from './word-count.js';

export const extensions = [...documentExtensions, Placeholder.configure({ placeholder: 'Start writing…' }), GhostText, SearchHighlight, WordCount, Pagination];
export default function ManuscriptEditor({ chapter, prefs, layoutSignature, onReady, onChange, onSelection, onAction }) {
  const callbacks = useRef({ onReady, onChange, onSelection, onAction, prefs });
  const toolbarFrame = useRef(0);
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
    onUpdate: ({ editor, transaction, appendedTransactions }) => {
      const content = associateHistoryContent(editor.getJSON(), editor.state.doc);
      callbacks.current.onChange(content, editor, transaction, { appendedTransactions, wordCount: wordCountKey.getState(editor.state) });
    },
    onSelectionUpdate: ({ editor }) => callbacks.current.onSelection(editor.state.selection),
    onTransaction: () => {
      if (!toolbarFrame.current) toolbarFrame.current = requestAnimationFrame(() => { toolbarFrame.current = 0; callbacks.current.onAction('toolbar-refresh'); });
    }
  });
  useEffect(() => {
    if (!editor) return;
    const captureSelection = ({ transaction }) => transaction.setMeta(HISTORY_SELECTION_META, editor.state.selection.toJSON());
    editor.on('beforeTransaction', captureSelection);
    callbacks.current.onReady(editor);
    return () => { editor.off('beforeTransaction', captureSelection); callbacks.current.onReady(null); };
  }, [editor]);
  useEffect(() => () => cancelAnimationFrame(toolbarFrame.current), []);
  useEffect(() => { editor?.setOptions({ editorProps: { ...editor.options.editorProps, attributes: { ...editor.options.editorProps.attributes, spellcheck: String(prefs.spellcheck), lang: prefs.language } } }); }, [editor, prefs.spellcheck, prefs.language]);
  useEffect(() => { if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(paginationKey, { enabled: prefs.pageMode === 'pages', numbering: { row: prefs.showRowNumbers, page: prefs.showPageNumbers, paragraph: prefs.showParagraphNumbers }, revision: JSON.stringify([prefs.zoom, prefs.measure, prefs.showRowNumbers, prefs.showPageNumbers, prefs.showParagraphNumbers, layoutSignature]) }).setMeta('addToHistory', false)); }, [editor, prefs.pageMode, prefs.zoom, prefs.measure, prefs.showRowNumbers, prefs.showPageNumbers, prefs.showParagraphNumbers, layoutSignature]);
  return <EditorContent editor={editor} />;
}
