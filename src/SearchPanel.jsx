import React, { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Search, X } from 'lucide-react';
import { groupSearchResults } from './search.js';

function Snippet({ result, replacement, preview = false }) {
  const snippet = result.snippet || { before: '', match: result.text, after: '' };
  return <span className="manuscript-search-snippet">{snippet.before}<mark>{snippet.match}</mark>{preview && <><span className="search-replacement-arrow"> → </span><ins>{replacement || '(delete)'}</ins></>}{snippet.after}</span>;
}

function ResultsList({ results, activeId, disabled, onActivate, replacement, preview = false, query }) {
  const [page, setPage] = useState(0), list = useRef(), pageSize = 100;
  const activeIndex = results.findIndex(result => result.id === activeId), pages = Math.max(1, Math.ceil(results.length / pageSize));
  const currentPage = Math.min(page, pages - 1), start = currentPage * pageSize;
  const groups = groupSearchResults(results.slice(start, start + pageSize));
  const totals = new Map(groupSearchResults(results).map(group => [group.chapterId, group.results.length]));
  useEffect(() => { setPage(0); }, [results]);
  useEffect(() => { if (!preview && activeIndex >= 0) setPage(Math.floor(activeIndex / pageSize)); }, [activeIndex, preview]);
  useEffect(() => { list.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' }); }, [activeId, currentPage]);
  return <><div ref={list} className="manuscript-search-results" aria-label={preview ? 'Replacement preview results' : 'Search results'}>{groups.map(group => <section className="manuscript-search-group" key={group.chapterId}><h3>{group.chapterTitle}<span>{group.results.length < totals.get(group.chapterId) ? `${group.results.length} of ${totals.get(group.chapterId)}` : group.results.length}</span></h3>{group.results.map(result => preview ? <div className="manuscript-search-result preview" key={result.id}><Snippet result={result} replacement={replacement} preview /></div> : <button type="button" key={result.id} className={'manuscript-search-result' + (result.id === activeId ? ' active' : '')} aria-current={result.id === activeId ? 'true' : undefined} disabled={disabled} onClick={() => onActivate(result)}><Snippet result={result} /></button>)}</section>)}{!preview && query && !results.length && <p className="manuscript-search-empty">No matches found.</p>}{!preview && !query && <p className="manuscript-search-empty">Find passages across your chapters.</p>}</div>{pages > 1 && <div className="manuscript-search-pages"><button type="button" className="secondary-button" aria-label={preview ? 'Previous preview results' : 'Previous search results'} disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous results</button><span>Showing {start + 1}–{Math.min(start + pageSize, results.length)} of {results.length}. {preview ? 'All matches will be replaced.' : ''}</span><button type="button" className="secondary-button" aria-label={preview ? 'More preview results' : 'More search results'} disabled={currentPage === pages - 1} onClick={() => setPage(currentPage + 1)}>More results</button></div>}</>;
}

export default function SearchPanel({ query, onQueryChange, replacement, onReplacementChange, scope = 'manuscript', onScopeChange, options = {}, onOptionsChange, results = [], activeResult, onActivate, onReplace, onReplaceAll, onClose, busy = false }) {
  const input = useRef(), panel = useRef();
  const [preview, setPreview] = useState(null), [applying, setApplying] = useState(false), [error, setError] = useState('');
  const activeId = typeof activeResult === 'string' ? activeResult : activeResult?.id;
  const activeIndex = results.findIndex(result => result.id === activeId);
  const disabled = busy || applying;
  useEffect(() => { input.current?.focus(); }, []);
  // A changed query, scope, option or replacement needs a fresh review. A preview
  // holds its original results so the caller can reject stale manuscript edits.
  useEffect(() => { setPreview(null); setError(''); }, [query, replacement, scope, options.caseSensitive, options.wholeWord]);
  const navigate = direction => {
    if (!results.length || disabled) return;
    const index = activeIndex < 0 ? direction > 0 ? 0 : results.length - 1 : (activeIndex + direction + results.length) % results.length;
    onActivate(results[index]);
  };
  const confirmReplace = async () => {
    if (!preview || disabled) return;
    setApplying(true);
    try { const applied = await onReplaceAll(preview.results, preview.replacement); if (applied === false) throw new Error('The manuscript changed after this preview. Cancel it and preview the replacements again.'); setPreview(null); setError(''); }
    catch (failure) { setError(failure?.message || 'The replacements could not be applied. Search again and review a fresh preview.'); }
    finally { setApplying(false); }
  };
  return <section ref={panel} className="manuscript-search-panel" aria-label="Manuscript search and replace" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (preview) setPreview(null); else onClose(); }
  }}>
    <div className="manuscript-search-heading"><strong><Search size={16} />Find and replace</strong><button type="button" className="icon-button" title="Close search" aria-label="Close search" onClick={onClose}><X size={17} /></button></div>
    <div className="manuscript-search-controls">
      <label>Find<input ref={input} aria-label="Find text" placeholder="Find text" value={query} onChange={event => onQueryChange(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); navigate(event.shiftKey ? -1 : 1); } }} /></label>
      <label>Search in<select aria-label="Search scope" value={scope} onChange={event => onScopeChange(event.target.value)}><option value="manuscript">Whole manuscript</option><option value="chapter">Current chapter</option></select></label>
      <div className="manuscript-search-options"><label><input type="checkbox" checked={!!options.caseSensitive} onChange={event => onOptionsChange({ ...options, caseSensitive: event.target.checked })} />Match case</label><label><input type="checkbox" checked={!!options.wholeWord} onChange={event => onOptionsChange({ ...options, wholeWord: event.target.checked })} />Whole words</label></div>
      <div className="manuscript-search-navigation"><span role="status" aria-live="polite">{activeIndex >= 0 ? `${activeIndex + 1} of ` : ''}{results.length} match{results.length === 1 ? '' : 'es'}</span><button type="button" className="icon-button" title="Previous match" aria-label="Previous match" disabled={!results.length || disabled} onClick={() => navigate(-1)}><ArrowUp size={16} /></button><button type="button" className="icon-button" title="Next match" aria-label="Next match" disabled={!results.length || disabled} onClick={() => navigate(1)}><ArrowDown size={16} /></button></div>
      <label>Replace with<input aria-label="Replacement text" placeholder="Replacement text" value={replacement} onChange={event => onReplacementChange(event.target.value)} /></label>
      <div className="manuscript-search-actions"><button type="button" className="secondary-button" title="Replace the current match" disabled={!results.length || disabled} onClick={() => onReplace(results[activeIndex >= 0 ? activeIndex : 0], replacement)}>Replace</button><button type="button" className="secondary-button" disabled={!results.length || disabled} onClick={() => { setPreview({ results, replacement }); setError(''); }}>Preview replace all</button></div>
    </div>
    {preview ? <div className="search-replace-preview" role="region" aria-label="Replace all preview">
      <p>Replace {preview.results.length} match{preview.results.length === 1 ? '' : 'es'} in {groupSearchResults(preview.results).length} chapter{groupSearchResults(preview.results).length === 1 ? '' : 's'}? You can undo the replacements together.</p>
      <ResultsList results={preview.results} replacement={preview.replacement} preview />
      {error && <p role="alert">{error}</p>}<div className="manuscript-search-actions"><button type="button" className="secondary-button" disabled={disabled} onClick={() => setPreview(null)}>Cancel preview</button><button type="button" className="primary-button" disabled={disabled} onClick={confirmReplace}>{applying ? 'Replacing…' : `Replace all ${preview.results.length}`}</button></div>
    </div> : <ResultsList results={results} query={query} activeId={activeId} disabled={disabled} onActivate={onActivate} />}
  </section>;
}
