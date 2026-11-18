const fs = require('node:fs');
const path = require('node:path');

const FUNCTION_WORDS = new Set("a an the and or but nor so yet for of on in at to from with by about over under between among into onto than then as if though although because since until unless whether that which who whom whose this these those it its it's he him his she her hers they them their theirs we us our ours i me my mine you your yours you're is are was were be been being am has have had do does did not no".split(' '));
const CONFUSIONS = new Set('advice advise affect effect accept except breath breathe loose lose past passed weather whether quiet quite were where then than there their they\'re your you\'re its it\'s'.split(' '));
const DELETE_WORDS = new Set('a an the of to for in on at that which it is are was were do does did have has had'.split(' '));
// Agreement tags specify number, not spelling. Keep known pairs for endings
// whose reverse transformation is ambiguous (movies/stories, heroes/shoes,
// wolves/curves), and abstain rather than inventing a singular from a suffix.
const pluralForms = {
  child:'children', person:'people', man:'men', woman:'women', mouse:'mice', tooth:'teeth', foot:'feet', goose:'geese',
  wolf:'wolves', leaf:'leaves', shelf:'shelves', knife:'knives', wife:'wives', life:'lives', half:'halves', calf:'calves', loaf:'loaves', thief:'thieves',
  scarf:'scarves', hoof:'hooves', elf:'elves', self:'selves',
  movie:'movies', cookie:'cookies', zombie:'zombies', brownie:'brownies', smoothie:'smoothies', calorie:'calories',
  selfie:'selfies', rookie:'rookies', prairie:'prairies', goalie:'goalies', hippie:'hippies', pie:'pies', tie:'ties', lie:'lies',
  story:'stories', city:'cities', country:'countries', party:'parties', family:'families', army:'armies', baby:'babies',
  lady:'ladies', body:'bodies', penny:'pennies', puppy:'puppies', berry:'berries', fairy:'fairies', memory:'memories',
  mystery:'mysteries', enemy:'enemies', ally:'allies', pony:'ponies', fly:'flies', reply:'replies', theory:'theories',
  hero:'heroes', potato:'potatoes', tomato:'tomatoes', echo:'echoes', veto:'vetoes',
  shoe:'shoes', toe:'toes', canoe:'canoes', curve:'curves', nerve:'nerves', serve:'serves',
  bus:'buses', gas:'gases', status:'statuses', campus:'campuses', virus:'viruses', quiz:'quizzes', fez:'fezzes',
  house:'houses', spouse:'spouses', blouse:'blouses', cause:'causes', pause:'pauses', excuse:'excuses', fuse:'fuses',
  beach:'beaches', bench:'benches', branch:'branches', church:'churches', coach:'coaches', lunch:'lunches',
  peach:'peaches', torch:'torches', watch:'watches', witch:'witches', ache:'aches', niche:'niches', quiche:'quiches',
  moustache:'moustaches', mustache:'mustaches', avalanche:'avalanches',
  class:'classes', boss:'bosses', glass:'glasses', guess:'guesses', mass:'masses', pass:'passes', dress:'dresses',
  mousse:'mousses', finesse:'finesses', impasse:'impasses',
  size:'sizes', prize:'prizes', maze:'mazes', gaze:'gazes', blaze:'blazes', breeze:'breezes', buzz:'buzzes', topaz:'topazes'
};
const singularForms = Object.fromEntries(Object.entries(pluralForms).map(([singular, plural]) => [plural, singular]));
const invariantNouns = new Set('sheep deer fish salmon trout moose bison offspring series species aircraft spacecraft watercraft information advice furniture equipment luggage baggage news physics mathematics politics economics measles mumps scissors trousers pants clothes'.split(' '));
const baseAux = new Set('can could may might must shall should will would do does did cannot'.split(' '));
const normalize = text => text.replaceAll('’', "'").toLowerCase();
const sameCase = (source, value) => source === source.toUpperCase() ? value.toUpperCase() : /^\p{Lu}/u.test(source) ? value[0]?.toUpperCase() + value.slice(1) : value;

