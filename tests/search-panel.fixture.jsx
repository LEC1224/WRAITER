import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import SearchPanel from '../src/SearchPanel.jsx';
import '../src/styles.css';

export function mountSearchPanel() {
  const initial = Array.from({ length: 2405 }, (_, index) => ({ id: `result-${index}`, chapterId: index < 2300 ? 'one' : 'two', chapterTitle: index < 2300 ? 'First chapter' : 'Second chapter', text: 'needle', snippet: { before: `Paragraph ${index + 1}. `, match: 'needle', after: ' beside the river.' } }));
  function Harness() {
    const [results, setResults] = useState(initial), [activeId, setActiveId] = useState(initial.at(-1).id), [query, setQuery] = useState('needle'), [replacement, setReplacement] = useState(''), [options, setOptions] = useState({});
    window.searchPanelFixture = { refresh: () => setResults(current => current.map(result => ({ ...result }))), removeActive: () => setResults(current => current.filter(result => result.id !== activeId)), replaceResults: count => { setResults(initial.slice(0, count)); }, setActive: index => setActiveId(initial[index]?.id) };
    return <SearchPanel query={query} onQueryChange={value => { setQuery(value); setResults(current => current.map(result => ({ ...result }))); }} replacement={replacement} onReplacementChange={setReplacement} options={options} onOptionsChange={value => { setOptions(value); setResults(current => current.map(result => ({ ...result }))); }} onScopeChange={() => {}} results={results} activeResult={activeId} onActivate={result => setActiveId(result.id)} onReplace={() => {}} onReplaceAll={() => true} onClose={() => {}} />;
  }
  createRoot(document.getElementById('root')).render(<Harness />);
}
