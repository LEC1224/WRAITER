import React, { useEffect, useRef, useState } from 'react';
import { Sun, Moon, Contrast, Keyboard, Globe2, SlidersHorizontal, Plug, Check, RotateCcw, X, LoaderCircle, CheckCircle2, Info, ExternalLink, Download } from 'lucide-react';
import { DEFAULT_HOTKEYS, HOTKEY_LABELS, shortcutFromEvent, shortcutConflicts, formatShortcut } from './hotkeys.js';
import { LANGUAGES } from './languages.js';
import LocalModels from './LocalModels.jsx';

const api = window.wraiter;
const TASKS = [['continue', 'Autocomplete'], ['correct', 'Spell correction'], ['rewrite', 'Rephrase / translate'], ['chat', 'Project assistant']];
const PROVIDERS = { local: 'Local models (managed)', codex: 'Codex account', ollama: 'Ollama (local)', openai: 'OpenAI API', anthropic: 'Claude API', compatible: 'Compatible API / xAI' };
const PRESETS = { local: { baseUrl: '', model: '' }, codex: { baseUrl: '', model: '', codexPath: '' }, ollama: { baseUrl: 'http://localhost:11434', model: '' }, openai: { baseUrl: 'https://api.openai.com/v1', model: '' }, anthropic: { baseUrl: 'https://api.anthropic.com/v1', model: '' }, compatible: { baseUrl: 'https://api.x.ai/v1', model: '' } };
const errorText = error => String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const profileFor = (settings, task) => ({ provider: settings.provider || 'codex', baseUrl: settings.baseUrl || '', model: settings.model || '', codexPath: settings.codexPath || '', ...(settings.taskProfiles?.[task] || {}) });
const connectionKey = profile => [profile.provider, profile.baseUrl.replace(/\/+$/, ''), profile.codexPath || ''].join('|');

function NumberField({ label, value, min, max, step = 1, onChange, help }) {
  return <label>{label}<input className="field-input" type="number" aria-label={label} min={min} max={max} step={step} value={value ?? ''} onChange={event => onChange(event.target.value === '' ? '' : Number(event.target.value))} />{help && <small className="field-help">{help}</small>}</label>;
}

