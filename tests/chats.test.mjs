import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_CHATS, activeChat, adoptChatMessages, chatTitle, normalizeProjectChats, persistedChat, withActiveChat, withChatMessage, withChatMessages, withNewChat } from '../src/chats.js';

const project = () => ({ id: 'project', title: 'Draft', chats: [], activeChatId: null });

test('chat sessions are named from their first question and can be revisited', () => {
  const created = withNewChat(project(), '2026-09-20T10:00:00.000Z');
  const first = withChatMessage(created.project, created.chat.id, { id: 'user-1', role: 'user', text: '  How should this scene end?  ' }, '2026-09-20T10:01:00.000Z');
  const answered = withChatMessage(first, created.chat.id, { id: 'assistant-1', role: 'assistant', text: 'Keep the ending quiet.' }, '2026-09-20T10:02:00.000Z');
  assert.equal(activeChat(answered).title, 'How should this scene end?');
  assert.deepEqual(activeChat(answered).messages.map(message => message.text), ['  How should this scene end?  ', 'Keep the ending quiet.']);
  const second = withNewChat(answered, '2026-09-20T11:00:00.000Z');
  assert.equal(activeChat(second.project).title, 'New chat');
  assert.equal(activeChat(withActiveChat(second.project, created.chat.id)).title, 'How should this scene end?');
});

test('legacy in-memory conversations migrate without entering manuscript content', () => {
  const messages = [{ id: 'u', role: 'user', text: 'A legacy question' }, { id: 'a', role: 'assistant', text: 'A legacy answer', pending: true }];
  const migrated = adoptChatMessages(normalizeProjectChats({ id: 'legacy' }), messages, '2026-09-20T12:00:00.000Z');
  assert.equal(migrated.chats.length, 1); assert.equal(activeChat(migrated).title, 'A legacy question');
  assert.equal(persistedChat(activeChat(migrated)).messages[1].pending, undefined);
  assert.equal(chatTitle('x'.repeat(100)).length, 64);
});

test('chat limits do not silently discard earlier sessions', () => {
  let value = project();
  for (let index = 0; index < MAX_CHATS; index++) value = withNewChat(value, new Date(index).toISOString()).project;
  const refused = withNewChat(value);
  assert.equal(refused.chat, null); assert.equal(refused.project, value); assert.equal(value.chats.length, MAX_CHATS);
  const selected = value.chats[0];
  assert.equal(withChatMessages(value, selected.id, [{ id: 'one', role: 'user', text: 'First' }]).chats[0].title, 'First');
});
