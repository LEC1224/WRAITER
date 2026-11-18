// Match the editor's 26% highlight opacity. Publication formats use the final
// blended colour, including formats such as DOCX that cannot store opacity.
export const HIGHLIGHT_OPACITY = 0.26;
export const LIGHT_PAGE = '#ffffff';
export const DARK_PAGE = '#1b1d20';

let context;
const parsedColours = new Map();
export function colourRGBA(value) {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase();
  if (parsedColours.has(key)) return parsedColours.get(key);
  let result = null;
  const hex = key.match(/^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i);
  if (hex) {
    const digits = hex[1].length < 5 ? [...hex[1]].map(n => n + n).join('') : hex[1];
    result = [0, 2, 4].map(index => parseInt(digits.slice(index, index + 2), 16));
    result.push(digits.length === 8 ? parseInt(digits.slice(6), 16) / 255 : 1);
  } else if (typeof document !== 'undefined' && CSS.supports('color', key) && !/var\(|currentcolor|inherit|initial|unset/i.test(key)) {
    context ||= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    if (context) {
      context.clearRect(0, 0, 1, 1); context.fillStyle = key; context.fillRect(0, 0, 1, 1);
      const bytes = [...context.getImageData(0, 0, 1, 1).data];
      result = [...bytes.slice(0, 3), bytes[3] / 255];
    }
  }
  if (parsedColours.size >= 512) parsedColours.clear();
  parsedColours.set(key, result);
  return result;
}

export function blendColour(value, background = LIGHT_PAGE, opacity = 1) {
  const colour = colourRGBA(value), paper = colourRGBA(background);
  if (!colour || !paper) return background;
  const alpha = colour[3] * opacity;
  return '#' + colour.slice(0, 3).map((channel, index) => Math.round(channel * alpha + paper[index] * (1 - alpha)).toString(16).padStart(2, '0')).join('');
}

export function luminance(value) {
  const rgb = colourRGBA(value);
  if (!rgb) return 0;
  const linear = rgb.slice(0, 3).map(channel => { const n = channel / 255; return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; });
  return linear.reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
}

export function contrastRatio(first, second) {
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function highlightAppearance(value, background = LIGHT_PAGE) {
  const fill = blendColour(value, background, HIGHLIGHT_OPACITY);
  const color = contrastRatio('#000000', fill) >= contrastRatio('#ffffff', fill) ? '#000000' : '#ffffff';
  return { background: fill, color };
}

// Office runs can carry both an imported background and a highlight. Apply
// the layers in the same order as the editor's outer span and inner mark.
export function highlightedRun(marks, background = LIGHT_PAGE) {
  const style = marks.find(mark => mark.type === 'textStyle')?.attrs || {};
  const highlight = marks.find(mark => mark.type === 'highlight');
  let result = style.backgroundColor ? highlightAppearance(style.backgroundColor, background) : null;
  if (highlight) result = highlightAppearance(highlight.attrs?.color || '#fff29b', result?.background || background);
  return result;
}

export function applyPublicationHighlights(container, background = LIGHT_PAGE) {
  const visit = (element, paper, textColour = null) => {
    const highlighted = element.tagName === 'MARK' || element.hasAttribute('data-wraiter-background');
    if (highlighted) {
      const source = element.style.backgroundColor || element.getAttribute('data-color') || '#fff29b';
      const appearance = highlightAppearance(source, paper);
      paper = appearance.background; textColour = appearance.color;
      element.style.backgroundColor = paper;
    } else if (element.style.backgroundColor) paper = blendColour(element.style.backgroundColor, paper);
    // Inline colour beats named styles and nested links on highlighted text.
    if (textColour) element.style.color = textColour;
    for (const child of element.children) visit(child, paper, textColour);
  };
  for (const element of container.children) visit(element, background);
  return container;
}
