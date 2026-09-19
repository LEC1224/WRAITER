export const MAX_CHATS = 200;
export const MAX_CHAT_MESSAGES = 2000;

const now = () => new Date().toISOString();
const cleanTitle = value => String(value || '').replace(/\s+/g, ' ').trim();

export function chatTitle(text) {
  const title = cleanTitle(text);
  if (!title) return 'New chat';
  return title.length > 64 ? `${title.slice(0, 63).trimEnd()}…` : title;
}

export function createChat(date = now()) {
  return { id: crypto.randomUUID(), title: 'New chat', createdAt: date, updatedAt: date, messages: [] };
}

export function normalizeProjectChats(project) {
  const chats = Array.isArray(project?.chats) ? project.chats : [];
  const activeChatId = chats.some(chat => chat.id === project?.activeChatId)
    ? project.activeChatId
    : chats.at(-1)?.id || null;
  if (project?.chats === chats && project?.activeChatId === activeChatId) return project;
  return { ...project, chats, activeChatId };
}

export function activeChat(project) {
  return (project?.chats || []).find(chat => chat.id === project?.activeChatId) || null;
}

export function withActiveChat(project, chatId, date = now()) {
  if (!(project?.chats || []).some(chat => chat.id === chatId)) return project;
  return { ...project, activeChatId: chatId, updatedAt: date };
}

export function withNewChat(project, date = now()) {
  if ((project?.chats || []).length >= MAX_CHATS) return { project, chat: null };
  const chat = createChat(date);
  return { project: { ...project, chats: [...(project.chats || []), chat], activeChatId: chat.id, updatedAt: date }, chat };
}

export function withChatMessages(project, chatId, messages, date = now()) {
  const chats = project?.chats || [];
  const index = chats.findIndex(chat => chat.id === chatId);
  if (index < 0) return project;
  const previous = chats[index];
  const firstQuestion = messages.find(message => message.role === 'user')?.text;
  const chat = { ...previous, title: firstQuestion ? chatTitle(firstQuestion) : previous.title || 'New chat', updatedAt: date, messages };
  const next = [...chats]; next[index] = chat;
  return { ...project, chats: next, activeChatId: chatId, updatedAt: date };
}

export function withChatMessage(project, chatId, message, date = now()) {
  const chat = (project?.chats || []).find(item => item.id === chatId);
  if (!chat || chat.messages.length >= MAX_CHAT_MESSAGES) return project;
  return withChatMessages(project, chatId, [...chat.messages, { createdAt: date, ...message }], date);
}

// Old releases kept one conversation only in renderer memory. This also lets a
// running pre-upgrade window move that conversation into the project cleanly.
export function adoptChatMessages(project, messages, date = now()) {
  const created = withNewChat(project, date);
  if (!created.chat) return project;
  return withChatMessages(created.project, created.chat.id, messages, date);
}

export function persistedChat(chat) {
  return {
    ...chat,
    messages: (chat.messages || []).map(({ pending, ...message }) => message)
  };
}
