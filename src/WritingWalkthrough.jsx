import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, Check, ChevronRight, Pause, Play, X } from 'lucide-react';
import { TextSelection } from '@tiptap/pm/state';
import { DEFAULT_HOTKEYS, formatShortcut } from './hotkeys.js';
import { AI_STEPS, CORRECTION_SENTENCE, TUTORIAL_OPENING, TUTORIAL_STEPS, newTutorialSession, nextTutorialStep, tutorialEvent } from './tutorial.js';
import { findTextMatches } from './search.js';

const api = window.wraiter;
const errorText = error => String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const targets = {
  welcome: '.chapter-list', chapter: '.add-chapter', opening: '.manuscript', complete: '.manuscript', preview: '.ghost-text, .ghost-controls', practice: '.manuscript', rephrase: '.revision-source, .rephrase-options, .manuscript', undo: '[aria-label="Undo (Ctrl Z)"], [aria-label="Redo (Ctrl Shift Z)"]', correct: '.manuscript',
  voice: '[data-tour="notes"], .voice', references: '[data-tour="references"], .reference-card', chat: '[aria-label="Toggle writing assistant"], .chat-composer', history: '[data-tour="history"], .history-tabs', find: '.sidebar-search, .search-bar', pages: '[data-tour="page-view"]', focus: '[aria-label="Focus view"]', save: '.save-indicator', export: '[data-tour="export"]', finish: '.project-tabs-bar'
};

