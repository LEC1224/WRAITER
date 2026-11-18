import { openDocument } from '../cloud-vault.js';
import { request } from './api.js';

const encoder = new TextEncoder();
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => { let value = n; for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1; return value >>> 0; });
function header(length, fields) { const data = new Uint8Array(length), view = new DataView(data.buffer); for (const [offset, value, size = 4] of fields) size === 2 ? view.setUint16(offset, value, true) : view.setUint32(offset, value, true); return data; }
function safeTitle(title) {
  let value = String(title || 'Untitled manuscript').normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '').replace(/[ .]+$/g, '').trim().slice(0, 110);
  if (!value) value = 'Untitled manuscript';
  if (/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(value)) value = '_' + value;
  return value;
}
const stopped = signal => signal?.throwIfAborted();
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

// ZIP32 with streamed entries and data descriptors. At most one decrypted
// document is processed at a time; supported browsers write straight to disk.
export async function writeLibraryArchive({ documents, userId, key, onProgress = () => {}, signal, loadDocument = id => request('/api/documents/' + encodeURIComponent(id)) }, write) {
  if (!key || !userId) throw new Error('Unlock your document library before downloading it.');
  if (!Array.isArray(documents) || !documents.length) throw new Error('Your library has no documents to download.');
  if (documents.length > 32760) throw new Error('This library has too many documents for a single ZIP archive.');
  const directory = [], names = new Set(), manifest = []; let bytes = 0, completed = 0, currentTitle = '';
  const emit = async chunk => { stopped(signal); await write(chunk); bytes += chunk.byteLength; if (bytes > 0xffffffff) throw new Error('This library exceeds the supported ZIP size.'); };
  const progress = () => onProgress({ completed, total: documents.length, currentTitle, bytes });
  async function add(name, content) {
    stopped(signal); const nameBytes = encoder.encode(name), input = typeof content === 'string' ? encoder.encode(content) : content;
    let crc = 0xffffffff;
    for (let offset = 0; offset < input.length; offset++) { crc = crcTable[(crc ^ input[offset]) & 255] ^ (crc >>> 8); if (offset && offset % (1024 * 1024) === 0) { stopped(signal); await tick(); } }
    crc = (crc ^ 0xffffffff) >>> 0;
    let compression; try { compression = new CompressionStream('deflate-raw'); } catch {}
    const method = compression ? 8 : 0, start = bytes, now = new Date(), year = Math.max(1980, Math.min(2107, now.getFullYear())), time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1), date = ((year - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    await emit(header(30, [[0, 0x04034b50], [4, 20, 2], [6, 0x0808, 2], [8, method, 2], [10, time, 2], [12, date, 2], [26, nameBytes.length, 2]])); await emit(nameBytes);
    const dataStart = bytes;
    if (compression) {
      const reader = new Blob([input]).stream().pipeThrough(compression).getReader();
      try { while (true) { stopped(signal); const result = await reader.read(); if (result.done) break; await emit(result.value); } }
      catch (error) { await reader.cancel().catch(() => {}); throw error; }
      finally { reader.releaseLock(); }
    } else for (let offset = 0; offset < input.length; offset += 65536) { await emit(input.subarray(offset, offset + 65536)); if (offset % (1024 * 1024) === 0) await tick(); }
    const compressed = bytes - dataStart;
    await emit(header(16, [[0, 0x08074b50], [4, crc], [8, compressed], [12, input.length]]));
    directory.push({ nameBytes, start, method, time, date, crc, compressed, size: input.length });
  }
  progress();
  for (const item of documents) {
    stopped(signal); currentTitle = item.title || 'Untitled manuscript'; progress();
    const detail = await loadDocument(item.id); stopped(signal);
    if (!detail?.sealed) throw new Error('Finish encrypting your library before downloading it.');
    const { project, journal } = await openDocument(key, userId, item.id, detail.sealed);
    let base = safeTitle(project.title), stem = base, number = 1;
    while (names.has(stem.toLocaleLowerCase('en-US'))) stem = `${base} (${++number})`;
    names.add(stem.toLocaleLowerCase('en-US'));
    const documentPath = `documents/${stem}.wraiter`, historyPath = `history/${stem}.json`, portable = { ...project }; delete portable.historySequence;
    await add(documentPath, JSON.stringify(portable, null, 2));
    await add(historyPath, JSON.stringify({ projectId: project.id, historySequence: project.historySequence ?? null, journal }, null, 2));
    manifest.push({ id: item.id, projectId: project.id, title: project.title, document: documentPath, history: historyPath, revision: detail.revision });
    completed++; progress();
  }
  await add('manifest.json', JSON.stringify({ format: 'wraiter-library', version: 1, exportedAt: new Date().toISOString(), documents: manifest }, null, 2));
  await add('README.txt', 'Extract this ZIP, then open the .wraiter files in the documents folder with WRAITER desktop.\n\nThe files contain your manuscript, references, conversations and embedded checkpoints. New local undo history starts when you open a file. The history folder retains the original cloud editing journals as an additional backup.\n\nThis ZIP contains decrypted documents. Keep it private. It does not contain account passwords, API keys or document recovery keys.\n');
  const centralStart = bytes;
  for (const item of directory) {
    await emit(header(46, [[0, 0x02014b50], [4, 20, 2], [6, 20, 2], [8, 0x0808, 2], [10, item.method, 2], [12, item.time, 2], [14, item.date, 2], [16, item.crc], [20, item.compressed], [24, item.size], [28, item.nameBytes.length, 2], [42, item.start]])); await emit(item.nameBytes);
  }
  const centralBytes = bytes - centralStart;
  await emit(header(22, [[0, 0x06054b50], [8, directory.length, 2], [10, directory.length, 2], [12, centralBytes], [16, centralStart]]));
  return { count: completed, bytes };
}

export async function exportLibrary(options) {
  const day = new Date(), date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`, filename = `WRAITER Library - ${date}.zip`;
  let writable;
  if (typeof window.showSaveFilePicker === 'function') {
    // Keep this before the first asynchronous document load to retain the click's
    // user activation. A cancelled picker must not start any library requests.
    const handle = await window.showSaveFilePicker({ suggestedName: filename, types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }] });
    writable = await handle.createWritable();
  }
  const parts = [];
  try {
    const result = await writeLibraryArchive(options, chunk => writable ? writable.write(chunk) : parts.push(chunk));
    stopped(options.signal);
    if (writable) await writable.close();
    else {
      const blob = new Blob(parts, { type: 'application/zip' }), url = URL.createObjectURL(blob), link = document.createElement('a'); parts.length = 0;
      link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
    return { filename, ...result, streamed: Boolean(writable) };
  } catch (error) { parts.length = 0; await writable?.abort().catch(() => {}); throw error; }
}
