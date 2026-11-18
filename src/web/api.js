let requestUser = null, requestSession = null;
export function setRequestSession(tag) { requestSession = typeof tag === 'string' && tag ? tag : null; }
export const getRequestSession = () => requestSession;
export function setRequestUser(userId) { requestUser = typeof userId === 'string' && userId ? userId : null; }
export async function request(path, { method = 'GET', body, signal, expectedUser = requestUser, expectedSession = requestSession } = {}) {
  const response = await fetch(path, { method, credentials: 'same-origin', headers: { 'X-Wraiter-Request': '1', ...(expectedUser ? { 'X-Wraiter-User': expectedUser } : {}), ...(expectedSession ? { 'X-Wraiter-Session': expectedSession } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal });
  let value;
  try { value = await response.json(); } catch { value = {}; }
  if (!response.ok) { const error = new Error(typeof value.error === 'string' ? value.error : value.error?.message || value.message || `Request failed (${response.status}).`); error.status = response.status; error.details = value; error.code = value.code; if (response.status === 409 && value.code === 'ACCOUNT_CHANGED' && expectedUser === requestUser && expectedSession === requestSession) window.dispatchEvent(new CustomEvent('wraiter-account-changed', { detail: error.message })); if (response.status === 401 && expectedUser === requestUser && expectedSession === requestSession && (!path.startsWith('/api/auth/') || /\/auth\/(me|logout)$/.test(path))) window.dispatchEvent(new CustomEvent('wraiter-session-expired', { detail: 'Your sign-in expired. Sign in again.' })); throw error; }
  return value;
}
export const formatBytes = bytes => bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.ceil(bytes / 1e3))} KB`;
export function download(data, name, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([data], { type })), anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export const filename = title => String(title || 'Untitled manuscript').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 160);
