const { CloudError } = require('./store.cjs');
const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function configured(env = process.env) { return Boolean(env.WRAITER_RESEND_KEY || env.WRAITER_MAIL_RELAY_URL && env.WRAITER_MAIL_RELAY_SECRET || env.CLOUDFLARE_EMAIL_TOKEN && env.CLOUDFLARE_ACCOUNT_ID || env.WRAITER_SMTP_URL); }
async function sendMail(to, kind, link, env = process.env) {
  const verify = kind === 'verify', subject = verify ? 'Confirm your WRAITER account' : 'Reset your WRAITER password';
  const explanation = verify ? 'Confirm your email to open your private WRAITER document library. This link expires in 24 hours.' : 'Use this link to choose a new WRAITER password. It expires in 30 minutes.';
  const text = `${subject}\n\n${explanation}\n\n${link}\n\nIf you did not request this, you can ignore this email.`;
  const from = `WRAITER <${env.WRAITER_MAIL_FROM || 'noreply@example.net'}>`;
  const message = { from,to,subject,text,html:`<div style="font-family:system-ui;max-width:560px;margin:32px auto;color:#25282d"><h1 style="font-size:24px">${subject}</h1><p>${explanation}</p><p><a style="display:inline-block;padding:12px 18px;background:#244b53;color:#fff;border-radius:6px;text-decoration:none" href="${escape(link)}">${verify ? 'Confirm email' : 'Reset password'}</a></p><p>Or open: ${escape(link)}</p><p style="color:#667">If you did not request this, you can ignore this email.</p><p>WRAITER</p></div>` };
  return deliver(message, env);
}
async function deliver(message, env, idempotencyKey) {
  if (env.WRAITER_RESEND_KEY) {
    const response = await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${env.WRAITER_RESEND_KEY}`,...(idempotencyKey ? {'Idempotency-Key':idempotencyKey} : {})},body:JSON.stringify(message),signal:AbortSignal.timeout(20000),redirect:'error'});
    if (!response.ok) throw new CloudError(503,'Confirmation email could not be sent. Please try again shortly.'); return;
  }
  if (env.WRAITER_MAIL_RELAY_URL) {
    const response = await fetch(env.WRAITER_MAIL_RELAY_URL,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${env.WRAITER_MAIL_RELAY_SECRET}`},body:JSON.stringify(message),signal:AbortSignal.timeout(20000),redirect:'error'});
    if (!response.ok) throw new CloudError(503,'Confirmation email could not be sent. Please try again shortly.'); return;
  }
  if (env.CLOUDFLARE_EMAIL_TOKEN && env.CLOUDFLARE_ACCOUNT_ID) {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/email/sending/send`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${env.CLOUDFLARE_EMAIL_TOKEN}`},body:JSON.stringify(message),signal:AbortSignal.timeout(20000),redirect:'error'});
    const data = await response.json().catch(() => ({})); if (!response.ok || data.success === false) throw new CloudError(503,'Confirmation email could not be sent. Please try again shortly.'); return;
  }
  if (env.WRAITER_SMTP_URL) {
    const nodemailer = require('nodemailer'); await nodemailer.createTransport(env.WRAITER_SMTP_URL).sendMail(message); return;
  }
  throw new CloudError(503,'Email confirmation is temporarily unavailable. Please try again shortly.');
}
module.exports = { configured, sendMail, deliver };
