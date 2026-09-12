import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Feather, Plus, Search, ChevronDown, ChevronRight, ArrowLeft, ArrowUp, ArrowDown, ArrowUpRight, Check, X, Minus, Maximize2, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Settings2, FileText, FolderOpen, Download, Save, Copy, MoreHorizontal, Bold, Italic, Underline, Highlighter, AlignLeft, AlignCenter, AlignRight, List, ListOrdered, Quote, Image, Table2, Link2, Undo2, Redo2, Sparkles, WandSparkles, BookOpen, BookMarked, MessageSquare, Send, CircleStop, RotateCcw, CheckCheck, Sun, Moon, Contrast, Focus, Clock3, History, Trash2, FilePlus2, Keyboard, ShieldCheck, Circle, CheckCircle2, LoaderCircle, ExternalLink, SlidersHorizontal, Type, PenLine, GripVertical, Info, Eye, Laptop, ChevronUp, Target } from 'lucide-react';
import ManuscriptEditor, { extensions } from './Editor.jsx';
import { ghostKey, searchKey } from './extensions.js';
import { newProject, uid, blankContent, nodeText, wordCount, projectWords, snapshot } from './document.js';
import { importDocument, exportPayload } from './io.js';
import { revisionTransaction, proposalChangesStructure } from './revisions.js';
import { closeHistory } from '@tiptap/pm/history';
import { TextSelection } from '@tiptap/pm/state';
import { findTextMatches } from './search.js';

const api = window.wraiter;
const DEFAULTS = { theme: 'paper', font: 'Georgia', fontSize: 19, lineHeight: 1.8, measure: 720, predictionWords: 35, goal: 500, spellcheck: true, language: 'en-US', provider: 'ollama', baseUrl: 'http://localhost:11434', model: '', enabled: false, continuous: false };
const providerNames = { ollama: 'Ollama', openai: 'OpenAI', compatible: 'Compatible API', anthropic: 'Claude API', codex: 'Codex CLI' };
const errorText = error => String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

