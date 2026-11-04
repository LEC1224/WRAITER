const test = require('node:test');
const assert = require('node:assert/strict');
const { storeVersion, validateIdentity, manifest, storePlan } = require('../tools/store-package.cjs');
const identity = require('../build/store-identity.json');

test('Store version mapping supports updates from 0.x and reserves the last component', () => {
  assert.equal(storeVersion('0.17.0'), '1.17.0.0');
  assert.equal(storeVersion('0.17.1'), '1.17.1.0');
  assert.equal(storeVersion('1.0.0'), '2.0.0.0');
  for (const invalid of ['0.17.0-beta.1', '0.17', '1.2.3.4', '-1.2.3', '65535.0.0', '0.65536.0', '0.0.65536']) assert.throws(() => storeVersion(invalid));
});

test('Submission refuses guessed identities and unsupported identity fields', () => {
  assert.deepEqual(validateIdentity(identity), identity);
  assert.throws(() => validateIdentity(require('../build/store-identity.example.json')), /Preview\/example/);
  assert.throws(() => storePlan([], '0.17.0'), /Product identity/);
  assert.throws(() => validateIdentity({ ...identity, publisher: 'LEC1224' }), /CN=/);
  assert.throws(() => validateIdentity({ ...identity, identityName: 'WRAITER invalid' }), /Identity\/Name/);
  assert.throws(() => validateIdentity({ ...identity, publisherDisplayName: 'A\nB' }), /publisherDisplayName/);
  assert.throws(() => validateIdentity({ ...identity, applicationId: 'CON' }), /Application Id/);
  assert.throws(() => validateIdentity({ ...identity, publish: 'always' }), /only/);
});

test('Store build isolates preview outputs and cannot use direct-release signing or publish options', () => {
  const actual = storePlan([], '0.17.0', identity), preview = storePlan(['--preview'], '0.17.0');
  assert.equal(actual.preview, false);
  assert.equal(actual.config.directories.output, 'release/store/v0.17.0');
  assert.equal(preview.config.directories.output, 'release/store-preview/v0.17.0');
  assert.notEqual(preview.identity.identityName, actual.identity.identityName);
  assert.equal(actual.config.extraMetadata.wraiterDistribution, 'microsoft-store');
  assert.equal(actual.config.extraMetadata.wraiterStorePackageVersion, '1.17.0.0');
  assert.equal(actual.config.win.signExecutable, false);
  assert.equal(actual.config.forceCodeSigning, false);
  assert.equal(actual.config.win.azureSignOptions, null);
  assert.equal(actual.config.win.signtoolOptions, null);
  assert.throws(() => storePlan(['--publish', 'always'], '0.17.0', identity), /never publishes/);
  assert.throws(() => storePlan(['--identity'], '0.17.0', identity), /identity/);
  assert.throws(() => storePlan(['--preview', '--identity', 'actual.json'], '0.17.0', identity), /not both/);
});

test('Manifest uses minimal desktop capabilities and safely quotes file activation paths', () => {
  const text = manifest(validateIdentity({ ...identity, publisherDisplayName: 'LEC & "Writer"', displayName: 'WRAITER <draft>' }), '1.17.0.0');
  assert.match(text, /LEC &amp; &quot;Writer&quot;/);
  assert.match(text, /WRAITER &lt;draft&gt;/);
  assert.match(text, /Parameters="&quot;%1&quot;"/);
  assert.match(text, /<uap:FileType>\.wraiter<\/uap:FileType>/);
  assert.match(text, /Executable="app\\WRAITER.exe"/);
  assert.match(text, /ProcessorArchitecture="x64"/);
  assert.match(text, /TargetDeviceFamily Name="Windows.Desktop"/);
  assert.equal((text.match(/:Capability /g) || []).length, 1);
  assert.match(text, /Capability Name="runFullTrust"/);
  assert.doesNotMatch(text, /broadFileSystemAccess|unvirtualizedResources|runAsAdministrator|windows\.startupTask/);
});