export default function Settings({ initialTab, prefs, updatePrefs, onClose, notify, fonts = [], Modal }) {
  const [tab, setTab] = useState(['appearance', 'language', 'connections', 'local', 'ai', 'hotkeys'].includes(initialTab) ? initialTab : 'appearance');
  const [draft, setDraft] = useState(() => ({ ...prefs, taskProfiles: Object.fromEntries(TASKS.map(([task]) => [task, profileFor(prefs, task)])), hotkeys: { ...DEFAULT_HOTKEYS, ...(prefs.hotkeys || {}) } }));
  const [task, setTask] = useState('continue');
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
      const result = await (action === 'login' ? api.loginProvider(payload()) : action === 'reconnect' ? api.reconnectProvider(payload()) : action === 'connect' ? api.connectProvider(payload()) : api.listModels(payload()));
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
  }, [tab, task, profile.provider, pending]);

  async function save(close) {
    if (conflicts.length) { setSaveError('Resolve the shortcut conflicts before saving.'); setTab('hotkeys'); return; }
    const ranges = { zoom: [50, 200], measure: [400, 1600], goal: [0, 1000000], predictionWords: [1, 500], contextWords: [50, 16000], tokenCap: [64, 32768], temperature: [0, 2] };
    for (const [name, [min, max]] of Object.entries(ranges)) {
      if (!Number.isFinite(draft[name]) || draft[name] < min || draft[name] > max) { setSaveError('Check the number fields. Every value must be within its displayed range.'); return; }
    }
    setSaving(true); setSaveError('');
    try {
      const continuation = profileFor(draft, 'continue');
      // Keep the original top-level connection in sync for older display consumers.
      await updatePrefs({ ...draft, ...continuation });
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

  const tabs = [['appearance', 'Appearance', Sun], ['language', 'Languages', Globe2], ['connections', 'Connections', Plug], ['local', 'Local models', Download], ['ai', 'Writing AI', SlidersHorizontal], ['hotkeys', 'Shortcuts', Keyboard]];
  return <Modal title="Settings" onClose={saving ? () => {} : onClose} wide>
    <div className="settings-tabs" role="tablist" aria-label="Settings categories">{tabs.map(([id, label, Icon]) => <button type="button" key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'selected' : ''} onClick={() => { setCapturing(''); setTab(id); }}><Icon size={15} />{label}</button>)}</div>
    <div className="settings-content" role="tabpanel" aria-label={tabs.find(([id]) => id === tab)?.[1]}>
      {tab === 'local' && <LocalModels notify={notify} onAssign={(which, model) => setProfile(which, { provider: 'local', baseUrl: '', model })} />}
      {tab === 'appearance' && <>
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
        <label className="check-label"><input type="checkbox" checked={!!draft.spellcheck} onChange={event => set('spellcheck', event.target.checked)} />Underline spelling mistakes with the local dictionary</label>
        <div className="settings-section"><h3>Selection behaviour</h3><p className="notice-copy">Select text and press {formatShortcut(draft.hotkeys.complete)}. Text in the document's language receives a rephrasing suggestion. A word or phrase in your native language receives a translation into the document's language. Review and accept the suggested replacement before it changes the manuscript.</p><p className="small-muted">LLM correction uses the current document's language, including the selected English spelling variant. The local dictionary is independent of the AI correction model.</p></div>
      </div>}
      {tab === 'connections' && <>
        <p className="small-muted settings-introduction">Choose a connection and model for each task. Connections using the same provider address share its saved API key.</p>
        <div className="task-profiles">
          <div className="task-profile-row header" aria-hidden="true"><span>Task</span><span>Connection</span><span>Model</span><span /></div>
          {TASKS.map(([which, label]) => {
            const item = profileFor(draft, which), known = connections[connectionKey(item)], modelNames = known?.models || [];
            return <div key={which} className={'task-profile-row' + (task === which ? ' selected' : '')}>
              <strong>{label}</strong>
              <select className="field-input" aria-label={label + ' provider'} value={item.provider} onChange={event => { setProfile(which, { provider: event.target.value, ...PRESETS[event.target.value] }); setTask(which); }}>{Object.entries(PROVIDERS).map(([value, name]) => <option value={value} key={value}>{name}</option>)}</select>
              <div><input className="field-input" aria-label={label + ' model'} list={'models-' + which} value={item.model} placeholder={item.provider === 'codex' ? 'Codex default model' : 'Choose or type model'} onChange={event => setProfile(which, { model: event.target.value })} /><datalist id={'models-' + which}>{modelNames.map(model => <option value={typeof model === 'string' ? model : model.id || model.model} key={typeof model === 'string' ? model : model.id || model.model} />)}</datalist></div>
              <button className="secondary-button" type="button" onClick={() => setTask(which)} aria-pressed={task === which}>Configure</button>
            </div>;
          })}
        </div>
        <div className="connection-editor">
          <h3>{TASKS.find(([which]) => which === task)?.[1]} — {PROVIDERS[profile.provider]}</h3>
          {profile.provider === 'local' ? <><p className="small-muted">WRAITER manages this engine and starts the selected model automatically. Processing stays on this computer.</p><button className="secondary-button" type="button" onClick={() => setTab('local')}>Manage local models</button></> : profile.provider === 'codex' ? <>
            <p className="small-muted">WRAITER connects to the account already saved by Codex. You do not need to open a terminal or keep a CLI window running.</p>
            {connection?.needsLogin && !connection.error && <button type="button" className="primary-button spaced-button" disabled={pending === identity} onClick={() => check('login')}><ExternalLink size={14} />Sign in with ChatGPT</button>}
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
          <div className="connection-check"><button className="secondary-button" type="button" disabled={!!pending} onClick={() => check('connect')}>{pending === identity ? <LoaderCircle size={14} className="spin" /> : <Plug size={14} />}Connect</button><button className="secondary-button" type="button" disabled={!!pending} onClick={() => check('models')}>Refresh models</button>{profile.provider === 'codex' && <button className="text-button" type="button" disabled={!!pending} onClick={() => check('reconnect')}>Reconnect</button>}</div>
          {pending === identity && <div className="connection-status" role="status"><LoaderCircle size={14} className="spin" />Checking connection…</div>}
          {connection && pending !== identity && <div className={'connection-status ' + (connection.error ? 'error' : connection.needsLogin ? '' : 'success')} role="status">{connection.error ? <Info size={15} /> : <CheckCircle2 size={15} />}<span>{connection.message || (connection.connected ? 'Connected.' : 'Connection checked.')}{connection.models?.length && !/models? available/i.test(connection.message || '') ? ' ' + connection.models.length + ' models available.' : ''}</span></div>}
          {profile.provider === 'codex' && <details><summary>Advanced: executable location</summary><p className="small-muted">Detected automatically from your Codex installation. Override only if you use a custom installation.</p><div className="input-with-button"><input className="field-input" aria-label="Codex executable path" value={profile.codexPath || ''} placeholder="Automatic detection" onChange={event => setProfile(task, { codexPath: event.target.value })} /><button className="secondary-button" type="button" onClick={async () => { try { const chosen = await api.chooseCodex(); if (chosen) setProfile(task, { codexPath: chosen }); } catch (error) { setSaveError(errorText(error)); } }}>Browse</button></div></details>}
          <p className="small-muted">{profile.provider === 'local' ? 'Local processing uses the selected model folder and memory controls.' : profile.provider === 'ollama' ? 'Text is sent to this Ollama address. A localhost address keeps model processing on this computer.' : 'Selected text, surrounding context, and enabled references are sent to the chosen provider when assistance runs.'}</p>
        </div>
      </>}
      {tab === 'ai' && <>
        <label className="check-label"><input type="checkbox" checked={!!draft.enabled} onChange={event => set('enabled', event.target.checked)} />Enable AI writing assistance</label>
        <label className="check-label"><input type="checkbox" checked={!!draft.continuous} onChange={event => set('continuous', event.target.checked)} />Suggest automatically after a writing pause</label>
        <div className="form-grid">
          <NumberField label="Suggestion length (words)" value={draft.predictionWords} min={1} max={500} onChange={value => set('predictionWords', value)} help="1–500 words. Also used when retrying a suggestion." />
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
          }}>{capturing === command ? 'Press shortcut…' : formatShortcut(draft.hotkeys[command])}</button>
          <span className="hotkey-actions"><button type="button" className="icon-button" aria-label={'Reset ' + HOTKEY_LABELS[command]} title={'Reset to ' + formatShortcut(defaultKey)} onClick={() => set('hotkeys', { ...draft.hotkeys, [command]: defaultKey })}><RotateCcw size={14} /></button><button type="button" className="icon-button" aria-label={'Unassign ' + HOTKEY_LABELS[command]} title="Unassign shortcut" onClick={() => set('hotkeys', { ...draft.hotkeys, [command]: '' })}><X size={14} /></button></span>
        </div>)}</div>
        {!!conflicts.length && <div className="connection-status error" role="alert"><span>{conflicts.join('\n')}</span></div>}
        <button type="button" className="secondary-button" onClick={() => { set('hotkeys', { ...DEFAULT_HOTKEYS }); setCapturing(''); }}><RotateCcw size={14} />Restore all default shortcuts</button>
      </>}
    </div>
    {saveError && <div className="connection-status error" role="alert"><Info size={15} /><span>{saveError}</span></div>}
    <div className="modal-footer"><button type="button" className="secondary-button" disabled={saving} onClick={onClose}>Cancel</button><button type="button" className="secondary-button" disabled={saving || !!conflicts.length} onClick={() => save(false)}>Apply</button><button type="button" className="primary-button" disabled={saving || !!conflicts.length} onClick={() => save(true)}>{saving ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}Save settings</button></div>
  </Modal>;
}
