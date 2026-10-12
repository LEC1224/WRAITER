import { documentExtensions } from '../electron/editor-schema.mjs';
import React, { useEffect, useMemo, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { Fragment, Slice } from '@tiptap/pm/model';

import Placeholder from '@tiptap/extension-placeholder';
import { GhostText, SearchHighlight, ghostKey } from './extensions.js';
import { DEFAULT_HOTKEYS, shortcutFromEvent } from './hotkeys.js';
import { associateHistoryContent, HISTORY_GROUP_BREAK_META, HISTORY_SELECTION_META } from './history.js';
import { Pagination, paginationKey, removePageBreakAtCursor } from './pagination.js';
import { WordCount, wordCountKey } from './word-count.js';
import { imageImportExtension } from './image-import.js';
import { imageControls } from './images.js';

export const extensions = [...documentExtensions, Placeholder.configure({ placeholder: 'Start writing…' }), GhostText, SearchHighlight, WordCount, Pagination];
// Ordinary text copying does not duplicate a note or expose its internal ID.
function withoutCommentAnchors(slice) {
  const clean = node => {
    const marks = node.marks.filter(mark => mark.type.name !== 'commentAnchor');
    return (node.isLeaf ? node : node.copy(Fragment.fromArray(Array.from({ length: node.childCount }, (_, index) => clean(node.child(index)))))).mark(marks);
  };
  return new Slice(Fragment.fromArray(Array.from({ length: slice.content.childCount }, (_, index) => clean(slice.content.child(index)))), slice.openStart, slice.openEnd);
}
export default function ManuscriptEditor({ chapter, prefs, layoutSignature, onReady, onChange, onSelection, onAction, onNotice, canImportImages }) {
  const callbacks = useRef({ onReady, onChange, onSelection, onAction, onNotice, canImportImages, prefs });
  const toolbarFrame = useRef(0);
  const selectionBoundary = useRef(true);
  const initialContent = useRef(chapter.content), editorInstance = useRef(null);
  callbacks.current = { onReady, onChange, onSelection, onAction, onNotice, canImportImages, prefs };
  // The editor owns its live document. Parent snapshots change on every edit;
  // rebuilding options for each snapshot needlessly updates the entire view.
  // Chapter/project/history replacement remounts this component with a new key.
  const options = useMemo(() => ({
    extensions: [...extensions.map(extension => extension.name === 'image' ? imageControls(extension, current => callbacks.current.canImportImages?.(current) !== false) : extension), imageImportExtension({ onNotice: message => callbacks.current.onNotice?.(message), canInsert: () => callbacks.current.canImportImages?.(editorInstance.current) !== false })], content: initialContent.current,
    editorProps: {
      attributes: { class: 'manuscript', 'aria-label': 'Manuscript editor', role: 'textbox', 'aria-multiline': 'true', spellcheck: String(prefs.spellcheck), lang: prefs.language },
      transformCopied: withoutCommentAnchors,
      transformPasted: withoutCommentAnchors,
      handleClick(_view, _position, event) {
        if (event.button !== 0) return false;
        const link = event.target.closest?.('a[href]');
        if (link && (event.ctrlKey || event.metaKey)) { event.preventDefault(); callbacks.current.onAction('open-link:' + link.getAttribute('href')); return true; }
        const anchor = event.target.closest?.('[data-comment-id]');
        if (anchor) callbacks.current.onAction('comment:' + anchor.getAttribute('data-comment-id'));
        return false;
      },
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
      transaction.setMeta(HISTORY_GROUP_BREAK_META, selectionBoundary.current);
      selectionBoundary.current = false;
      const content = associateHistoryContent(editor.getJSON(), editor.state.doc);
      callbacks.current.onChange(content, editor, transaction, { appendedTransactions, wordCount: wordCountKey.getState(editor.state) });
    },
    onSelectionUpdate: ({ editor, transaction }) => {
      if (!transaction?.docChanged) selectionBoundary.current = true;
      callbacks.current.onSelection(editor.state.selection);
    },
    onTransaction: () => {
      if (!toolbarFrame.current) toolbarFrame.current = requestAnimationFrame(() => { toolbarFrame.current = 0; callbacks.current.onAction('toolbar-refresh'); });
    }
  }), [prefs.spellcheck, prefs.language]);
  const editor = useEditor(options);
  editorInstance.current = editor;
  useEffect(() => {
    if (!editor) return;
    const captureSelection = ({ transaction }) => transaction.setMeta(HISTORY_SELECTION_META, editor.state.selection.toJSON());
    editor.on('beforeTransaction', captureSelection);
    callbacks.current.onReady(editor);
    return () => { editor.off('beforeTransaction', captureSelection); callbacks.current.onReady(null); };
  }, [editor]);
  useEffect(() => () => cancelAnimationFrame(toolbarFrame.current), []);
  useEffect(() => { if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(paginationKey, { enabled: prefs.pageMode === 'pages', numbering: { row: prefs.showRowNumbers, page: prefs.showPageNumbers, paragraph: prefs.showParagraphNumbers }, revision: JSON.stringify([prefs.zoom, prefs.measure, prefs.showRowNumbers, prefs.showPageNumbers, prefs.showParagraphNumbers, layoutSignature]) }).setMeta('addToHistory', false)); }, [editor, prefs.pageMode, prefs.zoom, prefs.measure, prefs.showRowNumbers, prefs.showPageNumbers, prefs.showParagraphNumbers, layoutSignature]);
  return <EditorContent editor={editor} />;
}
