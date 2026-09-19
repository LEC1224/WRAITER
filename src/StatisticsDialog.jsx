import React, { useMemo, useState } from 'react';
import { BarChart3, BookOpen, Clock3, Hash, MessageSquareQuote, Pilcrow, Type } from 'lucide-react';
import { documentStatistics, formatDuration } from './statistics.js';

const number = value => Number(value || 0).toLocaleString();

export default function StatisticsDialog({ Modal, project, onClose }) {
  const [wordsPerPage, setWordsPerPage] = useState(250);
  const stats = useMemo(() => documentStatistics(project, wordsPerPage), [project, wordsPerPage]);
  const cards = [
    ['Words', number(stats.words), Type],
    ['Characters', number(stats.characters), Hash],
    ['Characters · no spaces', number(stats.charactersNoSpaces), Hash],
    ['Paragraphs', number(stats.paragraphs), Pilcrow],
    ['Sentences', number(stats.sentences), MessageSquareQuote],
    ['Chapters', number(stats.chapters), BookOpen],
    ['Estimated pages', number(stats.pages), BarChart3],
    ['Reading time', formatDuration(stats.readingMinutes), Clock3],
    ['Read-aloud time', formatDuration(stats.speakingMinutes), Clock3]
  ];
  return <Modal title="Document statistics" subtitle={project.title} onClose={onClose} wide className="statistics-modal">
    <div className="statistics-cards">{cards.map(([label, value, Icon]) => <div key={label}><Icon size={16} /><span>{label}</span><strong>{value}</strong></div>)}</div>
    <section className="statistics-nerdy"><h3>The nerdy details</h3><dl><div><dt>Unique words</dt><dd>{number(stats.uniqueWords)}</dd></div><div><dt>Vocabulary diversity</dt><dd>{(stats.vocabularyDiversity * 100).toFixed(1)}%</dd></div><div><dt>Average word length</dt><dd>{stats.averageWordLength.toFixed(1)} letters</dd></div><div><dt>Average sentence</dt><dd>{stats.averageSentenceLength.toFixed(1)} words</dd></div><div><dt>Average paragraph</dt><dd>{stats.averageParagraphLength.toFixed(1)} words</dd></div><div><dt>Words inside quotation marks</dt><dd>{(stats.dialoguePercent * 100).toFixed(1)}%</dd></div><div><dt>Longest chapter</dt><dd>{stats.longest ? `${stats.longest.title} · ${number(stats.longest.words)} words` : '—'}</dd></div><div><dt>Shortest non-empty chapter</dt><dd>{stats.shortest ? `${stats.shortest.title} · ${number(stats.shortest.words)} words` : '—'}</dd></div></dl></section>
    <label className="page-estimate-setting">Estimated page length<span><input className="field-input" type="number" min="50" max="1000" step="25" aria-label="Words per estimated page" value={wordsPerPage} onChange={event => setWordsPerPage(Math.max(50, Math.min(1000, Number(event.target.value) || 250)))} />words per page</span><small>Page count is an editorial estimate; exported layout depends on font, margins, paper size, and images.</small></label>
    <section className="chapter-statistics"><h3>By chapter</h3><div className="chapter-statistics-table" role="table" aria-label="Chapter statistics"><div role="row" className="header"><span role="columnheader">Chapter</span><span role="columnheader">Words</span><span role="columnheader">Paragraphs</span><span role="columnheader">Sentences</span></div>{stats.chaptersDetail.map(chapter => <div role="row" key={chapter.id}><span role="cell"><small>{String(chapter.number).padStart(2, '0')}</small>{chapter.title}</span><span role="cell">{number(chapter.words)}</span><span role="cell">{number(chapter.paragraphs)}</span><span role="cell">{number(chapter.sentences)}</span></div>)}</div></section>
    <div className="modal-footer"><button className="primary-button" onClick={onClose}>Done</button></div>
  </Modal>;
}
