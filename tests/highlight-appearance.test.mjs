import test from 'node:test';
import assert from 'node:assert/strict';
import { blendColour, colourRGBA, contrastRatio, highlightAppearance, highlightedRun } from '../src/highlight-appearance.js';

test('highlight opacity matches the editor and is flattened against the destination page', () => {
  assert.deepEqual(highlightAppearance('#000000'), { background: '#bdbdbd', color: '#000000' });
  assert.deepEqual(highlightAppearance('#ffffff', '#000000'), { background: '#424242', color: '#ffffff' });
  assert.deepEqual(highlightAppearance('#00000000', '#ffffff'), { background: '#ffffff', color: '#000000' });
  assert.equal(blendColour('#ff000080', '#ffffff', 0.26), '#ffdede');
  assert.deepEqual(colourRGBA('#ABC'), [170, 187, 204, 1]);
  assert.deepEqual(colourRGBA('#abcd'), [170, 187, 204, 221 / 255]);
  assert.equal(colourRGBA('not a colour'), null);
});

test('automatic text always chooses the higher contrast after blending, including midtone backgrounds', () => {
  let black = 0, white = 0;
  for (const page of ['#ffffff', '#1b1d20', '#000000', '#666666', '#808080', '#276e82']) {
    for (let r = 0; r <= 255; r += 51) for (let g = 0; g <= 255; g += 51) for (let b = 0; b <= 255; b += 51) {
      const source = '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
      const result = highlightAppearance(source, page), contrast = contrastRatio(result.color, result.background);
      assert.ok(contrast >= 4.5, JSON.stringify({ source, page, result, contrast }));
      assert.ok(contrast >= contrastRatio(result.color === '#000000' ? '#ffffff' : '#000000', result.background));
      if (result.color === '#000000') black++; else white++;
    }
  }
  assert.ok(black > 0 && white > 0);
});

test('imported background and highlight layers compose in editor order without modifying marks', () => {
  const marks = [{ type: 'textStyle', attrs: { color: '#cc0000', backgroundColor: '#0000ff' } }, { type: 'highlight', attrs: { color: '#00ff00' } }];
  const original = JSON.stringify(marks);
  const base = highlightAppearance('#0000ff');
  assert.deepEqual(highlightedRun(marks), highlightAppearance('#00ff00', base.background));
  assert.equal(JSON.stringify(marks), original);
  assert.equal(highlightedRun([{ type: 'textStyle', attrs: { color: '#ffffff' } }]), null);
  assert.deepEqual(highlightedRun([{ type: 'highlight' }]), highlightAppearance('#fff29b'));
});
