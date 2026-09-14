const STEPS = ['welcome', 'chapter', 'opening', 'complete', 'preview', 'practice', 'rephrase', 'undo', 'correct', 'voice', 'references', 'chat', 'history', 'find', 'pages', 'focus', 'save', 'export', 'finish'];
function validateTutorial(value) {
  if (value === null) return null;
  if (!value || Array.isArray(value) || value.version !== 1 || !STEPS.includes(value.step) || typeof value.paused !== 'boolean') throw new Error('Invalid tutorial progress.');
  for (const key of ['tabId', 'projectId', 'returnTabId', 'chapterId']) if (typeof value[key] !== 'string' || value[key].length > 200 || (['tabId', 'projectId'].includes(key) && !value[key])) throw new Error('Invalid tutorial document.');
  if (!value.flags || Array.isArray(value.flags) || typeof value.flags !== 'object' || Object.keys(value.flags).length > 30 || Object.entries(value.flags).some(([key, flag]) => !/^[a-zA-Z]{1,30}$/.test(key) || typeof flag !== 'boolean')) throw new Error('Invalid tutorial lesson state.');
  return { version: 1, tabId: value.tabId, projectId: value.projectId, returnTabId: value.returnTabId, chapterId: value.chapterId, step: value.step, paused: value.paused, flags: { ...value.flags } };
}
module.exports = { validateTutorial };
