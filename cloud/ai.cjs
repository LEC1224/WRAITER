const { CloudError } = require('./store.cjs');
const providers = require('../electron/providers.cjs');
const { validateRequest } = require('../electron/core.cjs');
const { runProofread } = require('../electron/proofreading.cjs');
const { runInlineProofread } = require('../electron/inline-grammar.cjs');
const { runWritingAgent } = require('../electron/writing-agent.cjs');
const { resolveTask } = require('../electron/preferences.cjs');
const PROVIDERS = new Map([['api.openai.com','https://api.openai.com/v1'],['api.anthropic.com','https://api.anthropic.com/v1'],['api.x.ai','https://api.x.ai/v1'],['openrouter.ai','https://openrouter.ai/api/v1'],['generativelanguage.googleapis.com','https://generativelanguage.googleapis.com/v1beta/openai']]);
function cloudSettings(input, operation) {
  const mode = { agent:'chat',inline:'proofread',proofread:'proofread',checkpoint:'checkpoint' }[operation] || input?.mode || 'continue';
  const settings = resolveTask(input || {},mode);
  if (!['openai','anthropic','compatible'].includes(settings.provider)) throw new CloudError(400,'The web app supports cloud API providers only. Connect your own API key.');
  let url; try { url = new URL(settings.baseUrl || (settings.provider === 'anthropic' ? 'https://api.anthropic.com/v1' : 'https://api.openai.com/v1')); } catch { throw new CloudError(400,'Choose a supported cloud provider address.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443' || !PROVIDERS.has(url.hostname) || url.search || url.hash || url.pathname.replace(/\/$/,'') !== new URL(PROVIDERS.get(url.hostname)).pathname) throw new CloudError(400,'Supported cloud providers: OpenAI, Anthropic, xAI, OpenRouter and Google. Local and custom network endpoints are unavailable.');
  if (settings.provider === 'anthropic' && url.hostname !== 'api.anthropic.com' || settings.provider !== 'anthropic' && url.hostname === 'api.anthropic.com') throw new CloudError(400,'The provider type does not match its address.');
  return {...settings,baseUrl:PROVIDERS.get(url.hostname),enabled:true};
}
async function runAI(operation, body, signal) {
  const request = body.request || {}, settings = cloudSettings({...body.settings,mode:request.mode},operation), key = body.apiKey;
  if (typeof key !== 'string' || !key.trim() || key.length > 8192 || /[\r\n]/.test(key)) throw new CloudError(400,'Enter your own cloud provider API key in AI connections.');
  if (operation === 'generate') return providers.generate(settings,key,validateRequest(request),signal);
  if (operation === 'proofread') return runProofread(providers,settings,key,request,signal);
  if (operation === 'inline') return runInlineProofread(providers,settings,key,request,signal);
  if (operation === 'agent') return runWritingAgent({...request,references:(request.project?.references || []).filter(item => item.enabled !== false && typeof item.text === 'string'),settings,key,signal});
  if (operation === 'checkpoint') return providers.generateCheckpoint(settings,key,request,signal);
  if (operation === 'probe' || operation === 'models') return providers.probe(settings,key);
  throw new CloudError(404,'Unknown AI operation.');
}
module.exports = { runAI, cloudSettings, PROVIDERS };
