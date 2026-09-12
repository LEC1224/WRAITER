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
import Settings from './Settings.jsx';
import { DEFAULT_HOTKEYS, shortcutFromEvent, formatShortcut, appendedDuringRequest } from './hotkeys.js';
import { LANGUAGES, languageName } from './languages.js';

const api = window.wraiter;
const DEFAULTS = { theme: 'paper', font: 'Cambria', fontSize: 16, lineHeight: 1.5, measure: 720, zoom: 100, predictionWords: 35, contextWords: 2000, tokenCap: 512, temperature: 0.7, allowReasoning: false, ollamaMode: 'auto', goal: 500, spellcheck: true, language: 'en-US', nativeLanguage: '', provider: 'codex', baseUrl: '', model: '', enabled: false, continuous: false, hotkeys: DEFAULT_HOTKEYS };
const providerNames = { ollama: 'Ollama', openai: 'OpenAI', compatible: 'Compatible API / xAI', anthropic: 'Claude API', codex: 'Codex' };
const errorText = error => String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

function IconButton({ icon: Icon, title, active, className = '', children, ...props }) {
  return <button type="button" aria-label={title} title={title} className={`icon-button ${active ? 'active' : ''} ${className}`} {...props}><Icon size={17} strokeWidth={1.7} />{children}</button>;
}
function FontSizeInput({ value, onApply, label = 'Font size in points', className = 'font-size-select' }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return <input className={className} type="number" aria-label={label} title="Font size (points)" min="6" max="96" step="0.5" value={draft} onChange={e => setDraft(e.target.value)} onBlur={() => { const size = Number(draft); if (size >= 6 && size <= 96) onApply(size); else setDraft(String(value)); }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }} />;
}
function Modal({ title, subtitle, children, onClose, wide = false }) {
  const ref = useRef();
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.querySelector('input,button,select,textarea')?.focus();
    const handler = event => {
      if (event.defaultPrevented) return;
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
  const [panel, setPanel] = useState(null), [leftOpen, setLeftOpen] = useState(true), [focus, setFocus] = useState(false), [pageView, setPageView] = useState(true);
  const [modal, setModal] = useState(null), [menu, setMenu] = useState(false), [toast, setToast] = useState(''), [epoch, setEpoch] = useState(0);
  const [editor, setEditor] = useState(null), [, refreshToolbar] = useState(0), [selection, setSelection] = useState({ from: 0, to: 0 });
  const [query, setQuery] = useState(''), [replacement, setReplacement] = useState(''), [searchOpen, setSearchOpen] = useState(false);
  const [busy, setBusy] = useState(null), [proposal, setProposal] = useState(null), [ghost, setGhost] = useState(null), [aiError, setAiError] = useState('');
  const [instruction, setInstruction] = useState(''), [messages, setMessages] = useState([]), [renameId, setRenameId] = useState(null), [recents, setRecents] = useState([]);
  const projectRef = useRef(project), editorRef = useRef(editor), prefsRef = useRef(prefs), requestRef = useRef(null), autosaveTimer = useRef(null), continuousTimer = useRef(null), rejected = useRef([]), lastRequest = useRef(null), pendingSave = useRef(Promise.resolve()), opening = useRef(false), cancellation = useRef(Promise.resolve());
  const sessionStart = useRef(null), [sessionWords, setSessionWords] = useState(0);
  const [fonts, setFonts] = useState(['Cambria', 'Calibri', 'Arial', 'Georgia', 'Times New Roman']), [gitHistory, setGitHistory] = useState({ available: true, entries: [] });
  const documentLanguage = project?.language || prefs.language;
  const proposalRef = useRef(null); proposalRef.current = proposal;
  projectRef.current = project; editorRef.current = editor; prefsRef.current = prefs;
  const chapter = project?.chapters.find(c => c.id === activeId) || project?.chapters[0];
  const notify = useCallback(message => setToast(message), []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 6500); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { document.documentElement.dataset.theme = prefs.theme; }, [prefs.theme]);
  useEffect(() => { document.title = project ? `${project.title} — WRAITER` : 'WRAITER'; }, [project?.title]);
  useEffect(() => { if (documentLanguage) api?.setDocumentLanguage(documentLanguage).catch(error => notify(errorText(error))); }, [documentLanguage]);
  useEffect(() => { api?.listFonts().then(setFonts).catch(() => {}); }, []);
  useEffect(() => { if (panel === 'history' && project) loadGitHistory(); }, [panel, project?.id]);

  useEffect(() => {
    if (!api) return;
    api.boot().then(result => {
      const initial = result.project || { ...newProject(false), language: result.prefs.language || 'en-US' };
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
    try { await saveLocal(); await installProject({ ...newProject(), language: prefsRef.current.language }, null, true); setModal(null); notify('New manuscript created.'); }
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
  async function loadGitHistory() {
    try { await saveLocal(); setGitHistory(await api.listGitHistory()); } catch (error) { setGitHistory({ available: false, entries: [], error: errorText(error) }); }
  }
  async function createSnapshot(label) {
    if (typeof label !== 'string') { setModal({ type: 'snapshot' }); return; }
    try {
      await pendingSave.current;
      await api.commitGitSnapshot(projectRef.current, label || 'Version checkpoint');
      await loadGitHistory(); setModal(null); notify('Version saved in Git history.'); return true;
    } catch (error) { notify(errorText(error)); return false; }
  }
  async function restoreGitVersion(revision) {
    try {
      if (!await createSnapshot('Before restoring a version')) return;
      const previous = await api.getGitRevision(revision);
      const restored = { ...previous, id: projectRef.current.id, updatedAt: new Date().toISOString() };
      await api.commitGitSnapshot(restored, `Restored version ${revision.slice(0, 8)}`);
      dismiss(); updateProject(restored); setActiveId(previous.chapters[0].id); setEpoch(value => value + 1); setModal(null);
      setGitHistory(await api.listGitHistory());
      notify('Earlier version restored. Your preceding version remains in Git history.');
    } catch (error) { notify(errorText(error)); }
  }
  async function exportDocument(format) {
    setModal(null);
    try { const payload = await exportPayload(projectRef.current, format, extensions); const result = await api.exportFile(payload); if (result) { notify(`Exported to ${result}`); if (payload.warning) setModal({ type: 'notice', title: 'Export details', text: payload.warning }); } }
    catch (error) { notify(errorText(error)); }
  }

  function acceptGhost(part = 'all') {
    const current = editorRef.current, item = current && ghostKey.getState(current.state);
    if (!item?.text) return;
    if (item.kind === 'revision') { acceptProposal(); return; }
    const accepted = part === 'word' ? item.text.match(/^\s*\S+\s*/)?.[0] || item.text : part === 'character' ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(item.text)][0].segment : item.text;
    const remainder = item.text.slice(accepted.length);
    const next = remainder ? { kind: 'completion', pos: item.pos + accepted.length, text: remainder } : null;
    let tr = closeHistory(current.state.tr).insertText(accepted, item.pos).setMeta(ghostKey, next).setMeta('assistAccept', true);
    tr.setSelection(TextSelection.create(tr.doc, item.pos + accepted.length));
    current.view.dispatch(tr); current.view.focus(); setGhost(next);
  }
  function acceptProposal() {
    const current = editorRef.current, proposal = proposalRef.current;
    if (!proposal || !current) return;
    if (JSON.stringify(current.getJSON()) !== proposal.originalDoc || projectRef.current.id !== proposal.projectId) { dismiss(); notify('The text changed. Request a fresh revision.'); return; }
    const { from, to, text } = proposal;
    proposalRef.current = null; setProposal(null);
    const preserved = revisionTransaction(current.state, from, to, text);
    if (preserved) { current.view.dispatch(preserved.setMeta(ghostKey, null).setMeta('assistAccept', true)); current.view.focus(); }
    else {
      current.view.dispatch(closeHistory(current.state.tr).setMeta(ghostKey, null));
      current.chain().focus().setTextSelection({ from, to }).insertContent(text.includes('\n') ? text.split('\n').map(p => ({ type: 'paragraph', content: p ? [{ type: 'text', text: p }] : undefined })) : { type: 'text', text, marks: current.state.doc.resolve(from).marks().map(m => m.toJSON()) }).run();
    }
    setGhost(null); rejected.current = []; notify('Revision applied. Ctrl+Z to undo.');
  }
  async function askAI(mode, customInstruction = instruction, retry = false) {
    const current = editorRef.current, settings = prefsRef.current;
    if (!settings.enabled) { setModal({ type: 'settings', tab: 'connections' }); return; }
    if (!current || requestRef.current) return;
    await dismiss(); setAiError('');
    if (current.isDestroyed || editorRef.current !== current || requestRef.current) return;
    const { from, to } = current.state.selection;
    if (['correct', 'rewrite'].includes(mode) && from === to) { notify('Select a word, sentence, or passage first.'); return; }
    const selected = current.state.doc.textBetween(from, to, '\n', '\n');
    const before = current.state.doc.textBetween(0, from, '\n', '\n');
    const after = current.state.doc.textBetween(to, current.state.doc.content.size, '\n', '\n');
    const id = uid(), originalDoc = JSON.stringify(current.getJSON()), projectId = projectRef.current.id;
    const request = { id, mode, before, after: mode === 'continue' ? '' : after, selection: selected, instruction: customInstruction, words: Number(settings.predictionWords), contextWords: settings.contextWords, language: projectRef.current.language || settings.language, nativeLanguage: settings.nativeLanguage || '', references: (projectRef.current.references || []).filter(r => r.enabled !== false), style: projectRef.current.style || '', history: rejected.current, conversation: mode === 'chat' ? messages.slice(-8).map(m => ({ role: m.role, text: m.text })) : [] };
    const pending = { id, mode, from, to, originalDoc, originalNode: current.state.doc, projectId };
    if (lastRequest.current && (lastRequest.current.mode !== mode || lastRequest.current.from !== from || lastRequest.current.to !== to || lastRequest.current.selected !== selected || lastRequest.current.projectId !== projectId || lastRequest.current.chapterId !== activeId)) { rejected.current = []; request.history = []; }
    requestRef.current = pending; lastRequest.current = { mode, instruction: customInstruction, from, to, selected, projectId, chapterId: activeId }; setBusy(mode);
    if (mode === 'chat') setPanel('assist');
    else current.view.dispatch(current.state.tr.setMeta(ghostKey, { kind: 'loading', pos: mode === 'continue' ? from : to }));
    if (mode === 'chat') { if (!customInstruction.trim()) { setBusy(null); requestRef.current = null; return; } setMessages(prev => [...prev, { id, role: 'user', text: customInstruction }]); setInstruction(''); }
    try {
      const text = await api.generate(request);
      if (requestRef.current !== pending) return;
      if (mode === 'chat') setMessages(prev => [...prev, { id: uid(), role: 'assistant', text }]);
      else {
        if (current.isDestroyed || editorRef.current !== current || projectRef.current.id !== projectId) return;
        if (mode === 'continue') {
          const prefix = before && !/[\s([{\/]$/.test(before) && !/^[\s.,!?;:’”)}\]%]/.test(text) ? ' ' : '';
          const typed = appendedDuringRequest(pending, current), whole = prefix + text;
          if (typed === null || !whole.startsWith(typed)) { current.view.dispatch(current.state.tr.setMeta(ghostKey, null)); scheduleContinuous(); return; }
          const remaining = whole.slice(typed.length);
          const item = remaining ? { kind: 'completion', pos: current.state.selection.from, text: remaining } : null;
          current.view.dispatch(current.state.tr.setMeta(ghostKey, item)); setGhost(item);
        } else {
          if (JSON.stringify(current.getJSON()) !== originalDoc || current.state.selection.from !== from || current.state.selection.to !== to) return;
          if (text === selected) { current.view.dispatch(current.state.tr.setMeta(ghostKey, null)); notify('No changes suggested for this selection.'); }
          else {
            const item = { kind: 'revision', pos: to, from, to, text };
            const proposed = { text, original: selected, from, to, originalDoc, projectId, mode, changesStructure: proposalChangesStructure(current.state, from, to, text) };
            proposalRef.current = proposed; setProposal(proposed);
            current.view.dispatch(current.state.tr.setMeta(ghostKey, item)); setGhost(item);
          }
        }
      }
    } catch (error) { if (requestRef.current === pending) { setAiError(errorText(error)); notify(errorText(error)); } }
    finally { if (requestRef.current === pending) { requestRef.current = null; setBusy(null); if (!current.isDestroyed && ghostKey.getState(current.state)?.kind === 'loading') current.view.dispatch(current.state.tr.setMeta(ghostKey, null)); } }
  }
  function rejectSuggestion() {
    const item = proposalRef.current, current = editorRef.current, text = item?.text || (current && !current.isDestroyed ? ghostKey.getState(current.state)?.text : '');
    if (text) rejected.current = [...rejected.current, text].slice(-5);
    dismiss();
    if (item && editorRef.current && JSON.stringify(editorRef.current.getJSON()) === item.originalDoc) editorRef.current.chain().focus().setTextSelection({ from: item.from, to: item.to }).run();
  }
  function retryAI() {
    const last = lastRequest.current;
    rejectSuggestion(); if (last) setTimeout(() => askAI(last.mode, last.instruction, true), 0);
  }
  function scheduleContinuous() {
    clearTimeout(continuousTimer.current);
    if (prefsRef.current.enabled && prefsRef.current.continuous) continuousTimer.current = setTimeout(() => {
      if (editorRef.current?.isFocused && editorRef.current.state.selection.empty && !requestRef.current) actionRef.current.askAI('continue');
    }, 1200);
  }
  const actionRef = useRef();
  actionRef.current = { askAI, acceptGhost, dismiss, rejectSuggestion, saveNamed, saveLocal, command: handleCommand, updatePrefs };
  const onEditorAction = useCallback(action => {
    if (action === 'toolbar-refresh') { refreshToolbar(x => x + 1); return; }
    if (action === 'accept') actionRef.current.acceptGhost();
    if (action === 'accept-word') actionRef.current.acceptGhost('word');
    if (action === 'accept-character') actionRef.current.acceptGhost('character');
    if (action === 'dismiss') actionRef.current.rejectSuggestion();
    if (['continue', 'rewrite', 'correct'].includes(action)) actionRef.current.askAI(action);
  }, []);
  function onContentChanged(content, current, transaction) {
    setProposal(null); setGhost(ghostKey.getState(current.state)?.text ? ghostKey.getState(current.state) : null);
    if (requestRef.current && requestRef.current.mode !== 'chat' && appendedDuringRequest(requestRef.current, current) === null) dismiss();
    setProject(previous => ({ ...previous, updatedAt: new Date().toISOString(), chapters: previous.chapters.map(c => c.id === activeId ? { ...c, content } : c) }));
    if (!transaction.getMeta('assistAccept')) scheduleContinuous();
  }
  function onEditorSelection(nextSelection) {
    setSelection(nextSelection);
    const current = editorRef.current;
    const item = current && !current.isDestroyed ? ghostKey.getState(current.state) : null;
    setGhost(item?.text ? item : null);
    if (!item && !requestRef.current) setProposal(null);
    if (requestRef.current && requestRef.current.mode !== 'chat' && appendedDuringRequest(requestRef.current, current) === null) dismiss();
  }
  function handleCommand(command) {
    if (command.startsWith('reference-warning:')) { notify(command.slice(18)); return; }
    if (command.startsWith('settings-')) { setModal({ type: 'settings', tab: command.slice(9) }); return; }
    const current = editorRef.current;
    const actions = {
      new: () => setModal({ type: 'new' }), open: () => openDocument(), save: () => saveNamed(), 'save-copy': () => saveNamed(true), export: () => setModal({ type: 'export' }),
      recent: async () => { setRecents(await api.getRecents()); setModal({ type: 'recent' }); }, reveal: () => api.reveal(),
      undo: () => current?.chain().focus().undo().run(), redo: () => current?.chain().focus().redo().run(), 'select-all': () => current?.chain().focus().selectAll().run(),
      find: () => setSearchOpen(true), replace: () => setSearchOpen(true), focus: () => setFocus(value => !value), 'toggle-outline': () => { setFocus(false); setLeftOpen(value => !value); },
      'toggle-assistant': () => { setFocus(false); setPanel(value => value === 'assist' ? null : 'assist'); }, 'page-view': () => setPageView(value => !value), history: () => setPanel('history'), snapshot: () => createSnapshot(),
      complete: () => askAI(current?.state.selection.empty ? 'continue' : 'rewrite'), correct: () => askAI('correct'), rewrite: () => askAI('rewrite'), accept: () => acceptGhost(), dismiss: () => rejectSuggestion(),
      'toggle-ai': () => { dismiss(); updatePrefs({ enabled: !prefsRef.current.enabled }); }, 'toggle-continuous': () => updatePrefs({ continuous: !prefsRef.current.continuous })
    };
    actions[command]?.();
  }
  useEffect(() => {
    const onKey = event => {
      if (event.defaultPrevented || document.querySelector('[role="dialog"]')) return;
      const pressed = shortcutFromEvent(event), keys = { ...DEFAULT_HOTKEYS, ...prefsRef.current.hotkeys };
      if (!pressed) return;
      if (pressed === keys.toggleAI) { event.preventDefault(); actionRef.current.command('toggle-ai'); }
      if (pressed === keys.toggleContinuous) { event.preventDefault(); actionRef.current.command('toggle-continuous'); }
    };
    document.addEventListener('keydown', onKey);
    const stop = api?.onCommand(async command => {
      if (command === 'close-request') { clearTimeout(autosaveTimer.current); actionRef.current.dismiss(); await pendingSave.current; api.finishClose(projectRef.current); }
      else actionRef.current.command(command);
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
  if (!project) return <div className="boot-screen"><Feather size={38} /><h1>Opening WRAITER…</h1>{toast && <p>{toast}</p>}</div>;
  const totalWords = projectWords(project), chapterWords = wordCount(nodeText(chapter.content));
  const selectedWords = editor && !editor.isDestroyed ? wordCount(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, ' ')) : 0;
  const matches = searchOpen ? findMatches().length : 0;
  const activeReferences = (project.references || []).filter(r => r.enabled !== false);
  const editorCommand = command => { if (editor) command(editor.chain().focus()).run(); };
  const docStyle = project.documentStyle || { fontFamily: 'Cambria', fontSize: 12, lineHeight: 1.5 };
  const titleStyle = editor?.isActive('heading', { level: 1 }) ? 'heading1' : editor?.isActive('heading', { level: 2 }) ? 'heading2' : editor?.isActive('heading', { level: 3 }) ? 'heading3' : 'paragraph';

  return <div className={`app ${focus ? 'focus-mode' : ''}`} style={{ '--writing-font': docStyle.fontFamily, '--writing-size': `${docStyle.fontSize}pt`, '--writing-leading': docStyle.lineHeight, '--writing-measure': `${prefs.measure}px`, '--document-zoom': (prefs.zoom || 100) / 100 }}>
    <div className="workspace">
      {!focus && leftOpen && <aside className="sidebar">
        <div className="project-switcher"><div className="project-avatar"><BookOpen size={21} /></div><div className="project-switcher-text"><small>YOUR MANUSCRIPT</small><button className="project-title-button" onClick={() => setModal({ type: 'rename' })}>{project.title}<PenLine size={12} /></button></div></div>
        <button className="sidebar-search" onClick={() => setSearchOpen(x => !x)}><Search size={15} />Find in chapter<kbd>{formatShortcut(prefs.hotkeys?.find)}</kbd></button>
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
        <div className="session-progress"><span>Session: {sessionWords.toLocaleString()} / {Number(prefs.goal).toLocaleString()} words</span><div className="progress-track"><div style={{ width: Math.min(100, sessionWords / Math.max(1, prefs.goal) * 100) + '%' }} /></div></div>
      </aside>}
      <main className="main-panel">
        <div className="document-topbar"><div className="document-location"><IconButton icon={leftOpen && !focus ? PanelLeftClose : PanelLeftOpen} title="Toggle manuscript sidebar" onClick={() => { setFocus(false); setLeftOpen(!leftOpen); }} /><button className="document-name" onClick={() => setModal({ type: 'rename' })}>{project.title}</button><ChevronRight size={13} /><span>{chapter.title}</span></div><div className="document-actions"><button className={'save-indicator ' + (saveState === 'error' ? 'error' : '')} title={saveError || path || 'Saved in recovery. Use File → Save to choose a file.'} onClick={() => saveNamed()}>{saveState === 'saving' || saveState === 'pending' ? <LoaderCircle size={13} className="spin" /> : saveState === 'error' ? <Info size={13} /> : <Check size={13} />}<span>{saveState === 'error' ? 'Save needs attention' : saveState === 'saved' ? path ? 'Saved' : 'Autosaved' : 'Saving'}</span></button><IconButton icon={Focus} title="Focus view" active={focus} onClick={() => setFocus(!focus)} /><IconButton icon={PanelRightOpen} title="Toggle writing assistant" active={panel === 'assist'} onClick={() => setPanel(panel === 'assist' ? null : 'assist')} /></div></div>
        {!focus && <div className="writer-toolbar formatbar" role="toolbar" aria-label="Text formatting">
          <div className="native-toolbar-group"><IconButton icon={FilePlus2} title="New manuscript" onClick={() => setModal({ type: 'new' })} /><IconButton icon={FolderOpen} title="Open manuscript" onClick={() => openDocument()} /><IconButton icon={Save} title="Save manuscript" onClick={() => saveNamed()} /><IconButton icon={Undo2} title="Undo (Ctrl Z)" disabled={!editor?.can().undo()} onClick={() => editorCommand(c => c.undo())} /><IconButton icon={Redo2} title="Redo (Ctrl Shift Z)" disabled={!editor?.can().redo()} onClick={() => editorCommand(c => c.redo())} /></div>
          <div className="native-toolbar-group"><select className="paragraph-style-select" aria-label="Paragraph style" value={titleStyle} onChange={e => editorCommand(c => e.target.value === 'paragraph' ? c.setParagraph() : c.setHeading({ level: Number(e.target.value.at(-1)) }))}><option value="paragraph">Normal</option><option value="heading1">Heading 1</option><option value="heading2">Heading 2</option><option value="heading3">Heading 3</option></select><select className="font-family-select" aria-label="Font family" value={editor?.getAttributes('textStyle').fontFamily || docStyle.fontFamily} onChange={e => editorCommand(c => c.setFontFamily(e.target.value))}>{[...new Set([docStyle.fontFamily, editor?.getAttributes('textStyle').fontFamily, ...fonts].filter(Boolean))].map(font => <option key={font}>{font}</option>)}</select><FontSizeInput value={parseFloat(editor?.getAttributes('textStyle').fontSize || docStyle.fontSize)} onApply={size => editorCommand(c => c.setFontSize(size + 'pt'))} /></div>
          <div className="native-toolbar-group"><IconButton icon={Bold} title="Bold (Ctrl B)" active={editor?.isActive('bold')} onClick={() => editorCommand(c => c.toggleBold())} /><IconButton icon={Italic} title="Italic (Ctrl I)" active={editor?.isActive('italic')} onClick={() => editorCommand(c => c.toggleItalic())} /><IconButton icon={Underline} title="Underline (Ctrl U)" active={editor?.isActive('underline')} onClick={() => editorCommand(c => c.toggleUnderline())} /><label className="font-color" title="Text colour"><Type size={17} /><input type="color" aria-label="Text colour" value={editor?.getAttributes('textStyle').color || '#222222'} onChange={e => editorCommand(c => c.setColor(e.target.value))} /></label><IconButton icon={Highlighter} title="Highlight" active={editor?.isActive('highlight')} onClick={() => editorCommand(c => c.toggleHighlight({ color: '#fff29b' }))} /></div>
          <div className="native-toolbar-group"><IconButton icon={AlignLeft} title="Align left" active={editor?.isActive({ textAlign: 'left' })} onClick={() => editorCommand(c => c.setTextAlign('left'))} /><IconButton icon={AlignCenter} title="Align centre" active={editor?.isActive({ textAlign: 'center' })} onClick={() => editorCommand(c => c.setTextAlign('center'))} /><IconButton icon={AlignRight} title="Align right" active={editor?.isActive({ textAlign: 'right' })} onClick={() => editorCommand(c => c.setTextAlign('right'))} /><IconButton icon={List} title="Bullet list" active={editor?.isActive('bulletList')} onClick={() => editorCommand(c => c.toggleBulletList())} /><IconButton icon={ListOrdered} title="Numbered list" active={editor?.isActive('orderedList')} onClick={() => editorCommand(c => c.toggleOrderedList())} /></div>
          <div className="native-toolbar-group"><IconButton icon={Image} title="Insert image" onClick={async () => { try { const src = await api.image(); if (src) editorCommand(c => c.setImage({ src })); } catch (e) { notify(errorText(e)); } }} /><IconButton icon={Link2} title="Insert or edit link" onClick={() => setModal({ type: 'link', value: editor?.getAttributes('link').href || '' })} /><IconButton icon={Table2} title="Table tools" onClick={() => setModal({ type: 'table' })} /><IconButton icon={SlidersHorizontal} title="Paragraph and document formatting" onClick={() => setModal({ type: 'format' })} /></div>
        </div>}
        {!focus && <div className="ai-toolbar" role="toolbar" aria-label="Writing assistance"><button className={prefs.enabled ? 'active' : ''} aria-pressed={prefs.enabled} onClick={() => handleCommand('toggle-ai')} title={formatShortcut(prefs.hotkeys?.toggleAI)}><PenLine size={14} />AI {prefs.enabled ? 'on' : 'off'}</button><button className={prefs.continuous ? 'active' : ''} aria-pressed={prefs.continuous} onClick={() => handleCommand('toggle-continuous')} title={formatShortcut(prefs.hotkeys?.toggleContinuous)}>Automatic suggestions {prefs.continuous ? 'on' : 'off'}</button><span className="toolbar-divider" /><button disabled={!!busy} onClick={() => handleCommand('complete')}>Suggest <kbd>{formatShortcut(prefs.hotkeys?.complete ?? 'Tab')}</kbd></button><button disabled={!!busy || !selectedWords} onClick={() => askAI('correct')}><CheckCheck size={14} />Correct</button><button disabled={!!busy || !selectedWords} onClick={() => askAI('rewrite')}>Rephrase / translate</button><div className="toolbar-spacer" /><button onClick={() => setModal({ type: 'settings', tab: 'connections' })}><Settings2 size={14} />AI settings</button></div>}
        {searchOpen && <div className="search-bar"><Search size={15} /><input autoFocus aria-label="Find text" placeholder="Find in this chapter" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') nextMatch(); }} /><span>{matches} matches</span><IconButton icon={ArrowDown} title="Next match" onClick={nextMatch} /><input aria-label="Replacement text" placeholder="Replace with" value={replacement} onChange={e => setReplacement(e.target.value)} /><button onClick={() => replaceMatches(false)}>Replace</button><button onClick={() => replaceMatches(true)}>All</button><IconButton icon={X} title="Close search" onClick={() => { setSearchOpen(false); setQuery(''); }} /></div>}
        {saveError && <div className="inline-warning"><Info size={16} /><span>{saveError}</span><button onClick={() => saveNamed(true)}>Save a copy</button></div>}
        <div className={`writing-scroll ${pageView ? 'page-view' : ''}`}>
          <article className="writing-sheet">
            <div className="chapter-kicker"><span>CHAPTER {String(project.chapters.findIndex(c => c.id === chapter.id) + 1).padStart(2, '0')}</span><span className="kicker-line" /><select aria-label="Chapter status" value={chapter.status || 'Draft'} onChange={e => editChapter(chapter.id, { status: e.target.value })}><option>Draft</option><option>Notes</option><option>Revising</option><option>Final</option></select></div>
            <div className="chapter-title-row"><input className="chapter-title" aria-label="Chapter title" value={chapter.title} onChange={e => editChapter(chapter.id, { title: e.target.value })} /><div className="chapter-tools"><IconButton icon={ArrowUp} title="Move chapter earlier" disabled={project.chapters[0].id === chapter.id} onClick={() => reorderChapter(chapter.id, -1)} /><IconButton icon={ArrowDown} title="Move chapter later" disabled={project.chapters.at(-1).id === chapter.id} onClick={() => reorderChapter(chapter.id, 1)} /><IconButton icon={Trash2} title="Delete chapter" disabled={project.chapters.length === 1} onClick={() => setModal({ type: 'delete-chapter' })} /></div></div>
            <div className="chapter-meta">{chapterWords.toLocaleString()} words<span>·</span>{Math.max(1, Math.ceil(chapterWords / 220))} min read</div>
            <ManuscriptEditor key={`${project.id}:${chapter.id}:${epoch}`} chapter={chapter} prefs={{ ...prefs, language: documentLanguage }} onReady={setEditor} onChange={onContentChanged} onSelection={onEditorSelection} onAction={onEditorAction} />
            {ghost && <div className="ghost-controls"><span>{ghost.kind === 'revision' ? 'Selected text · proposed replacement' : 'Suggested continuation'}</span><button onClick={() => acceptGhost()}><kbd>{formatShortcut(prefs.hotkeys?.accept ?? 'Tab')}</kbd> Accept</button><button onClick={retryAI}><RotateCcw size={13} />Another</button><button onClick={rejectSuggestion}><kbd>{formatShortcut(prefs.hotkeys?.dismiss ?? 'Escape')}</kbd> Dismiss</button></div>}
            {busy && busy !== 'chat' && <div className="generation-inline" role="status">Generating suggestion…<button onClick={dismiss}>Cancel</button></div>}
          </article>
        </div>
        <div className="writer-status writing-status"><div><span>{selectedWords ? selectedWords + ' selected' : chapterWords.toLocaleString() + ' words'}</span><span className="status-dot">·</span><span>{totalWords.toLocaleString()} in document</span></div><div><select className="language-select" aria-label="Content language" value={documentLanguage} onChange={e => updateProject({ language: e.target.value })}>{[...new Map([...LANGUAGES, [documentLanguage, languageName(documentLanguage)]]).entries()].map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select><button onClick={() => setPageView(!pageView)}>{pageView ? 'Page view' : 'Continuous view'}</button><select aria-label="Document zoom" value={prefs.zoom || 100} onChange={e => updatePrefs({ zoom: Number(e.target.value) })}>{[50, 75, 90, 100, 110, 125, 150, 175, 200].map(zoom => <option key={zoom} value={zoom}>{zoom}%</option>)}</select></div></div>
      </main>
      {!focus && panel && <aside className="inspector">
        <div className="inspector-heading"><div className="inspector-title">{panel === 'assist' ? <Sparkles size={17} /> : panel === 'references' ? <BookMarked size={17} /> : panel === 'notes' ? <PenLine size={17} /> : <History size={17} />}<span>{({ assist: 'Writing assistant', references: 'Reference library', notes: 'Notes & voice', history: 'Revision history' })[panel]}</span></div><IconButton icon={PanelRightClose} title="Close side panel" onClick={() => setPanel(null)} /></div>
        {panel === 'assist' && <><div className="inspector-body">
          <div className="assist-actions"><button onClick={() => askAI('continue')} disabled={!!busy}><span className="assist-action-icon"><PenLine size={17} /></span><span><strong>Continue writing</strong><small>A suggestion at your cursor</small></span><kbd>Tab</kbd></button><button onClick={() => askAI('correct')} disabled={!!busy}><span className="assist-action-icon"><CheckCheck size={18} /></span><span><strong>Check this passage</strong><small>Spelling, grammar & punctuation</small></span><ChevronRight size={14} /></button><button onClick={() => askAI('rewrite')} disabled={!!busy}><span className="assist-action-icon"><WandSparkles size={17} /></span><span><strong>Find another phrasing</strong><small>A fresh take on selected text</small></span><ChevronRight size={14} /></button></div>
          <div className="context-summary"><div><BookOpen size={14} /><strong>Context for this request</strong></div><p>{selectedWords ? `${selectedWords} selected words + surrounding text` : 'Text near your cursor'}{activeReferences.length ? ` + ${activeReferences.length} reference${activeReferences.length > 1 ? 's' : ''}` : ''}</p><button onClick={() => setPanel('references')}>Manage references <ArrowUpRight size={12} /></button></div>
          {!prefs.enabled && <div className="connect-card"><span className="section-eyebrow">AI CONNECTION</span><p>Connect a local model or your preferred AI provider.</p><button className="primary-button" onClick={() => setModal({ type: 'settings', tab: 'connections' })}>AI connections <ArrowUpRight size={14} /></button><small>Writing and saving always work offline.</small></div>}
          {prefs.enabled && <div className="provider-badge"><span className="tiny-dot" /><span>{providerNames[prefs.provider]}<small>{prefs.model || 'Default model'}</small></span><IconButton icon={Settings2} title="Connection settings" onClick={() => setModal({ type: 'settings', tab: 'connections' })} /></div>}
          {aiError && <div className="ai-error" role="alert"><Info size={16} /><p>{aiError}</p><button onClick={() => setAiError('')}>Dismiss</button></div>}
          {proposal && <div className="revision-card"><div className="revision-heading"><Sparkles size={14} /><strong>Suggested revision</strong></div><small>ORIGINAL</small><p className="original-text">{proposal.original}</p><small>PROPOSED</small><p className="proposed-text">{proposal.text}</p>{proposal.changesStructure && <p className="small-muted">This changes paragraph structure or embedded content. Formatting inside the selection may be simplified; surrounding text stays intact.</p>}<div className="revision-actions"><button className="primary-button" onClick={acceptProposal}><Check size={14} />Accept</button><IconButton icon={RotateCcw} title="Another phrasing" onClick={retryAI} /><IconButton icon={X} title="Reject revision" onClick={rejectSuggestion} /></div></div>}
          {messages.map(message => <div className={`chat-message ${message.role}`} key={message.id}><span>{message.role === 'user' ? 'YOU' : 'ASSISTANT'}</span><p>{message.text}</p></div>)}
          {busy && busy !== 'continue' && <div className="thinking"><LoaderCircle size={15} className="spin" />{busy === 'chat' ? 'Thinking it through…' : 'Reading your selection…'}<button onClick={dismiss}>Cancel</button></div>}
        </div><div className="chat-composer"><textarea aria-label="Ask the writing assistant" placeholder="Ask about your writing, or add a rephrasing instruction…" value={instruction} onChange={e => setInstruction(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) askAI('chat'); }} /><div><span>{prefs.enabled ? providerNames[prefs.provider] : 'Choose a connection'}</span><button aria-label="Send writing question" disabled={!!busy || !instruction.trim()} onClick={() => askAI('chat')}><ArrowUp size={16} /></button></div><small>Answers use the current passage and enabled references.</small></div></>}
        {panel === 'references' && <div className="inspector-body reference-panel"><div className="panel-description"><h3>Reference files</h3><p>Add character sheets, research, or canon. Enabled references accompany AI requests; originals stay separate.</p></div><button className="primary-button full" onClick={async () => { try { const items = await api.reference(); if (!items.length) return; const next = [...(project.references || []), ...items.map(r => ({ ...r, id: uid(), enabled: true }))]; if (next.length > 20) { notify('Keep up to 20 references per manuscript.'); return; } updateProject({ references: next }); } catch (e) { notify(errorText(e)); } }}><Plus size={15} />Add reference files</button><p className="small-muted">Markdown and text files · refreshes saved edits<br />Up to 48,000 characters are sent per request.</p>{!(project.references || []).length && <div className="empty-state"><BookMarked size={32} /><p>No reference files attached.</p><small>Attach Markdown or text files to include them in AI context.</small></div>}{(project.references || []).map(reference => <div className="reference-card" key={reference.id}><div><BookMarked size={16} /><strong>{reference.name}</strong><IconButton icon={Trash2} title={`Remove ${reference.name}`} onClick={() => updateProject({ references: project.references.filter(r => r.id !== reference.id) })} /></div><p>{reference.text.slice(0, 130)}{reference.text.length > 130 ? '…' : ''}</p><label className="check-label"><input type="checkbox" checked={reference.enabled !== false} onChange={e => updateProject({ references: project.references.map(r => r.id === reference.id ? { ...r, enabled: e.target.checked } : r) })} />Include in AI context</label><button className="text-button" onClick={() => setModal({ type: 'reference', reference })}>Read reference <ArrowUpRight size={12} /></button></div>)}</div>}
        {panel === 'notes' && <div className="inspector-body notes-panel"><div className="panel-description"><h3>Notes</h3><p>Private notes and instructions for this manuscript.</p></div><label className="field-label">PRIVATE NOTES <small>Not sent to AI</small></label><textarea className="notes-textarea" aria-label="Private manuscript notes" placeholder="A scene to come back to. A question to leave open…" value={project.notes || ''} onChange={e => updateProject({ notes: e.target.value })} /><label className="field-label">YOUR WRITING VOICE <small>Included in AI context</small></label><textarea className="notes-textarea voice" aria-label="Writing voice instructions" placeholder="For example: British spelling. Keep dialogue informal. Preserve deliberate fragments. Never rename characters." value={project.style || ''} onChange={e => updateProject({ style: e.target.value })} /><p className="small-muted">These are your instructions. AI suggestions never update them automatically.</p></div>}
        {panel === 'history' && <div className="inspector-body"><p className="small-muted">Git records document text, formatting, chapters, notes and references. Versions are stored locally for this manuscript.</p><button className="primary-button full" onClick={() => createSnapshot()}><Plus size={15} />Save version</button>{gitHistory.error && <p className="ai-error">{gitHistory.error}</p>}{gitHistory.entries.map(item => <div className="snapshot-card" key={item.revision}><div><Clock3 size={14} /><small>{new Date(item.date).toLocaleString()}</small></div><strong>{item.message}</strong><code>{item.revision.slice(0, 8)}</code><button className="secondary-button" onClick={() => setModal({ type: 'git-restore', item })}>Restore this version</button></div>)}{Boolean(project.snapshots?.length) && <h3>Earlier embedded snapshots</h3>}{(project.snapshots || []).map(item => <div className="snapshot-card" key={item.id}><strong>{item.name}</strong><small>{new Date(item.createdAt).toLocaleString()}</small><button className="secondary-button" onClick={() => setModal({ type: 'restore', item })}>Restore snapshot</button></div>)}</div>}
      </aside>}
    </div>
    {toast && <div className="toast" role="status"><CheckCircle2 size={16} /><span>{toast}</span><IconButton icon={X} title="Dismiss notification" onClick={() => setToast('')} /></div>}
    {modal?.type === 'settings' && <Settings Modal={Modal} fonts={fonts} initialTab={modal.tab} prefs={prefs} updatePrefs={updatePrefs} onClose={() => setModal(null)} notify={notify} />}
    {modal?.type === 'rename' && <Modal title="Document title" onClose={() => setModal(null)}><form onSubmit={e => { e.preventDefault(); setModal(null); }}><label className="field-label">TITLE</label><input className="field-input" aria-label="Manuscript title" value={project.title} onChange={e => updateProject({ title: e.target.value })} /><div className="modal-footer"><button className="primary-button">Done</button></div></form></Modal>}
    {modal?.type === 'new' && <Modal title="New manuscript" subtitle="Your current manuscript will be preserved. Unnamed drafts remain available through Recent manuscripts." onClose={() => setModal(null)}><div className="modal-footer"><button className="secondary-button" onClick={async () => { await saveNamed(); }}>Save current manuscript</button><button className="primary-button" onClick={createNew}>Create manuscript</button></div></Modal>}
    {modal?.type === 'export' && <Modal title="Export document" subtitle="Export all chapters in manuscript order. Your working document stays here." onClose={() => setModal(null)} wide><div className="export-grid">{[['pdf', 'PDF document', 'A clean A4 reading copy', FileText], ['docx', 'Word document', 'Basic formatting, tables & images', FileText], ['html', 'Web document', 'Styled HTML with embedded images', Laptop], ['txt', 'Plain text', 'Your words, universally readable', Type], ['md', 'Markdown', 'Headings and lightweight formatting', PenLine], ['bbcode', 'BBCode', 'Ready for forums and story posts', MessageSquare]].map(([format, title, description, Icon]) => <button className="export-option" key={format} onClick={() => exportDocument(format)}><Icon size={23} /><strong>{title}</strong><span>{description}</span><small>.{format === 'bbcode' ? 'txt' : format}<ArrowUpRight size={14} /></small></button>)}</div><p className="small-muted">This preview exports basic manuscript structure. Advanced page layout, footnotes, comments, and tracked changes are not yet supported. Review an export before publishing.</p></Modal>}
    {modal?.type === 'link' && <Modal title="Link to something" onClose={() => setModal(null)}><form onSubmit={e => { e.preventDefault(); const href = new FormData(e.currentTarget).get('href'); if (!/^(https?:\/\/|mailto:)/i.test(href)) { notify('Use a full https://, http://, or mailto: address.'); return; } editorCommand(c => c.extendMarkRange('link').setLink({ href })); setModal(null); }}><input className="field-input" name="href" aria-label="Link address" placeholder="https://" defaultValue={modal.value} /><div className="modal-footer"><button type="button" className="secondary-button" onClick={() => { editorCommand(c => c.unsetLink()); setModal(null); }}>Remove link</button><button className="primary-button">Apply link</button></div></form></Modal>}
    {modal?.type === 'table' && <Modal title="Table tools" onClose={() => setModal(null)}><div className="button-grid">{[['Insert 3 × 3 table', c => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }), false], ['Add row below', c => c.addRowAfter(), true], ['Add column', c => c.addColumnAfter(), true], ['Delete row', c => c.deleteRow(), true], ['Delete column', c => c.deleteColumn(), true], ['Remove table', c => c.deleteTable(), true]].map(([label, command, needsTable]) => <button className="secondary-button" key={label} disabled={needsTable && !editor?.isActive('table')} onClick={() => { editorCommand(command); setModal(null); }}>{label}</button>)}</div></Modal>}
    {modal?.type === 'format' && <Modal title="Paragraph and document formatting" onClose={() => setModal(null)} wide><div className="settings-section"><h3>Selected paragraphs</h3><div className="form-grid"><label>Line spacing<select className="field-input" defaultValue={editor?.getAttributes('paragraph').lineHeight || docStyle.lineHeight} onChange={e => editorCommand(c => c.setParagraphFormat({ lineHeight: Number(e.target.value) }))}>{[1, 1.15, 1.5, 2, 2.5, 3].map(n => <option key={n}>{n}</option>)}</select></label><label>Space after (pt)<input className="field-input" type="number" min="0" max="72" defaultValue={editor?.getAttributes('paragraph').spaceAfter ?? 8} onChange={e => editorCommand(c => c.setParagraphFormat({ spaceAfter: Math.max(0, Math.min(72, Number(e.target.value))) }))} /></label><label>First-line indent (pt)<input className="field-input" type="number" min="0" max="144" defaultValue={editor?.getAttributes('paragraph').firstLineIndent || 0} onChange={e => editorCommand(c => c.setParagraphFormat({ firstLineIndent: Math.max(0, Math.min(144, Number(e.target.value))) }))} /></label></div><div className="button-grid"><button className="secondary-button" onClick={() => editorCommand(c => c.setTextAlign('justify'))}>Justify</button><button className="secondary-button" onClick={() => editorCommand(c => c.toggleBlockquote())}>Block quote</button><button className="secondary-button" onClick={() => editorCommand(c => c.setHorizontalRule())}>Scene break</button><button className="secondary-button" onClick={() => editorCommand(c => c.toggleStrike())}>Strikethrough</button><button className="secondary-button" onClick={() => editorCommand(c => c.unsetAllMarks().clearNodes())}>Clear formatting</button></div></div><div className="settings-section"><h3>Document defaults</h3><p className="small-muted">Applies to text without explicit formatting and to exports.</p><div className="form-grid"><label>Default font<select className="field-input" aria-label="Default document font" value={docStyle.fontFamily} onChange={e => updateProject({ documentStyle: { ...docStyle, fontFamily: e.target.value } })}>{[...new Set([docStyle.fontFamily, ...fonts])].map(font => <option key={font}>{font}</option>)}</select></label><label>Default size (pt)<input className="field-input" type="number" min="6" max="96" aria-label="Default document size" value={docStyle.fontSize} onChange={e => { const size = Number(e.target.value); if (size >= 6 && size <= 96) updateProject({ documentStyle: { ...docStyle, fontSize: size } }); }} /></label><label>Default line spacing<select className="field-input" value={docStyle.lineHeight} onChange={e => updateProject({ documentStyle: { ...docStyle, lineHeight: Number(e.target.value) } })}>{[1, 1.15, 1.5, 2, 2.5, 3].map(n => <option key={n}>{n}</option>)}</select></label></div></div><div className="modal-footer"><button className="primary-button" onClick={() => setModal(null)}>Done</button></div></Modal>}
    {modal?.type === 'snapshot' && <Modal title="Save version" onClose={() => setModal(null)}><form onSubmit={e => { e.preventDefault(); createSnapshot(new FormData(e.currentTarget).get('label')); }}><label className="field-label">Version description</label><input className="field-input" name="label" aria-label="Version description" placeholder="e.g. Before revising the opening" maxLength="200" /><div className="modal-footer"><button className="primary-button">Save version</button></div></form></Modal>}
    {modal?.type === 'git-restore' && <Modal title="Restore this version?" subtitle={modal.item.message + ' · ' + new Date(modal.item.date).toLocaleString()} onClose={() => setModal(null)}><p className="notice-copy">Your current document will be saved as a new Git checkpoint before restoring this version.</p><div className="modal-footer"><button className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button className="primary-button" onClick={() => restoreGitVersion(modal.item.revision)}>Restore version</button></div></Modal>}
    {modal?.type === 'recent' && <Modal title="Recent manuscripts" onClose={() => setModal(null)}><div className="recent-list">{recents.length ? recents.map(target => <button className="secondary-button" key={target} title={target} onClick={() => { setModal(null); openDocument(target); }}>{target.split(/[\\/]/).pop()}</button>) : <p>No saved manuscripts yet.</p>}</div></Modal>}
    {modal?.type === 'delete-chapter' && <Modal title={`Delete “${chapter.title}”?`} subtitle="A snapshot of your manuscript will be kept before the chapter is removed." onClose={() => setModal(null)}><div className="modal-footer"><button className="secondary-button" onClick={() => setModal(null)}>Keep chapter</button><button className="danger-button" onClick={() => { const current = projectRef.current; const chapters = current.chapters.filter(c => c.id !== chapter.id); dismiss(); updateProject({ chapters, snapshots: [snapshot(current, 'Before deleting a chapter'), ...(current.snapshots || [])].slice(0, 20) }); setActiveId(chapters[0].id); setModal(null); }}>Delete chapter</button></div></Modal>}
    {modal?.type === 'restore' && <Modal title="Return to this revision?" subtitle="We’ll capture your current version first, so you can return to it later." onClose={() => setModal(null)}><div className="modal-footer"><button className="secondary-button" onClick={() => setModal(null)}>Keep writing</button><button className="primary-button" onClick={() => { const item = modal.item; dismiss(); updateProject({ title: item.title, chapters: structuredClone(item.chapters), notes: item.notes || '', style: item.style || '', language: item.language || project.language, documentStyle: item.documentStyle || project.documentStyle, references: structuredClone(item.references || []), snapshots: [snapshot(project, 'Before restoring a revision'), ...project.snapshots].slice(0, 20) }); setActiveId(item.chapters[0].id); setEpoch(x => x + 1); setModal(null); notify('Revision restored.'); }}>Restore revision</button></div></Modal>}
    {modal?.type === 'reference' && <Modal title={modal.reference.name} subtitle="Attached copy. Linked files refresh separately before each AI request." onClose={() => setModal(null)} wide><pre className="reference-reader">{modal.reference.text}</pre></Modal>}
    {modal?.type === 'notice' && <Modal title={modal.title} onClose={() => setModal(null)}><p className="notice-copy">{modal.text}</p><div className="modal-footer"><button className="primary-button" onClick={() => setModal(null)}>Continue writing</button></div></Modal>}
    {modal?.type === 'about' && <Modal title="WRAITER · 0.2.0" subtitle="Desktop writing with integrated AI assistance." onClose={() => setModal(null)}><p className="notice-copy">This is the first Windows preview. It includes rich-text writing, chapters, local recovery, revision snapshots, basic imports and exports, and provider connections.</p><p className="notice-copy">Live pagination, comments, tracked changes, footnotes, EPUB, full office-format compatibility, and Claude Code / Grok Build agent connections are future work. The page-width view is a reading surface; PDF export performs pagination.</p><p className="small-muted">The opening sample is fictional demonstration text. Your existing manuscripts are never opened or changed automatically.</p></Modal>}
  </div>;
}
