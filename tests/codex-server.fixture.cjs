// A local JSONL process fixture. It never connects to a model or reads user files.
const readline = require('node:readline');
const records = []; let threads = 0; let turns = 0; const timers = new Set();
const send = message => process.stdout.write(`${JSON.stringify(message)}\n`);
readline.createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line); records.push(message);
  const { id, method, params = {} } = message;
  if (!method || id == null) return;
  const reply = result => send({ id, result });
  if (method === 'initialize') return reply({});
  if (method === 'account/read') return reply({ account: { type: 'chatgpt', planType: 'pro' }, requiresOpenaiAuth: true });
  if (method === 'model/list') return reply({ data: [{ id: 'test-model', model: 'test-model', isDefault: true, defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'medium' }] }] });
  if (method === 'thread/start' || method === 'thread/fork') return reply({ thread: { id: `thread-${++threads}`, ephemeral: Boolean(params.ephemeral) } });
  if (method === 'test/records') return reply({ records });
  if (method === 'turn/start') {
    const turnId = `turn-${++turns}`;
    const finish = () => {
      send({ method: 'item/completed', params: { threadId: 'unrelated', item: { type: 'agentMessage', text: 'wrong thread' } } });
      send({ id: `server-${turnId}`, method: 'item/tool/call', params: { threadId: params.threadId, tool: 'forbidden' } });
      send({ method: 'item/completed', params: { threadId: params.threadId, turnId, item: { type: 'agentMessage', text: JSON.stringify({ completion: 'A synthetic completion.' }) } } });
      send({ method: 'turn/completed', params: { threadId: params.threadId, turn: { id: turnId, status: 'completed' } } });
    };
    if (params.input?.[0]?.text?.includes('HANG_REQUEST')) return reply({ turn: { id: turnId, status: 'inProgress' } });
    // Exercise a valid protocol race: notifications can arrive before the ack.
    finish(); return reply({ turn: { id: turnId, status: 'inProgress' } });
  }
  if (method === 'turn/interrupt') {
    reply({}); return send({ method: 'turn/completed', params: { threadId: params.threadId, turn: { id: params.turnId, status: 'interrupted' } } });
  }
  reply({});
}).on('close', () => { for (const timer of timers) clearTimeout(timer); process.exit(0); });
