const { randomUUID, createHash, timingSafeEqual } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');
const { EventEmitter } = require('node:events');
const { CloudError } = require('./store.cjs');
const mail = require('./mail.cjs');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const attachmentNames = new Set(['recent-logs.jsonl', 'browser-errors.jsonl', 'crash-report-1.json', 'crash-report-2.json', 'crash-report-3.json']);
const conflict = () => new CloudError(409, 'This suggestion changed. Refresh the list to see its latest version.');
function field(value, name, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new CloudError(400, `Enter ${name} (up to ${max} characters).`);
  return value.trim();
}
function attachments(input) {
  const files = input.attachments ?? [];
  if (!Array.isArray(files) || files.length > 4 || (files.length && input.includeDiagnostics !== true)) throw new CloudError(400, 'Diagnostic files require your consent.');
  const seen = new Set();
  return files.map(file => {
    if (!attachmentNames.has(file?.name) || seen.has(file.name) || typeof file.text !== 'string' || !file.text || Buffer.byteLength(file.text) > 65536) throw new CloudError(400, 'Invalid diagnostic attachment.');
    seen.add(file.name);
    return { name: file.name, text: file.text };
  });
}
function settingsForSuggestions(env) {
  if (env !== process.env) return env;
  try { return { ...env, ...parseEnv(readFileSync(path.join(__dirname, '../config/suggestions.env'), 'utf8')) }; }
  catch (err) { if (err.code === 'ENOENT') return env; throw err; }
}
function catalog(input) {
  if (!Array.isArray(input) || !input.length || input.length > 250) throw new CloudError(400, 'Invalid Codex model list.');
  return input.map(m => {
    const choices = (items, max) => {
      if (!Array.isArray(items) || items.length > max) throw new CloudError(400, 'Invalid Codex model options.');
      return items.map(item => field(item, 'a Codex option', 80));
    };
    const efforts = choices(m.efforts, 16), tiers = choices(m.tiers, 16);
    return { id: field(m.id, 'a model', 200), label: field(m.label, 'a model name', 200), efforts, tiers,
      defaultEffort: efforts.includes(m.defaultEffort) ? m.defaultEffort : efforts[0] || '', isDefault: m.isDefault === true };
  });
}

