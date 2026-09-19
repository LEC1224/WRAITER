import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, CheckCheck, CircleStop, LoaderCircle, RefreshCw, Settings2, Sparkles } from 'lucide-react';
import { attachProofreadingFindings, chunkProofreadingPassages, collectProofreadingPassages, PROOFREAD_CATEGORIES, PROOFREAD_SEVERITIES } from './proofreading.js';

const api = window.wraiter;
const providerNames = { local: 'Local models', ollama: 'Ollama', openai: 'OpenAI', compatible: 'Compatible API / xAI', anthropic: 'Claude API', codex: 'Codex', claude: 'Claude Code' };
const errorText = error => String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const profileFor = prefs => ({ provider: prefs.provider || 'codex', baseUrl: prefs.baseUrl || '', model: prefs.model || '', codexPath: prefs.codexPath || '', claudePath: prefs.claudePath || '', ...(prefs.taskProfiles?.proofread || {}) });
const inlineText = value => String(value || '').replace(/\s*[\r\n]+\s*/g, ' ↵ ').replace(/[\t ]+/g, ' ');
const shortSeverity = { definite: 'definite', likely: 'likely', optional: 'editorial' };

export default function ProofreadingDialog({ Modal, project, activeChapterId, editor, schema, prefs, updatePrefs, onApply, onClose, onConnectionSettings }) {
  const hasSelection = Boolean(editor && !editor.isDestroyed && !editor.state.selection.empty);
  const [scope, setScope] = useState(hasSelection ? 'selection' : 'chapter');
  const [findings, setFindings] = useState([]), [running, setRunning] = useState(false), [progress, setProgress] = useState(null), [error, setError] = useState('');
  const [severityFilter, setSeverityFilter] = useState('all'), [categoryFilter, setCategoryFilter] = useState('all');
  const [models, setModels] = useState([]), [modelsError, setModelsError] = useState(''), [modelDraft, setModelDraft] = useState(profileFor(prefs).model || '');
  const cancelled = useRef(false), runNumber = useRef(0);
  const profile = profileFor(prefs);

  useEffect(() => { setModelDraft(profile.model || ''); }, [profile.provider, profile.model]);
  useEffect(() => {
    let alive = true; setModelsError('');
    api.listModels({ task: 'proofread' }).then(result => { if (alive) setModels(result.models || []); }).catch(reason => { if (alive) setModelsError(errorText(reason)); });
    return () => { alive = false; };
  }, [profile.provider, profile.baseUrl, profile.codexPath, profile.claudePath]);
  useEffect(() => {
    if (!findings.some(item => item.status === 'applied')) return;
    setTimeout(() => document.querySelector('.proofreading-modal .proofread-footer button:not(:disabled)')?.focus(), 0);
  }, [editor]);

  const visible = useMemo(() => findings.filter(item => (severityFilter === 'all' || item.severity === severityFilter) && (categoryFilter === 'all' || item.category === categoryFilter)), [findings, severityFilter, categoryFilter]);
  const grouped = useMemo(() => Object.entries(PROOFREAD_CATEGORIES).map(([id, label]) => [id, label, visible.filter(item => item.category === id)]).filter(([, , items]) => items.length), [visible]);
  const pending = findings.filter(item => item.status === 'pending'), selected = pending.filter(item => item.selected);
  const counts = Object.fromEntries(Object.keys(PROOFREAD_SEVERITIES).map(severity => [severity, findings.filter(item => item.severity === severity).length]));

  async function chooseModel(value) {
    setModelDraft(value); setError('');
    try { await updatePrefs({ taskProfiles: { proofread: { model: value } } }); }
    catch (reason) { setError(errorText(reason)); }
  }

  async function analyze() {
    if (!prefs.enabled) { setError('Enable an AI connection before proofreading.'); return; }
    const selection = hasSelection ? { from: editor.state.selection.from, to: editor.state.selection.to } : null;
    if (scope === 'selection' && !selection) { setError('Select text in the current chapter first.'); return; }
    let passages;
    try { passages = collectProofreadingPassages(project, schema, { scope, activeChapterId, selection }); }
    catch (reason) { setError(errorText(reason)); return; }
    if (!passages.length) { setError('This scope contains no plain text to proofread.'); return; }
    const chunks = chunkProofreadingPassages(passages), currentRun = ++runNumber.current;
    cancelled.current = false; setRunning(true); setFindings([]); setError(''); setProgress({ current: 0, total: chunks.length, passages: passages.length });
    const collected = [];
    try {
      for (let index = 0; index < chunks.length; index++) {
        if (cancelled.current || currentRun !== runNumber.current) break;
        const chunk = chunks[index];
        setProgress({ current: index, total: chunks.length, passages: passages.length });
        const result = await api.proofread({
          id: crypto.randomUUID(), projectId: project.id, scope, language: project.language || prefs.language, style: project.style || '',
          passages: chunk.map(({ id, chapterTitle, paragraph, text }) => ({ id, chapterTitle, paragraph, text }))
        });
        if (cancelled.current || currentRun !== runNumber.current) break;
        collected.push(...attachProofreadingFindings(result, chunk));
        setFindings([...collected]); setProgress({ current: index + 1, total: chunks.length, passages: passages.length });
      }
      if (!cancelled.current && currentRun === runNumber.current && !collected.length) setFindings([]);
    } catch (reason) {
      if (!cancelled.current && currentRun === runNumber.current) setError(collected.length ? `Analysis stopped after ${collected.length} finding${collected.length === 1 ? '' : 's'}: ${errorText(reason)}` : errorText(reason));
    } finally { if (currentRun === runNumber.current) setRunning(false); }
  }

  function stop() { cancelled.current = true; runNumber.current++; setRunning(false); api.cancel().catch(() => {}); }
  function close() { if (running) stop(); onClose(); }
  function edit(id, patch) { setFindings(items => items.map(item => item.id === id ? { ...item, ...patch } : item)); }
  function setSelectionFor(predicate, value) { setFindings(items => items.map(item => item.status === 'pending' && predicate(item) ? { ...item, selected: value } : item)); }
  function toggleGroup(category, severity) {
    const targets = findings.filter(item => item.status === 'pending' && item.category === category && (!severity || item.severity === severity));
    const choose = targets.some(item => !item.selected);
    setSelectionFor(item => item.category === category && (!severity || item.severity === severity), choose);
  }
  function apply(ids) {
    try {
      setFindings(onApply(ids, findings)); setError('');
      setTimeout(() => document.querySelector('.proofreading-modal .proofread-footer button:not(:disabled)')?.focus(), 0);
    }
    catch (reason) { setError(errorText(reason)); }
  }

  const subtitle = findings.length
    ? `${findings.length} finding${findings.length === 1 ? '' : 's'} · ${pending.length} remaining`
    : 'A review pass that leaves every change under your control.';
  return <Modal title="Proofread manuscript" subtitle={subtitle} onClose={close} wide className="proofreading-modal">
    <div className="proofread-setup">
      <fieldset disabled={running}><legend>Analyse</legend><label><input type="radio" name="proofread-scope" checked={scope === 'selection'} disabled={!hasSelection} onChange={() => setScope('selection')} />Selected text</label><label><input type="radio" name="proofread-scope" checked={scope === 'chapter'} onChange={() => setScope('chapter')} />Current chapter</label><label><input type="radio" name="proofread-scope" checked={scope === 'manuscript'} onChange={() => setScope('manuscript')} />Whole manuscript</label></fieldset>
      <label className="proofread-model">Model<span><select className="field-input" aria-label="Proofreading model" value={modelDraft} disabled={running} onChange={event => chooseModel(event.target.value)}><option value="">Provider default</option>{modelDraft && !models.includes(modelDraft) && <option value={modelDraft}>{modelDraft}</option>}{models.map(model => { const value = typeof model === 'string' ? model : model.id || model.model; return <option value={value} key={value}>{value}</option>; })}</select><button className="icon-button" aria-label="Proofreading connection settings" title="Connection settings" disabled={running} onClick={onConnectionSettings}><Settings2 size={16} /></button></span><small>{providerNames[profile.provider] || profile.provider}{modelsError ? ` · ${modelsError}` : ''}</small></label>
      {!running ? <button className="primary-button proofread-run" onClick={analyze}><Sparkles size={15} />{findings.length ? 'Analyse again' : 'Analyse'}</button> : <button className="secondary-button proofread-run" onClick={stop}><CircleStop size={15} />Stop</button>}
    </div>
    {running && <div className="proofread-progress" role="status"><LoaderCircle size={16} className="spin" /><div><strong>Reading your text…</strong><span>Batch {Math.min((progress?.current || 0) + 1, progress?.total || 1)} of {progress?.total || 1} · {progress?.passages || 0} paragraphs/passages</span><progress value={progress?.current || 0} max={progress?.total || 1} /></div></div>}
    {error && <div className="proofread-error" role="alert"><AlertTriangle size={16} /><span>{error}</span>{!prefs.enabled && <button className="text-button" onClick={onConnectionSettings}>Open connections</button>}</div>}
    {!running && !findings.length && !error && <div className="proofread-empty"><CheckCheck size={34} /><h3>Ready for a careful pass</h3><p>The model will list possible errors by confidence and type. Nothing changes until you apply a suggestion.</p></div>}
    {!running && findings.length > 0 && <>
      <div className="proofread-summary" aria-label="Proofreading summary">{Object.entries(PROOFREAD_SEVERITIES).map(([id, meta]) => <button key={id} className={`severity-summary ${id} ${severityFilter === id ? 'active' : ''}`} onClick={() => setSeverityFilter(severityFilter === id ? 'all' : id)}><strong>{counts[id] || 0}</strong><span>{meta.label}</span></button>)}</div>
      <div className="proofread-controls"><label>Show<select className="field-input" aria-label="Finding severity filter" value={severityFilter} onChange={event => setSeverityFilter(event.target.value)}><option value="all">All severities</option>{Object.entries(PROOFREAD_SEVERITIES).map(([id, meta]) => <option key={id} value={id}>{meta.label}</option>)}</select></label><label>Category<select className="field-input" aria-label="Finding category filter" value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)}><option value="all">All categories</option>{Object.entries(PROOFREAD_CATEGORIES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><button className="secondary-button" onClick={() => setSelectionFor(item => visible.some(visibleItem => visibleItem.id === item.id), true)}>Select shown</button><button className="text-button" onClick={() => setSelectionFor(() => true, false)}>Clear selection</button><span>{selected.length} selected</span></div>
      <div className="proofread-findings">{grouped.map(([category, label, items]) => {
        const selectable = items.filter(item => item.status === 'pending'), allSelected = selectable.length && selectable.every(item => item.selected);
        return <section className={`finding-group category-${category}`} key={category}><div className="finding-group-heading"><label><input type="checkbox" aria-label={`Select all ${label} findings`} checked={Boolean(allSelected)} disabled={!selectable.length} onChange={() => toggleGroup(category)} /><span className="category-swatch" />{label}<small>{items.length}</small></label><div>{Object.entries(PROOFREAD_SEVERITIES).map(([severity]) => {
          const severityItems = selectable.filter(item => item.severity === severity), amount = severityItems.length;
          if (!amount) return null;
          const allSeveritySelected = severityItems.every(item => item.selected), action = allSeveritySelected ? 'Deselect all' : 'Select all';
          return <button key={severity} aria-pressed={allSeveritySelected} className={`severity-pill group-severity-select ${severity} ${allSeveritySelected ? 'selected' : ''}`} title={`${action} ${shortSeverity[severity]} findings in ${label}`} onClick={() => toggleGroup(category, severity)}>{allSeveritySelected ? <Check size={11} /> : <CheckCheck size={11} />}<span>{action} {shortSeverity[severity]}</span><strong>({amount})</strong></button>;
        })}</div></div>
          {items.map(item => <article className={`proofread-finding ${item.severity} ${item.status}`} key={item.id}><div className="finding-select"><input type="checkbox" aria-label={`Select finding in ${item.chapterTitle}, paragraph ${item.paragraph}`} checked={item.selected} disabled={item.status !== 'pending'} onChange={event => edit(item.id, { selected: event.target.checked })} /></div><div className="finding-content"><div className="finding-meta"><span className={`severity-pill ${item.severity}`}>{PROOFREAD_SEVERITIES[item.severity].label}</span><span>{item.chapterTitle} · ¶{item.paragraph}</span>{item.reason && <span className="finding-reason" title={item.reason}>{item.reason}</span>}{item.status === 'applied' && <span className="finding-state"><Check size={12} />Applied</span>}{item.status === 'stale' && <span className="finding-state warning">Text changed</span>}</div><div className="proofread-diff" aria-label={`Change ${item.original} to ${item.replacement}`}><div className="proofread-diff-line removed" aria-label="Original text with context"><span className="proofread-diff-sign" aria-hidden="true">−</span><span className="proofread-diff-context">{item.contextBefore}</span><span className="proofread-diff-change old">{item.contextOriginal || inlineText(item.original)}</span><span className="proofread-diff-context">{item.contextAfter}</span></div><div className="proofread-diff-line added" aria-label="Suggested text with context"><span className="proofread-diff-sign" aria-hidden="true">+</span><span className="proofread-diff-context">{item.contextBefore}</span><span className="proofread-diff-change new">{inlineText(item.replacement)}</span><span className="proofread-diff-context">{item.contextAfter}</span></div></div><div className="finding-actions"><label className="finding-replacement"><span>Replacement</span><textarea rows={Math.min(3, Math.max(1, String(item.replacement).split(/\r?\n/).length))} aria-label={`Replacement for ${item.original}`} value={item.replacement} disabled={item.status !== 'pending'} onChange={event => edit(item.id, { replacement: event.target.value })} /></label>{item.replacement !== item.suggestion && item.status === 'pending' && <button className="text-button" onClick={() => edit(item.id, { replacement: item.suggestion })}><RefreshCw size={12} />Reset</button>}<button className="primary-button" disabled={item.status !== 'pending'} onClick={() => apply(new Set([item.id]))}>Apply</button></div></div></article>)}
        </section>;
      })}{!visible.length && <p className="proofread-no-filter">No findings match these filters.</p>}</div>
    </>}
    <div className="modal-footer proofread-footer"><span>{findings.filter(item => item.status === 'applied').length ? `${findings.filter(item => item.status === 'applied').length} applied · one undo step per batch` : 'Model suggestions can be wrong. Review before applying.'}</span><button className="secondary-button" onClick={close}>Close</button>{findings.length > 0 && <button className="primary-button" disabled={!selected.length || running} onClick={() => apply(new Set(selected.map(item => item.id)))}><CheckCheck size={15} />Apply {selected.length || ''} selected</button>}</div>
  </Modal>;
}
