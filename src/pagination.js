import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const paginationKey = new PluginKey('wraiterPagination');
export function insertPageBreak(editor) {
  if (!editor || !['paragraph', 'heading'].includes(editor.state.selection.$from.parent.type.name)) return false;
  return editor.chain().focus().splitBlock().command(({ tr }) => {
    const { $from } = tr.selection;
    if (!$from.depth || !['paragraph', 'heading'].includes($from.parent.type.name)) return false;
    tr.setNodeMarkup($from.before(), undefined, { ...$from.parent.attrs, pageBreakBefore: true });
    tr.setMeta('historyLabel', 'Insert page break').scrollIntoView(); return true;
  }).run();
}
export function removePageBreakAtCursor(view) {
  const { $from, empty } = view.state.selection;
  if (!empty || $from.parentOffset !== 0 || !$from.parent.attrs.pageBreakBefore) return false;
  view.dispatch(view.state.tr.setNodeMarkup($from.before(), undefined, { ...$from.parent.attrs, pageBreakBefore: null }).setMeta('historyLabel', 'Remove page break')); return true;
}

// Screen-only gaps: neither automatic page divisions nor page furniture become
// document nodes, export content, or undo events. Manual breaks are attributes.
export function arrangePages(lines, pageHeight, margin = 56, gap = 24) {
  const pages = [{ top: 0, height: pageHeight }], breaks = []; let added = 0;
  for (const line of lines) {
    let page = pages.at(-1), top = line.top + added;
    // Imported spacing can skip a complete sheet even without a text line.
    while (!line.force && top >= page.top + page.height + gap + margin) { page = { top: page.top + page.height + gap, height: pageHeight }; pages.push(page); }
    if (line.force || top + line.height > page.top + page.height - margin + 1) {
      if (top > page.top + margin + 1 || line.force) {
        const next = { top: page.top + page.height + gap, height: pageHeight };
        const height = Math.max(0, next.top + margin - top);
        // Only a real page spacer needs a character offset. Line numbers and
        // continuous-view page labels already have their screen coordinates.
        breaks.push({ pos: line.breakPosition ? line.breakPosition() : line.pos, top: line.top, height, inline: line.inline });
        added += height; top += height;
        pages.push(next); page = next;
      }
      // Keep oversized objects visible; never cut a tall image/table in half.
      if (line.height > pageHeight - 2 * margin) page.height = line.height + 2 * margin;
    }
  }
  return { pages, breaks, height: pages.at(-1).top + pages.at(-1).height };
}

// offsetWidth is rounded to whole pixels; deriving zoom from it accumulates
// several pixels of error far down a long sheet with a fractional width.
const sheetScale = sheet => sheet.currentCSSZoom || parseFloat(getComputedStyle(sheet).zoom) || 1;

function wrappedLineStart(view, text, top) {
  const range = document.createRange();
  let low = 0, high = text.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    range.setStart(text, mid); range.setEnd(text, mid + 1);
    if (range.getBoundingClientRect().top < top - 1) low = mid + 1; else high = mid;
  }
  return view.posAtDOM(text, low);
}

// Position lookup for paragraphs in normal flow, including manuscripts with
// block illustrations. Nested and negatively spaced blocks can overlap and
// keep the container-by-container measurement below.
const flatParagraphs = new WeakMap();
function paragraphWindow(view, viewport) {
  const doc = view.state.doc;
  if (!flatParagraphs.has(doc)) {
    let entries = [], pos = 0;
    for (let index = 0; index < doc.childCount; index++) {
      const node = doc.child(index);
      if (node.isTextblock && !(node.attrs.spaceBefore < 0 || node.attrs.spaceAfter < 0)) entries.push({ node, pos });
      else if (!['image', 'horizontalRule'].includes(node.type.name)) { entries = null; break; }
      pos += node.nodeSize;
    }
    flatParagraphs.set(doc, entries);
  }
  const entries = flatParagraphs.get(doc);
  if (!entries) return null;
  let low = 0, high = entries.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const element = view.nodeDOM(entries[middle].pos);
    if (!element?.getBoundingClientRect) return null;
    if (element.getBoundingClientRect().bottom < viewport.top) low = middle + 1;
    else high = middle;
  }
  // Reuse the visible elements we already measured. The next paragraph in a
  // normal flow is either part of the buffered window or below its bottom.
  const visible = [];
  for (let index = low; index < entries.length; index++) {
    const entry = entries[index], element = view.nodeDOM(entry.pos);
    if (!element?.getBoundingClientRect) return null;
    if (element.getBoundingClientRect().top > viewport.bottom) break;
    visible.push({ ...entry, element, number: index + 1 });
  }
  return visible;
}

