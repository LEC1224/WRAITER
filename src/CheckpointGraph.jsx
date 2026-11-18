import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, Clock3, CornerDownRight, Eye, GitBranch, GitMerge, ListTree, Search, Settings2, X } from 'lucide-react';
import HistoryMapCanvas from './HistoryMapCanvas.jsx';
import CheckpointEdits from './CheckpointEdits.jsx';
import { layoutHistory, searchHistory, versionLabel } from './history-map.js';
import './checkpoint-graph.css';

const date = value => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const time = value => new Date(value).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

function usePassageNames(projectId, groups, visible, enabled, memory) {
  const [names, setNames] = useState(memory.names || {});
  const [naming, setNaming] = useState(''), [failed, setFailed] = useState('');
  const [retry, setRetry] = useState(0), priority = useRef([]);
  const lookup = useMemo(() => new Map((groups || []).map(g => [g.key, g])), [groups]);
  priority.current = visible;
  const wake = visible.join(' ');
  useEffect(() => {
    if (!enabled || !window.wraiter.describeStoryPassage) { setNaming(''); return; }
    let alive = true, timer;
    const cooldown = memory.cooldown ||= new Map();
    async function next() {
      const now = Date.now();
      const waiting = priority.current.map(key => lookup.get(key)).filter(g => g?.hasProse && !g.sections && !memory.names?.[g.key]);
      const group = waiting.find(g => (cooldown.get(g.key) || 0) <= now);
      if (!group) {
        setNaming('');
        if (waiting.length) timer = setTimeout(next, Math.max(1000, Math.min(...waiting.map(g => cooldown.get(g.key))) - now));
        return;
      }
      setNaming(group.key);
      let response;
      try { response = await window.wraiter.describeStoryPassage(projectId, group.key); } catch { response = { status: 'unavailable' }; }
      if (!alive) return;
      if (response?.status === 'ready') {
        memory.names = { ...memory.names, [group.key]: response.sections };
        setNames(memory.names); cooldown.delete(group.key); setFailed('');
      } else if (response?.status === 'disabled') { setNaming(''); return; }
      else if (response?.status === 'busy') {
        setNaming(''); timer = setTimeout(next, 3500); return;
      } else { cooldown.set(group.key, now + 120000); setFailed(group.key); }
      timer = setTimeout(next, 250);
    }
    timer = setTimeout(next, 240);
    return () => { alive = false; clearTimeout(timer); };
  }, [enabled, projectId, lookup, wake, memory, retry]);
  return { names, naming, failed, retry: key => { memory.cooldown?.delete(key); setRetry(n => n + 1); } };
}