function createSuggestions({ store, env, selectSite, deliver = mail.deliver, pollMs = 20000 }) {
  const db = store.db, settings = settingsForSuggestions(env), wake = new EventEmitter();
  const address = settings.WRAITER_SUGGESTION_ADMIN_EMAIL?.trim().toLowerCase();
  const relayKey = settings.WRAITER_SUGGESTION_RELAY_KEY;
  db.exec(`
    CREATE TABLE IF NOT EXISTS suggestions (
      seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      origin TEXT NOT NULL, original TEXT NOT NULL, prompt TEXT NOT NULL, consent INTEGER NOT NULL,
      files TEXT NOT NULL, filenames TEXT NOT NULL, created INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'pending', motivation TEXT, options TEXT, lease TEXT, lease_until INTEGER,
      thread_id TEXT, delivery_error TEXT
    );
    CREATE INDEX IF NOT EXISTS suggestions_delivery ON suggestions(status, lease_until, seq);
    CREATE TABLE IF NOT EXISTS suggestion_mail (
      suggestion_id TEXT REFERENCES suggestions(id) ON DELETE CASCADE, kind TEXT NOT NULL,
      due INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, sent INTEGER, PRIMARY KEY(suggestion_id, kind)
    );
    CREATE INDEX IF NOT EXISTS suggestion_mail_due ON suggestion_mail(sent, due);
  `);
  const getMeta = key => db.prepare('SELECT value FROM metadata WHERE key=?').get('suggestions.' + key)?.value;
  const setMeta = (key, value) => db.prepare('INSERT OR REPLACE INTO metadata(key,value) VALUES (?,?)').run('suggestions.' + key, value);
  function owner() {
    let id = getMeta('owner');
    if (!id) {
      if (!address) return null;
      const candidate = store.user(address);
      if (!candidate?.verified) return null;
      id = candidate.id;
      setMeta('owner', id);
    }
    return store.userById(id);
  }
  owner();
  function requireAdmin(user) {
    if (!user.verified || owner()?.id !== user.id) throw new CloudError(403, 'This page is restricted to the WRAITER administrator.');
  }
  function requireRelay(request) {
    const token = (request.headers.authorization || '').replace(/^Bearer /, '');
    const hash = value => createHash('sha256').update(value).digest();
    if (!relayKey || relayKey.length < 43 || !request.headers.authorization?.startsWith('Bearer ') || !timingSafeEqual(hash(token), hash(relayKey))) throw new CloudError(403, 'Developer PC authentication required.');
  }
  let sending = false, closed = false, lastSeen = 0;
  function queueMail(id, kind) {
    db.prepare('INSERT INTO suggestion_mail(suggestion_id,kind,due) VALUES(?,?,?)').run(id, kind, Date.now());
  }
  async function flushMail() {
    if (sending || closed) return;
    sending = true;
    try {
      while (!closed) {
        const row = db.prepare(`SELECT m.*, s.origin, s.original, s.motivation, u.email FROM suggestion_mail m
          JOIN suggestions s ON s.id=m.suggestion_id JOIN users u ON u.id=s.user_id
          WHERE m.sent IS NULL AND m.due<=? ORDER BY m.due LIMIT 1`).get(Date.now());
        if (!row) break;
        const { suggestion_id: id, kind } = row;
        if (!db.prepare('UPDATE suggestion_mail SET due=?, attempts=attempts+1 WHERE suggestion_id=? AND kind=? AND sent IS NULL AND due=?').run(Date.now()+120000, id, kind, row.due).changes) continue;
        try {
          const site = selectSite({ headers: { host: new URL(row.origin).host }, url: '/admin' });
          if (site.origin !== row.origin) throw new Error('Submission site unavailable');
          const notifyOwner = kind === 'received';
          let config = site.mail;
          if (site.alternate && settings.WRAITER_SUGGESTION_ALIAS_RESEND_KEY) config = { WRAITER_RESEND_KEY: settings.WRAITER_SUGGESTION_ALIAS_RESEND_KEY, WRAITER_MAIL_FROM: settings.WRAITER_SUGGESTION_ALIAS_FROM || site.mail.WRAITER_MAIL_FROM };
          const to = notifyOwner ? owner()?.email : row.email;
          if (!to) throw new Error('Recipient unavailable');
          const subject = notifyOwner ? 'New WRAITER suggestion' : 'Your WRAITER suggestion was declined';
          const text = notifyOwner
            ? `A new suggestion is ready for review.\n\n${row.original}\n\nReview it at ${site.origin}/admin`
            : `The WRAITER developer declined your suggestion.\n\nReason from the developer\n${row.motivation}\n\nYour original suggestion\n${row.original}`;
          await deliver({ from: `WRAITER <${config.WRAITER_MAIL_FROM || 'noreply@' + new URL(site.origin).hostname.replace(/^wraiter\./, '')}>`, to, subject, text }, config, `wraiter-suggestion-${kind}-${id}`);
          if (!closed) db.prepare('UPDATE suggestion_mail SET sent=? WHERE suggestion_id=? AND kind=?').run(Date.now(), id, kind);
        } catch {
          if (!closed) db.prepare('UPDATE suggestion_mail SET due=? WHERE suggestion_id=? AND kind=?').run(Date.now() + Math.min(3600000, 30000 * 2 ** Math.min(7, row.attempts)), id, kind);
        }
      }
    } finally { sending = false; }
  }
  const triggerMail = () => { void flushMail().catch(() => console.error('Suggestion notification queue unavailable')); };
  const timer = setInterval(triggerMail, 15000);
  timer.unref();
  function submit(user, site, input) {
    const original = field(input.description, 'a description', 8000);
    if (!UUID.test(input.id) || typeof input.includeDiagnostics !== 'boolean') throw new CloudError(400, 'Invalid suggestion.');
    const files = attachments(input);
    store.transaction(() => {
      const existing = db.prepare('SELECT user_id,origin,original,consent FROM suggestions WHERE id=?').get(input.id);
      if (existing) {
        if (existing.user_id !== user.id || existing.origin !== site.origin || existing.original !== original || Boolean(existing.consent) !== input.includeDiagnostics) throw conflict();
        return;
      }
      db.prepare('INSERT INTO suggestions(id,user_id,origin,original,prompt,consent,files,filenames,created) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(input.id,user.id,site.origin,original,original,Number(input.includeDiagnostics),JSON.stringify(files),JSON.stringify(files.map(f => f.name)),Date.now());
      queueMail(input.id, 'received');
    });
    triggerMail();
    return { id: input.id };
  }
  const models = () => JSON.parse(getMeta('models') || '[]');
  function list(before) {
    const cursor = before === null ? Number.MAX_SAFE_INTEGER : Number(before);
    if (!Number.isSafeInteger(cursor) || cursor < 1) throw new CloudError(400, 'Invalid suggestions page.');
    const rows = db.prepare(`SELECT s.seq,s.id,s.original,s.prompt,s.created,s.status,s.revision,s.motivation,s.origin,
      s.filenames,s.delivery_error,s.thread_id,u.email,
      (SELECT sent FROM suggestion_mail WHERE suggestion_id=s.id AND kind='received') AS received_mail,
      (SELECT sent FROM suggestion_mail WHERE suggestion_id=s.id AND kind='declined') AS decline_mail
      FROM suggestions s JOIN users u ON u.id=s.user_id WHERE s.seq<? ORDER BY s.seq DESC LIMIT 31`).all(cursor);
    const items = rows.slice(0,30).map(row => ({ ...row, filenames: JSON.parse(row.filenames) }));
    return { items, next: rows.length > 30 ? items.at(-1).seq : null, models: models(), online: Date.now()-lastSeen < 65000 };
  }
  function review(id, action, input) {
    store.transaction(() => {
      const row = db.prepare('SELECT revision,status FROM suggestions WHERE id=?').get(id);
      if (!row) throw new CloudError(404, 'Suggestion not found.');
      if (row.revision !== input.revision || row.status !== (action === 'retry' ? 'failed' : 'pending')) throw conflict();
      if (action === 'edit') db.prepare('UPDATE suggestions SET prompt=?,revision=revision+1 WHERE id=?').run(field(input.prompt,'a prompt',8000),id);
      else if (action === 'decline') {
        db.prepare("UPDATE suggestions SET motivation=?,status='declined',revision=revision+1 WHERE id=?").run(field(input.motivation,'a motivation',4000),id);
        queueMail(id,'declined');
      } else if (action === 'approve') {
        const { model, effort, tier } = input;
        const choice = models().find(item => item.id === model);
        if (!choice || !(choice.efforts.length ? choice.efforts.includes(effort) : effort === '') || !(tier === '' || choice.tiers.includes(tier))) throw new CloudError(400, 'Choose an available Codex model, reasoning level and speed.');
        db.prepare("UPDATE suggestions SET options=?,status='queued',revision=revision+1 WHERE id=?").run(JSON.stringify({ model,effort,tier }),id);
      } else if (action === 'retry') db.prepare("UPDATE suggestions SET status='queued',delivery_error=NULL,revision=revision+1 WHERE id=?").run(id);
      else throw new CloudError(404, 'Review action not found.');
    });
    if (action === 'decline') triggerMail();
    else if (action !== 'edit') wake.emit('job');
    return { ok: true };
  }
  function claim() {
    return store.transaction(() => {
      const row = db.prepare("SELECT id,prompt,files,options,thread_id FROM suggestions WHERE status='queued' OR (status='delivering' AND lease_until<=?) ORDER BY seq LIMIT 1").get(Date.now());
      if (!row) return null;
      const lease = randomUUID();
      db.prepare("UPDATE suggestions SET status='delivering',lease=?,lease_until=? WHERE id=?").run(lease,Date.now()+120000,row.id);
      return { id: row.id, lease, prompt: row.prompt, files: JSON.parse(row.files), options: JSON.parse(row.options), threadId: row.thread_id };
    });
  }
  async function poll(input, res) {
    lastSeen = Date.now();
    if (input.models) {
      const serialized = JSON.stringify(catalog(input.models));
      if (serialized !== getMeta('models')) setMeta('models', serialized);
    }
    const job = claim();
    if (job) return { job };
    await new Promise(resolve => {
      const done = () => { clearTimeout(timeout); wake.off('job', done); res.off('close', done); resolve(); };
      const timeout = setTimeout(done, pollMs);
      wake.once('job', done); res.once('close', done);
    });
    return { job: closed || res.destroyed ? null : claim() };
  }
  function receipt(input) {
    const { id,lease,threadId,stage } = input;
    if (!UUID.test(id) || !UUID.test(lease) || !['thread','sent','failed'].includes(stage) || (stage !== 'failed' && !UUID.test(threadId))) throw new CloudError(400, 'Invalid delivery receipt.');
    const row = db.prepare('SELECT status,lease,thread_id FROM suggestions WHERE id=?').get(id);
    if (stage === 'sent' && row?.status === 'sent' && row.thread_id === threadId && row.lease === lease) return { ok: true };
    if (row?.status !== 'delivering' || row.lease !== lease || (threadId && row.thread_id && threadId !== row.thread_id)) throw conflict();
    if (stage === 'failed') db.prepare("UPDATE suggestions SET status='failed',delivery_error=?,revision=revision+1 WHERE id=?").run(field(input.error,'a delivery error',400),id);
    else db.prepare('UPDATE suggestions SET status=?,thread_id=?,lease_until=? WHERE id=?').run(stage === 'sent' ? 'sent' : 'delivering',threadId,Date.now()+120000,id);
    return { ok: true };
  }
  return { requireAdmin,requireRelay,submit,list,review,poll,receipt,flushMail,close() { closed=true; clearInterval(timer); wake.emit('job'); } };
}
module.exports = { createSuggestions };
