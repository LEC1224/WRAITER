"""Extract a deterministic evaluation sample from the bundled LT source.

The examples exercise LT's own rules, so results are not an independent test
of LanguageTool or evidence of parity with another editor. This script never
reads the author's documents. Output belongs in disposable test-output/.
"""
import json
import random
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
source = root / 'build/offline-grammar/payload/sources/language-en-6.8-sources.jar'
destination = Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'test-output/grammar-examples.json'
limit = int(sys.argv[2]) if len(sys.argv) > 2 else 1500

with zipfile.ZipFile(source) as archive:
    xml = ET.fromstring(archive.read('org/languagetool/rules/en/grammar.xml'))

positives, negatives = [], []
def visit(element, rule_id='', disabled=False):
    rule_id = element.get('id', rule_id)
    disabled = disabled or element.get('default') in ('off', 'temp_off')
    if element.tag == 'example' and not disabled:
        pieces, spans = [], []
        def collect(node):
            if node.text:
                pieces.append(node.text)
            for child in node:
                start = len(''.join(pieces).encode('utf-16-le')) // 2
                collect(child)
                end = len(''.join(pieces).encode('utf-16-le')) // 2
                if child.tag == 'marker':
                    spans.append((start, end))
                if child.tail:
                    pieces.append(child.tail)
        collect(element)
        text = ''.join(pieces)
        if not text.strip() or len(text) > 2000:
            return
        if 'correction' in element.attrib and len(spans) == 1 and spans[0][0] < spans[0][1]:
            positives.append({'rule': rule_id, 'text': text, 'from': spans[0][0], 'to': spans[0][1], 'correction': element.get('correction')})
        elif 'correction' not in element.attrib and element.get('type') != 'incorrect' and not spans:
            negatives.append({'rule': rule_id, 'text': text})
        return
    for child in element:
        visit(child, rule_id, disabled)

for category in xml.findall('category'):
    if category.get('id') == 'GRAMMAR':
        visit(category)

randomizer = random.Random(20261110)
randomizer.shuffle(positives)
randomizer.shuffle(negatives)
def diverse(values):
    selected, rules, texts = [], set(), set()
    for value in values:
        if value['rule'] in rules or value['text'] in texts:
            continue
        rules.add(value['rule']); texts.add(value['text']); selected.append(value)
        if len(selected) >= limit:
            break
    return selected

sample = {'source': 'LanguageTool 6.8 English GRAMMAR rule examples', 'positive': diverse(positives), 'negative': diverse(negatives)}
destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_text(json.dumps(sample, ensure_ascii=False), encoding='utf-8')
print(json.dumps({'positive': len(sample['positive']), 'negative': len(sample['negative']), 'destination': str(destination)}))
