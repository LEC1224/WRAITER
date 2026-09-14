import React, { useState } from 'react';
import { Clipboard, Download } from 'lucide-react';
import { textFormats } from './formats/chat.js';
const formats = [ ['docx', 'Word document (.docx)'], ['odt', 'OpenDocument Text (.odt)'], ['pdf', 'PDF · print / standard'], ['pdf-desktop', 'PDF · desktop reading'], ['pdf-mobile', 'PDF · mobile reading'], ['epub', 'EPUB ebook'], ['txt', 'Plain text (.txt)'], ['bbcode', 'BBCode text (.txt)'], ['md', 'Markdown (.md)'], ['html', 'HTML document (.html)'], ['discord', 'Discord chat (.txt)'], ['rich-text', 'Formatted text · Telegram / email (.html)'], ['telegram-md', 'Telegram bot · MarkdownV2 (.txt)'], ['telegram-html', 'Telegram bot · HTML (.txt)'] ];
const help = {
  discord: 'Paste into Discord chat. Basic emphasis, headings, lists, quotes and links are retained. Tables become text rows and images become placeholders. Long exports may need several messages; text is never truncated.',
  'rich-text': 'Copy formatted text for Telegram Desktop, email and other rich-text editors, with a plain-text fallback. Formatting depends on the receiving app. Images become placeholders. File export creates HTML you can open in a browser.',
  'telegram-md': 'For Telegram bots using MarkdownV2. This is escaped markup, not ordinary chat paste. Headings become bold, tables become text rows and images become placeholders. Split long messages before sending through a bot.',
  'telegram-html': 'For Telegram bots using HTML. This is markup, not ordinary chat paste. Headings become bold, tables become text rows and images become placeholders. Split long messages before sending through a bot.',
  html: 'Exports HTML source. Clipboard export copies the source as text; choose Formatted text to paste rendered formatting.',
  'pdf-mobile': 'A narrow portrait page with larger relative text for phone reading.',
  'pdf-desktop': 'A readable screen layout with a comfortable line width.',
  epub: 'Reflowable text with chapter navigation, suitable for ebook readers.'
};
export default function ExportDialog({ Modal, project, chapterId, hasSelection, onExport, onClose }) {
  const [format, setFormat] = useState('pdf'), [scope, setScope] = useState('manuscript'), [chapter, setChapter] = useState(chapterId), [colorMode, setColorMode] = useState('light'), [includeTitle, setIncludeTitle] = useState(true), [includeChapterTitles, setIncludeChapterTitles] = useState(true), [working, setWorking] = useState(false), [destination, setDestination] = useState('file');
  const pdf = format.startsWith('pdf'), canCopy = textFormats.includes(format) || format === 'rich-text';
  const copying = canCopy && destination === 'clipboard';
  async function run() {
    setWorking(true);
    try { await onExport(pdf ? 'pdf' : format, { destination: copying ? 'clipboard' : 'file', scope, chapterId: chapter, pdfPreset: format === 'pdf-mobile' ? 'mobile' : format === 'pdf-desktop' ? 'desktop' : 'standard', colorMode, includeTitle: scope === 'manuscript' && includeTitle, includeChapterTitles: scope !== 'selection' && includeChapterTitles }); }
    finally { setWorking(false); }
  }
  return <Modal title="Export document" onClose={onClose} wide><div className="export-settings"><div className="form-grid">
    <label>What to export<select className="field-input" aria-label="Export scope" value={scope} disabled={working} onChange={event => setScope(event.target.value)}><option value="manuscript">Full manuscript</option><option value="chapter">One chapter</option><option value="selection" disabled={!hasSelection}>Selected text</option></select></label>
    <label>Format<select className="field-input" aria-label="Export format" value={format} disabled={working} onChange={event => setFormat(event.target.value)}>{formats.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
    <label>Destination<select className="field-input" aria-label="Export destination" value={copying ? 'clipboard' : 'file'} disabled={working || !canCopy} onChange={event => setDestination(event.target.value)}><option value="file">Create file</option><option value="clipboard" disabled={!canCopy}>Export to Clipboard</option></select></label>
    {scope === 'chapter' && <label>Chapter<select className="field-input" aria-label="Export chapter" value={chapter} disabled={working} onChange={event => setChapter(event.target.value)}>{project.chapters.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
    {pdf && <label>Page colour<select className="field-input" aria-label="PDF colour" value={colorMode} disabled={working} onChange={event => setColorMode(event.target.value)}><option value="light">Light</option><option value="dark">Dark</option></select></label>}
    </div><div className="export-options">{scope === 'manuscript' && <label className="check-label"><input type="checkbox" checked={includeTitle} disabled={working} onChange={event => setIncludeTitle(event.target.checked)} />Include manuscript title</label>}{scope !== 'selection' && <label className="check-label"><input type="checkbox" checked={includeChapterTitles} disabled={working} onChange={event => setIncludeChapterTitles(event.target.checked)} />Include chapter headings</label>}</div>
    <p className="small-muted">{help[format] || 'The export contains document content and formatting supported by this format.'} Private notes, AI context and editing history are excluded.</p>
    </div><div className="modal-footer"><button className="secondary-button" disabled={working} onClick={onClose}>Cancel</button><button className="primary-button" disabled={working} onClick={run}>{copying ? <Clipboard size={14} /> : <Download size={14} />}{working ? 'Exporting…' : copying ? 'Export to Clipboard' : 'Export'}</button></div></Modal>;
}
