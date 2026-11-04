class ContinuationError extends Error {
  constructor(reason = 'empty', message = 'The model did not return a usable story continuation. Try another suggestion.') {
    super(message);
    this.name = 'ContinuationError';
    this.code = 'INVALID_CONTINUATION';
    this.reason = reason;
  }
}

const invalid = reason => { throw new ContinuationError(reason); };
const protocol = /<\|(?:im_start|im_end|im_sep|start_header_id|end_header_id|eot_id|end_of_text|endoftext|begin_of_text|startoftext|start|end|message|channel|recipient|fim_prefix|fim_middle|fim_suffix|assistant|user|system|analysis|final)[^<>]*\|>|\[\/?INST\]|<<\/?SYS>>|<\/?(?:s|assistant|user|system|developer|analysis|final)>|\[\s*(?:end of text|end of response|done)\s*\]/gi;
const statusOnly = /^(?:complete[.!]?|completed[.!]?|continue[.!]?|continuation[.!]?|done[.!]?|ready[.!]?|success[.!]?|ok(?:ay)?[.!]?|sure[.!]?|no (?:continuation|output)[.!]?|n\/a|null|undefined)$/i;
const labelWrapper = /^\s*(?:(?:#{1,6}\s+)?(?:completion|suggestion|insert|continuation|possible continuation|story continuation|replacement|revision|revised text)\s*:[ \t]*(?:\n[ \t]*)?|#{1,6}\s+(?:continuation|suggestion|completion)[ \t]*\n[ \t]*)/i;
const sentenceWrapper = /^\s*(?:(?:sure|certainly|of course)[,!:.]?\s+)?here(?:['’]s| is)\s+(?:(?:the|a|your|requested)\s+)?(?:continuation(?:\s+of (?:the|your) (?:story|passage|text))?|next (?:paragraph|part)|continued (?:story|passage|text))\s*:[ \t]*(?:\n[ \t]*)?/i;
const bareWrapper = /^(?:(?:sure|certainly|of course)[,!:.]?\s+)?here(?:['’]s| is)\s+(?:(?:the|a|your|requested)\s+)?(?:continuation(?:\s+of (?:the|your) (?:story|passage|text))?|next (?:paragraph|part)|continued (?:story|passage|text))[.!:]?$/i;

// Match labels plus a specific signal of model commentary. Ordinary prose about
// a technique, and characters saying words such as "Analysis:", remain valid.
const metadata = [
  /(?:^|\n)[ \t]*(?:#{1,6}[ \t]*)?(?:assistant|user|system|developer|human|tool)[ \t]*:/gim,
  /(?:^|\n)[ \t]*(?:#{1,6}[ \t]*)?(?:analysis|reasoning|explanation|commentary|technique)[ \t]*:/gim,
  /\b(?:technique|analysis|reasoning|explanation|commentary|style|notes?|author['’]s note)[ \t]*:[ \t]*(?:(?:this|the)\s+(?:passage|continuation|response|excerpt|text|scene|story)\b|in this (?:passage|continuation|response|excerpt|text)\b)/gi,
  /(?:^|\n|(?<=[.!?])[ \t]+)(?:this|the)\s+(?:continuation|response|excerpt)\s+(?:uses|employs|demonstrates|maintains|introduces|follows|adds|combines|provides|is written)\b/gi,
  /(?:^|\n)[ \t]*(?:#{1,6}[ \t]*)?(?:text before cursor|text after cursor|selected text|reference material)[ \t]*:/gim,
  /(?:^|\n)[ \t]*(?:as an ai(?: language model)?\b|i (?:cannot|can't|am unable to) (?:continue|write|provide) (?:the|your|a) (?:story|continuation|passage)\b)/gi
];

function quoteAt(text, index, initialQuote = null, start = 0) {
  let quote = initialQuote;
  for (let offset = start; offset < index; offset++) {
    const char = text[offset];
    if (char === '"' && text[offset - 1] !== '\\') quote = quote === '"' ? null : quote || '"';
    else if (char === "'" && text[offset - 1] !== '\\' && !(/[\p{L}\p{N}]/u.test(text[offset - 1] || '') && /[\p{L}\p{N}]/u.test(text[offset + 1] || ''))) {
      if (quote === "'") quote = null;
      else if (!quote && !/[\p{L}\p{N}]/u.test(text[offset - 1] || '')) quote = "'";
    }
    else if (['“', '‘', '«', '„', '「', '『'].includes(char) && !quote) quote = ({ '“': '”', '‘': '’', '«': '»', '„': '“', '「': '」', '『': '』' })[char];
    else if (quote === char) quote = null;
  }
  return quote;
}

function metadataCutoff(text, initialQuote) {
  let cutoff = text.length;
  for (const pattern of metadata) {
    pattern.lastIndex = 0;
    let quote = initialQuote, position = 0;
    for (const match of text.matchAll(pattern)) {
      if (match.index >= cutoff) break;
      const labelStart = match.index + (match[0].match(/^\s*/)?.[0].length || 0);
      quote = quoteAt(text, labelStart, quote, position);
      position = labelStart;
      if (!quote) cutoff = match.index;
    }
  }
  return cutoff;
}

function removeThinking(text) {
  // Closed blocks can be discarded; an unfinished block cannot be separated
  // reliably from its reasoning and must never be shown as a suggestion.
  const tags = /<\/?(?:think|thinking)(?:\s[^<>]*)?>/gi;
  let depth = 0, start = 0, cursor = 0, result = '';
  for (const match of text.matchAll(tags)) {
    if (/^<\//.test(match[0])) {
      if (!depth) invalid('unclosed-thinking');
      if (!--depth) cursor = match.index + match[0].length;
    } else {
      if (!depth) { start = match.index; result += text.slice(cursor, start); }
      depth++;
    }
  }
  if (depth) invalid('unclosed-thinking');
  result += text.slice(cursor);
  if (/<\/?(?:think|thinking)(?=[\s>/]|$)/i.test(result)) invalid('unclosed-thinking');
  return result;
}

function removeWrappers(text) {
  let result = text;
  // Bound this loop so malformed wrapper repetition cannot monopolize cleanup.
  for (let attempt = 0; attempt < 4; attempt++) {
    const next = result.replace(labelWrapper, '').replace(sentenceWrapper, '');
    if (next === result) break;
    result = next;
  }
  const fenced = result.match(/^\s*```(?:text|prose|plaintext|markdown)?[ \t]*\n([\s\S]*?)\n?```[ \t]*$/i);
  if (fenced) result = fenced[1];
  else if (/^\s*```/.test(result)) invalid('unclosed-fence');
  return result;
}

const MAX_CONTINUATION_CHARACTERS = 64 * 1024;
const ECHO_CONTEXT_CHARACTERS = 16 * 1024;
const ECHO_WORDS = 8;

function lexicalWords(text) {
  // Apostrophes within words are ignored as well as dialogue punctuation, so
  // straight/curly quotes and a changed ellipsis cannot disguise copied prose.
  return text.replace(/(?<=[\p{L}\p{N}])['’](?=[\p{L}\p{N}])/gu, '').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu) || [];
}

function sameWords(left, leftStart, right, rightStart, length) {
  for (let offset = 0; offset < length; offset++) if (left[leftStart + offset] !== right[rightStart + offset]) return false;
  return true;
}

function echoedContext(candidate, before) {
  const context = lexicalWords(before.slice(-ECHO_CONTEXT_CHARACTERS));
  // An exact multiword suffix alone is an echo; one repeated word or a short
  // dialogue response is not sufficient evidence.
  if (candidate.length >= 4 && candidate.length <= context.length && new Set(candidate).size >= 3 && candidate.join('').length >= 16 && sameWords(candidate, 0, context, context.length - candidate.length, candidate.length)) return true;
  if (candidate.length < ECHO_WORDS || context.length < ECHO_WORDS) return false;
  const windows = new Set();
  for (let offset = 0; offset <= context.length - ECHO_WORDS; offset++) {
    const words = context.slice(offset, offset + ECHO_WORDS);
    if (new Set(words).size >= 4 && words.join('').length >= 32) windows.add(words.join('\x1f'));
  }
  // Check the whole suggestion, including copied paragraphs followed by fresh
  // prose. Keep the original text intact and retry instead of guessing a cut.
  for (let offset = 0; offset <= candidate.length - ECHO_WORDS; offset++) {
    if (windows.has(candidate.slice(offset, offset + ECHO_WORDS).join('\x1f'))) return true;
  }
  return false;
}

function repeatedOutput(words) {
  if (words.length < 12) return false;
  const ids = new Map(), values = new Uint32Array(words.length), prefix = new Uint32Array(words.length + 1), powers = new Uint32Array(words.length + 1);
  powers[0] = 1;
  for (let offset = 0; offset < words.length; offset++) {
    if (!ids.has(words[offset])) ids.set(words[offset], ids.size + 1);
    values[offset] = ids.get(words[offset]);
    prefix[offset + 1] = (Math.imul(prefix[offset], 16777619) + values[offset]) >>> 0;
    powers[offset + 1] = Math.imul(powers[offset], 16777619) >>> 0;
  }
  const hash = (start, length) => (prefix[start + length] - Math.imul(prefix[start], powers[length])) >>> 0;
  const identical = (start, next, length) => hash(start, length) === hash(next, length) && sameWords(values, start, values, next, length);
  // Allow everyday emphasis and short refrains. Short periods need many repeats;
  // long sentences/paragraphs need two complete consecutive copies.
  for (let period = 1; period < ECHO_WORDS; period++) {
    const repeats = period === 1 ? 12 : period <= 3 ? 6 : period <= 5 ? 4 : 3;
    for (let start = 0; start + period * repeats <= words.length; start++) {
      let repeated = true;
      for (let copy = 1; copy < repeats; copy++) {
        if (!identical(start, start + period * copy, period)) { repeated = false; break; }
      }
      if (repeated) return true;
    }
  }
  const seen = new Map();
  for (let start = 0; start + ECHO_WORDS <= words.length; start++) {
    const key = hash(start, ECHO_WORDS), previous = seen.get(key) || [];
    for (const prior of previous) {
      const period = start - prior;
      if (period >= ECHO_WORDS && start + period <= words.length && identical(prior, start, period)) return true;
    }
    // Retain only a few recent candidates per hash. This bounds collision and
    // repetitive-prefix work, while shorter periodic loops are handled above.
    previous.push(start);
    if (previous.length > 4) previous.shift();
    seen.set(key, previous);
  }
  return false;
}

function singleWordInSentence(text, before, request) {
  // "complete" can be the requested next word in "The job was ". A bare
  // command from a normal multiword request is still rejected.
  return Number(request?.words) === 1 && /^[\p{L}\p{N}]+[.!]?$/u.test(text.trim()) &&
    /[\p{L}\p{N}]$/u.test(before.trimEnd()) && (/\s$/u.test(before) || /^\s/u.test(text));
}

function cleanContinuation(text, request = {}) {
  if (typeof text !== 'string') invalid('empty');
  // A 500-word prediction has no reason to approach this generous limit. Bound
  // allocations and metadata scanning before processing an oversized response.
  if (text.length > MAX_CONTINUATION_CHARACTERS) {
    if (repeatedOutput(lexicalWords(text.slice(0, MAX_CONTINUATION_CHARACTERS)))) invalid('repetition');
    invalid('oversized');
  }
  let result = removeThinking(text.replace(/\r\n?/g, '\n'));
  result = removeWrappers(result);
  protocol.lastIndex = 0;
  const token = protocol.exec(result);
  if (token) result = result.slice(0, token.index).trimEnd();
  const before = typeof request?.before === 'string' ? request.before : '';
  const cutoff = metadataCutoff(result, quoteAt(before, before.length));
  if (cutoff < result.length) result = result.slice(0, cutoff).trimEnd();
  const content = result.trim();
  const status = content.replace(/^(?:\*\*?|__?|`)([\s\S]*?)(?:\*\*?|__?|`)$/, '$1').trim();
  if (!/[\p{L}\p{N}]/u.test(content)) invalid('empty');
  if ((statusOnly.test(status) && !singleWordInSentence(result, before, request)) || bareWrapper.test(content)) invalid('status');
  const words = lexicalWords(result);
  if (echoedContext(words, before)) invalid('echo');
  if (repeatedOutput(words)) invalid('repetition');
  return result;
}

module.exports = { cleanContinuation, ContinuationError };
