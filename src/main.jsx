import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
class RecoveryBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) return <div className="boot-screen"><h1>The writing view needs to restart.</h1><p>Your saved files and local recovery are still on disk.</p><pre>{String(this.state.error.message)}</pre><button className="primary-button" onClick={() => location.reload()}>Reload writing view</button><button className="secondary-button" onClick={() => window.wraiter?.finishClose(null)}>Close WRAITER</button></div>;
    return this.props.children;
  }
}
createRoot(document.getElementById('root')).render(<RecoveryBoundary><App /></RecoveryBoundary>);
