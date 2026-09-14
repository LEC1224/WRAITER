const { hash } = require('./core.cjs');
const TASKS = ['continue', 'correct', 'rewrite', 'chat'];
const PROVIDERS = ['ollama', 'openai', 'anthropic', 'compatible', 'codex', 'claude', 'local'];
const DEFAULT_HOTKEYS = { complete: 'Tab', accept: 'Tab', acceptCharacter: 'ArrowRight', acceptWord: 'Ctrl+ArrowRight', dismiss: 'Escape', toggleAI: 'Ctrl+Shift+Space', toggleContinuous: 'Ctrl+Alt+Space', correct: 'Ctrl+Alt+G', rewrite: 'Ctrl+Alt+R', save: 'Ctrl+S', saveCopy: 'Ctrl+Shift+S', open: 'Ctrl+O', new: 'Ctrl+N', find: 'Ctrl+F', replace: 'Ctrl+H', preferences: 'Ctrl+,', focus: 'F11', snapshot: 'Ctrl+Alt+S', pageBreak: 'Ctrl+Enter', closeTab: 'Ctrl+W', nextTab: 'Ctrl+Tab', previousTab: 'Ctrl+Shift+Tab' };
const defaults = { tutorialSession: null, setupComplete: false, tutorialComplete: false, setupMode: 'simple', claudePath: '', provider: 'codex', baseUrl: 'http://localhost:11434', model: '', codexPath: '', enabled: false, continuous: false, predictionWords: 35, contextWords: 2000, tokenCap: 512, temperature: 0.7, allowReasoning: false, ollamaMode: 'auto', startup: 'restore', pageMode: 'continuous', theme: 'paper', font: 'Georgia', fontSize: 19, lineHeight: 1.8, measure: 720, zoom: 100, spellcheck: true, goal: 500, language: 'en-US', nativeLanguage: '', taskProfiles: {}, hotkeys: DEFAULT_HOTKEYS };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const profileKeys = ['provider', 'baseUrl', 'model', 'codexPath', 'claudePath'];
function validateProfile(profile) {
  if (!object(profile)) throw new Error('Invalid AI task profile.');
  const result = {};
  for (const key of profileKeys) if (key in profile) {
    if (typeof profile[key] !== 'string' || profile[key].length > 4000) throw new Error(`Invalid task ${key}.`);
    result[key] = profile[key];
  }
  if ('provider' in result && !PROVIDERS.includes(result.provider)) throw new Error('Unknown AI provider.');
  return result;
}
function resolveTask(prefs, task = 'continue') {
  if (!TASKS.includes(task)) throw new Error('Unknown AI task.');
  return { ...prefs, ...validateProfile(prefs.taskProfiles?.[task] || {}) };
}
function keySlot(settings) {
  const defaultURL = { openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com/v1', ollama: 'http://localhost:11434' };
  return `${settings.provider}:${hash(String(settings.baseUrl || defaultURL[settings.provider] || '').trim().replace(/\/+$/, ''))}`;
}
function validateSettings(update) {
  if (!object(update)) throw new Error('Invalid preferences.');
  if ('setupMode' in update && !['simple', 'advanced'].includes(update.setupMode)) throw new Error('Choose simple or advanced setup.');
  const allowed = Object.fromEntries(Object.entries(update).filter(([key]) => Object.hasOwn(defaults, key)));
  if ('tutorialSession' in allowed) allowed.tutorialSession = require('./tutorial-state.cjs').validateTutorial(allowed.tutorialSession);
  if ('pageMode' in allowed && !['continuous', 'pages'].includes(allowed.pageMode)) throw new Error('Choose continuous view or divided pages.');
  if ('startup' in allowed && !['restore', 'new'].includes(allowed.startup)) throw new Error('Choose whether to restore projects or start a new project.');
  const strings = ['provider', 'baseUrl', 'model', 'codexPath', 'claudePath', 'theme', 'font', 'language', 'nativeLanguage', 'ollamaMode', 'pageMode'];
  for (const key of strings) if (key in allowed && (typeof allowed[key] !== 'string' || allowed[key].length > 4000)) throw new Error(`Invalid ${key} preference.`);
  for (const key of ['setupComplete', 'tutorialComplete', 'enabled', 'continuous', 'spellcheck', 'allowReasoning']) if (key in allowed && typeof allowed[key] !== 'boolean') throw new Error(`Invalid ${key} preference.`);
  const ranges = { predictionWords: [1, 500], contextWords: [50, 16000], tokenCap: [64, 32768], temperature: [0, 2], fontSize: [8, 96], lineHeight: [1, 3], measure: [400, 1600], zoom: [50, 200], goal: [0, 1000000] };
  for (const [key, [min, max]] of Object.entries(ranges)) if (key in allowed && (!Number.isFinite(allowed[key]) || allowed[key] < min || allowed[key] > max)) throw new Error(`Invalid ${key} preference.`);
  if ('provider' in allowed && !PROVIDERS.includes(allowed.provider)) throw new Error('Unknown provider.');
  if ('theme' in allowed && !['paper', 'dark', 'contrast'].includes(allowed.theme)) throw new Error('Unknown theme.');
  if ('ollamaMode' in allowed && !['auto', 'guided', 'raw'].includes(allowed.ollamaMode)) throw new Error('Unknown Ollama connection mode.');
  if ('language' in allowed && !/^[a-z]{2,3}(?:-[a-zA-Z]{2,8}){0,2}$/.test(allowed.language)) throw new Error('Invalid content language.');
  if ('nativeLanguage' in allowed && allowed.nativeLanguage !== '' && !/^[a-z]{2,3}(?:-[a-zA-Z]{2,8}){0,2}$/.test(allowed.nativeLanguage)) throw new Error('Invalid native language.');
  if (allowed.taskProfiles !== undefined) {
    if (!object(allowed.taskProfiles) || Object.keys(allowed.taskProfiles).some(key => !TASKS.includes(key))) throw new Error('Invalid AI task profiles.');
    allowed.taskProfiles = Object.fromEntries(Object.entries(allowed.taskProfiles).map(([key, value]) => [key, validateProfile(value)]));
  }
  if (allowed.hotkeys !== undefined) {
    if (!object(allowed.hotkeys)) throw new Error('Invalid keyboard shortcuts.');
    for (const [key, value] of Object.entries(allowed.hotkeys)) {
      if (!Object.hasOwn(DEFAULT_HOTKEYS, key) || typeof value !== 'string' || value.length > 100 || /[\r\n\x00-\x1f]/.test(value)) throw new Error('Invalid keyboard shortcut.');
    }
  }
  if (update.apiKey != null && (typeof update.apiKey !== 'string' || update.apiKey.length > 16000)) throw new Error('Invalid API key.');
  if (update.apiKeyTask != null && !TASKS.includes(update.apiKeyTask)) throw new Error('Invalid API key task.');
  return allowed;
}
function mergeSettings(previous, update) {
  const allowed = validateSettings(update);
  const taskProfiles = { ...(previous.taskProfiles || {}) };
  for (const [task, value] of Object.entries(allowed.taskProfiles || {})) taskProfiles[task] = { ...(taskProfiles[task] || {}), ...value };
  const hotkeys = { ...DEFAULT_HOTKEYS, ...(previous.hotkeys || {}), ...(allowed.hotkeys || {}) };
  // An added default must not take over an author's existing Ctrl+Enter action.
  if (!Object.hasOwn(allowed.hotkeys || {}, 'pageBreak') && hotkeys.pageBreak === DEFAULT_HOTKEYS.pageBreak && Object.entries(hotkeys).some(([key, value]) => key !== 'pageBreak' && value === hotkeys.pageBreak)) hotkeys.pageBreak = '';
  for (const command of ['closeTab', 'nextTab', 'previousTab']) if (!Object.hasOwn(allowed.hotkeys || {}, command) && hotkeys[command] === DEFAULT_HOTKEYS[command] && Object.entries(hotkeys).some(([key, value]) => key !== command && value === hotkeys[command])) hotkeys[command] = '';
  return { ...previous, ...allowed, taskProfiles, hotkeys };
}
module.exports = { defaults, DEFAULT_HOTKEYS, TASKS, PROVIDERS, validateSettings, resolveTask, keySlot, mergeSettings };