function measureLines(view, sheet, scale, { numberText = false, locateBreaks = false, viewport, visibleParagraphs } = {}) {
  const top = sheet.getBoundingClientRect().top, lines = [], containers = new Map(); let paragraph = 0;
  const measure = (node, pos, visibleElement) => {
    if (numberText && node.type.name === 'table') return;
    if (node.type.name === 'table' || node.type.name === 'image' || node.type.name === 'horizontalRule') {
      const element = view.nodeDOM(pos), box = element?.getBoundingClientRect();
      if (box) lines.push({ pos, top: (box.top - top) / scale, height: box.height / scale, inline: false, table: node.type.name === 'table' });
      return false;
    }
    if (!node.isTextblock) return;
    // Count every paragraph in document order. Only nearby paragraph starts
    // need glyph measurements when row and page numbering are disabled.
    paragraph++;
    const element = visibleElement || view.nodeDOM(pos); if (!element?.getBoundingClientRect) return false;
    if (viewport && !visibleElement) {
      const container = element.closest('.manuscript > *') || element;
      if (!containers.has(container)) containers.set(container, container.getBoundingClientRect());
      const box = containers.get(container);
      if (box.bottom < viewport.top || box.top > viewport.bottom) return false;
    }
    const style = getComputedStyle(element), lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const rows = [], bands = new Map(), tolerance = lineHeight * .45;
    function addRow(y, height, breakPosition) {
      // Different marks and bidi text can produce multiple rectangles on the
      // same visual line. A band this narrow holds at most one distinct row.
      const band = Math.floor(y / tolerance);
      let firstMatch = rows.length;
      for (let key = band - 1; key <= band + 1; key++) {
        const index = bands.get(key);
        if (index < firstMatch && Math.abs(rows[index].top - y) < tolerance) firstMatch = index;
      }
      if (firstMatch < rows.length) {
        rows[firstMatch].height = Math.max(rows[firstMatch].height, height);
        return;
      }
      bands.set(band, rows.length);
      rows.push({ pos, top: y, height, inline: true, breakPosition });
    }
    while (walker.nextNode()) {
      const text = walker.currentNode;
      if (!text.length || text.parentElement.closest('.ghost-text,.ai-loading,.pagination-spacer')) continue;
      const range = document.createRange();
      if (viewport) { range.setStart(text, 0); range.setEnd(text, 1); }
      else range.selectNodeContents(text);
      for (const box of range.getClientRects()) {
        if (!box.height || (!viewport && !box.width)) continue;
        const y = (box.top - top) / scale - Math.max(0, lineHeight - box.height / scale) / 2;
        addRow(y, Math.max(lineHeight, box.height / scale), locateBreaks ? () => wrappedLineStart(view, text, box.top) : undefined);
        if (viewport) break;
      }
      if (viewport && rows.length) break;
    }
    for (const br of element.querySelectorAll('br:not(.ProseMirror-trailingBreak)')) {
      const box = br.getBoundingClientRect(), y = (box.top - top) / scale - Math.max(0, lineHeight - box.height / scale) / 2;
      addRow(y, lineHeight, locateBreaks ? () => view.posAtDOM(br, 0) : undefined);
      if (viewport) break;
    }
    if (!rows.length) addRow((element.getBoundingClientRect().top - top) / scale, lineHeight, locateBreaks ? () => pos + 1 : undefined);
    rows.sort((a, b) => a.top - b.top);
    rows[0].force = Boolean(node.attrs.pageBreakBefore); rows[0].paragraph = paragraph;
    for (const row of rows) lines.push(row);
    return false;
  };
  if (visibleParagraphs) {
    for (const item of visibleParagraphs) { paragraph = item.number - 1; measure(item.node, item.pos, item.element); }
  } else view.state.doc.descendants((node, pos) => measure(node, pos));
  return lines;
}

