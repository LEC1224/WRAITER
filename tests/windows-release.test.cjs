const { test } = require('node:test');
const assert = require('node:assert/strict');
const { packagingPlan } = require('../tools/package-windows.cjs');
const { validateSignatures } = require('../tools/verify-windows-release.cjs');

test('public packaging needs an explicit signing identity and cannot silently discover an unrelated certificate', () => {
  assert.throws(() => packagingPlan([], '0.17.0', {}, {}), /trusted Windows signing identity/);
  const plan = packagingPlan([], '0.17.0', {}, { WIN_CSC_LINK: 'private-certificate.pfx' });
  assert.equal(plan.config.forceCodeSigning, true);
  assert.equal(plan.config.win.signExecutable, true);
  assert.deepEqual(plan.config.win.signExts, ['.exe', '.dll']);
  assert.equal(plan.config.directories.output, 'release/signed/v0.17.0');
});

test('a deliberate unsigned preview stays separate from signed output and disables configured cloud signing', () => {
  const plan = packagingPlan(['--unsigned-preview'], '0.17.0', { win: { azureSignOptions: { endpoint: 'example' } } }, {});
  assert.equal(plan.preview, true);
  assert.equal(plan.config.directories.output, 'release/unsigned-preview/v0.17.0');
  assert.equal(plan.config.forceCodeSigning, false);
  assert.equal(plan.config.win.azureSignOptions, null);
  assert.equal(plan.config.win.signtoolOptions, null);
});

test('release options cannot turn off signing or publish from a local packaging command', () => {
  for (const args of [['--config.forceCodeSigning=false'], ['--publish', 'always'], ['--output']]) assert.throws(() => packagingPlan(args, '0.17.0', {}, {}));
  assert.throws(() => packagingPlan([], '0.17.0', { win: { signExecutable: false } }, {}), /Only azureSignOptions/);
  const plan = packagingPlan(['--publish', 'never', '--config.directories.output=tmp/signed-check'], '0.17.0', { win: { signtoolOptions: { certificateSha1: 'explicit identity' } } }, {});
  assert.equal(plan.config.directories.output, 'tmp/signed-check');
  assert.equal(plan.config.win.signExecutable, true);
});

test('verification requires both distribution packages, the app, and valid timestamped signatures on every runtime binary', () => {
  const valid = ['WRAITER-0.17.0-Setup.exe', 'WRAITER-0.17.0-Windows.exe', 'win-unpacked/WRAITER.exe', 'win-unpacked/library.dll'].map(file => ({ file, status: 'Valid', signer: 'trusted publisher', timestamp: 'trusted timestamp' }));
  validateSignatures(valid, '0.17.0');
  assert.throws(() => validateSignatures(valid.slice(1), '0.17.0'), /Setup.exe: missing/);
  for (const status of ['NotSigned', 'HashMismatch', 'NotTrusted']) assert.throws(() => validateSignatures([...valid.slice(0, -1), { ...valid.at(-1), status }], '0.17.0'), new RegExp(`library.dll: ${status}`));
  assert.throws(() => validateSignatures(valid.map(item => ({ ...item, timestamp: null })), '0.17.0'), /missing signing timestamp/);
});
