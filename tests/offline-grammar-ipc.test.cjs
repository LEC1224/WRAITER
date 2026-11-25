const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const JSZip = require('jszip');
const { OfflineGrammar, validateOfflineGrammarRequest } = require('../electron/offline-grammar.cjs');
const directory = path.resolve(__dirname, '../build/offline-grammar/payload');
const java = path.join(directory, 'runtime', 'bin', 'java.exe');
const bridge = path.join(directory, 'WraiterGrammar.jar');
const available = fs.existsSync(java) && fs.existsSync(bridge);

function fakeChild() {
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => { child.killed = true; child.emit('exit', 0); };
  child.requests = [];
  child.stdin.on('data', chunk => child.requests.push(...chunk.toString().trim().split('\n').map(line => JSON.parse(line))));
  return child;
}

test('local grammar IPC accepts only bounded supported-language passages', () => {
  assert.deepEqual(validateOfflineGrammarRequest({ language: 'en-GB', texts: ['She walk.'] }), { language: 'en-GB', texts: ['She walk.'] });
  assert.deepEqual(validateOfflineGrammarRequest({ language: 'sv-SE', texts: ['Text.'] }), { language: 'sv-SE', texts: ['Text.'] });
  for (const request of [null, {}, { language: 'de-DE', texts: ['Text.'] }, { language: 'en-US', texts: [] },
    { language: 'en-US', texts: Array(17).fill('x') }, { language: 'en-US', texts: ['x'.repeat(3501)] },
    { language: 'en-US', texts: Array(4).fill('x'.repeat(3500)) }, { language: 'en-US', texts: [1] }]) {
    assert.throws(() => validateOfflineGrammarRequest(request), /Invalid local grammar request/);
  }
});

