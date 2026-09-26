import { randomUUID, createHash } from 'node:crypto';
import { EditorState } from '@tiptap/pm/state';
import { TableMap } from '@tiptap/pm/tables';
import { editorialSchema as schema } from './editor-schema.mjs';
import { applyTextChanges } from './text-edits.mjs';
import { documentChanges, documentFields } from './document-changes.mjs';
import core from './core.cjs';
import legacy from './writing-agent.cjs';

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const paragraph = text => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) });
const integer = (value, min, max, label) => { if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${label}.`); return value; };
const list = (value, label, max = 1000) => { if (!Array.isArray(value) || value.length > max) throw new Error(`Invalid ${label}.`); return value; };
const text = (value, label, max = 100000) => { if (typeof value !== 'string' || value.length > max) throw new Error(`Invalid ${label}.`); return value; };
const readTools = new Set(['read_document', 'search_document', 'read_structure', 'read_reference', 'read_conversation']);
const textTools = new Set(['replace_all', 'replace_text', 'rewrite_passage', 'normalize_spaces', 'remove_empty_paragraphs', 'delete_paragraph', 'rename_chapter']);

export function createEditorialTools(project, options = {}) {
  let current = structuredClone(project), revision = 0, selection = options.selection ? { ...options.selection } : null;
  const initial = structuredClone(project), operations = [], assets = new Map();
  const selectionActive = Boolean(selection && selection.from < selection.to && current.chapters.some(c => c.id === selection.chapterId));
  const defaultScope = selectionActive ? 'selection' : 'all';
  const activeId = options.activeChapterId || current.chapters[0].id;
  const token = id => `r${revision}:${id}`;
  const untoken = id => {
    if (typeof id !== 'string') throw new Error('Read the passage to obtain its block ID.');
    const match = id.match(/^r(\d+):(.*)$/);
    if (!match || Number(match[1]) !== revision) throw new Error('The passage ID is stale. Read the document again after an edit.');
    return match[2];
  };
  const chapter = id => { const item = current.chapters.find(c => c.id === (id || activeId)); if (!item) throw new Error('This chapter does not exist.'); return item; };
  const checkRevision = args => { if (args.revision !== revision) throw new Error('Read the current document structure and use its revision before changing structure.'); };
  const unselected = () => { if (selectionActive) throw new Error('This operation changes structure outside the selected text. Clear the selection for a manuscript or chapter edit.'); };
  function blocks(args = {}, editing = false) {
    let items = legacy.collectBlocks(current, selection);
    const scope = args.scope || defaultScope;
    if (scope === 'selection') items = items.filter(b => b.selection);
    else if (scope !== 'all') { const id = scope === 'active' ? activeId : scope; chapter(id); items = items.filter(b => b.chapterId === id); }
    if (editing && selectionActive) items = items.filter(b => b.selection);
    if (args.blockId) { const id = untoken(args.blockId); items = items.filter(b => b.id === id); if (!items.length) throw new Error('The passage is outside the requested scope.'); }
    return items.map(block => ({ ...block, range: (scope === 'selection' || editing && selectionActive) ? block.selection : { from: 0, to: block.text.length } }));
  }
  function docState(id) { return EditorState.create({ schema, doc: schema.nodeFromJSON(chapter(id).content) }); }
  function setDoc(id, doc) { doc.check(); chapter(id).content = doc.toJSON(); }
  function validate(before) {
    core.validateProject(current);
    const previous = new Map(before.chapters.map(item => [item.id, item.content]));
    for (const item of current.chapters) {
      const doc = schema.nodeFromJSON(item.content); doc.check();
      doc.descendants(node => { if (node.type.name === 'table' && TableMap.get(node).problems?.length) throw new Error('The table has inconsistent rows or cell spans. No changes were applied.'); });
      if (!equal(previous.get(item.id), item.content)) item.content = doc.toJSON();
    }
    if (JSON.stringify(current).length - JSON.stringify(initial).length > 4 * 1024 * 1024) throw new Error('This request would add more than 4 MB of document content. Split it into smaller requests.');
  }
  function encodeNode(node) {
    if (node.type === 'image') {
      const assetId = createHash('sha256').update(JSON.stringify(node)).digest('hex').slice(0, 20);
      assets.set(assetId, structuredClone(node));
      const { src, ...attrs } = node.attrs || {};
      return { type: 'image', assetId, attrs };
    }
    return { ...node, ...(node.content ? { content: node.content.map(encodeNode) } : {}) };
  }
  function decodeNode(node) {
    if (typeof node === 'string') return paragraph(node);
    if (!node || typeof node !== 'object') throw new Error('Invalid document block.');
    if (node.type === 'image' && node.assetId) {
      if (!assets.has(node.assetId)) throw new Error('Read the image in the document structure before reusing it.');
      return { ...structuredClone(assets.get(node.assetId)), attrs: { ...assets.get(node.assetId).attrs, ...(node.attrs || {}) } };
    }
    return { ...node, ...(node.content ? { content: list(node.content, 'block content', 300000).map(decodeNode) } : {}) };
  }
  function requireMark(mark) {
    if (!mark || !schema.marks[mark.type]) throw new Error('Unsupported character formatting.');
    const attrs = mark.attrs || {};
    const allowed = schema.marks[mark.type].spec.attrs || {};
    if (Object.keys(attrs).some(key => !Object.hasOwn(allowed, key))) throw new Error('Unsupported character formatting attribute.');
    const created = schema.marks[mark.type].create(attrs);
    // Validate URLs and formatting values through the same native-file gate.
    core.validateProject({ ...initial, snapshots: [], chats: [], activeChatId: null, chapters: [{ id: 'check', title: '', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [created.toJSON()] }] }] } }] });
    return created;
  }
  function applyMark(tr, from, to, mark) {
    // Setting a colour must not discard an existing font or font size.
    if (mark.type === 'textStyle') {
      const ranges = [];
      tr.doc.nodesBetween(from, to, (node, pos) => {
        if (node.isText) ranges.push({ from: Math.max(from, pos), to: Math.min(to, pos + node.nodeSize), attrs: { ...(node.marks.find(m => m.type.name === 'textStyle')?.attrs || {}), ...(mark.attrs || {}) } });
      });
      for (const range of ranges) tr.addMark(range.from, range.to, requireMark({ type: 'textStyle', attrs: range.attrs }));
    } else tr.addMark(from, to, requireMark(mark));
  }
  function runText(name, args) {
    const workspace = legacy.createDocumentTools(current, { activeChapterId: activeId, selection });
    const converted = { ...args, ...(args.blockId ? { blockId: untoken(args.blockId) } : {}) };
    const result = workspace.execute(name, converted);
    const changes = workspace.changes();
    const applied = applyTextChanges(current, changes, schema);
    if (selectionActive && changes.edits.length) {
      // Exact legacy text edits retain paragraph identities. Map the selected
      // bounds over length changes before the next operation reads them.
      let delta = 0;
      for (const edit of changes.edits) if (edit.chapterId === selection.chapterId) delta += edit.kind === 'delete_paragraph' ? -(edit.to - edit.from) : edit.after.length - edit.before.length;
      selection.to += delta;
    }
    current = applied.project;
    return result;
  }
  const tools = {
    read_document(args) {
      const workspace = legacy.createDocumentTools(current, { activeChapterId: activeId, selection });
      const result = workspace.execute('read_document', { ...args, ...(args.blockId ? { blockId: untoken(args.blockId) } : {}) });
      const all = new Map(blocks(args).map(b => [b.id, b]));
      result.blocks = result.blocks.map(item => {
        const block = all.get(item.blockId); let offset = 0;
        const lower = block.range.from + item.offset, upper = lower + item.text.length;
        const runs = (block.node.content || []).flatMap(node => {
          const length = node.type === 'text' ? node.text.length : 1, from = Math.max(offset, lower), to = Math.min(offset + length, upper), start = offset; offset += length;
          return from < to ? [{ from: from - block.range.from, to: to - block.range.from, type: node.type, ...(node.type === 'text' ? { text: node.text.slice(from - start, to - start) } : {}), marks: node.marks || [] }] : [];
        });
        return { ...item, blockId: token(item.blockId), attrs: block.node.attrs || {}, runs };
      });
      return { ...result, revision };
    },
    search_document(args) {
      const workspace = legacy.createDocumentTools(current, { activeChapterId: activeId, selection });
      const result = workspace.execute('search_document', { ...args, ...(args.blockId ? { blockId: untoken(args.blockId) } : {}) });
      return { ...result, revision, matches: result.matches.map(item => ({ ...item, blockId: token(item.blockId) })) };
    },
    read_structure(args) {
      const item = chapter(args.chapterId), nodes = item.content.content;
      const cursor = integer(args.cursor ?? 0, 0, nodes.length, 'structure cursor');
      const limit = integer(args.limit ?? 20, 1, 100, 'structure limit');
      const result = []; let size = 0, index = cursor;
      for (; index < nodes.length && result.length < limit; index++) {
        const node = encodeNode(nodes[index]), serialized = JSON.stringify(node);
        if (size + serialized.length > 60000) {
          if (!result.length) { result.push({ index, type: node.type, complete: false, characters: serialized.length, note: 'Large block: use read_document for text passages; move it by index to preserve its structure.' }); index++; }
          break;
        }
        result.push({ index, node, complete: true }); size += serialized.length;
      }
      return { revision, chapterId: item.id, title: item.title, blocks: result, totalBlocks: nodes.length, nextCursor: index < nodes.length ? index : null, label: `Read structure of ${item.title || 'chapter'}` };
    },
    rewrite_passages(args) {
      const passages = list(args.passages, 'passages', 200);
      const workspace = legacy.createDocumentTools(current, { activeChapterId: activeId, selection });
      for (const passage of passages) workspace.execute('rewrite_passage', { ...passage, blockId: untoken(passage.blockId), scope: args.scope });
      const changes = workspace.changes();
      if (selectionActive) selection.to += changes.edits.reduce((sum, edit) => sum + edit.after.length - edit.before.length, 0);
      current = applyTextChanges(current, changes, schema).project;
      return { count: changes.edits.length, label: `Revised ${changes.edits.length} passages` };
    },
    format_text(args) {
      const marks = list(args.marks || [], 'formatting marks', 20), remove = list(args.remove || [], 'removed formatting', 20);
      marks.forEach(requireMark);
      if (remove.some(name => !schema.marks[name])) throw new Error('Unsupported removed formatting.');
      const targets = [];
      for (const block of blocks(args, true)) {
        const value = block.text.slice(block.range.from, block.range.to);
        if (args.find !== undefined) {
          const find = text(args.find, 'search text'); if (!find) throw new Error('Search text cannot be empty.');
          let index = 0;
          while ((index = value.indexOf(find, index)) >= 0) { targets.push({ block, from: block.range.from + index, to: block.range.from + index + find.length }); index += find.length; }
        } else if (args.from !== undefined || args.to !== undefined) {
          if (!args.blockId) throw new Error('Offsets require one block ID.');
          const from = integer(args.from, 0, value.length, 'format start'), to = integer(args.to, from, value.length, 'format end');
          targets.push({ block, from: block.range.from + from, to: block.range.from + to });
        } else targets.push({ block, from: block.range.from, to: block.range.to });
      }
      if (args.find !== undefined && args.expectedCount !== targets.length) throw new Error(`Expected match count did not agree. Found ${targets.length} matches.`);
      const transactions = new Map();
      for (const { block, from, to } of targets) {
        let tr = transactions.get(block.chapterId); if (!tr) transactions.set(block.chapterId, tr = docState(block.chapterId).tr);
        for (const mark of remove) tr.removeMark(block.from + from, block.from + to, schema.marks[mark]);
        for (const mark of marks) applyMark(tr, block.from + from, block.from + to, mark);
      }
      for (const [id, tr] of transactions) setDoc(id, tr.doc);
      return { count: targets.length, label: `Formatted ${targets.length} text ranges` };
    },
    format_paragraphs(args) {
      const attrs = args.attrs || {}, allowed = new Set(['textAlign', 'lineHeight', 'spaceAfter', 'firstLineIndent', 'pageBreakBefore', 'level']);
      if (Object.keys(attrs).some(key => !allowed.has(key))) throw new Error('Unsupported paragraph attribute.');
      if (args.type && !['paragraph', 'heading', 'codeBlock'].includes(args.type)) throw new Error('Unsupported paragraph type.');
      const transactions = new Map(), targets = blocks(args, true);
      for (const block of targets) {
        if (selectionActive && !block.fullySelected) throw new Error('Select complete paragraphs to change their paragraph formatting.');
        let tr = transactions.get(block.chapterId); if (!tr) transactions.set(block.chapterId, tr = docState(block.chapterId).tr);
        const type = schema.nodes[args.type || block.kind];
        tr.setNodeMarkup(block.from - 1, type, { ...block.node.attrs, ...attrs });
      }
      for (const [id, tr] of transactions) setDoc(id, tr.doc);
      return { count: targets.length, label: `Formatted ${targets.length} paragraphs` };
    },
    convert_bbcode(args) {
      const transactions = new Map(), stacks = new Map(), deletions = new Map(); let count = 0;
      const names = { b: 'bold', i: 'italic', u: 'underline', s: 'strike', strike: 'strike', code: 'code' };
      for (const block of blocks(args, true)) {
        if (block.kind === 'codeBlock') continue;
        const stack = stacks.get(block.chapterId) || []; stacks.set(block.chapterId, stack);
        let tr = transactions.get(block.chapterId); if (!tr) transactions.set(block.chapterId, tr = docState(block.chapterId).tr);
        const removed = deletions.get(block.chapterId) || []; deletions.set(block.chapterId, removed);
        const value = block.text.slice(block.range.from, block.range.to);
        for (const match of value.matchAll(/\[(\/)?(b|i|u|s|strike|code|color|size|url)(?:=([^\]\r\n]+))?\]/gi)) {
          const from = block.from + block.range.from + match.index, to = from + match[0].length, name = match[2].toLowerCase();
          if (match[1]) {
            const open = stack.pop(); if (!open || open.name !== name) throw new Error('BBCode tags are unbalanced or cross the selection boundary. No conversion was applied.');
            let mark;
            if (names[name]) mark = { type: names[name] };
            else if (name === 'url') mark = { type: 'link', attrs: { href: open.value || tr.doc.textBetween(open.to, from, '', '') } };
            else mark = { type: 'textStyle', attrs: { [name === 'color' ? 'color' : 'fontSize']: name === 'size' && /^\d+(?:\.\d+)?$/.test(open.value || '') ? `${open.value}pt` : open.value } };
            requireMark(mark); applyMark(tr, open.to, from, mark); removed.push({ from: open.from, to: open.to }, { from, to }); count++;
          } else stack.push({ name, from, to, value: match[3] });
        }
      }
      if ([...stacks.values()].some(stack => stack.length)) throw new Error('BBCode tags are unbalanced or cross the selection boundary. No conversion was applied.');
      for (const [id, tr] of transactions) {
        for (const range of deletions.get(id).sort((a, b) => b.from - a.from)) tr.delete(range.from, range.to);
        if (selectionActive && id === selection.chapterId) selection = { ...selection, from: tr.mapping.map(selection.from, -1), to: tr.mapping.map(selection.to, 1) };
        setDoc(id, tr.doc);
      }
      return { count, label: `Converted ${count} BBCode pairs to formatting` };
    },
    split_paragraph(args) {
      const [block] = blocks(args, true); if (!args.blockId || !block || block.kind !== 'paragraph') throw new Error('Read and specify one ordinary paragraph to split.');
      const offset = integer(args.offset, 0, block.range.to - block.range.from, 'split offset') + block.range.from;
      const tr = docState(block.chapterId).tr;
      tr.split(block.from + offset);
      const second = tr.doc.nodeAt(block.from + offset + 1);
      if (second) tr.setNodeMarkup(block.from + offset + 1, null, { ...second.attrs, pageBreakBefore: null });
      if (selectionActive) selection.to += 2;
      setDoc(block.chapterId, tr.doc);
      return { count: 1, label: 'Split paragraph' };
    },
    edit_blocks(args) {
      unselected(); checkRevision(args);
      const item = chapter(args.chapterId), nodes = item.content.content;
      const from = integer(args.from, 0, nodes.length, 'first block'), to = integer(args.to, from, nodes.length, 'last block');
      const inserted = list(args.blocks, 'replacement blocks').map(decodeNode);
      item.content = { type: 'doc', content: [...nodes.slice(0, from), ...inserted, ...nodes.slice(to)] };
      if (!item.content.content.length) item.content.content = [paragraph('')];
      return { count: Math.max(to - from, inserted.length), label: `Replaced ${to - from} blocks with ${inserted.length} in ${item.title || 'chapter'}` };
    },
    move_blocks(args) {
      unselected(); checkRevision(args);
      const source = chapter(args.chapterId), target = chapter(args.targetChapterId || source.id), nodes = source.content.content;
      const from = integer(args.from, 0, nodes.length - 1, 'first block'), to = integer(args.to, from + 1, nodes.length, 'last block');
      let index = integer(args.index, 0, target.content.content.length, 'destination index');
      if (source === target && index >= from && index <= to) return { count: 0, label: 'Blocks already in that position' };
      const moved = nodes.splice(from, to - from);
      if (source === target && index > to) index -= moved.length;
      target.content.content.splice(index, 0, ...moved);
      if (!source.content.content.length) source.content.content.push(paragraph(''));
      return { count: moved.length, label: `Moved ${moved.length} blocks` };
    },
    create_chapter(args) {
      unselected(); checkRevision(args);
      const index = integer(args.index ?? current.chapters.length, 0, current.chapters.length, 'chapter position');
      const item = { id: randomUUID(), title: text(args.title, 'chapter title', 2000), status: 'Draft', content: { type: 'doc', content: args.blocks?.length ? list(args.blocks, 'chapter blocks').map(decodeNode) : [paragraph('')] } };
      current.chapters.splice(index, 0, item);
      return { count: 1, chapterId: item.id, label: `Added chapter: ${item.title || 'Untitled'}` };
    },
    delete_chapter(args) {
      unselected(); checkRevision(args); const item = chapter(args.chapterId);
      if (current.chapters.length === 1) throw new Error('Keep at least one chapter. Its contents can be replaced or cleared.');
      if (args.before !== item.title) throw new Error('The original chapter title does not match.');
      current.chapters = current.chapters.filter(c => c !== item);
      return { count: 1, label: `Removed chapter: ${item.title || 'Untitled'}` };
    },
    reorder_chapters(args) {
      unselected(); checkRevision(args); const order = list(args.chapterIds, 'chapter order', 2000);
      if (order.length !== current.chapters.length || new Set(order).size !== order.length) throw new Error('Include every chapter exactly once.');
      current.chapters = order.map(chapter);
      return { count: order.length, label: 'Reordered chapters' };
    },
    split_chapter(args) {
      unselected(); checkRevision(args); const item = chapter(args.chapterId), index = current.chapters.indexOf(item);
      const at = integer(args.index, 1, item.content.content.length - 1, 'chapter split');
      const next = { ...item, id: randomUUID(), title: text(args.title, 'new chapter title', 2000), content: { type: 'doc', content: item.content.content.splice(at) } };
      current.chapters.splice(index + 1, 0, next);
      return { count: 1, chapterId: next.id, label: `Split chapter: ${next.title || 'Untitled'}` };
    },
    merge_chapters(args) {
      unselected(); checkRevision(args); const ids = list(args.chapterIds, 'chapters to merge', 2000);
      if (ids.length < 2 || new Set(ids).size !== ids.length) throw new Error('Choose at least two distinct chapters, in their desired text order.');
      const items = ids.map(chapter), first = items[0];
      first.content = { type: 'doc', content: items.flatMap(item => item.content.content) };
      if (args.title !== undefined) first.title = text(args.title, 'merged chapter title', 2000);
      current.chapters = current.chapters.filter(item => item === first || !ids.includes(item.id));
      return { count: ids.length, chapterId: first.id, label: `Merged ${ids.length} chapters` };
    },
    set_document(args) {
      unselected();
      const fields = args.fields;
      if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.keys(fields).some(key => !documentFields.has(key))) throw new Error('Only title, subtitle, language and documentStyle can be edited here.');
      const next = structuredClone(fields);
      if (next.documentStyle) next.documentStyle = { fontFamily: 'Cambria', fontSize: 12, lineHeight: 1.5, ...current.documentStyle, ...next.documentStyle };
      Object.assign(current, next);
      return { count: Object.keys(fields).length, label: `Changed document ${Object.keys(fields).join(', ')}` };
    },
    read_reference(args) {
      const reference = (options.references || [])[integer(args.index, 0, (options.references || []).length - 1, 'reference index')];
      const offset = integer(args.offset ?? 0, 0, reference.text.length, 'reference offset'), limit = integer(args.limitChars ?? 24000, 1, 60000, 'reference read length');
      return { name: reference.name, text: reference.text.slice(offset, offset + limit), nextOffset: offset + limit < reference.text.length ? offset + limit : null, totalCharacters: reference.text.length, label: `Read reference: ${reference.name}` };
    },
    read_conversation(args) {
      const messages = options.conversation || [], cursor = integer(args.cursor ?? 0, 0, messages.length, 'conversation cursor');
      const selected = messages.slice(cursor, cursor + integer(args.limit ?? 10, 1, 20, 'message count'));
      return { messages: selected.map(m => ({ role: m.role, text: String(m.text).slice(0, 12000) })), nextCursor: cursor + selected.length < messages.length ? cursor + selected.length : null, label: `Read ${selected.length} earlier messages` };
    }
  };
  return {
    defaultScope,
    get metadata() { return { title: current.title, subtitle: current.subtitle || '', language: current.language || '', documentStyle: current.documentStyle || { fontFamily: 'Cambria', fontSize: 12, lineHeight: 1.5 } }; },
    get revision() { return revision; },
    get outline() { return current.chapters.map(item => ({ id: item.id, title: item.title, active: item.id === activeId, blocks: item.content.content.length, characters: schema.nodeFromJSON(item.content).textContent.length })); },
    execute(name, args = {}) {
      if (!Object.hasOwn(tools, name) && !textTools.has(name)) throw new Error(`Unknown document tool: ${name}.`);
      if (readTools.has(name)) return tools[name](args);
      if (selectionActive && selection.from >= selection.to) throw new Error('The selected text has been removed. No further edits can leave that selection.');
      const before = current, previousSelection = selection ? { ...selection } : null;
      current = structuredClone(current);
      try {
        const result = textTools.has(name) ? runText(name, args) : tools[name](args);
        validate(before);
        const changed = documentChanges(before, current).length > 0;
        if (changed) { revision++; operations.push({ tool: name, label: result.label, count: result.count || 0 }); }
        return { ...result, revision, changed };
      } catch (error) { current = before; selection = previousSelection; throw error; }
    },
    changes() {
      const changes = documentChanges(initial, current);
      // Legacy text summaries remain available to older consumers. The version
      // two documentChanges are the authoritative, complete rich edit batch.
      const oldBlocks = legacy.collectBlocks(initial), newBlocks = new Map(legacy.collectBlocks(current).map(block => [JSON.stringify([block.chapterId, block.path]), block]));
      const edits = oldBlocks.flatMap(block => {
        const next = newBlocks.get(JSON.stringify([block.chapterId, block.path]));
        return next && block.text !== next.text ? [{ chapterId: block.chapterId, blockId: block.id, from: block.from, to: block.to, before: block.text, after: next.text }] : [];
      });
      const chapterTitles = changes.filter(c => c.kind === 'chapter-field' && c.key === 'title').map(c => ({ chapterId: c.chapterId, before: c.before, after: c.after }));
      return { version: 2, documentChanges: changes, edits, chapterTitles, operations: changes.length ? operations : [] };
    }
  };
}
