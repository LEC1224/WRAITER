import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Sun, Moon, Contrast, Keyboard, Globe2, SlidersHorizontal, Plug, Check, RotateCcw, X, LoaderCircle, CheckCircle2, Info, ExternalLink, Download, FileText, FolderOpen } from 'lucide-react';
import { useLoggedSurface, reportError } from './diagnostics.js';
import { DEFAULT_HOTKEYS, HOTKEY_LABELS, shortcutFromEvent, shortcutConflicts, formatShortcut } from './hotkeys.js';
import { LANGUAGES } from './languages.js';
import LocalModels from './LocalModels.jsx';

const api = window.wraiter;
const TASKS = [['continue', 'Autocomplete'], ['correct', 'Spell correction'], ['rewrite', 'Rephrase / translate'], ['proofread', 'Proofreading review'], ['chat', 'Project assistant'], ['checkpoint', 'Version summaries']];
const PROVIDERS = { local: 'Local models (managed)', codex: 'Codex account', claude: 'Claude Code account', ollama: 'Ollama (local)', openai: 'OpenAI API', anthropic: 'Claude API', compatible: 'Compatible API / xAI' };
const PRESETS = { claude: { baseUrl: '', model: '', claudePath: '' }, local: { baseUrl: '', model: '' }, codex: { baseUrl: '', model: '', codexPath: '' }, ollama: { baseUrl: 'http://localhost:11434', model: '' }, openai: { baseUrl: 'https://api.openai.com/v1', model: '' }, anthropic: { baseUrl: 'https://api.anthropic.com/v1', model: '' }, compatible: { baseUrl: 'https://api.x.ai/v1', model: '' } };
const errorText = error => { reportError('settings.operation', error); return String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); };
const profileFor = (settings, task) => ({ provider: settings.provider || 'codex', baseUrl: settings.baseUrl || '', model: settings.model || '', codexPath: settings.codexPath || '', claudePath: settings.claudePath || '', ...(settings.taskProfiles?.[task] || {}) });
const connectionKey = profile => [profile.provider, profile.baseUrl.trim().replace(/\/+$/, ''), profile.provider === 'codex' ? profile.codexPath || '' : '', profile.provider === 'claude' ? profile.claudePath || '' : ''].join('|');
const modelIds = models => [...new Set((models || []).map(model => typeof model === 'string' ? model : model.id || model.model).filter(Boolean))];

function NumberField({ label, value, min, max, step = 1, onChange, help, disabled = false }) {
  return <label>{label}<input className="field-input" type="number" aria-label={label} min={min} max={max} step={step} disabled={disabled} value={value ?? ''} onChange={event => onChange(event.target.value === '' ? '' : Number(event.target.value))} />{help && <small className="field-help">{help}</small>}</label>;
}