export function useWritingWalkthrough(state, host) {
  const [session, setSession] = useState(null), [error, setError] = useState(''), [starting, setStarting] = useState(false);
  const latest = useRef({ state, host }), sessionRef = useRef(null), prepared = useRef(''), writes = useRef(Promise.resolve()), startingRef = useRef(false);
  latest.current = { state, host };
  function commit(next) {
    sessionRef.current = next; setSession(next);
    // Save each meaningful action, in order. Typing itself lives in the normal document recovery.
    const work = writes.current.then(() => api.settings({ tutorialSession: next }));
    writes.current = work.catch(error => setError('Could not save tutorial progress: ' + errorText(error)));
    return work;
  }
  function restore(saved) { sessionRef.current = saved || null; setSession(saved || null); }
  async function begin(saved = sessionRef.current) {
    if (startingRef.current) return;
    startingRef.current = true; setStarting(true); setError('');
    try {
      const { state, host } = latest.current;
      host.closeModal();
      if (saved && state.workspace.tabs.some(tab => tab.id === saved.tabId)) {
        const result = await host.activate(saved.tabId);
        if (result?.project?.id !== saved.projectId) throw new Error('The practice document changed. End this tour, then start a new one from Help.');
        prepared.current = ''; await commit({ ...saved, paused: false });
      } else {
        const returnTabId = state.workspace.activeId;
        const result = await host.create();
        if (!result?.project) throw new Error('The practice manuscript could not be opened. Your existing work is still available.');
        prepared.current = ''; await commit(newTutorialSession(result.workspace.activeId, result.project.id, returnTabId));
      }
      latest.current.host.showWorkspace();
    } catch (error) { setError(errorText(error)); }
    finally { startingRef.current = false; setStarting(false); }
  }
  function emit(type, detail = {}) {
    const current = sessionRef.current;
    if (current && ['opening', 'complete', 'preview', 'practice', 'rephrase'].includes(current.step) && latest.current.state.activeId !== current.chapterId) return;
    const next = tutorialEvent(current, { type, projectId: latest.current.state.project?.id, ...detail });
    if (next !== current) commit(next).catch(() => {});
  }
  const isCurrent = !!session && state.project?.id === session.projectId && state.workspace.activeId === session.tabId;
  const active = isCurrent && !session.paused;
  function next() {
    if (!sessionRef.current) return;
    latest.current.host.dismiss(); prepared.current = '';
    if (sessionRef.current.step === 'focus') latest.current.host.showWorkspace();
    commit(nextTutorialStep(sessionRef.current)).catch(() => {});
  }
  async function pause() {
    await latest.current.host.dismiss();
    if (sessionRef.current) await commit({ ...sessionRef.current, paused: true }).catch(() => {});
  }
  async function finish(returnToWriting = false) {
    setError('');
    try {
      const current = sessionRef.current;
      if (latest.current.state.project?.id === current?.projectId) { await latest.current.host.dismiss(); await latest.current.host.save(); }
      await writes.current;
      await latest.current.host.updatePrefs({ tutorialComplete: true, tutorialSession: null });
      restore(null);
      if (returnToWriting && latest.current.state.workspace.tabs.some(tab => tab.id === current?.returnTabId)) await latest.current.host.activate(current.returnTabId);
    } catch (error) { setError(errorText(error)); }
  }
  // Leave the real document, shortcuts and controls interactive. The coach has
  // its own reserved area; highlighting never covers the target with an overlay.
  useEffect(() => {
    if (!active || state.modal) return;
    const nodes = [...document.querySelectorAll(targets[session.step] || '')];
    nodes.forEach(node => node.classList.add('tour-target'));
    return () => nodes.forEach(node => node.classList.remove('tour-target'));
  }, [active, session?.step, state.panel, state.editor, state.ghost, state.modal, state.focus, state.searchOpen]);

  const editorMatches = active && !state.switching && state.editor && !state.editor.isDestroyed && state.editor.storage.wraiterContext?.projectId === session.projectId && state.editor.storage.wraiterContext?.chapterId === state.activeId;
  useEffect(() => {
    if (!editorMatches || state.modal || session.step !== 'opening' || state.activeId !== session.chapterId) return;
    const editor = state.editor;
    let stopped = false, timer;
    const wasEditable = editor.isEditable;
    const existing = editor.state.doc.textContent;
    if (!TUTORIAL_OPENING.startsWith(existing)) { emit('seeded'); return; }
    editor.setEditable(false);
    const type = () => {
      if (stopped || editor.isDestroyed || !latest.current.host.canType(editor, session.projectId) || latest.current.state.activeId !== session.chapterId) return;
      const text = editor.state.doc.textContent;
      if (!TUTORIAL_OPENING.startsWith(text)) { editor.setEditable(wasEditable); emit('seeded'); return; }
      if (text === TUTORIAL_OPENING) {
        editor.setEditable(wasEditable); editor.commands.focus('end'); emit('seeded'); return;
      }
      const rest = TUTORIAL_OPENING.slice(text.length), word = rest.match(/^\s*\S+\s*/)?.[0] || rest;
      const pos = editor.state.doc.content.size - 1;
      const tr = editor.state.tr.insertText(word, pos).setMeta('historyLabel', 'Tutorial: opening words');
      tr.setSelection(TextSelection.create(tr.doc, pos + word.length)); editor.view.dispatch(tr);
      timer = setTimeout(type, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 65);
    };
    type();
    return () => { stopped = true; clearTimeout(timer); if (!editor.isDestroyed) editor.setEditable(wasEditable); };
  }, [editorMatches, session?.step, session?.chapterId, state.editor, state.activeId, state.modal]);

  useEffect(() => {
    if (!active || state.modal || !['rephrase', 'correct'].includes(session.step)) return;
    const key = `${session.tabId}:${session.step}`;
    if (prepared.current === key) return;
    const chapterId = session.step === 'correct' ? state.project.chapters[0]?.id : session.chapterId;
    if (!state.project.chapters.some(chapter => chapter.id === chapterId)) return;
    if (state.activeId !== chapterId) { latest.current.host.changeChapter(chapterId); return; }
    if (!editorMatches) return;
    const text = session.step === 'correct' ? CORRECTION_SENTENCE : 'software';
    const match = findTextMatches(state.editor.state.doc, text)[0];
    prepared.current = key;
    if (match) {
      latest.current.host.showWorkspace();
      state.editor.chain().focus().setTextSelection(match).scrollIntoView().run();
    }
  }, [active, session?.step, state.activeId, state.editor, editorMatches, state.modal]);

  useEffect(() => { if (active && session.step === 'export' && state.modal?.type === 'export') emit('export-opened'); }, [active, session?.step, state.modal]);

  function showPassage() {
    prepared.current = '';
    latest.current.host.showWorkspace();
    const current = sessionRef.current;
    const chapterId = current.step === 'correct' ? latest.current.state.project.chapters[0]?.id : current.chapterId;
    if (chapterId && latest.current.state.project.chapters.some(chapter => chapter.id === chapterId)) latest.current.host.changeChapter(chapterId);
    else setError('The practice chapter was removed. You can skip this lesson or end the tour and start another from Help.');
    // Trigger preparation again even if the chapter was already active.
    setSession(current => ({ ...current }));
    const editor = latest.current.state.editor;
    if (editor && !editor.isDestroyed && editor.storage.wraiterContext?.chapterId === chapterId) {
      const match = findTextMatches(editor.state.doc, current.step === 'correct' ? CORRECTION_SENTENCE : 'software')[0];
      if (match) editor.chain().focus().setTextSelection(match).scrollIntoView().run();
      else editor.commands.focus('end');
    }
  }
  async function prepareChat() {
    await latest.current.host.dismiss();
    const current = sessionRef.current;
    if (current.chapterId && latest.current.state.project.chapters.some(chapter => chapter.id === current.chapterId)) latest.current.host.changeChapter(current.chapterId);
    latest.current.host.prepareChat('Add one short, playful sentence to the end of the active chapter. Keep the existing text.');
  }
  function returnToChapter() {
    const current = sessionRef.current;
    latest.current.host.showWorkspace();
    if (latest.current.state.project.chapters.some(chapter => chapter.id === current.chapterId)) latest.current.host.changeChapter(current.chapterId);
    else { prepared.current = ''; commit({ ...current, step: 'chapter', chapterId: '', flags: {} }).catch(() => {}); }
  }
  return { session, active, isCurrent, error, starting, begin, restore, emit, next, pause, finish, showPassage, prepareChat, returnToChapter, flush: () => writes.current };
}

