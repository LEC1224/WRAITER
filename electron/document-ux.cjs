const path = require('node:path');
function droppedPath(value, reference = false) {
  const extensions = reference ? ['txt', 'md'] : ['odt', 'docx', 'wraiter', 'txt', 'md', 'markdown', 'html', 'htm'];
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.length > 32768 || /[\x00-\x1f]/.test(value) || !extensions.includes(path.extname(value).slice(1).toLowerCase())) throw new Error(reference ? 'Drop a local Markdown or text reference file.' : 'Drop a local WRAITER, ODT, DOCX, Markdown, HTML or text document.');
  return value;
}
function externalLink(value) {
  if (typeof value !== 'string' || value.length > 8000 || /[\x00-\x20]/.test(value)) throw new Error('Use a valid http://, https:// or mailto: address.');
  let url; try { url = new URL(value); } catch { throw new Error('Use a valid http://, https:// or mailto: address.'); }
  if (!['http:', 'https:', 'mailto:'].includes(url.protocol) || (url.protocol === 'mailto:' ? !url.pathname : !url.hostname || url.username || url.password)) throw new Error('Use a valid http://, https:// or mailto: address.');
  return url.href;
}
module.exports = { droppedPath, externalLink };
