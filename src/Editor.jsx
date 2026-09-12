import React, { useEffect, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyleKit } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import { GhostText, SearchHighlight, ghostKey } from './extensions.js';

export const extensions = [
  StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false, autolink: false } }),
  TextStyleKit, TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Highlight.configure({ multicolor: true }), Image.configure({ allowBase64: true }), TableKit.configure({ table: { resizable: true } }),
  Placeholder.configure({ placeholder: 'Every story begins somewhere…' }), GhostText, SearchHighlight
];
export default function ManuscriptEditor({ chapter, prefs, onReady, onChange, onSelection, onAction }) {
  const callbacks = useRef({ onReady, onChange, onSelection, onAction });
  callbacks.current = { onReady, onChange, onSelection, onAction };
  const editor = useEditor({
    extensions, content: chapter.content,
    editorProps: {
      attributes: { class: 'manuscript', 'aria-label': 'Manuscript editor', role: 'textbox', 'aria-multiline': 'true', spellcheck: String(prefs.spellcheck), lang: prefs.language },
      handleKeyDown(view, event) {
        const ghost = ghostKey.getState(view.state);
        if (ghost && event.key === 'Tab') { event.preventDefault(); callbacks.current.onAction('accept'); return true; }
        if (ghost && event.key === 'ArrowRight' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); callbacks.current.onAction('accept-word'); return true; }
        if (event.key === 'Escape') { callbacks.current.onAction('dismiss'); return Boolean(ghost); }
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); callbacks.current.onAction('continue'); return true; }
        return false;
      }
    },
    onUpdate: ({ editor }) => callbacks.current.onChange(editor.getJSON()),
    onSelectionUpdate: ({ editor }) => callbacks.current.onSelection(editor.state.selection),
    onTransaction: () => callbacks.current.onAction('toolbar-refresh')
  });
  useEffect(() => { if (editor) callbacks.current.onReady(editor); return () => callbacks.current.onReady(null); }, [editor]);
  useEffect(() => { editor?.setOptions({ editorProps: { ...editor.options.editorProps, attributes: { ...editor.options.editorProps.attributes, spellcheck: String(prefs.spellcheck), lang: prefs.language } } }); }, [editor, prefs.spellcheck, prefs.language]);
  return <EditorContent editor={editor} />;
}
