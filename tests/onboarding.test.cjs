const test = require('node:test');
const assert = require('node:assert/strict');
const { completionArgs, run, environment } = require('../electron/claude-bridge.cjs');
const { installScript, provider } = require('../electron/setup.cjs');
const { defaults, mergeSettings, resolveTask } = require('../electron/preferences.cjs');
test('setup state and Claude task assignments survive settings validation', () => {
  const saved = mergeSettings(defaults, { setupComplete: true, tutorialComplete: true, setupMode: 'advanced', taskProfiles: { rewrite: { provider: 'claude', claudePath: 'C:\\Custom\\claude.exe', model: 'sonnet' } } });
  assert.equal(saved.setupComplete, true); assert.equal(saved.tutorialComplete, true);
  assert.equal(resolveTask(saved, 'rewrite').claudePath, 'C:\\Custom\\claude.exe');
  assert.throws(() => mergeSettings(saved, { setupComplete: 'true' }));
  assert.throws(() => mergeSettings(saved, { setupMode: 'arbitrary' }));
});
test('Claude writing calls disable host tools, MCP and hooks, and do not retain sessions', () => {
  const args = completionArgs({ model: 'sonnet' }, 'Writing instructions');
  assert.equal(args[args.indexOf('--tools') + 1], '');
  assert.equal(args[args.indexOf('--disallowedTools') + 1], '*');
  assert.equal(args[args.indexOf('--setting-sources') + 1], '');
  assert.deepEqual(JSON.parse(args[args.indexOf('--mcp-config') + 1]), { mcpServers: {} });
  assert.equal(JSON.parse(args[args.indexOf('--settings') + 1]).disableAllHooks, true);
  assert.ok(args.includes('--no-session-persistence'));
  assert.equal(environment().ELECTRON_RUN_AS_NODE, undefined);
});
test('setup only installs allowlisted official helpers', () => {
  assert.throws(() => provider('__proto__')); assert.throws(() => installScript('other; command'));
  assert.match(installScript('codex'), /https:\/\/chatgpt.com\/codex\/install.ps1/);
  assert.match(installScript('claude'), /https:\/\/claude.ai\/install.ps1/);
});
test('helper execution handles stdin, errors, cancellation and bounded output', async () => {
  assert.equal(await run(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], { input: 'sample only' }), 'sample only');
  await assert.rejects(run(process.execPath, ['-e', 'process.exit(1)']), /could not finish/);
  await assert.rejects(run(process.execPath, ['-e', 'setInterval(()=>{},100)'], { signal: AbortSignal.timeout(100) }), /cancelled/);
  await assert.rejects(run(process.execPath, ['-e', 'process.stdout.write("x".repeat(5*1024*1024))']), /too large/);
});
