import React, { useState } from 'react';
import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import policy from '../docs/PRIVACY.md?raw';

const html = DOMPurify.sanitize(new MarkdownIt({ html: false, linkify: false }).render(policy));
export default function Privacy({ Modal, onClose }) {
  const [error, setError] = useState('');
  return <Modal title="Privacy and AI data" subtitle="How WRAITER handles your writing and optional AI requests." onClose={onClose} wide>
    <div className="privacy-policy" onClick={event => {
      const link = event.target.closest('a');
      if (link) { event.preventDefault(); window.wraiter.openLink(link.href).catch(error => setError(String(error.message || error))); }
    }} dangerouslySetInnerHTML={{ __html: html }} />
    {error && <p className="connection-status error" role="alert">{error}</p>}
  </Modal>;
}

export function ReportAI({ Modal, onClose }) {
  const [error, setError] = useState('');
  const open = url => window.wraiter.openLink(url).catch(error => setError(String(error.message || error)));
  return <Modal title="Report an AI concern" subtitle="Tell the WRAITER publisher about inappropriate or harmful AI output." onClose={onClose}>
    <div className="onboarding-body">
      <p>Email <a href="mailto:carl.1224@outlook.com" onClick={event => { event.preventDefault(); open('mailto:carl.1224@outlook.com?subject=WRAITER%20AI%20content%20concern'); }}>carl.1224@outlook.com</a> with the WRAITER version, your chosen provider/model and a description of the concern. Include a short example only if you are comfortable sharing it.</p>
      <p>WRAITER does not attach or send your manuscript automatically. The buttons below open your email app or a public GitHub issue form; you choose what to send there.</p>
      <p>For a private report, use email. Keep manuscripts, personal information and credentials out of public GitHub issues. You can also report the output to your AI provider and turn AI off in WRAITER.</p>
      {error && <p className="connection-status error" role="alert">{error}</p>}
    </div>
    <div className="modal-footer">
      <button className="primary-button" onClick={() => open('mailto:carl.1224@outlook.com?subject=WRAITER%20AI%20content%20concern')} title="Open a draft in your email app. You choose what to include and send.">Open email report</button>
      <button className="secondary-button" onClick={() => open('https://github.com/LEC1224/WRAITER/issues/new?title=AI%20content%20concern')} title="Open a public GitHub report form in your browser. You choose what to submit.">Open public issue form</button>
    </div>
  </Modal>;
}