test('bundled rule process cannot open a network socket', { skip: !available }, () => {
  const classpath = `${bridge}${path.delimiter}${path.join(directory, 'lib', '*')}`;
  const result = spawnSync(java, ['-Djava.security.manager=allow', '-cp', classpath, 'WraiterGrammar', '--network-self-test'], { encoding: 'utf8', timeout: 30000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trim(), 'network-disabled');
});

test('bundled grammar includes its offline tagger and omits the unused spelling model', { skip: !available }, async () => {
  const lib = path.join(directory, 'lib');
  const names = fs.readdirSync(lib);
  for (const name of ['opennlp-chunk-models-1.5.jar', 'opennlp-postag-models-1.5.jar', 'opennlp-tokenize-models-1.5.jar', 'opennlp-tools-1.9.4.jar']) assert.ok(names.includes(name), name);
  const english = await JSZip.loadAsync(fs.readFileSync(path.join(lib, 'language-en-6.8.jar')));
  assert.equal(english.file('org/languagetool/resource/en/spelling_correction_model.bin'), null);
});

test('local process matches out-of-order replies and exits after an idle period', { skip: !available }, async () => {
  const child = fakeChild(), checker = new OfflineGrammar(directory, { spawnProcess: () => child, idleTimeout: 30 });
  const first = checker.check({ language: 'en-US', texts: ['One.'] });
  const second = checker.check({ language: 'en-GB', texts: ['Two.'] });
  assert.equal(child.requests.length, 2);
  child.stdout.write(JSON.stringify({ id: child.requests[1].id, results: [[{ original: 'Two' }]] }) + '\n');
  child.stdout.write(JSON.stringify({ id: child.requests[0].id, results: [[{ original: 'One' }]] }) + '\n');
  assert.equal((await first)[0][0].original, 'One'); assert.equal((await second)[0][0].original, 'Two');
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(checker.child, null); assert.equal(child.killed, true);
});

test('invalid output, exit, timeout, and excess pending requests fail safely', { skip: !available }, async () => {
  for (const failure of ['invalid', 'exit', 'timeout', 'capacity']) {
    const child = fakeChild(), checker = new OfflineGrammar(directory, { spawnProcess: () => child, timeout: failure === 'timeout' ? 30 : 30000 });
    const requests = Array.from({ length: failure === 'capacity' ? 32 : 1 }, () => checker.check({ language: 'en-US', texts: ['Synthetic.'] }));
    const settled = Promise.allSettled(requests);
    if (failure === 'invalid') child.stdout.write('not-json\n');
    if (failure === 'exit') child.emit('exit', 1);
    if (failure === 'capacity') {
      await assert.rejects(checker.check({ language: 'en-US', texts: ['Synthetic.'] }), /busy/);
      checker.stop();
    }
    if (failure === 'timeout') await new Promise(resolve => setTimeout(resolve, 60));
    const results = await settled;
    assert.ok(results.every(result => result.status === 'rejected'), failure);
    assert.equal(checker.pending.size, 0); assert.equal(checker.child, null);
  }
});

test('bundled rule process returns exact additional findings and shuts down', { skip: !available, timeout: 30000 }, async () => {
  const checker = new OfflineGrammar(directory);
  try {
    const texts = ['🙂 She waited. The dogs runs quickly.', 'Its not safe.', 'What it is is a mystery.', 'She walk home.',
      'Why were they mistakes?', 'Some countries have visa requirements.', 'How many cm are needed?',
      'Could you, like, do it live?', 'Abu Ubaidah lived there.', 'There is two miles to go.', 'There is ten dollars left.',
      'That being said, I do not want games I am actually playing and enjoying to cross over.', 'We are used to test the rules.'];
    const results = await checker.check({ language: 'en-US', texts });
    assert.ok(results[0].some(hint => hint.original === 'runs' && hint.replacement === 'run' && texts[0].slice(hint.from, hint.to) === 'runs'));
    assert.ok(results[1].some(hint => hint.original === 'Its' && hint.replacement === "It's"));
    assert.equal(results[2].some(hint => hint.original.includes('is is')), false);
    assert.ok(results[3].some(hint => hint.original === 'walk' && hint.alternatives.includes('walks')));
    for (let i = 4; i < texts.length; i++) assert.deepEqual(results[i], [], texts[i]);
    const gerund = await checker.check({ language: 'en-US', texts: ['She enjoys to swim in the lake.'] });
    assert.ok(gerund[0].some(hint => hint.original === 'enjoys to swim' && hint.replacement === 'enjoys swimming'));
    const emoji = ['🙂 The dogs runs quickly.', 'She waited. 🙂 The dogs runs quickly.', '🙂🤝 The dogs runs quickly.'];
    const emojiResults = await checker.check({ language: 'en-GB', texts: emoji });
    for (let i = 0; i < emoji.length; i++) {
      assert.ok(emojiResults[i].some(hint => hint.original === 'runs' && hint.replacement === 'run'), emoji[i]);
      assert.ok(emojiResults[i].every(hint => emoji[i].slice(hint.from, hint.to) === hint.original && !hint.original.includes('🙂')), 'Suggestions cannot cross a masked emoji');
    }
    const fiction = ['The branches on it were green.', 'She thought this a good idea.', 'It was not a bit cold.',
      'If it please the court, I will stay.', 'Any one of them may leave.', 'They went down stairs.',
      'What sort of a creature is that?', 'They must needs leave.', 'It was worth while waiting.',
      '“I cannot go no lower,” said the stranger.', 'She thought it an opportunity.', 'He had not time to answer.',
      'Let my friend and me talk.', 'The meeting was put an end to by the guests.', 'They might by this time have left.', 'The entail was inherited.'];
    const fictionResults = await checker.check({ language: 'en-GB', texts: fiction });
    for (let i = 0; i < fiction.length; i++) assert.deepEqual(fictionResults[i], [], fiction[i]);
    const moreFiction = ['He had been afraid even to ask.', 'I cannot help being tired.', 'They stood near by.',
      'A head shot up.', 'The cannon ball was heavy.', 'She made a hole in the left side of the box.'];
    const moreFictionResults = await checker.check({ language: 'en-GB', texts: moreFiction });
    for (let i = 0; i < moreFiction.length; i++) assert.deepEqual(moreFictionResults[i], [], moreFiction[i]);
    const stillMore = ['He was a best man at the wedding.', 'They were vulnerable from above.', 'I had occasion to visit.',
      'He was accustomed to keep a diary.', 'If I were to leave, she would stay.', 'She thought it time to leave.',
      'A trouble which cannot be solved remains.', 'They emigrated to America.', 'They earned a couple of hundred a year.'];
    const stillMoreResults = await checker.check({ language: 'en-GB', texts: stillMore });
    for (let i = 0; i < stillMore.length; i++) assert.deepEqual(stillMoreResults[i], [], stillMore[i]);
    const narrative = ['If it be so, let her speak.', 'Why could not he keep walking?',
      'Your coming to the village was a surprise.', 'On the evening before the journey, she left.',
      'I had rather stay at home.', 'She could not prevent its frequently recurring.',
      'May I ask to what these questions tend?', 'I shall think the worse of you for it.',
      'It had a character of its own.', 'The river was at its very highest.', 'I could feel its hard, rough surface.',
      'The chair had its back turned towards the window.', 'It was a large sum for people in their position.',
      'We will use it for want of a better plan.', 'She would always be true to him.', 'It was sheer frenzy.',
      'The reasoning ran from cause to effect.', 'They thought about it in less than no time.'];
    const narrativeResults = [];
    for (let offset = 0; offset < narrative.length; offset += 16) narrativeResults.push(...await checker.check({ language: 'en-GB', texts: narrative.slice(offset, offset + 16) }));
    for (let i = 0; i < narrative.length; i++) assert.deepEqual(narrativeResults[i], [], narrative[i]);
    const participle = await checker.check({ language: 'en-GB', texts: ['She was angry at being spoke to.'] });
    assert.ok(participle[0].some(hint => hint.original === 'spoke' && hint.replacement === 'spoken'));
    const swedish = ['🙂 Det var ett mörk kväll.', 'Det var en mörkt rum.', 'Han brukade att komma sent.', 'Det var en mörk kväll.', 'Det var ett mörkt rum.', 'Han brukade komma sent.'];
    const swedishResults = await checker.check({ language: 'sv-SE', texts: swedish });
    assert.ok(swedishResults[0].some(hint => hint.original === 'ett mörk kväll' && hint.replacement === 'en mörk kväll' && swedish[0].slice(hint.from, hint.to) === hint.original));
    assert.ok(swedishResults[1].some(hint => hint.replacement === 'ett mörkt rum'));
    assert.ok(swedishResults[2].some(hint => hint.replacement === 'brukade'));
    for (let i = 3; i < swedish.length; i++) assert.deepEqual(swedishResults[i], [], swedish[i]);
  } finally { checker.stop(); }
  assert.equal(checker.child, null);
});
