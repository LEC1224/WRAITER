import { newProject, paragraph, uid } from './document.js';

export const TUTORIAL_OPENING = "There was once a software called Wraiter, that was used to integrate AI in authors' workflows. One day";
export const CORRECTION_SENTENCE = 'The writer had a notebook full of ideas, but she wasnt sure where to begin.';
export const TUTORIAL_STEPS = ['welcome', 'chapter', 'opening', 'complete', 'preview', 'practice', 'rephrase', 'undo', 'correct', 'voice', 'references', 'chat', 'history', 'find', 'pages', 'focus', 'save', 'export', 'finish'];
export const AI_STEPS = ['complete', 'preview', 'practice', 'rephrase', 'correct', 'chat'];

export function tutorialProject() {
  const project = newProject();
  return { ...project, title: 'Learning WRAITER — your practice story', language: 'en-US',
    chapters: [{ ...project.chapters[0], title: 'A small beginning', content: { type: 'doc', content: [
      paragraph('The room was quiet, the page was empty, and an idea was waiting for its first words.'),
      paragraph(CORRECTION_SENTENCE),
      paragraph('Then she opened Wraiter. She would write the story herself, with a little help whenever she wanted it.')
    ] } }],
    notes: 'Private practice note: perhaps the story should end with a surprise. This note is not shared with AI.',
    references: [{ id: uid(), name: 'Practice story background', text: 'This is a playful story about an author learning to work with a writing application called Wraiter. The author remains in charge of the story.', enabled: true }]
  };
}
export function newTutorialSession(tabId, projectId, returnTabId) {
  return { version: 1, tabId, projectId, returnTabId: returnTabId || '', chapterId: '', step: 'welcome', paused: false, flags: {} };
}
// Only successful editor operations call these events. Merely pressing a key,
// a failed request, or activity in another project cannot complete a lesson.
export function tutorialEvent(session, event) {
  if (!session || session.paused || event.projectId !== session.projectId) return session;
  const { step } = session;
  if (event.type === 'chapter-created' && step === 'chapter') return { ...session, chapterId: event.chapterId, step: 'opening', flags: {} };
  if (event.type === 'seeded' && step === 'opening') return { ...session, step: 'complete', flags: {} };
  if (event.type === 'suggestion' && event.mode === 'continue' && step === 'complete') return { ...session, step: 'preview', flags: {} };
  if (event.type === 'accepted' && event.mode === 'continue' && ['complete', 'preview', 'practice'].includes(step)) {
    return { ...session, step: event.part === 'all' ? 'practice' : step, flags: { ...session.flags, accepted: true, ...(event.part === 'word' ? { word: true } : event.part === 'character' ? { character: true } : { whole: true }) } };
  }
  const flag = event.type === 'dismissed' && ['preview', 'practice'].includes(step) ? 'dismissed'
    : event.type === 'accepted' && event.mode === 'rewrite' && step === 'rephrase' ? 'rephrased'
    : event.type === 'undo' && step === 'undo' ? 'undone'
    : event.type === 'redo' && step === 'undo' && session.flags.undone ? 'redone'
    : event.type === 'accepted' && event.mode === 'correct' && step === 'correct' ? 'corrected'
    : event.type === 'no-change' && event.mode === 'correct' && step === 'correct' ? 'corrected'
    : event.type === 'chat-finished' && step === 'chat' ? 'chatted'
    : event.type === 'page-view' && step === 'pages' ? 'pages'
    : event.type === 'focus' && step === 'focus' ? 'focused'
    : event.type === 'saved' && step === 'save' ? 'saved'
    : event.type === 'export-opened' && step === 'export' ? 'exported' : '';
  if (!flag || session.flags[flag]) return session;
  return { ...session, flags: { ...session.flags, [flag]: true } };
}
export function nextTutorialStep(session) {
  const index = TUTORIAL_STEPS.indexOf(session.step);
  return { ...session, step: TUTORIAL_STEPS[Math.min(index + 1, TUTORIAL_STEPS.length - 1)], flags: {} };
}
