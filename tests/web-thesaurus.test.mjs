import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import desktop from '../electron/thesaurus.cjs';

test('browser dictionary matches bundled desktop lookups without transmitting selected words', async t => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    assert.match(url, /^\/assets\/thesaurus\/th_en_US_v2\.(idx|dat)\.gz$/);
    return new Response(await readFile(new URL('../assets/thesaurus/' + url.split('/').at(-1), import.meta.url)));
  });
  const { browserThesaurus } = await import('../src/web/thesaurus.js');
  for (const word of ['happy', 'book', 'write', 'quiet', 'zeal', 'aardvark', 'secret-unpublished-name']) {
    assert.deepEqual(await browserThesaurus(word, 'en-US'), await desktop.lookup(word, 'en-US'));
  }
  assert.equal(requests.length, 2, 'downloads each public corpus once');
  assert.ok(requests.every(item => item.options.credentials === 'omit' && !item.options.body));
  assert.deepEqual(await browserThesaurus('privat', 'sv-SE'), { available: false, senses: [] });
  assert.deepEqual(await browserThesaurus('bad\ninput', 'en-US'), { available: true, senses: [] });
  assert.equal(requests.length, 2, 'unsupported languages and invalid terms do not send requests');
});