export default function Settings({ initialTab, initialTask, prefs, updatePrefs, onClose, notify, fonts = [], Modal }) {
  const [tab, setTab] = useState(['general', 'appearance', 'grammar', 'language', 'connections', 'local', 'ai', 'hotkeys', 'logging'].includes(initialTab) ? initialTab : 'appearance');
  const [draft, setDraft] = useState(() => ({ logCleanupEnabled: true, logRetentionMonths: 1, translationSuggestions: 3, correctionSuggestions: 1, rephraseSuggestions: 3, ...prefs, taskProfiles: Object.fromEntries(TASKS.map(([task]) => [task, profileFor(prefs, task)])), hotkeys: { ...DEFAULT_HOTKEYS, ...(prefs.hotkeys || {}) } }));
  const [logStatus, setLogStatus] = useState(null);
  useLoggedSurface('settings', tab);
  useEffect(() => {
    if (tab !== 'logging') return;
    let active = true;
    api?.diagnosticsStatus?.().then(value => { if (active) setLogStatus(value); }).catch(error => { if (active) setSaveError(errorText(error)); });
    return () => { active = false; };
  }, [tab, prefs.logCleanupEnabled, prefs.logRetentionMonths]);
  const [task, setTask] = useState(TASKS.some(([which]) => which === initialTask) ? initialTask : 'continue');
  const [keyEdits, setKeyEdits] = useState({});
  const [connections, setConnections] = useState({});
  const [pending, setPending] = useState('');
  const [capturing, setCapturing] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const requestNumber = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; requestNumber.current++; }; }, []);
  useEffect(() => { if (!capturing) api.setShortcutCapture?.(false).catch(() => {}); }, [capturing]);
  useEffect(() => () => { api.setShortcutCapture?.(false).catch(() => {}); }, []);

  const profile = profileFor(draft, task);
  const identity = connectionKey(profile);
  const connection = connections[identity];
  const keyEdit = keyEdits[identity] || { apiKey: '', clearKey: false };
  const conflicts = shortcutConflicts(draft.hotkeys);
  const set = (name, value) => { setSaveError(''); setDraft(previous => ({ ...previous, [name]: value })); };
  const setProfile = (which, patch) => {
    setSaveError('');
    setDraft(previous => ({ ...previous, taskProfiles: { ...previous.taskProfiles, [which]: { ...profileFor(previous, which), ...patch } } }));
  };
  const setKeyEdit = patch => setKeyEdits(previous => ({ ...previous, [identity]: { ...(previous[identity] || { apiKey: '', clearKey: false }), ...patch } }));
  const payload = () => ({ ...draft, ...profile, task, apiKey: keyEdit.apiKey, clearKey: keyEdit.clearKey });
  const hasSavedKey = TASKS.some(([which]) => prefs.taskHasKey?.[which] && connectionKey(profileFor(prefs, which)) === identity);

  async function check(action = 'models') {
    const current = ++requestNumber.current, key = identity;
    setPending(key);
    try {
      const result = await (action === 'login' ? (profile.provider === 'claude' ? api.setupClaudeLogin(payload()) : api.loginProvider(payload())) : action === 'reconnect' ? api.reconnectProvider(payload()) : action === 'connect' ? api.connectProvider(payload()) : api.listModels(payload()));
      if (!mounted.current || current !== requestNumber.current) return;
      setConnections(previous => ({ ...previous, [key]: { ...previous[key], ...result, error: false } }));
      // Some connection calls return account state only. Refresh the model list after a successful connection.
      if (action !== 'models' && action !== 'login' && !result.needsLogin && !Array.isArray(result.models)) {
        const models = await api.listModels(payload());
        if (mounted.current && current === requestNumber.current) setConnections(previous => ({ ...previous, [key]: { ...previous[key], ...models, error: false } }));
      }
    } catch (error) {
      if (mounted.current && current === requestNumber.current) setConnections(previous => ({ ...previous, [key]: { ...previous[key], error: true, message: errorText(error) } }));
    } finally {
      if (mounted.current && current === requestNumber.current) setPending('');
    }
  }
  useEffect(() => {
    if (tab === 'connections' && !connections[identity] && !pending) {
      // Read the existing account/model list; browser sign-in is always an explicit action.
      check('models');
    }
  }, [tab, task, identity, pending]);

  async function save(close) {
    if (conflicts.length) { setSaveError('Resolve the shortcut conflicts before saving.'); setTab('hotkeys'); return; }
    const ranges = { logRetentionMonths: [1, 24], zoom: [50, 200], measure: [400, 1600], goal: [0, 1000000], predictionWords: [1, 500], translationSuggestions: [1, 8], correctionSuggestions: [1, 8], rephraseSuggestions: [1, 8], contextWords: [50, 16000], tokenCap: [64, 32768], temperature: [0, 2] };
    for (const [name, [min, max]] of Object.entries(ranges)) {
      if (!Number.isFinite(draft[name]) || draft[name] < min || draft[name] > max) { setSaveError('Check the number fields. Every value must be within its displayed range.'); return; }
    }
    if (['translationSuggestions', 'correctionSuggestions', 'rephraseSuggestions'].some(name => !Number.isInteger(draft[name]))) { setSaveError('Suggestion counts must be whole numbers from 1 to 8.'); return; }
    if (!Number.isInteger(draft.logRetentionMonths)) { setSaveError('Log retention must be a whole number of months from 1 to 24.'); return; }
    setSaving(true); setSaveError('');
    try {
      const continuation = profileFor(draft, 'continue');
      // Keep the original top-level connection in sync for older display consumers.
      // Walkthrough progress may advance while Settings is open. Its saved state
      // is owned by the walkthrough, not this older settings draft.
      const { tutorialSession, tutorialComplete, setupComplete, setupMode, ...editable } = draft;
      await updatePrefs({ ...editable, ...continuation });
      for (const [signature, edit] of Object.entries(keyEdits)) {
        if (!edit.apiKey.trim() && !edit.clearKey) continue;
        const activeTask = TASKS.find(([which]) => connectionKey(profileFor(draft, which)) === signature)?.[0];
        if (activeTask) await updatePrefs({ apiKeyTask: activeTask, apiKey: edit.apiKey, clearKey: edit.clearKey });
      }
      setKeyEdits({});
      notify('Settings saved.');
      if (close) onClose();
    } catch (error) { setSaveError(errorText(error)); }
    finally { if (mounted.current) setSaving(false); }
  }

  const tabs = [['general', 'General', SlidersHorizontal], ['appearance', 'Appearance', Sun], ['grammar', 'Spelling and grammar', Check], ['language', 'Languages', Globe2], ['connections', 'Connections', Plug], ['local', 'Local models', Download], ['ai', 'Writing AI', SlidersHorizontal], ['hotkeys', 'Shortcuts', Keyboard], ['logging', 'Logging', FileText]];
  return <Modal title="Settings" onClose={saving ? () => {} : onClose} wide>
    <div className="settings-tabs" role="tablist" aria-label="Settings categories">{tabs.map(([id, label, Icon]) => <button type="button" key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'selected' : ''} onClick={() => { setCapturing(''); setTab(id); }}><Icon size={15} />{label}</button>)}</div>
    <div className="settings-content" role="tabpanel" aria-label={tabs.find(([id]) => id === tab)?.[1]}>
      {tab === 'logging' && <>
        <h3>Local activity and error logs</h3>
        <p className="notice-copy">Logs help diagnose problems and understand how WRAITER is used. They record settings changes, panels and windows opening or closing, document operations, and errors.</p>
        <p className="small-muted">Logs stay on this computer. Typing, manuscript text, chats, document names and paths, credentials, and free-text setting values are excluded.</p>
        <label className="check-label"><input type="checkbox" checked={draft.logCleanupEnabled} onChange={event => set('logCleanupEnabled', event.target.checked)} />Automatically delete old logs</label>
        <div className="form-grid"><NumberField label="Keep logs for (months)" value={draft.logRetentionMonths} min={1} max={24} disabled={!draft.logCleanupEnabled} onChange={value => set('logRetentionMonths', value)} help="1–24 calendar months. The default is one month." /></div>
        <p className="small-muted">Cleanup runs when WRAITER starts, every hour while it is open, and when you apply a cleanup change. With cleanup turned off, logs are kept until you turn it on again. Use Apply or Save settings to confirm changes.</p>
        <button type="button" className="secondary-button" onClick={async () => { try { await api.openLogFolder(); } catch (error) { setSaveError(errorText(error)); } }} title="Open WRAITER’s diagnostic log folder in File Explorer."><FolderOpen size={15} />Open log folder</button>
        {logStatus && <p className="small-muted" style={{ overflowWrap: 'anywhere' }}>{logStatus.directory}</p>}
        {!!logStatus?.failures && <p className="connection-status error" role="status">Some log files could not be written or cleaned up ({logStatus.lastFailure}). Check the folder’s permissions and available disk space.</p>}
      </>}
      {tab === 'general' && <><h3>Projects and startup</h3><label className="field-label" htmlFor="startup-projects">When WRAITER starts</label><select id="startup-projects" className="field-input" aria-label="When WRAITER starts" value={draft.startup || 'restore'} onChange={event => set('startup', event.target.value)}><option value="restore">Restore all open project tabs</option><option value="new">Open a clean new project</option></select><p className="small-muted">Restoring includes unnamed drafts and the last active tab. Each project keeps its own editing history. Starting clean preserves unnamed drafts in File → Open recent.</p><p className="small-muted">New and Open add a project tab. Closing a tab keeps its saved file; unnamed drafts remain available in Open recent. This setting takes effect the next time you launch WRAITER.</p></>}
      {tab === 'local' && <LocalModels notify={notify} onAssign={(which, model) => setProfile(which, { provider: 'local', baseUrl: '', model })} />}
      {tab === 'grammar' && <><h3>Spelling and grammar</h3>
        <label className="check-label"><input type="checkbox" checked={!!draft.spellcheck} onChange={event => set('spellcheck', event.target.checked)} />Underline spelling mistakes with the local dictionary</label>
        <label className="check-label"><input type="checkbox" checked={!!draft.localGrammar} onChange={event => set('localGrammar', event.target.checked)} />Local grammar hints while typing (English)</label><p className="small-muted">Checks repeated words, a/an and common “could of” expressions on this computer. Hover an underline to read the suggestion; intentional wording can stay.</p>
        <label className="check-label"><input type="checkbox" checked={!!draft.aiGrammar} onChange={event => set('aiGrammar', event.target.checked)} />AI grammar hints while typing</label><p className="small-muted">After a three-second pause, sends the current paragraph to your selected proofreading connection. Cloud providers may charge or use your allowance. Suggestions never change the manuscript automatically.</p>
        <p className="small-muted">Hover a purple underline to see why it was flagged and what the AI suggests. Click it to apply or ignore. AI hints require AI to be enabled; choose their model under Connections → Proofreading review.</p>
      </>}
      {tab === 'appearance' && <>
        <label className="check-label"><input type="checkbox" checked={!!draft.showFormattingMarks} onChange={event => set('showFormattingMarks', event.target.checked)} />Show spaces, tabs and paragraph marks</label>
        <label className="check-label"><input type="checkbox" checked={!!draft.smartPunctuation} onChange={event => set('smartPunctuation', event.target.checked)} />Use smart quotes, em dashes and ellipses while typing</label>
        <p className="small-muted">Smart punctuation changes only newly typed characters and is off by default.</p>
        <h3>Text substitutions</h3><p className="small-muted">Type a trigger followed by a space to replace it. Rules are case-sensitive and stay on this computer. Text with mixed formatting is left unchanged.</p>
        {(draft.substitutions || []).map((rule, index) => <div className="form-grid" key={index}><label>Trigger<input className="field-input" aria-label={`Substitution ${index + 1} trigger`} maxLength="80" value={rule.from} onChange={event => set('substitutions', draft.substitutions.map((item, i) => i === index ? { ...item, from: event.target.value } : item))} /></label><label>Replacement<input className="field-input" aria-label={`Substitution ${index + 1} replacement`} maxLength="500" value={rule.to} onChange={event => set('substitutions', draft.substitutions.map((item, i) => i === index ? { ...item, to: event.target.value } : item))} /></label><button type="button" className="secondary-button" onClick={() => set('substitutions', draft.substitutions.filter((_, i) => i !== index))}>Remove</button></div>)}
        <button type="button" className="secondary-button" disabled={(draft.substitutions || []).length >= 100} onClick={() => set('substitutions', [...(draft.substitutions || []), { from: '', to: '' }])} title="Add a shortcut that expands into your chosen text while typing.">Add text substitution</button>
        <label className="field-label" htmlFor="document-page-view">Document view</label><select id="document-page-view" className="field-input" aria-label="Document view" value={draft.pageMode || 'continuous'} onChange={event => set('pageMode', event.target.value)}><option value="continuous">Continuous — infinite page (default)</option><option value="pages">Divided pages</option></select><p className="small-muted">Both views let you scroll almost one screen below the document. Divided pages flow with your font and column width. Insert a manual page break from Edit → Insert page break{draft.hotkeys.pageBreak ? ` or ${formatShortcut(draft.hotkeys.pageBreak)}` : ''}; Backspace at the start of that paragraph removes it.</p>
        <label className="field-label">Interface theme</label>
        <div className="theme-options">{[['paper', 'Light', Sun], ['dark', 'Dark', Moon], ['contrast', 'High contrast', Contrast]].map(([value, label, Icon]) => <button key={value} type="button" className={'theme-option ' + value + (draft.theme === value ? ' selected' : '')} aria-pressed={draft.theme === value} onClick={() => set('theme', value)}><div aria-hidden="true"><span /><span /><span /></div><label><Icon size={14} />{label}{draft.theme === value && <Check size={14} />}</label></button>)}</div>
        <div className="form-grid">
          <NumberField label="Document zoom (%)" value={draft.zoom} min={50} max={200} step={5} onChange={value => set('zoom', value)} help="50–200%. Changes the on-screen size only." />
          <NumberField label="Text column width (px)" value={draft.measure} min={400} max={1600} step={20} onChange={value => set('measure', value)} help="400–1600 px before zoom." />
          <NumberField label="Session word target" value={draft.goal} min={0} max={1000000} onChange={value => set('goal', value)} help="Set 0 for no target." />
        </div>
        <p className="small-muted">Use the document toolbar to set the actual font, size, colour, line spacing, and paragraph formatting. Those choices are saved with your manuscript.</p>
      </>}
      {tab === 'language' && <div className="language-settings">
        <div className="form-grid">
          <label>Default document language<select className="field-input" aria-label="Default document language" value={draft.language} onChange={event => set('language', event.target.value)}>{LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select><small className="field-help">Used for new documents. Change the current document's language in its toolbar.</small></label>
          <label>My native language<select className="field-input" aria-label="Native language" value={draft.nativeLanguage || ''} onChange={event => set('nativeLanguage', event.target.value)}><option value="">Not set</option>{LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select><small className="field-help">Optional. Enables translation of native-language selections.</small></label>
        </div>
        <div className="settings-section"><h3>Selection behaviour</h3><p className="notice-copy">Select text and press {formatShortcut(draft.hotkeys.complete)}. Text in the document's language receives a rephrasing suggestion. A word or phrase in your native language receives a translation into the document's language. Review and accept the suggested replacement before it changes the manuscript.</p><p className="small-muted">LLM correction uses the current document's language, including the selected English spelling variant. The local dictionary is independent of the AI correction model.</p></div>
      </div>}
      {tab === 'connections' && <>
        <p className="small-muted settings-introduction">Choose a connection and model for each task. Connections using the same provider address share its saved API key. Version summaries label meaningful checkpoints from excerpts of changed text.</p>
        <div className="task-profiles">
          <div className="task-profile-row header" aria-hidden="true"><span>Task</span><span>Connection</span><span>Model</span><span /></div>
          {TASKS.map(([which, label]) => {
            const item = profileFor(draft, which), known = connections[connectionKey(item)], modelNames = modelIds(known?.models).filter(model => !(draft.hiddenModels?.[connectionKey(item)] || []).includes(model));
            return <div key={which} className={'task-profile-row' + (task === which ? ' selected' : '')}>
              <strong>{label}</strong>
              <select className="field-input" aria-label={label + ' provider'} value={item.provider} onChange={event => { setProfile(which, { provider: event.target.value, ...PRESETS[event.target.value] }); setTask(which); }}>{Object.entries(PROVIDERS).map(([value, name]) => <option value={value} key={value}>{name}</option>)}</select>
              <div className="model-picker" onFocus={() => setTask(which)}>
                <input className="field-input" role="combobox" aria-expanded="false" aria-label={label + ' model'} value={item.model} placeholder={item.provider === 'codex' ? 'Codex default model' : 'Choose or type model'} onChange={event => setProfile(which, { model: event.target.value })} />
                <select className="field-input model-dropdown" aria-label={'Available models for ' + label} title="Show all available models" value="" onChange={event => { if (event.target.value) setProfile(which, { model: event.target.value }); }}>
                  <option value="" disabled>{!known ? 'Loading models…' : known.error ? 'Could not load models — use Refresh models' : modelNames.length ? 'Choose a model' : 'No visible models — check Advanced or refresh'}</option>
                  {modelNames.map(model => <option key={model} value={model}>{model}</option>)}
                </select><ChevronDown className="model-dropdown-arrow" size={14} aria-hidden="true" />
              </div>
              <button className="secondary-button" type="button" onClick={() => setTask(which)} aria-pressed={task === which} title={`Edit the connection details for ${label.toLowerCase()}.`}>Configure</button>
            </div>;
          })}
        </div>
        <div className="connection-editor">
          <h3>{TASKS.find(([which]) => which === task)?.[1]} — {PROVIDERS[profile.provider]}</h3>
          {profile.provider === 'local' ? <><p className="small-muted">WRAITER manages this engine and starts the selected model automatically. Processing stays on this computer.</p><button className="secondary-button" type="button" onClick={() => setTab('local')} title="Download or import local models, choose storage, and manage memory use.">Manage local models</button></> : ['codex', 'claude'].includes(profile.provider) ? <>
            <p className="small-muted">WRAITER connects to the account saved by the selected helper. You do not need to open a terminal or keep a CLI window running.</p>
            {connection?.needsLogin && !connection.error && <button type="button" className="primary-button spaced-button" disabled={pending === identity} onClick={() => check('login')} title="Open the provider’s sign-in flow to connect your account."><ExternalLink size={14} />Sign in{profile.provider === 'codex' ? ' with ChatGPT' : ' to Claude Code'}</button>}
          </> : <>
            <label className="field-label">{profile.provider === 'ollama' ? 'Ollama address' : 'API base address'}</label>
            <input className="field-input" aria-label="Provider base address" value={profile.baseUrl} onChange={event => setProfile(task, { baseUrl: event.target.value })} />
            {profile.provider !== 'ollama' && <>
              <label className="field-label spaced">API key<small>{hasSavedKey ? 'Saved securely; leave blank to keep' : 'Stored with Windows encryption'}</small></label>
              <input className="field-input" type="password" autoComplete="off" aria-label="Provider API key" value={keyEdit.apiKey} placeholder={hasSavedKey ? 'Saved API key' : 'Enter API key'} onChange={event => setKeyEdit({ apiKey: event.target.value, clearKey: false })} />
              <label className="check-label small"><input type="checkbox" checked={keyEdit.clearKey} onChange={event => setKeyEdit({ clearKey: event.target.checked, apiKey: '' })} />Remove the saved API key for this connection</label>
            </>}
            {profile.provider === 'ollama' && <p className="small-muted">Connect starts an installed local Ollama service if needed. Choose one of your installed models, or enter the name of a model available on your server.</p>}
          </>}
          <div className="connection-check"><button className="secondary-button" type="button" disabled={!!pending} onClick={() => check('connect')} title={profile.provider === "ollama" ? "Check this connection and start the installed local Ollama service if needed." : "Check the selected provider connection and retrieve its available models."}>{pending === identity ? <LoaderCircle size={14} className="spin" /> : <Plug size={14} />}Connect</button><button className="secondary-button" type="button" disabled={!!pending} onClick={() => check('models')} title="Reload the models available from the selected connection.">Refresh models</button>{profile.provider === 'codex' && <button className="text-button" type="button" disabled={!!pending} onClick={() => check('reconnect')} title="Restart the connection to the saved Codex account and refresh its models.">Reconnect</button>}</div>
          {pending === identity && <div className="connection-status" role="status"><LoaderCircle size={14} className="spin" />Checking connection…</div>}
          {connection && pending !== identity && <div className={'connection-status ' + (connection.error ? 'error' : connection.needsLogin ? '' : 'success')} role="status">{connection.error ? <Info size={15} /> : <CheckCircle2 size={15} />}<span>{connection.message || (connection.connected ? 'Connected.' : 'Connection checked.')}{connection.models?.length && !/models? available/i.test(connection.message || '') ? ' ' + connection.models.length + ' models available.' : ''}</span></div>}
          {profile.provider === 'claude' && <label>Claude Code executable (optional)<input className="field-input" aria-label="Claude Code executable path" value={profile.claudePath || ''} onChange={e => setProfile(task, { claudePath: e.target.value })} placeholder="Automatic detection" /></label>}
          {profile.provider === 'codex' && <details><summary>Advanced: executable location</summary><p className="small-muted">Detected automatically from your Codex installation. Override only if you use a custom installation.</p><div className="input-with-button"><input className="field-input" aria-label="Codex executable path" value={profile.codexPath || ''} placeholder="Automatic detection" onChange={event => setProfile(task, { codexPath: event.target.value })} /><button className="secondary-button" type="button" onClick={async () => { try { const chosen = await api.chooseCodex(); if (chosen) setProfile(task, { codexPath: chosen }); } catch (error) { setSaveError(errorText(error)); } }} title="Choose the installed Codex helper executable.">Browse</button></div></details>}
          <details className="model-visibility"><summary>Advanced: model visibility</summary>
            <p className="small-muted">Uncheck models to hide them from the dropdowns for this connection. Existing task assignments and manually typed model names still work. Save settings to keep these choices.</p>
            <div className="model-visibility-list">{modelIds([...(connection?.models || []), ...(draft.hiddenModels?.[identity] || [])]).map(model => <label className="check-label" key={model}><input type="checkbox" checked={!(draft.hiddenModels?.[identity] || []).includes(model)} onChange={event => set('hiddenModels', { ...draft.hiddenModels, [identity]: event.target.checked ? (draft.hiddenModels?.[identity] || []).filter(id => id !== model) : [...(draft.hiddenModels?.[identity] || []), model] })} />{model}</label>)}</div>
            {!connection?.models?.length && <p className="small-muted">Connect or refresh models to discover the available choices.</p>}
            {!!draft.hiddenModels?.[identity]?.length && <button type="button" className="secondary-button" onClick={() => set('hiddenModels', { ...draft.hiddenModels, [identity]: [] })}>Show all models</button>}
          </details>
          <p className="small-muted">{task === 'checkpoint' ? 'Version summaries use short excerpts of changed text, chapter titles, and the manuscript title. References are not sent.' : profile.provider === 'local' ? 'Local processing uses the selected model folder and memory controls.' : profile.provider === 'ollama' ? 'Text is sent to this Ollama address. A localhost address keeps model processing on this computer.' : 'Selected text, surrounding context, and enabled references are sent to the chosen provider when assistance runs.'}</p>
        </div>
      </>}
      {tab === 'ai' && <>
        <label className="check-label"><input type="checkbox" checked={!!draft.enabled} onChange={event => set('enabled', event.target.checked)} />Enable AI writing assistance</label>
        <label className="check-label"><input type="checkbox" checked={!!draft.continuous} onChange={event => set('continuous', event.target.checked)} />Suggest automatically after a writing pause</label>
        <h3>Selection suggestions</h3>
        <div className="form-grid">
          <NumberField label="Translation suggestions" value={draft.translationSuggestions} min={1} max={8} onChange={value => set('translationSuggestions', value)} />
          <NumberField label="Correction suggestions" value={draft.correctionSuggestions} min={1} max={8} onChange={value => set('correctionSuggestions', value)} />
          <NumberField label="Rephrasing suggestions" value={draft.rephraseSuggestions} min={1} max={8} onChange={value => set('rephraseSuggestions', value)} />
        </div>
        <p className="small-muted">Aim for 1–8 alternatives for the selected text. The model may offer fewer useful choices. Corrections stay limited to spelling, punctuation, and grammar.</p>
        <h3>Continuations and model controls</h3>
        <div className="form-grid">
          <NumberField label="Suggestion length (words)" value={draft.predictionWords} min={1} max={500} onChange={value => set('predictionWords', value)} help="1–500 words for continuations, including retries." />
          <NumberField label="Context budget (words)" value={draft.contextWords} min={50} max={16000} step={50} onChange={value => set('contextWords', value)} help="50–16,000 words of manuscript before the cursor. References have a separate limit." />
          <NumberField label="Maximum output tokens" value={draft.tokenCap} min={64} max={32768} step={64} onChange={value => set('tokenCap', value)} help="64–32,768. Caps the output requested from a model." />
          <NumberField label="Temperature" value={draft.temperature} min={0} max={2} step={0.05} onChange={value => set('temperature', value)} help="0–2. Lower values give more predictable suggestions." />
          <label>Ollama completion mode<select className="field-input" value={draft.ollamaMode || 'auto'} onChange={event => set('ollamaMode', event.target.value)}><option value="auto">Automatic model detection</option><option value="guided">Guided / instruction model</option><option value="raw">Raw / base model</option></select></label>
        </div>
        <label className="check-label"><input type="checkbox" checked={!!draft.allowReasoning} onChange={event => set('allowReasoning', event.target.checked)} />Allow additional model reasoning when supported</label>
        <p className="small-muted">Higher reasoning and larger context can increase response time and usage. Codex uses reasoning effort and ignores the temperature and token-cap controls. Other providers apply supported generation options. Enabled references are separately limited to 48,000 characters. Assign different models under Connections.</p>
        <h3>Accepting suggestions</h3><p className="notice-copy">Accept everything with {formatShortcut(draft.hotkeys.accept)}, accept the next character with {formatShortcut(draft.hotkeys.acceptCharacter)}, or the next word with {formatShortcut(draft.hotkeys.acceptWord)}. Use {formatShortcut(draft.hotkeys.dismiss)} to dismiss a suggestion. Unaccepted suggestions are never saved as manuscript text.</p>
      </>}
      {tab === 'hotkeys' && <>
        <p className="small-muted settings-introduction">Click a shortcut, then press the new key combination. Use the reset button to restore that command's default. Suggest and Accept may share a shortcut because they apply at different times.</p>
        <div className="hotkey-table">{Object.entries(DEFAULT_HOTKEYS).map(([command, defaultKey]) => <div className="hotkey-row" key={command}>
          <span>{HOTKEY_LABELS[command]}</span>
          <button type="button" className={'hotkey-capture' + (capturing === command ? ' capturing' : '')} aria-label={'Shortcut for ' + HOTKEY_LABELS[command]} onClick={async event => { const button = event.currentTarget; try { await api.setShortcutCapture?.(true); if (mounted.current && document.activeElement === button) setCapturing(command); else await api.setShortcutCapture?.(false); } catch (error) { if (mounted.current) setSaveError(errorText(error)); } }} onBlur={() => setCapturing(previous => previous === command ? '' : previous)} onKeyDown={event => {
            if (capturing !== command) return;
            event.preventDefault(); event.stopPropagation();
            const value = shortcutFromEvent(event);
            if (!value) return;
            set('hotkeys', { ...draft.hotkeys, [command]: value }); setCapturing('');
          }} title={capturing === command ? "Press the key combination you want to assign." : "Click, then press a key combination to assign this shortcut."}>{capturing === command ? 'Press shortcut…' : formatShortcut(draft.hotkeys[command])}</button>
          <span className="hotkey-actions"><button type="button" className="icon-button" aria-label={'Reset ' + HOTKEY_LABELS[command]} title={'Reset to ' + formatShortcut(defaultKey)} onClick={() => set('hotkeys', { ...draft.hotkeys, [command]: defaultKey })}><RotateCcw size={14} /></button><button type="button" className="icon-button" aria-label={'Unassign ' + HOTKEY_LABELS[command]} title="Unassign shortcut" onClick={() => set('hotkeys', { ...draft.hotkeys, [command]: '' })}><X size={14} /></button></span>
        </div>)}</div>
        {!!conflicts.length && <div className="connection-status error" role="alert"><span>{conflicts.join('\n')}</span></div>}
        <button type="button" className="secondary-button" onClick={() => { set('hotkeys', { ...DEFAULT_HOTKEYS }); setCapturing(''); }} title="Reset every keyboard shortcut to WRAITER’s defaults in this settings draft."><RotateCcw size={14} />Restore all default shortcuts</button>
      </>}
    </div>
    {saveError && <div className="connection-status error" role="alert"><Info size={15} /><span>{saveError}</span></div>}
    <div className="modal-footer"><button type="button" className="secondary-button" disabled={saving} onClick={onClose}>Cancel</button><button type="button" className="secondary-button" disabled={saving || !!conflicts.length} onClick={() => save(false)} title="Save the settings and keep this dialog open.">Apply</button><button type="button" className="primary-button" disabled={saving || !!conflicts.length} onClick={() => save(true)} title="Save the settings and close this dialog.">{saving ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}Save settings</button></div>
  </Modal>;
}
