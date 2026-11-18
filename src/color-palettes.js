export const RECENT_COLOUR_LIMIT = 12;
export const COLOUR_PRESETS = {
  highlight: [
    ['Yellow', '#fff29b'], ['Green', '#8de5a1'], ['Blue', '#8bc7ff'], ['Pink', '#ff9ecb'],
    ['Orange', '#ffbe79'], ['Purple', '#c6adff'], ['Red', '#ff9292'], ['Grey', '#b9c0ca']
  ],
  text: [
    ['Black', '#000000'], ['White', '#ffffff'], ['Grey', '#808080'], ['Red', '#d32f2f'],
    ['Orange', '#ed6c02'], ['Green', '#2e7d32'], ['Blue', '#1565c0'], ['Purple', '#7b1fa2']
  ]
};

export const paletteStorageKey = kind => `wraiter.colour-palette.${kind}.v1`;
const hex = value => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value.toLowerCase() : null;
const uniqueColours = values => [...new Set((Array.isArray(values) ? values : []).map(hex).filter(Boolean))];

export function normalizePalette(value, kind) {
  const defaults = new Set(COLOUR_PRESETS[kind].map(([, colour]) => colour));
  const locked = uniqueColours(value?.locked).filter(colour => !defaults.has(colour));
  const selected = new Set([...defaults, ...locked]);
  const recent = uniqueColours(value?.recent).filter(colour => !selected.has(colour)).slice(0, RECENT_COLOUR_LIMIT);
  return { locked, recent };
}

export function updatePalette(value, kind, action, colour) {
  const palette = normalizePalette(value, kind), chosen = hex(colour);
  if (!chosen || COLOUR_PRESETS[kind].some(([, preset]) => preset === chosen)) return palette;
  if (action === 'lock' && palette.recent.includes(chosen)) {
    return { locked: [...palette.locked, chosen], recent: palette.recent.filter(item => item !== chosen) };
  }
  if (action === 'unlock' && palette.locked.includes(chosen)) {
    return { locked: palette.locked.filter(item => item !== chosen), recent: [chosen, ...palette.recent].slice(0, RECENT_COLOUR_LIMIT) };
  }
  if (action === 'remember' && !palette.locked.includes(chosen)) {
    return { ...palette, recent: [chosen, ...palette.recent.filter(item => item !== chosen)].slice(0, RECENT_COLOUR_LIMIT) };
  }
  return palette;
}

export function readPalette(kind) {
  try { return normalizePalette(JSON.parse(localStorage.getItem(paletteStorageKey(kind))), kind); }
  catch { return normalizePalette(null, kind); }
}

export function writePalette(kind, palette) {
  try { localStorage.setItem(paletteStorageKey(kind), JSON.stringify(normalizePalette(palette, kind))); }
  catch { /* Picking colours remains available when preference storage is unavailable. */ }
}