export default function CheckpointGraph({ history, projectId, journal, aiEnabled, viewState, onSettings, onPreview, onRestore, onMerge }) {
  const memory = useMemo(() => {
    if (viewState.current?.id !== projectId) viewState.current = { id: projectId };
    return viewState.current;
  }, [projectId, viewState]);
  const [selection, setSelection] = useState(memory.selection || { id: history.headRevision, version: true });
  const [query, setQuery] = useState(''), [searchOpen, setSearchOpen] = useState(false), searchBox = useRef(null);
  const [focus, setFocus] = useState(null), [inspect, setInspect] = useState(null), [visible, setVisible] = useState([]);
  const reportVisible = useCallback(keys => setVisible(prev => prev.join() === keys.join() ? prev : keys), []);
  const ai = usePassageNames(projectId, history.passages, visible, aiEnabled && !inspect, memory);
  const map = useMemo(() => layoutHistory(history, ai.names), [history, ai.names]);
  const active = map.points.get(selection.id) || map.points.get(history.headRevision) || map.points.values().next().value;
  const scene = active && map.sceneOf.get(active.item.revision);
  const version = scene && (selection.version || scene.members.length === 1) ? active : null;
  const results = useMemo(() => searchHistory(map, query), [map, query]);
  const [limit, setLimit] = useState(25);
  const select = (s, point, move = false) => {
    if (!s) return;
    const next = { id: point?.item.revision || s.id, version: Boolean(point) };
    memory.selection = next; setSelection(next);
    if (move) setFocus({ ...next });
  };
  const goCurrent = () => { const p = map.points.get(history.headRevision); if (p) select(map.sceneOf.get(p.item.revision), p, true); };
  const openResult = result => { select(result.scene, result.point, true); searchBox.current?.focus(); setSearchOpen(false); };
  if (inspect) return <CheckpointEdits item={inspect} journal={journal} getRevision={window.wraiter.getGitRevision} onBack={() => setInspect(null)}/>;
  if (!scene) return <p role="status">{history.error || (history.loading ? 'Loading writing history…' : 'Save a version to start your history map.')}</p>;
  const item = version?.item, fact = (item || scene.members[Math.floor(scene.members.length / 2)].item).passage?.excerpts?.[0] || scene.members.find(p => p.item.passage?.excerpts?.length)?.item.passage.excerpts[0];
  const title = item && (scene.members.length > 1 || !scene.summary) ? versionLabel(item) : scene.title;
  const state = active.current ? 'Current draft' : active.onCurrentPath ? 'Earlier on this path' : active.integrated ? 'Merged path' : 'Alternate draft';
  const showResults = searchOpen && query.trim();
  return <div className="story-map">
    <div className="story-map-top">
      <div className="map-search-wrap" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setSearchOpen(false); }}>
        <div className="map-search"><Search size={16}/><input type="search" ref={searchBox} aria-label="Find a passage or version" placeholder="Find a character, passage, or version" value={query} onFocus={() => setSearchOpen(true)} onClick={() => setSearchOpen(true)}
          onChange={e => { setQuery(e.target.value); setLimit(25); setSearchOpen(true); }} onKeyDown={e => {
            if (e.key === 'Escape' && showResults) { e.preventDefault(); setSearchOpen(false); }
            if (e.key === 'Enter' && showResults && results.length) { e.preventDefault(); openResult(results[0]); }
            if (e.key === 'ArrowDown' && showResults) { e.preventDefault(); e.currentTarget.closest('.map-search-wrap').querySelector('.map-results button')?.focus(); }
          }}/>{query && <button aria-label="Clear search" onClick={() => { setQuery(''); searchBox.current.focus(); }}><X size={14}/></button>}</div>
        {showResults && <div className="map-results" aria-label="History search results">
          {results.length ? results.slice(0, limit).map(({ scene: s, point, title: label }, i) =>
            <button key={(point ? 'v' + point.item.revision : 's' + s.id)} onClick={() => openResult(results[i])}><strong>{label}</strong><small>{s.chapter && s.chapter + ' · '}{point ? date(point.item.date) + ' · ' + time(point.item.date) : s.members.length + (s.members.length === 1 ? ' version' : ' versions')}</small></button>)
            : <p role="status">No passages or versions match “{query}”.</p>}
          {results.length > limit && <button className="text-button" onClick={() => setLimit(limit + 50)}>Show more matches</button>}
        </div>}
      </div>
      <div className="map-overview-status">
        {!aiEnabled && window.wraiter.describeStoryPassage && <button className="text-button" onClick={onSettings}><Settings2 size={13}/>AI passage titles are off</button>}
        <span className="story-count">{map.scenes.length} {map.scenes.length === 1 ? 'passage' : 'passages'} · {map.points.size} {map.points.size === 1 ? 'version' : 'versions'}</span>
      </div>
    </div>
    {history.mapError && <p className="small-muted" role="status">{history.mapError}</p>}
    <div className="story-map-body">
      <div className="story-map-main">
        <HistoryMapCanvas map={map} selection={selection} focus={focus} onSelect={select} onCurrent={goCurrent} memory={memory} onVisible={reportVisible}/>
        <div className="story-map-key"><span>Drag to move · Scroll to zoom</span><span><i/>Current path</span>{map.edges.some(e => !e.active && !e.merge) && <span><i className="alternate"/>Alternate</span>}{map.edges.some(e => e.merge) && <span><i className="merge"/>Merged</span>}</div>
      </div>
      <aside className="story-inspector" aria-label="Selected history">
        {version && scene.members.length > 1 && <button className="text-button" onClick={() => select(scene, null)}><ArrowLeft size={13}/>Back to passage</button>}
        <div className="map-state"><span className={active.onCurrentPath ? 'active' : ''}/>{state}</div>
        <h3>{title}</h3>
        <div className="map-details">{(fact?.chapter || scene.chapter) && <span><BookOpen size={13}/>{fact?.chapter || scene.chapter}</span>}<span><Clock3 size={13}/>{date((item || scene.first.item).date)}{item ? ' · ' + time(item.date) : date(scene.first.item.date) !== date(scene.last.item.date) ? ' – ' + date(scene.last.item.date) : ''}</span></div>
        {scene.summary && <p className="map-summary">{scene.summary}</p>}
        {fact && fact.quote !== title && <blockquote>{fact.quote}</blockquote>}
        {!fact && item?.summary && <p className="map-summary">{item.summary}</p>}
        {scene.group?.key === ai.naming && <p className="map-ai-status" role="status">Naming this passage…</p>}
        {scene.group?.key === ai.failed && scene.group?.hasProse && !scene.summary && <button className="text-button" onClick={() => ai.retry(scene.group.key)}>Retry AI passage title</button>}
        {version ? <div className="map-actions">
          <button className="primary-button" onClick={() => onPreview(item)}><Eye size={15}/>Read this version</button>
          <button className="secondary-button" onClick={() => { setFocus(null); setInspect(item); }}><ListTree size={15}/>Inspect edits</button>
          {!version.current && <button className="secondary-button" onClick={() => onRestore(item)}><GitBranch size={15}/>Continue from here</button>}
          {!version.integrated && onMerge && <button className="secondary-button" onClick={() => onMerge(item)}><GitMerge size={15}/>Merge into current draft</button>}
        </div> : <>
          <div className="map-version-list"><h4>Saved versions <span>{scene.members.length}</span></h4>
            {[...scene.members].reverse().map(p => <button key={p.item.revision} onClick={() => select(scene, p, true)}><CornerDownRight size={13}/><span><strong>{versionLabel(p.item)}</strong><small>{date(p.item.date)} · {time(p.item.date)}</small></span></button>)}
          </div>
        </>}
      </aside>
    </div>
  </div>;
}
