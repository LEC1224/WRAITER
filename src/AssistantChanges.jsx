import React, { useMemo, useState } from 'react';
import { diffArrays } from 'diff';
import { assistantChangeSummary } from './editorial-report.js';

function RichNode({ node }) {
  if (!node) return null;
  if (node.type === 'text') {
    let result = node.text;
    for (const mark of node.marks || []) {
      const attrs = mark.attrs || {};
      if (mark.type === 'bold') result = <strong>{result}</strong>;
      if (mark.type === 'italic') result = <em>{result}</em>;
      if (mark.type === 'underline') result = <u>{result}</u>;
      if (mark.type === 'strike') result = <s>{result}</s>;
      if (mark.type === 'code') result = <code>{result}</code>;
      if (mark.type === 'highlight') result = <mark style={{ backgroundColor: attrs.color || undefined }}>{result}</mark>;
      if (mark.type === 'link') result = <span className="change-link" title={attrs.href}>{result}</span>;
      if (mark.type === 'textStyle') result = <span style={{ color: attrs.color, fontFamily: attrs.fontFamily, fontSize: attrs.fontSize }}>{result}</span>;
    }
    return result;
  }
  if (node.type === 'hardBreak') return <br />;
  if (node.type === 'horizontalRule') return <hr />;
  if (node.type === 'image') return <figure><img src={node.attrs?.src} alt={node.attrs?.alt || 'Manuscript image'} /><figcaption>{node.attrs?.title}</figcaption></figure>;
  const children = (node.content || []).map((child, index) => <RichNode key={index} node={child} />);
  const attrs = node.attrs || {}, style = { textAlign: attrs.textAlign, lineHeight: attrs.lineHeight, marginBottom: attrs.spaceAfter == null ? undefined : `${attrs.spaceAfter}pt`, textIndent: attrs.firstLineIndent == null ? undefined : `${attrs.firstLineIndent}pt` };
  const Tag = ({ paragraph: 'p', heading: `h${Math.min(6, Math.max(1, attrs.level || 1))}`, blockquote: 'blockquote', bulletList: 'ul', orderedList: 'ol', listItem: 'li', tableRow: 'tr', tableCell: 'td', tableHeader: 'th', codeBlock: 'pre' })[node.type] || 'div';
  if (node.type === 'table') return <table><tbody>{children}</tbody></table>;
  return <Tag style={style} colSpan={['td', 'th'].includes(Tag) ? attrs.colspan : undefined} rowSpan={['td', 'th'].includes(Tag) ? attrs.rowspan : undefined}>{attrs.pageBreakBefore && <small className="change-page-break">Page break</small>}{children.length ? children : <br />}</Tag>;
}
function ContentDiff({ before, after }) {
  const [shown, setShown] = useState(20);
  const groups = useMemo(() => {
    const a = before?.content || [], b = after?.content || [];
    const changes = diffArrays(a, b, { comparator: (left, right) => JSON.stringify(left) === JSON.stringify(right), timeout: 200, maxEditLength: 3000 });
    if (!changes) return [{ before: a, after: b }];
    const result = [];
    for (let i = 0; i < changes.length; i++) {
      const part = changes[i]; if (!part.added && !part.removed) continue;
      const group = { before: part.removed ? part.value : [], after: part.added ? part.value : [] };
      if (part.removed && changes[i + 1]?.added) group.after = changes[++i].value;
      result.push(group);
    }
    return result;
  }, [before, after]);
  return <>{groups.slice(0, shown).map((group, index) => <div className="assistant-change-comparison" key={index}><div><strong>Before</strong><div className="assistant-change-prose">{group.before.length ? group.before.map((node, i) => <RichNode key={i} node={node} />) : <small>Nothing here</small>}</div></div><div><strong>After</strong><div className="assistant-change-prose">{group.after.length ? group.after.map((node, i) => <RichNode key={i} node={node} />) : <small>Removed</small>}</div></div></div>)}{groups.length > shown && <button className="secondary-button" onClick={() => setShown(n => n + 20)}>Show more changes ({groups.length - shown} remaining)</button>}</>;
}
const valueText = value => value === undefined ? '(unset)' : typeof value === 'string' ? value || '(empty)' : JSON.stringify(value, null, 2);
export default function AssistantChanges({ entry, project, state, onRevert }) {
  const summary = assistantChangeSummary(entry, project);
  const display = (patch, side) => patch.scope === 'chapter-order' ? (patch[side] || []).map(id => {
    const titleChange = entry.patches.find(item => item.chapterId === id && item.key === 'title');
    const chapterChange = entry.patches.find(item => item.chapterId === id && item.scope === 'chapter');
    return titleChange?.[side] || chapterChange?.[side]?.title || project.chapters.find(item => item.id === id)?.title || 'Untitled chapter';
  }).join('\n') : valueText(patch[side]);
  return <div className="assistant-changes"><p className="small-muted">This report comes from the recorded document changes. Text, formatting and chapter changes are saved together as one undo step.</p><ul className="assistant-change-summary">{summary.map((text, index) => <li key={index}>{text}</li>)}</ul>
    {(entry?.patches || []).map((patch, index) => <details className="assistant-change-detail" key={index} open={(entry.patches || []).length <= 4}><summary>{summary[index]}</summary>
      {patch.key === 'content' ? <ContentDiff before={patch.before} after={patch.after} /> : patch.scope === 'chapter' ? <ContentDiff before={patch.before?.content} after={patch.after?.content} /> : <div className="assistant-change-comparison"><div><strong>Before</strong><pre>{display(patch, 'before')}</pre></div><div><strong>After</strong><pre>{display(patch, 'after')}</pre></div></div>}
    </details>)}
    <div className="assistant-change-footer"><span>{state === 'applied' ? 'Applied' : state === 'reverted' ? 'Reverted' : 'Undone or on an earlier history branch'}</span><button className="secondary-button" disabled={state !== 'applied'} onClick={onRevert}>Revert this assistant edit</button></div>
  </div>;
}
