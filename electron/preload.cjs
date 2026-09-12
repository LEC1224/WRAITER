const { contextBridge, ipcRenderer } = require('electron');
const invoke = channel => (...args) => ipcRenderer.invoke(channel, ...args);
contextBridge.exposeInMainWorld('wraiter', {
  boot: invoke('boot'), getRecents: invoke('recent:list'), open: invoke('open'), openRecent: invoke('open-recent'), save: invoke('save'),
  autosave: invoke('autosave'), newProject: invoke('new-project'), exportFile: invoke('export'),
  reference: invoke('reference'), image: invoke('image'), settings: invoke('settings'),
  generate: invoke('generate'), cancel: invoke('cancel'), probe: invoke('probe'),
  chooseCodex: invoke('choose-codex'), reveal: invoke('reveal'), finishClose: invoke('finish-close'),
  window: action => ipcRenderer.send('window', action),
  onCommand: callback => { const listener = (_event, command) => callback(command); ipcRenderer.on('command', listener); return () => ipcRenderer.removeListener('command', listener); }
});
