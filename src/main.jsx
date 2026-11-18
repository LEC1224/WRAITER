import React from 'react';
import { createRoot } from 'react-dom/client';
import { reportError } from './diagnostics.js';
import './styles.css';
window.addEventListener('error', event => reportError('window.error', event.error ?? event.message, { filename: event.filename, lineno: event.lineno, colno: event.colno }));
window.addEventListener('unhandledrejection', event => reportError('window.unhandled-rejection', event.reason));
// Load application modules only after the global handlers and recovery boundary
// exist, so module initialization failures cannot leave an unexplained blank view.
const App = React.lazy(() => import('./App.jsx'));
class RecoveryBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { reportError('react.boundary', error, { componentStack: info.componentStack }); }
  render() {
    if (this.state.error) return <div className="boot-screen"><h1>The writing view needs to restart.</h1><p>Your saved files and local recovery are still on disk.</p><pre>{String(this.state.error.message)}</pre><button className="primary-button" onClick={() => location.reload()}>Reload writing view</button><button className="secondary-button" onClick={() => window.wraiter?.finishClose(null)}>Close WRAITER</button></div>;
    return this.props.children;
  }
}
createRoot(document.getElementById('root')).render(<RecoveryBoundary><React.Suspense fallback={<div className="boot-screen">Opening WRAITER…</div>}><App /></React.Suspense></RecoveryBoundary>);
