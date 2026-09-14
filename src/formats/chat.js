import { nodeText } from '../document.js';

export const chatFormats = ['discord', 'telegram-md', 'telegram-html'];
export const textFormats = ['txt', 'md', 'bbcode', 'html', ...chatFormats];
const htmlEscape = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const escape = (text, format) => format === 'telegram-html' ? htmlEscape(text) : String(text).replace(format === 'telegram-md' ? /[\\_*\[\]()~`>#+\-=|{}.!]/g : /[\\_*\[\]()~`>#+\-=|{}]/g, '\\$&');
const codeEscape = text => text.replace(/[\\`]/g, '\\$&');

function inline(node, format) {
  const raw = node.text || '', marks = node.marks || [];
  if (marks.some(m => m.type === 'code')) {
    if (format === 'telegram-html') return `<code>${htmlEscape(raw)}</code>`;
    // Discord has no escape syntax inside code spans. Keep literal backticks as prose.
    if (format === 'discord' && /`|\n/.test(raw)) return escape(raw, format);
    return '`' + (format === 'telegram-md' ? codeEscape(raw) : raw) + '`';
  }
  const body = raw.trim();
  if (!body) return raw;
  let text = escape(body, format);
  const tokens = format === 'discord' ? { bold: '**', italic: '*', underline: '__', strike: '~~' } : { bold: '*', italic: '_', underline: '__', strike: '~' };
  const tags = { bold: 'b', italic: 'i', underline: 'u', strike: 's' };
  // Fixed nesting avoids Telegram's ambiguous italic/underline closing sequence.
  for (const type of ['italic', 'underline', 'bold', 'strike']) {
    if (!marks.some(m => m.type === type)) continue;
    if (format === 'telegram-html') text = `<${tags[type]}>${text}</${tags[type]}>`;
    else text = tokens[type] + text + (format === 'telegram-md' && type === 'underline' && marks.some(m => m.type === 'italic') ? '**' : '') + tokens[type];
  }
  const href = marks.find(m => m.type === 'link')?.attrs?.href;
  if (href && /^(https?:|mailto:|tg:)/i.test(href)) {
    const url = String(href).replace(/\s/g, c => encodeURIComponent(c));
    text = format === 'telegram-html' ? `<a href="${htmlEscape(url)}">${text}</a>` : `[${text}](${format === 'telegram-md' ? url.replace(/[\\)]/g, '\\$&') : url.replace(/[\\()<>]/g, c => encodeURIComponent(c))})`;
  }
  return raw.slice(0, raw.indexOf(body)) + text + raw.slice(raw.indexOf(body) + body.length);
}

export function chatMarkup(node, format, inQuote = false) {
  if (node.type === 'text') return inline(node, format);
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'image') return escape(`[Image: ${node.attrs?.alt || 'image omitted'}]`, format) + '\n\n';
  if (node.type === 'horizontalRule') return escape('* * *', format) + '\n\n';
  if (node.type === 'codeBlock') {
    const raw = nodeText(node);
    if (format === 'telegram-html') return `<pre>${htmlEscape(raw)}</pre>\n\n`;
    if (format === 'discord' && raw.includes('```')) return escape(raw, format) + '\n\n';
    return '```\n' + (format === 'telegram-md' ? codeEscape(raw) : raw) + '\n```\n\n';
  }
  if (['bulletList', 'orderedList'].includes(node.type)) return (node.content || []).map((item, i) => {
    const marker = node.type === 'orderedList' ? `${(Number(node.attrs?.start) || 1) + i}. ` : format === 'discord' ? '- ' : '• ';
    const value = chatMarkup(item, format, inQuote).trimEnd();
    return (format === 'discord' ? marker : escape(marker, format)) + value.split('\n').join('\n  ');
  }).join('\n') + '\n\n';
  if (node.type === 'table') return (node.content || []).map(row => (row.content || []).map(cell => chatMarkup(cell, format, inQuote).trim().replace(/\n+/g, ' / ')).join('\t')).join('\n') + '\n\n';
  const inner = (node.content || []).map(child => chatMarkup(child, format, inQuote || node.type === 'blockquote')).reduce((result, value) => result + (format === 'telegram-md' && result.endsWith('_') && value.startsWith('_') ? '**' : '') + value, '');
  if (node.type === 'paragraph') return inner + '\n\n';
  if (node.type === 'heading') {
    // Render Telegram headings as bold, without nesting a second bold mark.
    if (format !== 'discord') return inline({ text: nodeText(node), marks: [{ type: 'bold' }] }, format) + '\n\n';
    return '#'.repeat(Math.max(1, Math.min(3, node.attrs?.level || 1))) + ' ' + inner + '\n\n';
  }
  if (node.type === 'blockquote' && !inQuote) return format === 'telegram-html' ? `<blockquote>${inner.trimEnd()}</blockquote>\n\n` : inner.trimEnd().split('\n').map(line => '> ' + line).join('\n') + '\n\n';
  return inner;
}

export function chatDocument(project, format, titles) {
  const heading = (text, level) => chatMarkup({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] }, format);
  return (titles.includeTitle ? heading(project.title, 1) : '') + project.chapters.map(chapter => (titles.includeChapterTitles ? heading(chapter.title, 2) : '') + chatMarkup(chapter.content, format)).join('\n');
}
