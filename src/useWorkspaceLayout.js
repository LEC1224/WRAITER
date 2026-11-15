import { useEffect, useRef, useState } from 'react';
import { reportError } from './diagnostics.js';

function captureView(editor, chapterId) {
  const { from, to } = editor.state.selection;
  return { chapterId, selection: { from, to }, scrollTop: editor.view.dom.closest('.writing-scroll')?.scrollTop || 0 };
}

export function useWorkspaceLayout(api, booted) {
  const [panel, setPanel] = useState(null), [focus, setFocus] = useState(false);
  const [leftOpen, setLeftOpen] = useState(() => api?.platform !== 'web' || !window.matchMedia('(max-width: 760px)').matches);
  const [historyTab, setHistoryTab] = useState('edits');
  const [panes, setPanes] = useState([]);
  const panesRef = useRef(panes), paneSnapshots = useRef(new Map()), paneEditors = useRef(new Map()), restoredViews = useRef(new Map());
  panesRef.current = panes;

  async function restoreLayout({ layout, workspace }, prepareProject) {
    if (!layout) return;
    setLeftOpen(layout.leftOpen); setPanel(layout.panel); setFocus(layout.focus); setHistoryTab(layout.historyTab);
    if (layout.panes.length < 2) return;
    try {
      const restored = await api.layoutPaneProjects();
      for (const { id, project, view } of restored) {
        try {
          const next = prepareProject(project);
          const chapter = next.chapters.find(chapter => chapter.id === view.chapterId);
          paneSnapshots.current.set(id, { project: next, chapterId: (chapter || next.chapters[0]).id, epoch: 0, tracking: false });
          if (chapter) restoredViews.current.set(id, view);
        } catch (error) { reportError('workspace.restore-pane', error); }
      }
      // Projects that no longer exist, including clean startup's old tabs,
      // never produce blank panes. installWorkspace will include the active tab.
      const next = layout.panes.filter(pane => pane.id === workspace.activeId || paneSnapshots.current.has(pane.id));
      panesRef.current = next; setPanes(next);
    } catch (error) { reportError('workspace.restore-layout', error); }
  }

  useEffect(() => {
    if (!booted || !api?.rememberWorkspaceLayout) return;
    api.rememberWorkspaceLayout({ leftOpen, panel, focus, historyTab, panes }).catch(error => reportError('workspace.save-layout', error));
  }, [api, booted, leftOpen, panel, focus, historyTab, panes]);

  useEffect(() => {
    if (!booted || !restoredViews.current.size) return;
    // The pane editors register on mount. Let their first layout settle before
    // positioning passive panes, without focusing or activating any of them.
    const frame = requestAnimationFrame(() => {
      for (const [id, view] of restoredViews.current) {
        const editor = paneEditors.current.get(id);
        if (!editor || editor.isDestroyed) continue;
        if (view.selection) editor.commands.setTextSelection(view.selection);
        const scroller = editor.view.dom.closest('.writing-scroll');
        if (scroller && Number.isFinite(view.scrollTop)) scroller.scrollTop = view.scrollTop;
      }
      restoredViews.current.clear();
    });
    return () => cancelAnimationFrame(frame);
  }, [booted]);

  function capturePaneViews(activeId) {
    return panesRef.current.flatMap(({ id }) => {
      if (id === activeId) return [];
      const editor = paneEditors.current.get(id), snapshot = paneSnapshots.current.get(id);
      return editor && !editor.isDestroyed && snapshot ? [{ id, view: captureView(editor, snapshot.chapterId) }] : [];
    });
  }

  return { panel, setPanel, leftOpen, setLeftOpen, focus, setFocus, historyTab, setHistoryTab,
    panes, setPanes, panesRef, paneSnapshots, paneEditors, restoreLayout, capturePaneViews };
}
