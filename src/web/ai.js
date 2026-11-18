// Inference runs on the writer's device. Neither prompts nor API keys use the
// manuscript host as a relay, so encrypted storage is not undone by AI requests.
import core from '../../electron/document-core.cjs';
import rephrasing from '../../electron/rephrase-options.cjs';
import proofreading from '../../electron/proofreading.cjs';
import inline from '../../electron/inline-grammar.cjs';
import agent from '../../electron/writing-agent-core.cjs';
import { createEditorialTools } from '../../electron/editorial-tools.mjs';

const BASES = new Map([
  ['api.openai.com', 'https://api.openai.com/v1'],
  ['api.anthropic.com', 'https://api.anthropic.com/v1'],
  ['api.x.ai', 'https://api.x.ai/v1'],
  ['openrouter.ai', 'https://openrouter.ai/api/v1'],
  ['generativelanguage.googleapis.com', 'https://generativelanguage.googleapis.com/v1beta/openai']
]);
const bounded = (value, fallback, min, max) => Number.isFinite(Number(value)) && value !== '' && value != null ? Math.min(max, Math.max(min, Number(value))) : fallback;

export function browserCloudSettings(input = {}, operation = 'generate', request = {}) {
  const task = ({ agent: 'chat', inline: 'proofread', proofread: 'proofread', checkpoint: 'checkpoint' })[operation] || request.mode || 'continue';
  const settings = { ...input, ...(input.taskProfiles?.[task] || {}) };
  if (!['openai', 'anthropic', 'compatible'].includes(settings.provider)) throw new Error('Choose a supported cloud API connection. Local models and account helpers are unavailable on the web.');
  let url;
  try { url = new URL(settings.baseUrl || (settings.provider === 'anthropic' ? BASES.get('api.anthropic.com') : BASES.get('api.openai.com'))); }
  catch { throw new Error('Choose a supported cloud provider address.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.port && url.port !== '443') || !BASES.has(url.hostname) || url.pathname.replace(/\/$/, '') !== new URL(BASES.get(url.hostname)).pathname) throw new Error('Supported providers are OpenAI, Anthropic, xAI, OpenRouter and Google.');
  if ((settings.provider === 'anthropic') !== (url.hostname === 'api.anthropic.com')) throw new Error('The provider type does not match its address.');
  return { ...settings, baseUrl: BASES.get(url.hostname) };
}

async function requestJSON(url, init, signal, key) {
  let response;
  try { response = await fetch(url, { ...init, signal, mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' }); }
  catch (error) {
    if (signal?.aborted || error.name === 'AbortError') throw error;
    throw new Error('The provider could not be reached directly from this browser. Check its browser-access support and your connection, or choose another supported provider.');
  }
  const maximum = 4 * 1024 * 1024;
  if (Number(response.headers.get('content-length')) > maximum) { await response.body?.cancel(); throw new Error('The provider response exceeded the 4 MB limit.'); }
  const reader = response.body?.getReader(), chunks = []; let total = 0;
  if (reader) {
    try { while (true) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > maximum) { await reader.cancel(); throw new Error('The provider response exceeded the 4 MB limit.'); } chunks.push(value); } }
    finally { reader.releaseLock(); }
  }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let data; try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch {}
  if (!response.ok) {
    const raw = typeof data?.error === 'string' ? data.error : data?.error?.message;
    const message = String(raw || response.statusText).replaceAll(key, '[API key]').slice(0, 350);
    const error = new Error(`Provider returned ${response.status}: ${message}`); error.status = response.status; throw error;
  }
  if (!data || typeof data !== 'object') throw new Error('The provider returned an invalid JSON response.');
  return data;
}

function headers(settings, key, json = false) {
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(settings.provider === 'anthropic'
      ? { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }
      : { Authorization: `Bearer ${key}` })
  };
}
function outputLimit(settings, request) {
  if (request.mode === 'agent') return Math.trunc(bounded(settings.agentTokenCap, 6000, 2048, 32768));
  if (request.mode === 'checkpoint') return 768;
  const estimated = request.mode === 'chat' ? 2400 : request.mode === 'continue' ? Math.ceil((request.words || settings.predictionWords || 35) * 3 + 100) : request.alternatives ? Math.ceil((String(request.selection || '').length / 2 + 256) * core.getSuggestionLimit(request)) : Math.ceil(String(request.selection || '').length / 2 + 256);
  return Math.trunc(bounded(settings.tokenCap, Math.min(32768, Math.max(256, estimated)), 64, 32768));
}
async function generate(settings, key, request, signal, suppliedPrompt) {
  const model = String(settings.model || '').trim(); if (!model) throw new Error('Choose a model in Connections first.');
  const prompt = suppliedPrompt || core.buildPrompt(request), maxTokens = outputLimit(settings, request), temperature = bounded(settings.temperature, .65, 0, 2);
  let data, result;
  if (settings.provider === 'anthropic') {
    data = await requestJSON(`${settings.baseUrl}/messages`, { method: 'POST', headers: headers(settings, key, true), body: JSON.stringify({ model, system: prompt.system, messages: [{ role: 'user', content: prompt.user }], max_tokens: maxTokens, temperature: Math.min(1, temperature) }) }, signal, key);
    if (data.stop_reason === 'max_tokens' && request.mode !== 'continue') throw new Error('The model reached the output limit. Increase it and try again.');
    result = data.content?.filter(item => item.type === 'text').map(item => item.text).join('\n');
  } else if (settings.provider === 'openai') {
    const reasoningModel = /^(?:gpt-[5-9]|o[1-9])(?:[.-]|$)/i.test(model);
    const reasoning = reasoningModel ? { effort: settings.allowReasoning ? 'medium' : /^(?:gpt-6|o[1-9]|gpt-5(?:-|$))/i.test(model) ? 'low' : 'none' } : undefined;
    data = await requestJSON(`${settings.baseUrl}/responses`, { method: 'POST', headers: headers(settings, key, true), body: JSON.stringify({ model, instructions: prompt.system, input: prompt.user, store: false, max_output_tokens: maxTokens, ...(reasoningModel ? { reasoning } : { temperature }) }) }, signal, key);
    if (data.status === 'incomplete' && request.mode !== 'continue') throw new Error('The model returned an incomplete response. Increase the output limit and try again.');
    result = data.output?.flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text).join('\n');
  } else {
    data = await requestJSON(`${settings.baseUrl}/chat/completions`, { method: 'POST', headers: headers(settings, key, true), body: JSON.stringify({ model, messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }], stream: false, max_tokens: maxTokens, temperature }) }, signal, key);
    if (data.choices?.[0]?.finish_reason === 'length' && request.mode !== 'continue') throw new Error('The model reached the output limit. Increase it and try again.');
    result = data.choices?.[0]?.message?.content;
  }
  if (typeof result !== 'string' || !result.trim()) throw new Error('The provider returned no usable text.');
  signal?.throwIfAborted();
  return request.alternatives ? rephrasing.parseRephraseOptions(result, request) : request.mode === 'agent' ? result.trim() : core.cleanResult(result, request.mode, request.words, request);
}

