// Tab stops are left-aligned positions in points from the paragraph's text edge.
export function parseTabStops(text) {
  const source = String(text ?? '').trim(); if (!source) return [];
  const values = source.split(',').map(part => Number(part.trim()));
  if (values.length > 32 || values.some(value => !Number.isFinite(value) || value <= 0 || value > 1000)) throw new Error('Enter up to 32 tab positions between 0 and 1,000 pt, separated by commas.');
  return [...new Set(values.map(value => Math.round(value * 100) / 100))].sort((a,b) => a-b);
}
export function regularTabInterval(stops) {
  if (!Array.isArray(stops) || !stops.length || !Number.isFinite(stops[0]) || stops[0] <= 0) return null;
  return stops.every((value, index) => Math.abs(value - stops[0] * (index + 1)) < 0.01) ? stops[0] : null;
}