export default function WritingWalkthrough({ tour, state, onSetup, onEnable, onExport }) {
  const { session, active, isCurrent, starting, error } = tour;
  if (!session && !starting && !error) return null;
  const keys = { ...DEFAULT_HOTKEYS, ...state.prefs.hotkeys }, key = name => formatShortcut(keys[name]);
  if (!session) return <aside className="walkthrough compact" aria-label="Writing walkthrough"><p role="status">{starting ? 'Opening your practice manuscript…' : error}</p><button onClick={() => tour.begin()}>Try again</button></aside>;
  if (!active) return <aside className="walkthrough compact" aria-label="Writing walkthrough"><BookOpen size={18} /><p><strong>Writing walkthrough {isCurrent ? 'paused' : 'is in your practice tab'}.</strong> Your progress and practice story are kept.</p><button className="primary-button" disabled={starting} onClick={() => tour.begin()}><Play size={14} />{isCurrent ? 'Resume walkthrough' : 'Return to walkthrough'}</button><button className="text-button" onClick={() => tour.finish()}>End walkthrough</button>{error && <p role="alert">{error}</p>}</aside>;
  const flags = session.flags;
  const lessons = {
    welcome: ['A story you can learn in', 'This is a separate practice manuscript, with a short first chapter already started. Your own projects stay in their tabs. You’ll use the real editor and your connected AI; each request uses your provider’s allowance. Nothing is generated until you ask.', 'Let’s begin'],
    chapter: ['Make room for the next chapter', 'Click the highlighted New chapter button on the left. Chapters keep a longer manuscript organised. The title above the page can be renamed directly; the small arrows beside it change chapter order.'],
    opening: ['A beginning to build on', 'The walkthrough is typing the opening of your second chapter. In a moment, you’ll take over.'],
    complete: ['Give the story its next few words', `The cursor is after “One day”. Press ${key('complete')} in the manuscript to ask your AI what could happen next. The Suggest button does the same thing. This is a real request using your chosen autocomplete model.`],
    preview: ['The faint words are only a possibility', `Try ${key('acceptWord')} to bring in one word, or ${key('acceptCharacter')} for one character. ${key('accept')} accepts all the remaining words. ${key('dismiss')} dismisses a preview or cancels a pending request; then ${key('complete')} asks again. Only accepted words become your story.`],
    practice: ['Take the story a little further', `Continue for a few sentences. Write your own words, ask again with ${key('complete')}, and accept only what fits. Try dismissing an idea with ${key('dismiss')}. There’s no right ending, and no need to hurry.`, 'Try changing a word'],
    rephrase: ['Would another word fit better here?', `“Software” in “There was once a software called Wraiter” is selected for you. Press ${key('complete')} to ask for alternatives to just that word. Use Up / Down to explore them, then Enter or ${key('accept')} to choose. ${key('dismiss')} keeps the original. If you changed that sentence, select another word instead.`, 'Explore undo'],
    undo: ['You can always change your mind', 'Undo your word replacement with Ctrl+Z or the highlighted Undo button. Then restore it with Ctrl+Shift+Z, Ctrl+Y, or Redo. Accepted AI suggestions use the same editing history as your own changes.', 'Try correction'],
    correct: ['A second pair of eyes', `We’ve returned to chapter one and selected a sentence with “wasnt”. Press ${key('correct')} or click Correct. Read the proposed correction, then ${key('accept')} to apply it. Correction checks the selected text; rephrasing offers different ways to say it.`, 'Give AI some direction'],
    voice: ['Tell AI how you want to sound', 'Open Notes & voice on the left. Private notes are for you; they are never sent to AI. Your writing voice is shared. Try adding “Keep the tone playful and the sentences clear” to the writing-voice box. It will guide the next request.', 'Explore references'],
    references: ['Give the assistant a little background', 'Open Reference library on the left. This practice story includes a small background note. Read it and try switching Include in AI context off or on. Only enabled references accompany requests. For your own work, Add reference files attaches a text or Markdown file.', 'Try the writing assistant'],
    chat: ['Ask for a change in everyday words', 'The assistant on the right can answer questions and edit your document. Prepare the example below, then send it yourself with the arrow button or Ctrl+Enter. It asks for one more sentence. A direct edit applies to the document; Undo assistant edit can reverse it. A selection limits edits to that passage.', 'See where changes go'],
    history: ['Your changes leave a trail', 'Open Revision history on the left. Every edit shows typing, accepted suggestions and assistant changes. Expand an entry to inspect it. Checkpoints are labelled versions you can return to; they require Git. Ordinary undo and recovery work without Git.', 'Find your way around'],
    find: ['Find a passage without losing your place', `Use Find in chapter or ${key('find')}, then search for a word in this chapter. Next match moves through results. Replace changes one match; All changes every match in this chapter. You can close the search with its ×.`, 'Explore the page view'],
    pages: ['Choose how the page feels', 'Click Continuous view / Divided pages at the bottom of the editor. It changes the writing view without adding breaks to the manuscript. Ctrl+Enter inserts a real page break. Content language beside it guides spelling, AI correction and translation; a native language can be set in Settings.', 'Try focus view'],
    focus: ['A little more space to think', `Press ${key('focus')} or use Focus view near the top right of the document. The side panels and toolbars step aside. The same shortcut brings them back; the View menu can reopen individual panels.`, 'Learn about saving'],
    save: ['Give your practice story a home', `Recovery saves work on this computer, but it isn’t a file you chose or a remote backup. Use ${key('save')} or Save to choose a location for this practice manuscript. You can keep it, or skip saving a named file for now. ${key('saveCopy')} is Save as.`, 'Explore export'],
    export: ['Share a copy of your writing', 'Open Export to see the real options: the whole manuscript, a chapter, or a selection; office files, PDF, EPUB and text formats. Text formats can also go to the clipboard. An export is a separate copy and excludes private notes and AI context. You can close the export window without creating a file.', 'Finish the walkthrough'],
    finish: ['You’re ready for your own story', `Your practice manuscript stays in its tab. Use ${key('new')} for a new project or ${key('open')} to open existing writing. AI on/off controls assistance; automatic suggestions can be enabled when you want them. Settings → Keyboard shortcuts lets you change bindings. Help → Writing tutorial starts this walkthrough again.`, 'Keep writing here']
  };
  const [title, body, nextLabel] = lessons[session.step];
  const ready = session.step === 'rephrase' ? flags.rephrased : session.step === 'undo' ? flags.undone && flags.redone : session.step === 'correct' ? flags.corrected : session.step === 'voice' ? state.panel === 'notes' && !!state.project.style.trim() : session.step === 'references' ? state.panel === 'references' : session.step === 'chat' ? flags.chatted : session.step === 'history' ? state.panel === 'history' : session.step === 'find' ? state.searchOpen && !!state.query.trim() : session.step === 'pages' ? flags.pages : session.step === 'focus' ? flags.focused : session.step === 'save' ? flags.saved : session.step === 'export' ? flags.exported && !state.modal : true;
  return <aside className="walkthrough" aria-label="Writing walkthrough" data-step={session.step}>
    <div className="walkthrough-heading"><span><BookOpen size={17} /> LEARNING WRAITER <small>{TUTORIAL_STEPS.indexOf(session.step) + 1} / {TUTORIAL_STEPS.length}</small></span><div><button className="text-button" onClick={tour.pause}><Pause size={13} />Pause</button><button className="text-button" onClick={() => tour.finish()} aria-label="End walkthrough"><X size={15} />End tour</button></div></div>
    <div className="walkthrough-content"><div className="walkthrough-copy"><h2>{title}</h2><p>{body}</p>
      {state.busy && <p className="walkthrough-status" role="status">Your AI is working… {key('dismiss')} cancels an inline request.</p>}
      {session.step === 'preview' && (flags.word || flags.character || flags.dismissed) && <p className="walkthrough-status" role="status">{flags.word ? 'You accepted a word. ' : ''}{flags.character ? 'You accepted a character. ' : ''}{flags.dismissed ? 'You dismissed a suggestion. Ask again whenever you like. ' : ''}</p>}
      {session.step === 'undo' && flags.undone && <p className="walkthrough-status" role="status">{flags.redone ? 'Undone, then restored. You’re in control.' : 'Undone. Now try Redo to bring the replacement back.'}</p>}
      {(error || (AI_STEPS.includes(session.step) && state.aiError)) && <p className="walkthrough-error" role="alert">{error || state.aiError} You can check AI setup, retry from the editor, or skip this lesson.</p>}
      {AI_STEPS.includes(session.step) && !state.prefs.enabled && <p className="walkthrough-status">AI is off. Enable your saved connection or open AI setup. You can also skip this lesson and explore the other controls.</p>}
    </div><div className="walkthrough-actions">
      {session.chapterId && ['opening', 'complete', 'preview', 'practice', 'rephrase'].includes(session.step) && state.activeId !== session.chapterId && <button className="secondary-button" onClick={tour.returnToChapter}>{state.project.chapters.some(chapter => chapter.id === session.chapterId) ? 'Return to practice chapter' : 'Make another practice chapter'}</button>}
      {AI_STEPS.includes(session.step) && (!state.prefs.enabled || state.aiError) && <><button className="secondary-button" onClick={onSetup}>AI setup</button>{!state.prefs.enabled && <button className="secondary-button" onClick={onEnable}>Enable AI</button>}</>}
      {['rephrase', 'correct'].includes(session.step) && <button className="secondary-button" disabled={!!state.busy} onClick={tour.showPassage}>Show the passage</button>}
      {session.step === 'chat' && <button className="secondary-button" disabled={!!state.busy} onClick={tour.prepareChat}>Prepare a chat request</button>}
      {session.step === 'export' && !state.modal && <button className="secondary-button" onClick={onExport}>Open Export</button>}
      {session.step === 'preview' && flags.accepted && !state.ghost && <button className="primary-button" onClick={tour.next}>Keep practising <ChevronRight size={14} /></button>}
      {nextLabel && <button className="primary-button" disabled={!ready || !!state.busy || !!state.modal} onClick={() => session.step === 'finish' ? tour.finish() : tour.next()}>{ready && !['welcome', 'practice', 'finish'].includes(session.step) ? <Check size={14} /> : <ChevronRight size={14} />}{nextLabel}</button>}
      {session.step === 'finish' && <button className="secondary-button" onClick={() => tour.finish(true)}>Return to my writing</button>}
      {!['welcome', 'chapter', 'opening', 'finish'].includes(session.step) && <button className="text-button" disabled={!!state.modal} onClick={tour.next}>{session.step === 'save' ? 'Continue without a named file' : 'Skip this lesson'}</button>}
    </div></div>
  </aside>;
}