export async function runBrowserAI(operation, body, signal) {
  const request = body.request || {}, settings = browserCloudSettings(body.settings, operation, request), key = body.apiKey;
  if (typeof key !== 'string' || !key.trim() || key.length > 8192 || /[\r\n]/.test(key)) throw new Error('Enter your own cloud provider API key in Connections.');
  const controller = new AbortController(), cancel = () => controller.abort(signal?.reason), timer = setTimeout(() => controller.abort(new DOMException('The provider request timed out.', 'TimeoutError')), 240000);
  signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel();
  const providers = { generateStructured: (selected, secret, prompt, stopped) => generate(selected, secret, { mode: 'agent', references: [], history: [] }, stopped, prompt) };
  try {
    if (operation === 'generate') return await generate(settings, key, core.validateRequest(request), controller.signal);
    if (operation === 'proofread') return await proofreading.runProofread(providers, settings, key, request, controller.signal);
    if (operation === 'inline') return await inline.runInlineProofread(providers, settings, key, request, controller.signal);
    if (operation === 'agent') return await agent.runWritingAgent({ ...request, references: (request.project?.references || []).filter(item => item.enabled !== false && typeof item.text === 'string'), settings, key, signal: controller.signal }, providers.generateStructured, createEditorialTools);
    if (operation === 'structured') return await providers.generateStructured(settings, key, { system: request.system, user: request.user }, controller.signal);
    if (operation === 'checkpoint') return await generate(settings, key, { mode: 'checkpoint', references: [], history: [] }, controller.signal, request);
    if (operation === 'probe' || operation === 'models') {
      const data = await requestJSON(`${settings.baseUrl}/models`, { method: 'GET', headers: headers(settings, key) }, controller.signal, key);
      const items = data.models || data.data || []; if (!Array.isArray(items)) throw new Error('The provider returned an invalid model list.');
      const models = items.map(item => item?.name || item?.id).filter(item => typeof item === 'string').slice(0, 2000).sort();
      return { connected: true, provider: settings.provider, models, message: `Connected. ${models.length} model${models.length === 1 ? '' : 's'} available.` };
    }
    throw new Error('Unknown browser AI operation.');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}