function insideDialogue(text, position) {
  let quote = null;
  for (const match of text.slice(0, position).matchAll(/["“”‘’']/gu)) {
    const i = match.index, char = match[0];
    if (/['’]/u.test(char) && /[\p{L}\p{N}]/u.test(text[i - 1] || '') && /[\p{L}\p{N}]/u.test(text[i + 1] || '')) continue;
    if (!quote && /['’]/u.test(char) && /[\p{L}\p{N}]/u.test(text[i - 1] || '')) continue;
    if (quote && /['’]/u.test(char) && /s$/iu.test(text.slice(0, i)) && /^\s+\p{Ll}/u.test(text.slice(i + 1))) continue;
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'" || char === '“' || char === '‘') quote = ({ '“':'”', '‘':'’' })[char] || char;
  }
  return quote !== null;
}
function allowedEdit(text, word, replacement, tag) {
  // Development evaluation found high-confidence rewrites of deliberate
  // dialect. Leave dialogue to the established checks until trained otherwise.
  if (insideDialogue(text, word.from)) return false;
  const original = normalize(word.word), target = normalize(replacement);
  if (!/[\p{L}]/u.test(original) || !replacement && !DELETE_WORDS.has(original)) return false;
  if (/[\r\n\0\ufffc]/u.test(replacement) || replacement.length > 100) return false;
  if (tag.startsWith('$REPLACE_') && !FUNCTION_WORDS.has(original) && !FUNCTION_WORDS.has(target) &&
      !(CONFUSIONS.has(original) && CONFUSIONS.has(target))) return false;
  if (tag.startsWith('$APPEND_') && !FUNCTION_WORDS.has(target.split(' ').at(-1))) return false;
  if (tag.startsWith('$APPEND_') && ['a','an','the'].includes(target.split(' ').at(-1))) return false;
  if (tag === '$DELETE' && original === 'it' && /\bwhich\s*$/iu.test(text.slice(0, word.from))) return false;
  if (original === 'since' && target === 'for' && /^[^.!?;]*\bago\b/iu.test(text.slice(word.to))) return false;
  if (/\p{Lu}/u.test(word.word.slice(1)) || (/^\p{Lu}/u.test(word.word) && !FUNCTION_WORDS.has(original) &&
      !CONFUSIONS.has(original) && !/[.!?]["”’']?\s*$/u.test(text.slice(0, word.from)) && text.slice(0, word.from).trim())) return false;
  if (tag.startsWith('$TRANSFORM_VERB_')) {
    const previous = normalize(text.slice(0, word.from)).match(/[a-z]+(?:'[a-z]+)?/gu) || [];
    while (previous.length && /^(?:not|never|ever|just|already|really|yet|still|always)$/u.test(previous.at(-1))) previous.pop();
    const aux = previous.at(-1)?.replace(/n't$/u, '');
    const targetPOS = tag.split('_').at(-1);
    if ((baseAux.has(aux) || aux === 'to') && targetPOS !== 'VB') return false;
    if (['have','has','had'].includes(aux) && targetPOS !== 'VBN') return false;
  }
  // A noun used before another noun can be singular, and counted mass nouns
  // need a phrase such as "pieces of advice", not just a stripped final s.
  if (tag === '$TRANSFORM_AGREEMENT_SINGULAR' &&
      /\b(?:two|three|four|five|six|seven|eight|nine|ten|several|many|few)\b[^.!?,;:]{0,30}$/iu.test(text.slice(0, word.from))) return false;
  return replacement !== word.word;
}

class NeuralGrammarEngine {
  constructor(directory, { ort, Tokenizer } = {}) {
    this.directory = directory;
    this.ort = ort || require('onnxruntime-node');
    this.Tokenizer = Tokenizer || require('@huggingface/tokenizers').Tokenizer;
    this.tokenCache = new Map();
  }
  async setup() {
    if (this.session) return;
    const json = name => JSON.parse(fs.readFileSync(path.join(this.directory, name), 'utf8'));
    this.tokenizer = new this.Tokenizer(json('tokenizer.json'), {});
    const config = json('labels.json');
    this.labels = config.labels;
    this.limit = Math.min(256, Math.max(16, config.max_length || 80));
    this.verbs = new Map();
    for (const line of fs.readFileSync(path.join(this.directory, 'verb-form-vocab.txt'), 'utf8').split(/\r?\n/u)) {
      const match = /^([^_]+)_([^:]+):(.+)$/u.exec(line);
      if (match) this.verbs.set(match[1] + ':' + match[3], match[2]);
    }
    this.session = await this.ort.InferenceSession.create(path.join(this.directory, 'model.onnx'), {
      executionProviders: ['cpu'], intraOpNumThreads: 2, interOpNumThreads: 1, graphOptimizationLevel: 'all'
    });
  }
  tokens(word) {
    if (!this.tokenCache.has(word)) {
      if (this.tokenCache.size >= 4096) this.tokenCache.clear();
      this.tokenCache.set(word, this.tokenizer.encode(word, { add_special_tokens: false }).ids);
    }
    return this.tokenCache.get(word);
  }
  chunks(text) {
    const words = [...text.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*|[^\s]/gu)]
      .map(m => ({ word: m[0], from: m.index, to: m.index + m[0].length }));
    const chunks = [];
    for (let first = 0; first < words.length;) {
      let end = first, length = 3, lastSentence = -1;
      while (end < words.length && length + this.tokens(words[end].word).length <= this.limit) {
        length += this.tokens(words[end].word).length;
        if (/^[.!?]$/u.test(words[end].word)) lastSentence = end + 1;
        end++;
      }
      if (end === first) { first++; continue; }
      const artificial = end < words.length && lastSentence <= first;
      if (end < words.length && lastSentence > first) end = lastSentence;
      const chunkWords = words.slice(first, end), ids = [0, ...this.tokens('$START')], positions = [1];
      for (const word of chunkWords) { positions.push(ids.length); ids.push(...this.tokens(word.word)); }
      ids.push(2);
      chunks.push({ words: chunkWords, ids, positions, artificialStart: first > 0 && !/^[.!?]$/u.test(words[first - 1].word), artificialEnd: artificial });
      first = end;
    }
    return chunks;
  }
  decode(word, tag) {
    if (tag.startsWith('$REPLACE_')) return tag.slice(9);
    if (tag === '$DELETE') return '';
    if (tag.startsWith('$APPEND_')) return word + ' ' + tag.slice(8);
    if (tag.startsWith('$TRANSFORM_VERB_')) {
      const value = this.verbs.get(normalize(word) + ':' + tag.slice(16));
      return value && sameCase(word, value);
    }
    if (tag === '$TRANSFORM_AGREEMENT_PLURAL' && /^[a-z]+$/iu.test(word)) {
      const lower = normalize(word);
      if (invariantNouns.has(lower)) return null;
      return sameCase(word, Object.hasOwn(pluralForms, lower) ? pluralForms[lower] :
        /[^aeiou]y$/u.test(lower) ? lower.slice(0, -1) + 'ies' : /(?:s|x|z|ch|sh)$/u.test(lower) ? lower + 'es' : lower + 's');
    }
    if (tag === '$TRANSFORM_AGREEMENT_SINGULAR') {
      const lower = normalize(word);
      if (invariantNouns.has(lower)) return null;
      if (Object.hasOwn(singularForms, lower)) return sameCase(word, singularForms[lower]);
      if (/(?:ss|us|is|ies|oes|ves|uses|sses|ches|zes)$/u.test(lower)) return null;
      if (/(?:xes|shes)$/u.test(lower)) return sameCase(word, lower.slice(0, -2));
      if (/s$/u.test(lower)) return word.slice(0, -1);
    }
    return null;
  }
  async close() {
    const session = this.session;
    this.session = null;
    await session?.release();
    this.tokenCache.clear();
  }
  async check(text, stopping = () => false) {
    await this.setup();
    if (stopping()) return [];
    const hints = [];
    for (const chunk of this.chunks(text)) {
      if (stopping()) return [];
      const { ids, words, positions } = chunk;
      const input_ids = new this.ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]);
      const attention_mask = new this.ort.Tensor('int64', BigInt64Array.from(ids, () => 1n), [1, ids.length]);
      let output;
      try {
        output = await this.session.run({ input_ids, attention_mask });
        const probabilities = output.label_probs.data, errors = output.error_probs.data, width = output.label_probs.dims[2];
        if (!positions.some(position => errors[position] >= .6)) continue;
        for (let i = 1; i < positions.length; i++) {
          // Keep edges of artificially truncated sentences quiet.
          if (chunk.artificialStart && i <= 3 || chunk.artificialEnd && i >= positions.length - 3) continue;
          const position = positions[i], word = words[i - 1];
          let best = 0;
          for (let label = 1; label < width; label++) if (probabilities[position * width + label] > probabilities[position * width + best]) best = label;
          const confidence = probabilities[position * width + best], tag = this.labels[best];
          if (confidence < .6 || tag === '$KEEP' || tag.startsWith('$TRANSFORM_CASE_')) continue;
          const replacement = this.decode(word.word, tag);
          if (replacement == null || !allowedEdit(text, word, replacement, tag)) continue;
          let from = word.from, to = word.to, original = word.word;
          if (replacement === '') {
            const trailing = /^[ \t]+/u.exec(text.slice(to));
            if (trailing) { to += trailing[0].length; original = text.slice(from, to); }
          }
          hints.push({ from, to, original, replacement, alternatives: [replacement],
            reason: 'Check this wording in its sentence context.', category: 'grammar', rule: 'neural:' + tag });
        }
      } finally {
        input_ids.dispose(); attention_mask.dispose();
        if (output) for (const tensor of Object.values(output)) tensor.dispose();
      }
    }
    return hints;
  }
}
module.exports = { NeuralGrammarEngine, allowedEdit, insideDialogue };



