import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import FontPicker from '../src/FontPicker.jsx';
import '../src/styles.css';
const fonts = ['Arial', 'Cambria', ...Array.from({ length: 500 }, (_, index) => `Synthetic Font ${String(index).padStart(3, '0')}`)];
function Harness() {
  const [font, setFont] = useState('Cambria'), [returnToEditor, setReturnToEditor] = useState(false);
  const choose = value => { setFont(value); if (returnToEditor) document.getElementById('synthetic-editor').focus(); };
  return <div style={{ minHeight: '100vh' }}>
    <div style={{ position: 'fixed', left: 32, top: 24, display: 'flex', gap: 8 }}><button type="button">Before top font</button><FontPicker label="Top font" value={font} fonts={fonts} onChange={choose} /><input aria-label="After top font" /></div>
    <div id="font-scroll-container" style={{ position: 'fixed', bottom: 12, right: 32, width: 470, height: 150, overflow: 'auto' }}><div style={{ height: 75 }} /><div style={{ display: 'flex', gap: 8 }}><button type="button">Before bottom font</button><FontPicker label="Bottom font" value={font} fonts={fonts} onChange={choose} /><input aria-label="After bottom font" /></div><div style={{ height: 300 }} /></div>
    <div style={{ padding: '150px 40px' }}><textarea id="synthetic-editor" aria-label="Synthetic editor" defaultValue="Synthetic text stays unchanged." /><label><input type="checkbox" checked={returnToEditor} onChange={event => setReturnToEditor(event.target.checked)} />Return to editor after choosing</label><output aria-label="Chosen font">{font}</output></div>
  </div>;
}
createRoot(document.getElementById('root')).render(<Harness />);
