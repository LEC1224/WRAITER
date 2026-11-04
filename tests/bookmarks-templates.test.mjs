import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Transform } from '@tiptap/pm/transform';
import { editorialSchema } from '../electron/editor-schema.mjs';
import { newProject, paragraph, snapshot } from '../src/document.js';
import { chapterHeadings } from '../src/headings.js';
import { addBookmark, bookmarkRows, removeBookmark } from '../src/bookmarks.js';
import { addComment } from '../src/comments.js';
import { templateFromProject, projectFromTemplate, readTemplates, writeTemplates } from '../src/templates.js';
const require = createRequire(import.meta.url);
const { validateProject, hash } = require('../electron/core.cjs');
const { contentHash, DocumentFiles } = require('../electron/document-files.cjs');

test('heading locations include nested headings and use editor positions', () => {
  const content = { type: 'doc', content: [paragraph('First'), { type: 'blockquote', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Nested' }] }] }] };
  const headings = chapterHeadings(content);
  const doc = editorialSchema.nodeFromJSON(content);
  assert.equal(headings.length, 1);
  assert.equal(headings[0].title, 'Nested');
  assert.equal(doc.resolve(headings[0].from).parent.type.name, 'heading');
  assert.equal(chapterHeadings(content), headings);
});

test('bookmarks remain private and follow text edits independently of comments', () => {
  const project = newProject(); const chapter = project.chapters[0]; chapter.content = { type: 'doc', content: [paragraph('one two three')] };
  const commented = addComment(project, { chapterId: chapter.id, from: 1, to: 4, text: 'Comment' }).project;
  const bookmarked = addBookmark(commented, { chapterId: chapter.id, from: 5, to: 8 }, 'Second word').project;
  validateProject(bookmarked);
  assert.equal(bookmarked.comments.length, 1);
  assert.equal(bookmarkRows(bookmarked)[0].ranges[0].from, 5);
  const doc = editorialSchema.nodeFromJSON(bookmarked.chapters[0].content);
  const changed = new Transform(doc).insert(1, editorialSchema.text('new ')).doc.toJSON();
  const moved = { ...bookmarked, chapters: [{ ...chapter, content: changed }] };
  assert.equal(bookmarkRows(moved)[0].ranges[0].from, 9);
  const cleared = removeBookmark(moved, moved.bookmarks[0].id);
  assert.equal(cleared.comments.length, 1);
  assert.equal(bookmarkRows(cleared).length, 0);
  assert.equal(snapshot(bookmarked, 'Test').bookmarks[0].text, 'Second word');
});

test('templates create independent projects and omit private passage marks and metadata', () => {
  const project = newProject(); const chapter = project.chapters[0]; chapter.content = { type: 'doc', content: [paragraph('Some prose')] }; project.notes = 'Private';
  const bookmarked = addBookmark(project, { chapterId: chapter.id, from: 1, to: 5 }, 'Private bookmark').project;
  const template = templateFromProject(bookmarked, 'My starting point');
  const created = projectFromTemplate(template);
  assert.notEqual(created.id, project.id); assert.notEqual(created.chapters[0].id, chapter.id);
  assert.equal(created.notes, ''); assert.equal(created.bookmarks, undefined);
  assert.ok(!JSON.stringify(template).includes('commentAnchor'));
  validateProject(created);
  const data = new Map(); const storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
  writeTemplates([template], storage); assert.equal(readTemplates(storage)[0].name, 'My starting point');
});

test('private anchor changes do not dirty an attached office document', () => {
  const project = newProject(), chapter = project.chapters[0];
  chapter.content = editorialSchema.nodeFromJSON({ type: 'doc', content: [paragraph('one two three')] }).toJSON();
  const bookmarked = addBookmark(project, { chapterId: chapter.id, from: 5, to: 8 }, 'Place').project;
  assert.equal(contentHash(bookmarked), contentHash(project));
  bookmarked.chapters[0].content.content[0].content[1].text = 'TWO';
  assert.notEqual(contentHash(bookmarked), contentHash(project));
});

test('old sidecar hashes migrate only if they matched the exact saved content', async () => {
  const project = newProject();
  const legacy = hash(JSON.stringify({ title: project.title, chapters: project.chapters, documentStyle: project.documentStyle, language: project.language, layout: project.layout }, (key, value) => key === 'pageBreakBefore' && value == null ? undefined : value));
  const files = new DocumentFiles({ currentPath: 'C:\\test.docx' }, 'C:\\test-profile');
  files.readSidecar = async () => ({ project, binding: { contentHash: legacy } });
  await files.recover(); assert.equal(files.binding.contentHash, contentHash(project));
  files.readSidecar = async () => ({ project, binding: { contentHash: 'an-unmatched-hash' } });
  await files.recover(); assert.equal(files.binding.contentHash, 'an-unmatched-hash');
});

test('a damaged template entry prevents a later save from silently dropping its data', () => {
  const saved = JSON.stringify([{ id: 'damaged', name: 'Recover this', chapters: null }]);
  let writes = 0;
  const storage = { getItem: () => saved, setItem: () => { writes++; } };
  assert.throws(() => readTemplates(storage), /data has not been changed/i);
  assert.equal(writes, 0);
});