function IconButton({ icon: Icon, title, active, className = '', children, ...props }) {
  return <button type="button" aria-label={title} title={title} className={`icon-button ${active ? 'active' : ''} ${className}`} {...props}><Icon size={17} strokeWidth={1.7} />{children}</button>;
}
function Modal({ title, subtitle, children, onClose, wide = false }) {
  const ref = useRef();
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.querySelector('input,button,select,textarea')?.focus();
    const handler = event => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const items = [...ref.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')];
        const first = items[0], last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', handler);
    return () => { document.removeEventListener('keydown', handler); previous?.focus?.(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><section ref={ref} className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
    <div className="modal-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><IconButton icon={X} title="Close dialog" onClick={onClose} /></div>{children}
  </section></div>;
}

export default function App() {
  const [project, setProject] = useState(null), [prefs, setPrefs] = useState(DEFAULTS), [activeId, setActiveId] = useState(null);
  const [path, setPath] = useState(null), [saveState, setSaveState] = useState('saved'), [saveError, setSaveError] = useState('');
  const [panel, setPanel] = useState('assist'), [leftOpen, setLeftOpen] = useState(true), [focus, setFocus] = useState(false), [pageView, setPageView] = useState(false);
  const [modal, setModal] = useState(null), [menu, setMenu] = useState(false), [toast, setToast] = useState(''), [epoch, setEpoch] = useState(0);
  const [editor, setEditor] = useState(null), [, refreshToolbar] = useState(0), [selection, setSelection] = useState({ from: 0, to: 0 });
  const [query, setQuery] = useState(''), [replacement, setReplacement] = useState(''), [searchOpen, setSearchOpen] = useState(false);
  const [busy, setBusy] = useState(null), [proposal, setProposal] = useState(null), [ghost, setGhost] = useState(null), [aiError, setAiError] = useState('');
  const [instruction, setInstruction] = useState(''), [messages, setMessages] = useState([]), [renameId, setRenameId] = useState(null), [recents, setRecents] = useState([]);
  const projectRef = useRef(project), editorRef = useRef(editor), prefsRef = useRef(prefs), requestRef = useRef(null), autosaveTimer = useRef(null), continuousTimer = useRef(null), rejected = useRef([]), lastRequest = useRef(null), pendingSave = useRef(Promise.resolve()), opening = useRef(false), cancellation = useRef(Promise.resolve());
  const sessionStart = useRef(null), [sessionWords, setSessionWords] = useState(0);
  projectRef.current = project; editorRef.current = editor; prefsRef.current = prefs;
  const chapter = project?.chapters.find(c => c.id === activeId) || project?.chapters[0];
  const notify = useCallback(message => setToast(message), []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 6500); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { document.documentElement.dataset.theme = prefs.theme; }, [prefs.theme]);

  useEffect(() => {
    if (!api) return;
    api.boot().then(result => {
      const initial = result.project || newProject(true);
      setPrefs({ ...DEFAULTS, ...result.prefs }); setPath(result.path); setProject(initial); setActiveId(initial.chapters[0].id);
      setRecents(result.prefs.recent || []);
      sessionStart.current = projectWords(initial);
      if (result.warning) notify(result.warning);
    }).catch(error => notify(errorText(error)));
  }, []);

  const saveLocal = useCallback(async () => {
    clearTimeout(autosaveTimer.current);
    if (!projectRef.current || opening.current) return;
    const captured = projectRef.current;
    setSaveState('saving');
    const work = api.autosave(captured).then(result => {
      if (projectRef.current === captured) { setSaveState('saved'); setSaveError(''); }
      setPath(result.path);
      return result;
    }).catch(error => { setSaveState('error'); setSaveError(errorText(error)); throw error; });
    pendingSave.current = work.catch(() => {});
    return work;
  }, []);
  useEffect(() => {
    if (!project) return;
    setSaveState('pending');
    clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => saveLocal().catch(() => {}), 650);
    if (sessionStart.current !== null) setSessionWords(Math.max(0, projectWords(project) - sessionStart.current));
    return () => clearTimeout(autosaveTimer.current);
  }, [project, saveLocal]);

  const updateProject = useCallback(update => setProject(prev => ({ ...prev, ...update, updatedAt: new Date().toISOString() })), []);
  async function updatePrefs(update) {
    try { const next = await api.settings(update); setPrefs(next); return next; }
    catch (error) { notify(errorText(error)); throw error; }
  }
  function toggleDocumentMenu() {
    setMenu(previous => !previous);
    api.getRecents().then(setRecents).catch(error => notify(errorText(error)));
  }
  const dismiss = useCallback(() => {
    clearTimeout(continuousTimer.current);
    if (requestRef.current) { requestRef.current = null; cancellation.current = api.cancel().catch(() => {}); }
    setBusy(null); setProposal(null); setGhost(null);
    const current = editorRef.current;
    if (current && !current.isDestroyed && ghostKey.getState(current.state)) current.view.dispatch(current.state.tr.setMeta(ghostKey, null));
    return cancellation.current;
  }, []);
  async function saveNamed(copy = false) {
    clearTimeout(autosaveTimer.current);
    await pendingSave.current;
    try { const result = await api.save(projectRef.current, copy); if (result) { setPath(result.path); setSaveState('saved'); setSaveError(''); notify(copy ? 'A new copy is saved.' : 'Manuscript saved.'); } }
    catch (error) { setSaveState('error'); setSaveError(errorText(error)); notify(errorText(error)); }
  }
  async function installProject(next, nextPath = null, resetStorage = false) {
    dismiss(); opening.current = true; clearTimeout(autosaveTimer.current); await pendingSave.current;
    try {
      if (resetStorage) {
        const result = await api.newProject(next);
        if (result.recoveredPath) notify('Your previous unnamed manuscript is preserved in Recent manuscripts.');
      }
      setProject(next); setPath(nextPath); setActiveId(next.chapters[0].id); setEpoch(x => x + 1); setMessages([]); setQuery(''); setSearchOpen(false); setSaveError(''); setSaveState('saved'); sessionStart.current = projectWords(next);
    } finally { opening.current = false; }
  }
  async function openDocument(recent) {
    setMenu(false);
    try {
      await saveLocal(); await pendingSave.current;
      opening.current = true;
      const result = recent ? await api.openRecent(recent) : await api.open();
      if (!result) return;
      if (result.import) { const imported = await importDocument(result, extensions); await installProject(imported.project, null, true); if (imported.warning) { setModal({ type: 'notice', title: 'Import complete', text: imported.warning }); } }
      else await installProject(result.project, result.path);
    } catch (error) { notify(errorText(error)); }
    finally { opening.current = false; }
  }
  async function createNew() {
    try { await saveLocal(); await installProject(newProject(), null, true); setModal(null); notify('A fresh manuscript, ready when you are.'); }
    catch (error) { notify(errorText(error)); }
  }
  function changeChapter(id) { dismiss(); setActiveId(id); setQuery(''); setRenameId(null); }
  function addChapter() {
    dismiss(); const next = { id: uid(), title: `Chapter ${project.chapters.length + 1}`, status: 'Draft', content: blankContent() };
    updateProject({ chapters: [...project.chapters, next] }); setActiveId(next.id); setRenameId(next.id);
  }
  function editChapter(id, update) { updateProject({ chapters: projectRef.current.chapters.map(c => c.id === id ? { ...c, ...update } : c) }); }
  function reorderChapter(id, direction) {
    const chapters = [...project.chapters], index = chapters.findIndex(c => c.id === id), target = index + direction;
    if (target < 0 || target >= chapters.length) return;
    [chapters[index], chapters[target]] = [chapters[target], chapters[index]]; updateProject({ chapters });
  }
  function createSnapshot() { const item = snapshot(projectRef.current); updateProject({ snapshots: [item, ...(projectRef.current.snapshots || [])].slice(0, 20) }); notify('Revision snapshot saved.'); }
  async function exportDocument(format) {
    setModal(null);
    try { const payload = await exportPayload(projectRef.current, format, extensions); const result = await api.exportFile(payload); if (result) { notify(`Exported to ${result}`); if (payload.warning) setModal({ type: 'notice', title: 'Export details', text: payload.warning }); } }
    catch (error) { notify(errorText(error)); }
  }

  function acceptGhost(word = false) {
    const current = editorRef.current, item = current && ghostKey.getState(current.state);
    if (!item) return;
    const accepted = word ? item.text.match(/^\s*\S+\s*/)?.[0] || item.text : item.text;
    const remainder = item.text.slice(accepted.length);
    const next = remainder ? { pos: item.pos + accepted.length, text: remainder } : null;
    let tr = closeHistory(current.state.tr).insertText(accepted, item.pos).setMeta(ghostKey, next);
    tr.setSelection(TextSelection.create(tr.doc, item.pos + accepted.length));
    current.view.dispatch(tr); current.view.focus(); setGhost(next);
  }
  function acceptProposal() {
    const current = editorRef.current;
    if (!proposal || !current) return;
    if (JSON.stringify(current.getJSON()) !== proposal.originalDoc || projectRef.current.id !== proposal.projectId) { dismiss(); notify('The text changed. Request a fresh revision.'); return; }
    const { from, to, text } = proposal;
    setProposal(null);
    const preserved = revisionTransaction(current.state, from, to, text);
    if (preserved) { current.view.dispatch(preserved); current.view.focus(); }
    else {
      current.view.dispatch(closeHistory(current.state.tr));
      current.chain().focus().setTextSelection({ from, to }).insertContent(text.includes('\n') ? text.split('\n').map(p => ({ type: 'paragraph', content: p ? [{ type: 'text', text: p }] : undefined })) : { type: 'text', text, marks: current.state.doc.resolve(from).marks().map(m => m.toJSON()) }).run();
    }
    notify('Revision applied. Ctrl+Z to undo.');
  }
  async function askAI(mode, customInstruction = instruction, retry = false) {
    const current = editorRef.current, settings = prefsRef.current;
    if (!settings.enabled) { setModal({ type: 'settings', tab: 'connections' }); return; }
    if (!current || requestRef.current) return;
    const { from, to } = current.state.selection;
    if (['correct', 'rewrite'].includes(mode) && from === to) { notify('Select a word, sentence, or passage first.'); return; }
    await dismiss(); setAiError('');
    if (current.isDestroyed || editorRef.current !== current || requestRef.current) return;
    const selected = current.state.doc.textBetween(from, to, '\n', '\n');
    const before = current.state.doc.textBetween(0, from, '\n', '\n');
    const after = current.state.doc.textBetween(to, current.state.doc.content.size, '\n', '\n');
    const id = uid(), originalDoc = JSON.stringify(current.getJSON()), projectId = projectRef.current.id;
    const request = { id, mode, before, after, selection: selected, instruction: customInstruction, words: Number(settings.predictionWords), references: (projectRef.current.references || []).filter(r => r.enabled !== false), style: projectRef.current.style || '', history: retry ? rejected.current : [], conversation: mode === 'chat' ? messages.slice(-8).map(m => ({ role: m.role, text: m.text })) : [] };
    requestRef.current = id; lastRequest.current = { mode, instruction: customInstruction }; setBusy(mode);
    if (mode !== 'continue') setPanel('assist');
    if (mode === 'chat') { if (!customInstruction.trim()) { setBusy(null); requestRef.current = null; return; } setMessages(prev => [...prev, { id, role: 'user', text: customInstruction }]); setInstruction(''); }
    try {
      const text = await api.generate(request);
      if (requestRef.current !== id) return;
      if (mode === 'chat') setMessages(prev => [...prev, { id: uid(), role: 'assistant', text }]);
      else {
        if (current.isDestroyed || editorRef.current !== current || JSON.stringify(current.getJSON()) !== originalDoc || current.state.selection.from !== from || current.state.selection.to !== to) { notify('The cursor or text moved. The old suggestion was discarded.'); return; }
        if (mode === 'continue') {
          const prefix = before && !/\s$/.test(before) && !/^[\s.,!?;:’”)]/.test(text) ? ' ' : '';
          const item = { pos: from, text: prefix + text }; current.view.dispatch(current.state.tr.setMeta(ghostKey, item)); setGhost(item); current.view.focus();
        } else if (text === selected) notify('No changes suggested for this selection.');
        else setProposal({ text, original: selected, from, to, originalDoc, projectId, mode, changesStructure: proposalChangesStructure(current.state, from, to, text) });
      }
    } catch (error) { if (requestRef.current === id) setAiError(errorText(error)); }
    finally { if (requestRef.current === id) { requestRef.current = null; setBusy(null); } }
  }
  function retryAI() {
    const previous = proposal?.text || ghost?.text;
    if (previous) rejected.current = [...rejected.current, previous].slice(-3);
    const last = lastRequest.current;
    dismiss(); if (last) setTimeout(() => askAI(last.mode, last.instruction, true), 0);
  }
  const actionRef = useRef();
  actionRef.current = { askAI, acceptGhost, dismiss, saveNamed, saveLocal };
  const onEditorAction = useCallback(action => {
    if (action === 'toolbar-refresh') { refreshToolbar(x => x + 1); return; }
    if (action === 'accept') actionRef.current.acceptGhost();
    if (action === 'accept-word') actionRef.current.acceptGhost(true);
    if (action === 'dismiss') actionRef.current.dismiss();
    if (action === 'continue') actionRef.current.askAI('continue');
  }, []);
  function onContentChanged(content) {
    setProposal(null); setGhost(null);
    if (requestRef.current && busy !== 'chat') { requestRef.current = null; cancellation.current = api.cancel().catch(() => {}); setBusy(null); }
    setProject(previous => ({ ...previous, updatedAt: new Date().toISOString(), chapters: previous.chapters.map(c => c.id === activeId ? { ...c, content } : c) }));
    clearTimeout(continuousTimer.current);
    if (prefsRef.current.enabled && prefsRef.current.continuous && prefsRef.current.provider !== 'codex') continuousTimer.current = setTimeout(() => {
      if (editorRef.current?.isFocused && editorRef.current.state.selection.empty && !requestRef.current) actionRef.current.askAI('continue');
    }, 1800);
  }
  function onEditorSelection(nextSelection) {
    setSelection(nextSelection);
    clearTimeout(continuousTimer.current);
    const current = editorRef.current;
    setGhost(current && !current.isDestroyed ? ghostKey.getState(current.state) : null);
    if (requestRef.current && busy !== 'chat') { requestRef.current = null; cancellation.current = api.cancel().catch(() => {}); setBusy(null); }
  }
  useEffect(() => {
    const onKey = event => {
      if (event.key === 's' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); actionRef.current.saveNamed(event.shiftKey); }
      if (event.key === 'f' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); setSearchOpen(x => !x); }
      if (event.key === ',' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); setModal({ type: 'settings', tab: 'appearance' }); }
      if (event.key === 'F11') { event.preventDefault(); setFocus(x => !x); }
    };
    document.addEventListener('keydown', onKey);
    const stop = api?.onCommand(async command => {
      if (command === 'close-request') { clearTimeout(autosaveTimer.current); actionRef.current.dismiss(); await pendingSave.current; api.finishClose(projectRef.current); }
    });
    return () => { document.removeEventListener('keydown', onKey); stop?.(); };
  }, []);
  useEffect(() => { if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(searchKey, searchOpen ? query : '')); }, [editor, query, searchOpen]);
  function findMatches() {
    if (!editor || !query) return [];
    return findTextMatches(editor.state.doc, query);
  }
  function nextMatch() { const matches = findMatches(); const match = matches.find(m => m.from > editor.state.selection.from) || matches[0]; if (match) editor.chain().focus().setTextSelection(match).scrollIntoView().run(); }
  function replaceMatches(all) {
    const matches = findMatches(); if (!matches.length) return;
    const chosen = all ? matches : [matches.find(m => m.from >= editor.state.selection.from) || matches[0]];
    const tr = closeHistory(editor.state.tr);
    [...chosen].reverse().forEach(m => tr.insertText(replacement, m.from, m.to)); editor.view.dispatch(tr); notify(`Replaced ${chosen.length} match${chosen.length === 1 ? '' : 'es'}.`);
  }

  if (!api) return <div className="boot-screen"><Feather /><h1>WRAITER is a desktop application.</h1><p>Launch WRAITER.exe to use local files and writing assistance.</p></div>;
  if (!project) return <div className="boot-screen"><Feather size={38} /><h1>Opening your writing room…</h1>{toast && <p>{toast}</p>}</div>;
  const totalWords = projectWords(project), chapterWords = wordCount(nodeText(chapter.content));
  const selectedWords = editor && !editor.isDestroyed ? wordCount(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, ' ')) : 0;
  const matches = searchOpen ? findMatches().length : 0;
  const activeReferences = (project.references || []).filter(r => r.enabled !== false);
  const editorCommand = command => { if (editor) command(editor.chain().focus()).run(); };
  const titleStyle = editor?.isActive('heading', { level: 1 }) ? 'heading1' : editor?.isActive('heading', { level: 2 }) ? 'heading2' : editor?.isActive('heading', { level: 3 }) ? 'heading3' : 'paragraph';

  return <div className={`app ${focus ? 'focus-mode' : ''}`} style={{ '--writing-font': prefs.font, '--writing-size': `${prefs.fontSize}px`, '--writing-leading': prefs.lineHeight, '--writing-measure': `${prefs.measure}px` }}>
    <header className="titlebar">
      <div className="brand"><span className="brand-mark"><Feather size={19} /></span><span>WRAITER<span className="alpha-tag">PREVIEW</span></span></div>
      <div className="titlebar-document"><span className="tiny-dot" />{project.title}</div>
      <div className="window-controls"><button aria-label="Minimize window" onClick={() => api.window('minimize')}><Minus size={14} /></button><button aria-label="Maximize window" onClick={() => api.window('maximize')}><Maximize2 size={12} /></button><button aria-label="Close window" onClick={() => api.window('close')}><X size={16} /></button></div>
    </header>
    <div className="workspace">
      {!focus && leftOpen && <aside className="sidebar">
        <div className="project-switcher"><div className="project-avatar"><BookOpen size={21} /></div><div className="project-switcher-text"><small>YOUR MANUSCRIPT</small><button className="project-title-button" onClick={() => setModal({ type: 'rename' })}>{project.title}<PenLine size={12} /></button></div></div>
        <button className="sidebar-search" onClick={() => setSearchOpen(x => !x)}><Search size={15} />Find in chapter<kbd>Ctrl F</kbd></button>
        <div className="sidebar-section-label">MANUSCRIPT <IconButton icon={Plus} title="Add chapter" onClick={addChapter} /></div>
        <nav className="chapter-list" aria-label="Chapters">{project.chapters.map((item, index) => <div className={`chapter-item ${item.id === chapter.id ? 'selected' : ''}`} key={item.id}>
          <button className="chapter-select" onClick={() => changeChapter(item.id)}><span className="chapter-number">{String(index + 1).padStart(2, '0')}</span><span className="chapter-item-text"><span>{item.title}</span><small>{wordCount(nodeText(item.content)).toLocaleString()} words</small></span>{item.status === 'Final' ? <CheckCircle2 size={13} /> : <span className={`chapter-status ${item.status.toLowerCase()}`} />}</button>
        </div>)}</nav>
        <button className="add-chapter" onClick={addChapter}><Plus size={15} />New chapter</button>
        <div className="sidebar-divider" />
        <button className={`sidebar-nav ${panel === 'references' ? 'selected' : ''}`} onClick={() => setPanel(panel === 'references' ? null : 'references')}><BookMarked size={17} />Reference library<span>{project.references?.length || 0}</span></button>
        <button className={`sidebar-nav ${panel === 'notes' ? 'selected' : ''}`} onClick={() => setPanel(panel === 'notes' ? null : 'notes')}><PenLine size={17} />Notes & voice</button>
        <button className={`sidebar-nav ${panel === 'history' ? 'selected' : ''}`} onClick={() => setPanel(panel === 'history' ? null : 'history')}><History size={17} />Revision history<span>{project.snapshots?.length || 0}</span></button>
        <div className="sidebar-spacer" />
        <div className="session-card"><div><span className="section-eyebrow">THIS SESSION</span><Target size={14} /></div><p><strong>{sessionWords.toLocaleString()}</strong><span>/ {Number(prefs.goal).toLocaleString()} words</span></p><div className="progress-track"><div style={{ width: `${Math.min(100, sessionWords / Math.max(1, prefs.goal) * 100)}%` }} /></div><small>{sessionWords >= prefs.goal ? 'A little progress, made real.' : 'One sentence at a time.'}</small></div>
        <button className="sidebar-bottom" onClick={() => setModal({ type: 'settings', tab: 'appearance' })}><Settings2 size={17} /><span>Preferences</span><span className="shortcut">Ctrl ,</span></button>
      </aside>}
      <main className="main-panel">
        <div className="document-topbar"><div className="document-location"><IconButton icon={leftOpen && !focus ? PanelLeftClose : PanelLeftOpen} title="Toggle manuscript sidebar" onClick={() => { setFocus(false); setLeftOpen(!leftOpen); }} /><span className="breadcrumb">Manuscript</span><ChevronRight size={13} /><span>{chapter.title}</span></div><div className="document-actions"><button className={`save-indicator ${saveState === 'error' ? 'error' : ''}`} title={saveError || path || 'Autosaved to local recovery. Save to choose a file.'} onClick={() => saveNamed()}>{saveState === 'saving' || saveState === 'pending' ? <LoaderCircle size={13} className="spin" /> : saveState === 'error' ? <Info size={13} /> : <Check size={13} />}<span>{saveState === 'error' ? 'Save needs attention' : saveState === 'saved' ? path ? 'Saved' : 'Saved locally' : 'Saving'}</span></button><span className="topbar-separator" /><IconButton icon={Focus} title="Focus view (F11)" active={focus} onClick={() => setFocus(!focus)} /><button className="export-button" onClick={() => setModal({ type: 'export' })}><Download size={14} />Export</button><div className="menu-anchor"><IconButton icon={MoreHorizontal} title="Document menu" onClick={toggleDocumentMenu} />{menu && <><div className="menu-dismiss" onClick={() => setMenu(false)} /><div className="dropdown-menu"><button onClick={() => { setMenu(false); setModal({ type: 'new' }); }}><FilePlus2 />New manuscript</button><button onClick={() => openDocument()}><FolderOpen />Open / import…</button><button onClick={() => { setMenu(false); saveNamed(); }}><Save />Save manuscript</button><button onClick={() => { setMenu(false); saveNamed(true); }}><Copy />Save a copy…</button>{path && <button onClick={() => { setMenu(false); api.reveal(); }}><ExternalLink />Show in Explorer</button>}<hr />{recents.length > 0 && <><div className="recent-menu-title">RECENT MANUSCRIPTS</div>{recents.slice(0, 6).map(target => <button key={target} className="recent-menu-item" title={target} onClick={() => openDocument(target)}><FileText /><span>{target.split(/[\\/]/).pop().replace(/\.wraiter$/i, '')}</span></button>)}<hr /></>}<button onClick={() => { setMenu(false); setModal({ type: 'shortcuts' }); }}><Keyboard />Keyboard shortcuts</button><button onClick={() => { setMenu(false); setModal({ type: 'about' }); }}><Info />About this preview</button></div></>}</div></div></div>
        {!focus && <div className="formatbar" role="toolbar" aria-label="Text formatting">
          <select aria-label="Paragraph style" value={titleStyle} onChange={e => editorCommand(chain => e.target.value === 'paragraph' ? chain.setParagraph() : chain.setHeading({ level: Number(e.target.value.at(-1)) }))}><option value="paragraph">Body text</option><option value="heading1">Heading 1</option><option value="heading2">Heading 2</option><option value="heading3">Heading 3</option></select>
          <span className="toolbar-divider" /><IconButton icon={Bold} title="Bold (Ctrl B)" active={editor?.isActive('bold')} onClick={() => editorCommand(c => c.toggleBold())} /><IconButton icon={Italic} title="Italic (Ctrl I)" active={editor?.isActive('italic')} onClick={() => editorCommand(c => c.toggleItalic())} /><IconButton icon={Underline} title="Underline (Ctrl U)" active={editor?.isActive('underline')} onClick={() => editorCommand(c => c.toggleUnderline())} /><IconButton icon={Highlighter} title="Highlight" active={editor?.isActive('highlight')} onClick={() => editorCommand(c => c.toggleHighlight({ color: '#eedca4' }))} />
          <span className="toolbar-divider" /><IconButton icon={AlignLeft} title="Align left" active={editor?.isActive({ textAlign: 'left' })} onClick={() => editorCommand(c => c.setTextAlign('left'))} /><IconButton icon={AlignCenter} title="Align centre" active={editor?.isActive({ textAlign: 'center' })} onClick={() => editorCommand(c => c.setTextAlign('center'))} /><IconButton icon={List} title="Bullet list" active={editor?.isActive('bulletList')} onClick={() => editorCommand(c => c.toggleBulletList())} /><IconButton icon={Quote} title="Block quote" active={editor?.isActive('blockquote')} onClick={() => editorCommand(c => c.toggleBlockquote())} />
          <span className="toolbar-divider" /><IconButton icon={Image} title="Insert image" onClick={async () => { try { const src = await api.image(); if (src) editorCommand(c => c.setImage({ src })); } catch (e) { notify(errorText(e)); } }} /><IconButton icon={Link2} title="Insert or edit link" onClick={() => setModal({ type: 'link', value: editor?.getAttributes('link').href || '' })} /><IconButton icon={Table2} title="Table tools" onClick={() => setModal({ type: 'table' })} /><IconButton icon={SlidersHorizontal} title="More formatting" onClick={() => setModal({ type: 'format' })} />
          <div className="toolbar-spacer" /><IconButton icon={Undo2} title="Undo (Ctrl Z)" disabled={!editor?.can().undo()} onClick={() => editorCommand(c => c.undo())} /><IconButton icon={Redo2} title="Redo (Ctrl Shift Z)" disabled={!editor?.can().redo()} onClick={() => editorCommand(c => c.redo())} /><span className="toolbar-divider" /><IconButton icon={Sparkles} title="Toggle writing assistant" active={panel === 'assist'} onClick={() => setPanel(panel === 'assist' ? null : 'assist')} />
        </div>}
        {searchOpen && <div className="search-bar"><Search size={15} /><input autoFocus aria-label="Find text" placeholder="Find in this chapter" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') nextMatch(); }} /><span>{matches} matches</span><IconButton icon={ArrowDown} title="Next match" onClick={nextMatch} /><input aria-label="Replacement text" placeholder="Replace with" value={replacement} onChange={e => setReplacement(e.target.value)} /><button onClick={() => replaceMatches(false)}>Replace</button><button onClick={() => replaceMatches(true)}>All</button><IconButton icon={X} title="Close search" onClick={() => { setSearchOpen(false); setQuery(''); }} /></div>}
        {saveError && <div className="inline-warning"><Info size={16} /><span>{saveError}</span><button onClick={() => saveNamed(true)}>Save a copy</button></div>}
        <div className={`writing-scroll ${pageView ? 'page-view' : ''}`}>
          <article className="writing-sheet">
            <div className="chapter-kicker"><span>CHAPTER {String(project.chapters.findIndex(c => c.id === chapter.id) + 1).padStart(2, '0')}</span><span className="kicker-line" /><select aria-label="Chapter status" value={chapter.status || 'Draft'} onChange={e => editChapter(chapter.id, { status: e.target.value })}><option>Draft</option><option>Notes</option><option>Revising</option><option>Final</option></select></div>
            <div className="chapter-title-row"><input className="chapter-title" aria-label="Chapter title" value={chapter.title} onChange={e => editChapter(chapter.id, { title: e.target.value })} /><div className="chapter-tools"><IconButton icon={ArrowUp} title="Move chapter earlier" disabled={project.chapters[0].id === chapter.id} onClick={() => reorderChapter(chapter.id, -1)} /><IconButton icon={ArrowDown} title="Move chapter later" disabled={project.chapters.at(-1).id === chapter.id} onClick={() => reorderChapter(chapter.id, 1)} /><IconButton icon={Trash2} title="Delete chapter" disabled={project.chapters.length === 1} onClick={() => setModal({ type: 'delete-chapter' })} /></div></div>
            <div className="chapter-meta">{chapterWords.toLocaleString()} words<span>·</span>{Math.max(1, Math.ceil(chapterWords / 220))} min read</div>
            <ManuscriptEditor key={`${project.id}:${chapter.id}:${epoch}`} chapter={chapter} prefs={prefs} onReady={setEditor} onChange={onContentChanged} onSelection={onEditorSelection} onAction={onEditorAction} />
            <div className="endmark"><span />✦<span /></div>
            {ghost && <div className="ghost-controls"><span><Sparkles size={13} />Suggested continuation</span><button onClick={() => acceptGhost()}><kbd>Tab</kbd> Accept</button><button onClick={retryAI}><RotateCcw size={13} />Another</button><button onClick={dismiss}><kbd>Esc</kbd> Dismiss</button></div>}
            {busy === 'continue' && <div className="generation-inline"><LoaderCircle size={14} className="spin" />Finding the next words…<button onClick={dismiss}>Cancel</button></div>}
          </article>
        </div>
        <div className="writing-status"><div><span>{selectedWords ? `${selectedWords} selected` : `${chapterWords.toLocaleString()} words`}</span><span className="status-dot">·</span><span>{totalWords.toLocaleString()} in manuscript</span></div><div><button onClick={() => setModal({ type: 'settings', tab: 'appearance' })}>{prefs.language === 'sv-SE' ? 'Swedish' : prefs.language === 'en-GB' ? 'English (UK)' : 'English (US)'}</button><span className="status-dot">·</span><button onClick={() => setPageView(!pageView)}>{pageView ? 'Page-width view' : 'Continuous view'}</button><button className={`ai-status ${prefs.enabled ? 'enabled' : ''}`} onClick={() => setModal({ type: 'settings', tab: 'connections' })}><span className="tiny-dot" />{prefs.enabled ? providerNames[prefs.provider] : 'AI off'}</button></div></div>
      </main>
      {!focus && panel && <aside className="inspector">
        <div className="inspector-heading"><div className="inspector-title">{panel === 'assist' ? <Sparkles size={17} /> : panel === 'references' ? <BookMarked size={17} /> : panel === 'notes' ? <PenLine size={17} /> : <History size={17} />}<span>{({ assist: 'Writing companion', references: 'Reference library', notes: 'Notes & voice', history: 'Revision history' })[panel]}</span></div><IconButton icon={PanelRightClose} title="Close side panel" onClick={() => setPanel(null)} /></div>
        {panel === 'assist' && <><div className="inspector-body">
          <div className="assistant-intro"><span className="assistant-emblem"><Feather size={23} /></span><h2>A little help,<br />in your own voice.</h2><p>Find the next words. Refine a passage.<br />Keep the story yours.</p></div>
          <div className="assist-actions"><button onClick={() => askAI('continue')} disabled={!!busy}><span className="assist-action-icon"><PenLine size={17} /></span><span><strong>Continue writing</strong><small>A suggestion at your cursor</small></span><kbd>Ctrl ↵</kbd></button><button onClick={() => askAI('correct')} disabled={!!busy}><span className="assist-action-icon"><CheckCheck size={18} /></span><span><strong>Check this passage</strong><small>Spelling, grammar & punctuation</small></span><ChevronRight size={14} /></button><button onClick={() => askAI('rewrite')} disabled={!!busy}><span className="assist-action-icon"><WandSparkles size={17} /></span><span><strong>Find another phrasing</strong><small>A fresh take on selected text</small></span><ChevronRight size={14} /></button></div>
          <div className="context-summary"><div><BookOpen size={14} /><strong>Context for this request</strong></div><p>{selectedWords ? `${selectedWords} selected words + surrounding text` : 'Text near your cursor'}{activeReferences.length ? ` + ${activeReferences.length} reference${activeReferences.length > 1 ? 's' : ''}` : ''}</p><button onClick={() => setPanel('references')}>Manage references <ArrowUpRight size={12} /></button></div>
          {!prefs.enabled && <div className="connect-card"><span className="section-eyebrow">MAKE IT YOURS</span><p>Connect a local model or your preferred AI provider.</p><button className="primary-button" onClick={() => setModal({ type: 'settings', tab: 'connections' })}>Connect an AI <ArrowUpRight size={14} /></button><small>Writing and saving always work offline.</small></div>}
          {prefs.enabled && <div className="provider-badge"><span className="tiny-dot" /><span>{providerNames[prefs.provider]}<small>{prefs.model || 'Default model'}</small></span><IconButton icon={Settings2} title="Connection settings" onClick={() => setModal({ type: 'settings', tab: 'connections' })} /></div>}
          {aiError && <div className="ai-error" role="alert"><Info size={16} /><p>{aiError}</p><button onClick={() => setAiError('')}>Dismiss</button></div>}
          {proposal && <div className="revision-card"><div className="revision-heading"><Sparkles size={14} /><strong>Suggested revision</strong></div><small>ORIGINAL</small><p className="original-text">{proposal.original}</p><small>PROPOSED</small><p className="proposed-text">{proposal.text}</p>{proposal.changesStructure && <p className="small-muted">This changes paragraph structure or embedded content. Formatting inside the selection may be simplified; surrounding text stays intact.</p>}<div className="revision-actions"><button className="primary-button" onClick={acceptProposal}><Check size={14} />Accept</button><IconButton icon={RotateCcw} title="Another phrasing" onClick={retryAI} /><IconButton icon={X} title="Reject revision" onClick={() => { rejected.current.push(proposal.text); dismiss(); }} /></div></div>}
          {messages.map(message => <div className={`chat-message ${message.role}`} key={message.id}><span>{message.role === 'user' ? 'YOU' : 'WRITING COMPANION'}</span><p>{message.text}</p></div>)}
          {busy && busy !== 'continue' && <div className="thinking"><LoaderCircle size={15} className="spin" />{busy === 'chat' ? 'Thinking it through…' : 'Reading your selection…'}<button onClick={dismiss}>Cancel</button></div>}
        </div><div className="chat-composer"><textarea aria-label="Ask the writing companion" placeholder="Ask about your writing, or add a rephrasing instruction…" value={instruction} onChange={e => setInstruction(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) askAI('chat'); }} /><div><span>{prefs.enabled ? providerNames[prefs.provider] : 'Choose a connection'}</span><button aria-label="Send writing question" disabled={!!busy || !instruction.trim()} onClick={() => askAI('chat')}><ArrowUp size={16} /></button></div><small>Answers use the current passage and enabled references.</small></div></>}
        {panel === 'references' && <div className="inspector-body reference-panel"><div className="panel-description"><h3>A world within reach.</h3><p>Add character sheets, research, or canon. Enabled references accompany AI requests; originals stay separate.</p></div><button className="primary-button full" onClick={async () => { try { const items = await api.reference(); if (!items.length) return; const next = [...(project.references || []), ...items.map(r => ({ ...r, id: uid(), enabled: true }))]; if (next.length > 20) { notify('Keep up to 20 references per manuscript.'); return; } updateProject({ references: next }); } catch (e) { notify(errorText(e)); } }}><Plus size={15} />Add reference files</button><p className="small-muted">Markdown and text files · stored as local copies<br />Up to 48,000 characters are sent per request.</p>{!(project.references || []).length && <div className="empty-state"><BookMarked size={32} /><p>Your reference shelf is empty.</p><small>Start with a character sheet or a few notes about your world.</small></div>}{(project.references || []).map(reference => <div className="reference-card" key={reference.id}><div><BookMarked size={16} /><strong>{reference.name}</strong><IconButton icon={Trash2} title={`Remove ${reference.name}`} onClick={() => updateProject({ references: project.references.filter(r => r.id !== reference.id) })} /></div><p>{reference.text.slice(0, 130)}{reference.text.length > 130 ? '…' : ''}</p><label className="check-label"><input type="checkbox" checked={reference.enabled !== false} onChange={e => updateProject({ references: project.references.map(r => r.id === reference.id ? { ...r, enabled: e.target.checked } : r) })} />Include in AI context</label><button className="text-button" onClick={() => setModal({ type: 'reference', reference })}>Read reference <ArrowUpRight size={12} /></button></div>)}</div>}
        {panel === 'notes' && <div className="inspector-body notes-panel"><div className="panel-description"><h3>Keep the thread.</h3><p>A place for passing thoughts, and the choices that make the writing yours.</p></div><label className="field-label">PRIVATE NOTES <small>Not sent to AI</small></label><textarea className="notes-textarea" aria-label="Private manuscript notes" placeholder="A scene to come back to. A question to leave open…" value={project.notes || ''} onChange={e => updateProject({ notes: e.target.value })} /><label className="field-label">YOUR WRITING VOICE <small>Included in AI context</small></label><textarea className="notes-textarea voice" aria-label="Writing voice instructions" placeholder="For example: British spelling. Keep dialogue informal. Preserve deliberate fragments. Never rename characters." value={project.style || ''} onChange={e => updateProject({ style: e.target.value })} /><p className="small-muted">These are your instructions. AI suggestions never update them automatically.</p></div>}
        {panel === 'history' && <div className="inspector-body"><div className="panel-description"><h3>Room to reconsider.</h3><p>Save a named moment before trying a different direction. Snapshots stay inside this manuscript.</p></div><button className="primary-button full" onClick={createSnapshot}><Plus size={15} />Save revision snapshot</button><p className="small-muted">The 20 most recent snapshots are kept. Every named save also keeps the preceding file as a .bak backup.</p>{!(project.snapshots || []).length && <div className="empty-state"><History size={32} /><p>Your next draft starts here.</p><small>Capture a snapshot to keep this version within reach.</small></div>}{(project.snapshots || []).map(item => <div className="snapshot-card" key={item.id}><div><Clock3 size={14} /><small>{new Date(item.createdAt).toLocaleString()}</small></div><strong>{item.name}</strong><p>{item.chapters.length} chapters · {item.chapters.reduce((sum, c) => sum + wordCount(nodeText(c.content)), 0).toLocaleString()} words</p><button className="secondary-button" onClick={() => setModal({ type: 'restore', item })}><RotateCcw size={13} />Restore this version</button></div>)}</div>}
      </aside>}
    </div>
    {toast && <div className="toast" role="status"><CheckCircle2 size={16} /><span>{toast}</span><IconButton icon={X} title="Dismiss notification" onClick={() => setToast('')} /></div>}
    {modal?.type === 'settings' && <Preferences initialTab={modal.tab} prefs={prefs} updatePrefs={updatePrefs} onClose={() => setModal(null)} notify={notify} />}
    {modal?.type === 'rename' && <Modal title="Name your manuscript" onClose={() => setModal(null)}><form onSubmit={e => { e.preventDefault(); setModal(null); }}><label className="field-label">TITLE</label><input className="field-input" aria-label="Manuscript title" value={project.title} onChange={e => updateProject({ title: e.target.value })} /><div className="modal-footer"><button className="primary-button">Done</button></div></form></Modal>}
    {modal?.type === 'new' && <Modal title="A new beginning" subtitle="Your current manuscript will be preserved. Unnamed drafts remain available through Recent manuscripts." onClose={() => setModal(null)}><div className="modal-footer"><button className="secondary-button" onClick={async () => { await saveNamed(); }}>Save current manuscript</button><button className="primary-button" onClick={createNew}>Create manuscript</button></div></Modal>}
    {modal?.type === 'export' && <Modal title="Send your words out into the world." subtitle="Export all chapters in manuscript order. Your working document stays here." onClose={() => setModal(null)} wide><div className="export-grid">{[['pdf', 'PDF document', 'A clean A4 reading copy', FileText], ['docx', 'Word document', 'Basic formatting, tables & images', FileText], ['html', 'Web document', 'Styled HTML with embedded images', Laptop], ['txt', 'Plain text', 'Your words, universally readable', Type], ['md', 'Markdown', 'Headings and lightweight formatting', PenLine], ['bbcode', 'BBCode', 'Ready for forums and story posts', MessageSquare]].map(([format, title, description, Icon]) => <button className="export-option" key={format} onClick={() => exportDocument(format)}><Icon size={23} /><strong>{title}</strong><span>{description}</span><small>.{format === 'bbcode' ? 'txt' : format}<ArrowUpRight size={14} /></small></button>)}</div><p className="small-muted">This preview exports basic manuscript structure. Advanced page layout, footnotes, comments, and tracked changes are not yet supported. Review an export before publishing.</p></Modal>}
    {modal?.type === 'link' && <Modal title="Link to something" onClose={() => setModal(null)}><form onSubmit={e => { e.preventDefault(); const href = new FormData(e.currentTarget).get('href'); if (!/^(https?:\/\/|mailto:)/i.test(href)) { notify('Use a full https://, http://, or mailto: address.'); return; } editorCommand(c => c.extendMarkRange('link').setLink({ href })); setModal(null); }}><input className="field-input" name="href" aria-label="Link address" placeholder="https://" defaultValue={modal.value} /><div className="modal-footer"><button type="button" className="secondary-button" onClick={() => { editorCommand(c => c.unsetLink()); setModal(null); }}>Remove link</button><button className="primary-button">Apply link</button></div></form></Modal>}
    {modal?.type === 'table' && <Modal title="Table tools" onClose={() => setModal(null)}><div className="button-grid">{[['Insert 3 × 3 table', c => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }), false], ['Add row below', c => c.addRowAfter(), true], ['Add column', c => c.addColumnAfter(), true], ['Delete row', c => c.deleteRow(), true], ['Delete column', c => c.deleteColumn(), true], ['Remove table', c => c.deleteTable(), true]].map(([label, command, needsTable]) => <button className="secondary-button" key={label} disabled={needsTable && !editor?.isActive('table')} onClick={() => { editorCommand(command); setModal(null); }}>{label}</button>)}</div></Modal>}
    {modal?.type === 'format' && <Modal title="Text & paragraph" subtitle="These controls change document formatting. Reading preferences only change your writing view." onClose={() => setModal(null)}><div className="form-grid"><label>Font<select className="field-input" defaultValue={editor?.getAttributes('textStyle').fontFamily || ''} onChange={e => editorCommand(c => e.target.value ? c.setFontFamily(e.target.value) : c.unsetFontFamily())}><option value="">Manuscript default</option><option>Georgia</option><option>Cambria</option><option>Arial</option><option>Calibri</option><option>Times New Roman</option></select></label><label>Size<select className="field-input" defaultValue={editor?.getAttributes('textStyle').fontSize || ''} onChange={e => editorCommand(c => e.target.value ? c.setFontSize(e.target.value) : c.unsetFontSize())}><option value="">Default</option>{[12, 14, 16, 18, 20, 24, 28, 32].map(n => <option key={n} value={`${n}px`}>{n} px</option>)}</select></label></div><div className="button-grid"><button className="secondary-button" onClick={() => editorCommand(c => c.setTextAlign('justify'))}>Justify paragraph</button><button className="secondary-button" onClick={() => editorCommand(c => c.setTextAlign('right'))}>Align right</button><button className="secondary-button" onClick={() => editorCommand(c => c.toggleOrderedList())}>Numbered list</button><button className="secondary-button" onClick={() => editorCommand(c => c.setHorizontalRule())}>Scene break</button><button className="secondary-button" onClick={() => editorCommand(c => c.toggleStrike())}>Strikethrough</button><button className="secondary-button" onClick={() => editorCommand(c => c.unsetAllMarks().clearNodes())}>Clear formatting</button></div><div className="modal-footer"><button className="primary-button" onClick={() => setModal(null)}>Done</button></div></Modal>}
    {modal?.type === 'delete-chapter' && <Modal title={`Delete “${chapter.title}”?`} subtitle="A snapshot of your manuscript will be kept before the chapter is removed." onClose={() => setModal(null)}><div className="modal-footer"><button className="secondary-button" onClick={() => setModal(null)}>Keep chapter</button><button className="danger-button" onClick={() => { const current = projectRef.current; const chapters = current.chapters.filter(c => c.id !== chapter.id); dismiss(); updateProject({ chapters, snapshots: [snapshot(current, 'Before deleting a chapter'), ...(current.snapshots || [])].slice(0, 20) }); setActiveId(chapters[0].id); setModal(null); }}>Delete chapter</button></div></Modal>}
    {modal?.type === 'restore' && <Modal title="Return to this revision?" subtitle="We’ll capture your current version first, so you can return to it later." onClose={() => setModal(null)}><div className="modal-footer"><button className="secondary-button" onClick={() => setModal(null)}>Keep writing</button><button className="primary-button" onClick={() => { const item = modal.item; dismiss(); updateProject({ title: item.title, chapters: structuredClone(item.chapters), notes: item.notes || '', style: item.style || '', references: structuredClone(item.references || []), snapshots: [snapshot(project, 'Before restoring a revision'), ...project.snapshots].slice(0, 20) }); setActiveId(item.chapters[0].id); setEpoch(x => x + 1); setModal(null); notify('Revision restored.'); }}>Restore revision</button></div></Modal>}
    {modal?.type === 'reference' && <Modal title={modal.reference.name} subtitle="A local reference copy. Included only when enabled." onClose={() => setModal(null)} wide><pre className="reference-reader">{modal.reference.text}</pre></Modal>}
    {modal?.type === 'notice' && <Modal title={modal.title} onClose={() => setModal(null)}><p className="notice-copy">{modal.text}</p><div className="modal-footer"><button className="primary-button" onClick={() => setModal(null)}>Continue writing</button></div></Modal>}
    {modal?.type === 'shortcuts' && <Modal title="Keep your hands on the keys." onClose={() => setModal(null)}><div className="shortcut-list">{[['Save manuscript', 'Ctrl S'], ['Save a copy', 'Ctrl Shift S'], ['Find in chapter', 'Ctrl F'], ['Bold / italic / underline', 'Ctrl B / I / U'], ['Undo / redo', 'Ctrl Z / Ctrl Shift Z'], ['Ask for a continuation', 'Ctrl Enter'], ['Accept suggestion', 'Tab'], ['Accept next suggested word', 'Ctrl →'], ['Dismiss suggestion / cancel', 'Esc'], ['Focus view', 'F11']].map(([name, key]) => <div key={name}><span>{name}</span><kbd>{key}</kbd></div>)}</div></Modal>}
    {modal?.type === 'about' && <Modal title="WRAITER · 0.1.0" subtitle="A quiet place to write, with AI within reach." onClose={() => setModal(null)}><p className="notice-copy">This is the first Windows preview. It includes rich-text writing, chapters, local recovery, revision snapshots, basic imports and exports, and provider connections.</p><p className="notice-copy">Live pagination, comments, tracked changes, footnotes, EPUB, full office-format compatibility, and Claude Code / Grok Build agent connections are future work. The page-width view is a reading surface; PDF export performs pagination.</p><p className="small-muted">The opening sample is fictional demonstration text. Your existing manuscripts are never opened or changed automatically.</p></Modal>}
  </div>;
}

