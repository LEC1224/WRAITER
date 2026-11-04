import React, { useState } from 'react';
import { addBookmark, removeBookmark, bookmarkRows } from './bookmarks.js';
import './navigation.css';

export default function BookmarksPanel({ project, editor, chapterId, onChange, onNavigate, disabled, onError }) {
  const [label, setLabel] = useState('');
  const rows = bookmarkRows(project);
  function add(event) {
    event.preventDefault();
    try {
      const selection = editor?.state.selection;
      if (!selection || selection.empty) throw new Error('Select a passage in the manuscript before adding a bookmark.');
      const result = addBookmark(project, { chapterId, from: selection.from, to: selection.to }, label);
      onChange(result.project, 'Add bookmark', chapterId, result.selection);
      setLabel('');
    } catch (error) { onError(error.message); }
  }
  function remove(id) {
    try { onChange(removeBookmark(project, id), 'Remove bookmark'); }
    catch (error) { onError(error.message); }
  }
  return <details className="bookmarks-panel"><summary>Bookmarks ({rows.length})</summary>
    <form onSubmit={add}><label>Bookmark selected text<input className="field-input" aria-label="Bookmark name" value={label} onChange={event => setLabel(event.target.value)} maxLength={200} placeholder="Bookmark name" /></label><button type="submit" className="secondary-button" disabled={disabled || !label.trim()} title="Select a passage and enter a name to save a bookmark to it.">Add bookmark</button></form>
    {rows.map(({ comment, chapter, ranges, detached }) => <div className="bookmark-row" key={comment.id}><button disabled={disabled || detached} title={detached ? 'The bookmarked passage was removed.' : `Go to ${chapter?.title || 'bookmark'}`} onClick={() => onNavigate(chapter.id, ranges[0])}>{comment.text}<small>{detached ? 'Passage removed' : chapter?.title}</small></button><button disabled={disabled} aria-label={`Remove bookmark ${comment.text}`} onClick={() => remove(comment.id)} title="Remove this bookmark while keeping the passage.">×</button></div>)}
  </details>;
}
