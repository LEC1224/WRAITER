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
        breaks.push({ pos: line.pos, height, inline: line.inline }); added += height; top += height;
        pages.push(next); page = next;
      }
      // Keep oversized objects visible; never cut a tall image/table in half.
      if (line.height > pageHeight - 2 * margin) page.height = line.height + 2 * margin;
    }
  }
  return { pages, breaks, height: pages.at(-1).top + pages.at(-1).height };
}

function measureLines(view, sheet, scale, numberText = false) {
  const top = sheet.getBoundingClientRect().top, lines = []; let paragraph = 0;
  view.state.doc.descendants((node, pos) => {
    if (numberText && node.type.name === 'table') return;
    if (node.type.name === 'table' || node.type.name === 'image' || node.type.name === 'horizontalRule') {
      const element = view.nodeDOM(pos), box = element?.getBoundingClientRect();
      if (box) lines.push({ pos, top: (box.top - top) / scale, height: box.height / scale, inline: false });
      return false;
    }
    if (!node.isTextblock) return;
    const element = view.nodeDOM(pos); if (!element?.getBoundingClientRect) return false;
    const style = getComputedStyle(element), lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT); const rows = [];
    while (walker.nextNode()) {
      const text = walker.currentNode;
      if (!text.length || text.parentElement.closest('.ghost-text,.ai-loading,.pagination-spacer')) continue;
      const range = document.createRange(); range.selectNodeContents(text);
      for (const box of range.getClientRects()) {
        if (!box.height || !box.width) continue;
        let low = 0, high = text.length;
        // Find the first character on this visual line without scanning each
        // character. Also works for CJK, long words, and styled text runs.
        while (low < high) {
          const mid = Math.floor((low + high) / 2); range.setStart(text, mid); range.setEnd(text, Math.min(text.length, mid + 1));
          if (range.getBoundingClientRect().top < box.top - 1) low = mid + 1; else high = mid;
        }
        const y = (box.top - top) / scale - Math.max(0, lineHeight - box.height / scale) / 2;
        const previous = rows.find(row => Math.abs(row.top - y) < lineHeight * 0.45);
        if (previous && Math.abs(previous.top - y) < lineHeight * 0.45) { previous.height = Math.max(previous.height, lineHeight, box.height / scale); continue; }
        rows.push({ pos: view.posAtDOM(text, low), top: y, height: Math.max(lineHeight, box.height / scale), inline: true });
      }
    }
    for (const br of element.querySelectorAll('br:not(.ProseMirror-trailingBreak)')) {
      const box = br.getBoundingClientRect(), y = (box.top - top) / scale - Math.max(0, lineHeight - box.height / scale) / 2;
      if (!rows.some(row => Math.abs(row.top - y) < lineHeight * .45)) rows.push({ pos: view.posAtDOM(br, 0), top: y, height: lineHeight, inline: true });
    }
    if (!rows.length) { const box = element.getBoundingClientRect(); rows.push({ pos: pos + 1, top: (box.top - top) / scale, height: lineHeight, inline: true }); }
    rows.sort((a, b) => a.top - b.top || a.pos - b.pos);
    rows[0].force = Boolean(node.attrs.pageBreakBefore); rows[0].paragraph = ++paragraph; lines.push(...rows); return false;
  });
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
      let sheet;
      let frame = 0, working = false, disposed = false, width = 0;
      const furniture = document.createElement('div'); furniture.className = 'page-furniture'; furniture.setAttribute('aria-hidden', 'true');
      const gutter = document.createElement('div'); gutter.className = 'text-numbering'; gutter.setAttribute('aria-hidden', 'true');
      function numberLines(state, scale, pages) {
        const enabled = Object.entries(state.numbering || {}).filter(([, value]) => value);
        if (!enabled.length) return;
        const rows = measureLines(view, sheet, scale, true).filter(line => line.inline);
        const pageRows = state.enabled ? pages.map((page, index) => ({ top: index ? page.top + (parseFloat(getComputedStyle(sheet).paddingTop) || 56) : rows[0]?.top || 0, number: index + 1 })) : [];
        if (!state.enabled) {
          // Use the same virtual page boundaries in continuous view, without
          // inserting page gaps into the text merely to display page numbers.
          pageRows.push({ top: rows[0]?.top || 0, number: 1 });
          for (const item of pages.breaks) {
            const row = rows.find(row => row.pos >= item.pos);
            if (row) pageRows.push({ top: row.top, number: pageRows.length + 1 });
          }
        }
        for (const [kind] of enabled) {
          const column = document.createElement('div'); column.className = `numbering-column ${kind}-numbers`;
          const heading = document.createElement('span'); heading.className = 'numbering-heading'; heading.textContent = { row: 'Row', page: 'Page', paragraph: '¶' }[kind]; column.append(heading);
          const items = kind === 'page' ? pageRows : kind === 'paragraph' ? rows.filter(row => row.paragraph).map(row => ({ ...row, number: row.paragraph })) : rows.map((row, index) => ({ ...row, number: index + 1 }));
          for (const item of items) {
            const label = document.createElement('span'); label.className = 'text-number'; label.textContent = String(item.number); label.style.top = `${item.top}px`; label.style.lineHeight = `${item.height || rows[0]?.height || 24}px`; column.append(label);
          }
          gutter.append(column);
        }
      }
      function layout() {
        frame = 0; if (disposed || working || view.composing) { if (!disposed) schedule(); return; }
        if (!sheet) { sheet = view.dom.closest('.writing-sheet'); if (!sheet) { schedule(); return; } sheet.prepend(furniture, gutter); resize.observe(sheet); }
        working = true;
        const state = paginationKey.getState(view.state), scroller = sheet.closest('.writing-scroll'), oldScroll = scroller.scrollTop;
        try {
          // Restore natural flow for measurement synchronously within one frame.
          view.dispatch(view.state.tr.setMeta(paginationKey, { decorations: DecorationSet.empty }).setMeta('addToHistory', false));
          sheet.style.removeProperty('min-height'); furniture.replaceChildren(); gutter.replaceChildren();
          const scale = sheet.getBoundingClientRect().width / sheet.offsetWidth;
          const height = Math.round(sheet.offsetWidth * Math.SQRT2), margin = parseFloat(getComputedStyle(sheet).paddingTop) || 56;
          if (!state.enabled) {
            delete sheet.dataset.pageCount;
            if (Object.values(state.numbering || {}).some(Boolean)) numberLines(state, scale, state.numbering.page ? arrangePages(measureLines(view, sheet, scale), height, margin) : { breaks: [] });
            return;
          }
          const result = arrangePages(measureLines(view, sheet, scale), height, margin);
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
          view.dispatch(view.state.tr.setMeta(paginationKey, { reveal: false }).setMeta('addToHistory', false));
          working = false;
        }
      }
      function schedule() { if (!frame && !disposed) frame = requestAnimationFrame(layout); }
      const resize = new ResizeObserver(() => { const next = sheet.getBoundingClientRect().width; if (Math.abs(next - width) > 0.5) { width = next; schedule(); } });
      const fonts = () => schedule(); document.fonts?.addEventListener('loadingdone', fonts); view.dom.addEventListener('load', fonts, true); schedule();
      return { update(next, previous) { const current = paginationKey.getState(next.state), before = paginationKey.getState(previous); if (!working && (!next.state.doc.eq(previous.doc) || current.enabled !== before.enabled || current.revision !== before.revision)) schedule(); }, destroy() { disposed = true; cancelAnimationFrame(frame); resize.disconnect(); document.fonts?.removeEventListener('loadingdone', fonts); view.dom.removeEventListener('load', fonts, true); furniture.remove(); gutter.remove(); sheet?.style.removeProperty('min-height'); } };
    }
  })]; }
});