function Preferences({ initialTab, prefs, updatePrefs, onClose, notify }) {
  const [tab, setTab] = useState(initialTab || 'appearance'), [draft, setDraft] = useState({ ...prefs, apiKey: '' }), [checking, setChecking] = useState(false), [connection, setConnection] = useState(''), [models, setModels] = useState([]), [saving, setSaving] = useState(false);
  const set = (name, value) => setDraft(previous => ({ ...previous, [name]: value }));
  const presets = { ollama: { baseUrl: 'http://localhost:11434', model: '' }, openai: { baseUrl: 'https://api.openai.com/v1', model: '' }, compatible: { baseUrl: 'https://api.x.ai/v1', model: '' }, anthropic: { baseUrl: 'https://api.anthropic.com/v1', model: '' }, codex: { baseUrl: '', model: '' } };
  async function save() { setSaving(true); try { await updatePrefs(draft); onClose(); notify('Preferences saved.'); } catch {} finally { setSaving(false); } }
  async function check() { setChecking(true); setConnection(''); try { const result = await api.probe(draft); setConnection(result.message); setModels(result.models); } catch (e) { setConnection(errorText(e)); } finally { setChecking(false); } }
  return <Modal title="Make yourself at home." subtitle="Your writing space. Your preferred tools." onClose={onClose} wide>
    <div className="settings-tabs"><button className={tab === 'appearance' ? 'selected' : ''} onClick={() => setTab('appearance')}><Sun size={15} />Writing space</button><button className={tab === 'connections' ? 'selected' : ''} onClick={() => setTab('connections')}><Sparkles size={15} />AI connections</button></div>
    {tab === 'appearance' ? <div className="settings-content"><label className="field-label">ATMOSPHERE</label><div className="theme-options">{[['paper', 'Paper', Sun], ['dark', 'Warm dark', Moon], ['contrast', 'High contrast', Contrast]].map(([value, label, Icon]) => <button key={value} className={`theme-option ${value} ${draft.theme === value ? 'selected' : ''}`} onClick={() => set('theme', value)}><div><span /><span /><span /></div><label><Icon size={14} />{label}{draft.theme === value && <Check size={14} />}</label></button>)}</div><div className="form-grid"><label>Reading font<select className="field-input" value={draft.font} onChange={e => set('font', e.target.value)}><option>Georgia</option><option>Cambria</option><option>Palatino Linotype</option><option>Segoe UI</option><option>Arial</option><option>Consolas</option></select></label><label>Text size <span className="range-value">{draft.fontSize}px</span><input type="range" aria-label="Reading text size" min="14" max="28" value={draft.fontSize} onChange={e => set('fontSize', Number(e.target.value))} /></label><label>Line spacing<select className="field-input" value={draft.lineHeight} onChange={e => set('lineHeight', Number(e.target.value))}><option value="1.5">Compact · 1.5</option><option value="1.8">Comfortable · 1.8</option><option value="2">Spacious · 2.0</option></select></label><label>Text column<select className="field-input" value={draft.measure} onChange={e => set('measure', Number(e.target.value))}><option value="600">Narrow</option><option value="720">Balanced</option><option value="840">Wide</option></select></label><label>Document language<select className="field-input" value={draft.language} onChange={e => set('language', e.target.value)}><option value="en-US">English (US)</option><option value="en-GB">English (UK)</option><option value="sv-SE">Swedish</option></select></label><label>Session word goal<input className="field-input" type="number" min="1" max="100000" value={draft.goal} onChange={e => set('goal', Math.max(1, Number(e.target.value)))} /></label></div><label className="check-label"><input type="checkbox" checked={draft.spellcheck} onChange={e => set('spellcheck', e.target.checked)} />Underline spelling errors locally</label><p className="small-muted">Appearance changes affect your writing view. Publication exports use their own manuscript layout.</p></div> : <div className="settings-content"><div className="connection-toggle"><div><strong>Writing assistance</strong><p>Suggestions only become text when you accept them.</p></div><button role="switch" aria-checked={draft.enabled} aria-label="Enable writing assistance" className={`toggle ${draft.enabled ? 'on' : ''}`} onClick={() => set('enabled', !draft.enabled)}><span /></button></div><div className="form-grid"><label>Provider<select className="field-input" value={draft.provider} onChange={e => { setDraft(previous => ({ ...previous, provider: e.target.value, ...presets[e.target.value], apiKey: '', clearKey: false })); setModels([]); setConnection(''); }}>{Object.entries(providerNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Model<input className="field-input" list="provider-models" placeholder={draft.provider === 'codex' ? 'CLI default (or enter a model)' : 'Model name from your provider'} value={draft.model} onChange={e => set('model', e.target.value)} /><datalist id="provider-models">{models.map(model => <option key={model} value={model} />)}</datalist></label></div>{draft.provider !== 'codex' ? <><label className="field-label">{draft.provider === 'ollama' ? 'OLLAMA HOST' : 'API BASE ADDRESS'}</label><input className="field-input" value={draft.baseUrl} aria-label="Provider base address" onChange={e => set('baseUrl', e.target.value)} />{draft.provider !== 'ollama' && <><label className="field-label spaced">API KEY <small>{prefs.hasKey && draft.provider === prefs.provider && draft.baseUrl === prefs.baseUrl ? 'Saved securely · leave blank to keep' : 'Stored with Windows encryption'}</small></label><input className="field-input" type="password" autoComplete="off" aria-label="Provider API key" placeholder="Enter an API key" value={draft.apiKey} onChange={e => set('apiKey', e.target.value)} /><label className="check-label small"><input type="checkbox" checked={!!draft.clearKey} onChange={e => set('clearKey', e.target.checked)} />Remove saved key for this provider</label></>}</> : <><label className="field-label">CODEX EXECUTABLE <small>Optional if detected automatically</small></label><div className="input-with-button"><input className="field-input" aria-label="Codex executable path" value={draft.codexPath || ''} placeholder="Automatic detection" onChange={e => set('codexPath', e.target.value)} /><button className="secondary-button" onClick={async () => { const value = await api.chooseCodex(); if (value) set('codexPath', value); }}>Browse</button></div><p className="small-muted">Uses your existing Codex CLI sign-in. Each request runs in an isolated temporary folder with a read-only sandbox and tools disabled. CLI startup can make autocomplete slower.</p></>}
      <div className="connection-check"><button className="secondary-button" disabled={checking} onClick={check}>{checking ? <LoaderCircle size={14} className="spin" /> : <CheckCircle2 size={14} />}Check connection</button><small>Checks access; does not generate text.</small></div>{connection && <div className="connection-result" role="status">{connection}</div>}
      <div className="form-grid"><label>Suggestion length<select className="field-input" value={draft.predictionWords} onChange={e => set('predictionWords', Number(e.target.value))}><option value="15">Brief · 15 words</option><option value="35">A few sentences · 35 words</option><option value="70">A short passage · 70 words</option><option value="120">Extended · 120 words</option></select></label><label className="check-label continuous-label"><input type="checkbox" disabled={draft.provider === 'codex'} checked={draft.continuous && draft.provider !== 'codex'} onChange={e => set('continuous', e.target.checked)} />Suggest after a writing pause</label></div><div className="privacy-note"><ShieldCheck size={18} /><p>{draft.provider === 'ollama' ? 'Text is sent to the Ollama host above. A localhost address keeps model processing on this computer.' : 'Selected text, surrounding context, and enabled references are sent to this provider when you request assistance. Cloud usage follows your provider’s billing or subscription.'} Private notes are excluded.</p></div><p className="small-muted">Claude API is available here; Claude Code and Grok Build agent connections are planned. The compatible API option can connect to services such as xAI.</p>
    </div>}
    <div className="modal-footer"><button className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save preferences'}<Check size={14} /></button></div>
  </Modal>;
}