export const Pagination = Extension.create({
  name: 'pagination',
  addProseMirrorPlugins() { return [new Plugin({
    key: paginationKey,
    state: { init: () => ({ enabled: false, decorations: DecorationSet.empty }), apply(tr, previous) {
      const meta = tr.getMeta(paginationKey);
      if (meta) return { ...previous, ...meta };
      return tr.docChanged ? { ...previous, reveal: true, decorations: previous.decorations.map(tr.mapping, tr.doc) } : previous;
    } },
    props: { decorations: state => paginationKey.getState(state).decorations },
    view(view) {
      let sheet, scroller;
      let frame = 0, numberFrame = 0, timer = 0, working = false, disposed = false, width = 0;
      let numberedViewport = null;
      const furniture = document.createElement('div'); furniture.className = 'page-furniture'; furniture.setAttribute('aria-hidden', 'true');
      const gutter = document.createElement('div'); gutter.className = 'text-numbering'; gutter.setAttribute('aria-hidden', 'true');
      const viewportNumbering = state => !state.enabled && state.numbering?.paragraph && !state.numbering.row && !state.numbering.page;
      function numberLines(state, scale, pages, measuredLines) {
        const enabled = Object.entries(state.numbering || {}).filter(([, value]) => value);
        numberedViewport = null;
        if (!enabled.length) { gutter.replaceChildren(); return; }
        const bounds = viewportNumbering(state) ? scroller.getBoundingClientRect() : null;
        const viewport = bounds ? { top: bounds.top - bounds.height, bottom: bounds.bottom + bounds.height } : null;
        const lines = measuredLines || measureLines(view, sheet, scale, { numberText: true, viewport, visibleParagraphs: viewport && paragraphWindow(view, viewport) });
        const rows = lines.filter(line => line.inline);
        const pageRows = [];
        if (state.numbering.page && state.enabled) {
          const margin = parseFloat(getComputedStyle(sheet).paddingTop) || 56;
          pages.forEach((page, index) => pageRows.push({ top: index ? page.top + margin : rows[0]?.top || 0, number: index + 1 }));
        } else if (state.numbering.page) {
          // Use the same virtual page boundaries in continuous view, without
          // inserting page gaps into the text merely to display page numbers.
          pageRows.push({ top: rows[0]?.top || 0, number: 1 });
          let index = 0;
          for (const item of pages.breaks) {
            // In natural flow a wrapped line is identified by its containing
            // block and its vertical coordinate. A table or image break uses
            // the first numbered line at or after that block.
            while (index < rows.length && (rows[index].pos < item.pos || rows[index].pos === item.pos && rows[index].top < item.top)) index++;
            const row = rows[index];
            if (row) pageRows.push({ top: row.top, number: pageRows.length + 1 });
          }
        }
        const columns = [];
        for (const [kind] of enabled) {
          const column = document.createElement('div'); column.className = `numbering-column ${kind}-numbers`;
          const heading = document.createElement('span'); heading.className = 'numbering-heading'; heading.textContent = { row: 'Row', page: 'Page', paragraph: '¶' }[kind]; column.append(heading);
          const items = kind === 'page' ? pageRows : kind === 'paragraph' ? rows.filter(row => row.paragraph).map(row => ({ ...row, number: row.paragraph })) : rows.map((row, index) => ({ ...row, number: index + 1 }));
          for (const item of items) {
            const label = document.createElement('span'); label.className = 'text-number'; label.textContent = String(item.number); label.style.top = `${item.top}px`; label.style.lineHeight = `${item.height || rows[0]?.height || 24}px`; column.append(label);
          }
          columns.push(column);
        }
        gutter.replaceChildren(...columns);
        if (bounds) numberedViewport = { doc: view.state.doc, from: scroller.scrollTop - bounds.height, to: scroller.scrollTop + 2 * bounds.height };
      }
      function refreshNumbers(event) {
        if (disposed || !sheet || !viewportNumbering(paginationKey.getState(view.state)) || numberFrame) return;
        // Each drawing already covers an extra screen above and below the
        // viewport. Small scrolls can keep displaying those same labels.
        if (event?.type === 'scroll' && numberedViewport?.doc === view.state.doc &&
            scroller.scrollTop >= numberedViewport.from && scroller.scrollTop + scroller.clientHeight <= numberedViewport.to) return;
        numberFrame = requestAnimationFrame(() => {
          numberFrame = 0;
          const state = paginationKey.getState(view.state);
          if (disposed || working || !viewportNumbering(state)) return;
          numberLines(state, sheetScale(sheet), { breaks: [] });
        });
      }
      function layout() {
        frame = 0; if (disposed || working || view.composing) { if (!disposed) schedule(false); return; }
        if (!sheet) {
          sheet = view.dom.closest('.writing-sheet'); if (!sheet) { schedule(false); return; }
          scroller = sheet.closest('.writing-scroll'); scroller.addEventListener('scroll', refreshNumbers, { passive: true });
          sheet.prepend(furniture, gutter); resize.observe(sheet); resize.observe(view.dom);
        }
        working = true;
        cancelAnimationFrame(numberFrame); numberFrame = 0;
        const state = paginationKey.getState(view.state), oldScroll = scroller.scrollTop;
        try {
          // Restore natural flow for measurement synchronously within one frame.
          if (state.decorations !== DecorationSet.empty) view.dispatch(view.state.tr.setMeta(paginationKey, { decorations: DecorationSet.empty }).setMeta('addToHistory', false));
          sheet.style.removeProperty('min-height'); furniture.replaceChildren();
          // ResizeObserver also reports the initial size after this frame.
          // Remember the width we actually measured so it won't repaginate.
          width = sheet.getBoundingClientRect().width;
          const scale = sheetScale(sheet);
          const height = Math.round(sheet.offsetWidth * Math.SQRT2), margin = parseFloat(getComputedStyle(sheet).paddingTop) || 56;
          if (!state.enabled) {
            delete sheet.dataset.pageCount;
            if (state.numbering?.page) {
              const lines = measureLines(view, sheet, scale);
              const pages = arrangePages(lines, height, margin);
              // Page layout keeps a table together. Its cell text gets its
              // own row and paragraph numbers in the numbering pass.
              numberLines(state, scale, pages, lines.some(line => line.table) ? null : lines);
            } else numberLines(state, scale, { breaks: [] });
            return;
          }
          const result = arrangePages(measureLines(view, sheet, scale, { locateBreaks: true }), height, margin);
          const decorations = result.breaks.map((item, index) => Decoration.widget(item.pos, () => {
            const gap = document.createElement(item.inline ? 'span' : 'div'); gap.className = 'pagination-spacer'; gap.style.height = `${item.height}px`; gap.setAttribute('aria-hidden', 'true'); gap.setAttribute('contenteditable', 'false'); return gap;
          }, { side: -1, key: `page-${index}-${item.pos}-${item.height}`, ignoreSelection: true }));
          view.dispatch(view.state.tr.setMeta(paginationKey, { decorations: DecorationSet.create(view.state.doc, decorations) }).setMeta('addToHistory', false));
          for (const [index, page] of result.pages.entries()) {
            const card = document.createElement('div'); card.className = 'page-card'; card.style.top = `${page.top}px`; card.style.height = `${page.height}px`;
            const number = document.createElement('span'); number.textContent = String(index + 1); card.append(number); furniture.append(card);
          }
          sheet.style.minHeight = `${result.height}px`; sheet.dataset.pageCount = String(result.pages.length);
          numberLines(state, scale, result.pages);
        } finally {
          scroller.scrollTop = oldScroll;
          if (state.enabled && state.reveal && view.hasFocus() && view.state.selection.empty) {
            const caret = view.coordsAtPos(view.state.selection.head), bounds = scroller.getBoundingClientRect();
            if (caret.bottom > bounds.bottom - 48) scroller.scrollTop += caret.bottom - bounds.bottom + 80;
            else if (caret.top < bounds.top + 24) scroller.scrollTop += caret.top - bounds.top - 48;
          }
          if (state.reveal) view.dispatch(view.state.tr.setMeta(paginationKey, { reveal: false }).setMeta('addToHistory', false));
          working = false;
        }
      }
      function schedule(immediate = false) {
        if (disposed) return;
        if (immediate) {
          clearTimeout(timer); timer = 0;
          if (!frame) frame = requestAnimationFrame(layout);
          return;
        }
        clearTimeout(timer);
        timer = setTimeout(() => { timer = 0; if (!frame && !disposed) frame = requestAnimationFrame(layout); }, 180);
      }
      const resize = new ResizeObserver(() => { const next = sheet.getBoundingClientRect().width; if (Math.abs(next - width) > 0.5) { width = next; schedule(true); } else refreshNumbers(); });
      const fonts = () => schedule(true); document.fonts?.addEventListener('loadingdone', fonts); view.dom.addEventListener('load', fonts, true);
      schedule(true);
      return { update(next, previous) {
        const current = paginationKey.getState(next.state), before = paginationKey.getState(previous);
        if (working) return;
        const configurationChanged = current.enabled !== before.enabled || current.revision !== before.revision;
        if (configurationChanged) schedule(true);
        else if (!next.state.doc.eq(previous.doc) && (current.enabled || Object.values(current.numbering || {}).some(Boolean))) schedule(false);
      }, destroy() { disposed = true; clearTimeout(timer); cancelAnimationFrame(frame); cancelAnimationFrame(numberFrame); resize.disconnect(); scroller?.removeEventListener('scroll', refreshNumbers); document.fonts?.removeEventListener('loadingdone', fonts); view.dom.removeEventListener('load', fonts, true); furniture.remove(); gutter.remove(); sheet?.style.removeProperty('min-height'); } };
    }
  })]; }
});
