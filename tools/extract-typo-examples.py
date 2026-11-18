"""Select a deterministic, prose-like diagnostic from GitHub Typo Corpus 1.0.

The upstream data and its texts retain their individual repositories' licenses.
Keep the downloaded corpus and extracted examples as local test artifacts, not
application assets. This automatically classified data is noisy and mostly
technical writing; it is not a fiction corpus or a commercial-checker comparison.
"""
import difflib
import gzip
import hashlib
import json
import re
import sys

source = sys.argv[1] if len(sys.argv) > 1 else 'tmp/github-typo-corpus.v1.0.0.jsonl.gz'
output = sys.argv[2] if len(sys.argv) > 2 else 'test-output/github-typo-examples.json'
limit = int(sys.argv[3]) if len(sys.argv) > 3 else 2000
candidates = {}
with gzip.open(source, 'rt', encoding='utf-8') as stream:
    for line in stream:
        record = json.loads(line)
        for edit in record.get('edits', []):
            before, after = edit.get('src', {}), edit.get('tgt', {})
            text, corrected = before.get('text', '').strip(), after.get('text', '').strip()
            if before.get('lang') != 'eng' or after.get('lang') != 'eng' or edit.get('prob_typo', 0) < 0.9:
                continue
            if not re.search(r'\.(?:md|txt|rst)$', before.get('path', ''), re.I):
                continue
            if not 25 <= len(text) <= 350 or not text.isascii() or not corrected.isascii():
                continue
            if not re.fullmatch(r'[A-Z][A-Za-z0-9 ,.;:!?\'"()/-]*[.!?]', text):
                continue
            if not re.fullmatch(r'[A-Z][A-Za-z0-9 ,.;:!?\'"()/-]*[.!?]', corrected):
                continue
            changes = [item for item in difflib.SequenceMatcher(None, text, corrected, autojunk=False).get_opcodes() if item[0] != 'equal']
            if len(changes) != 1:
                continue
            _, start, end, replacement_start, replacement_end = changes[0]
            if start == end or replacement_start == replacement_end or end - start > 30:
                continue
            item = {'text': text, 'from': start, 'to': end, 'correction': corrected[replacement_start:replacement_end]}
            key = hashlib.sha256((text + '\0' + corrected).encode()).hexdigest()
            candidates.setdefault(key, (item, {'text': corrected}))
selected = [candidates[key] for key in sorted(candidates)[:limit]]
data = {
    'source': 'GitHub Typo Corpus 1.0: deterministic high-confidence, sentence-like English documentation edits',
    'note': 'Machine-classified real edits, not manually adjudicated labels; corrected text can contain other errors. Technical prose, not fiction.',
    'upstream': 'https://github.com/mhagiwara/github-typo-corpus',
    'availableCandidates': len(candidates),
    'positive': [pair[0] for pair in selected],
    'negative': [pair[1] for pair in selected],
}
with open(output, 'w', encoding='utf-8') as stream:
    json.dump(data, stream, ensure_ascii=False)
print(f'Selected {len(selected)} of {len(candidates)} distinct candidate pairs into {output}.')
