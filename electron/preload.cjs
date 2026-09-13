const { contextBridge, ipcRenderer } = require('electron');
const invoke = channel => (...args) => ipcRenderer.invoke(channel, ...args);
contextBridge.exposeInMainWorld('wraiter', {
  boot: invoke('boot'), getRecents: invoke('recent:list'), clearRecents: invoke('recent:clear'), open: invoke('open'), openRecent: invoke('open-recent'), save: invoke('save'),
  activateProject: invoke('workspace:activate'), closeProject: invoke('workspace:close'), rememberProjectView: invoke('workspace:view'),
  autosave: invoke('autosave'), newProject: invoke('new-project'), exportFile: invoke('export'),
  bindNative: invoke('native:bind'), chooseSaveTarget: invoke('save:choose'), saveEncoded: invoke('save:encoded'), loadEditHistory: invoke('history:load'), appendEditHistory: invoke('history:append'), restartEditHistory: invoke('history:restart'), runAgent: invoke('agent:run'),
  reference: invoke('reference'), image: invoke('image'), settings: invoke('settings'),
  generate: invoke('generate'), cancel: invoke('cancel'), probe: invoke('probe'),
  connectionStatus: invoke('provider:status'), connectProvider: invoke('provider:connect'), reconnectProvider: invoke('provider:reconnect'), loginProvider: invoke('provider:login'), listModels: invoke('provider:models'),
  listFonts: invoke('fonts:list'), setDocumentLanguage: invoke('document:language'), setShortcutCapture: invoke('shortcuts:capture'),
  localStatus: invoke('local:status'), configureLocal: invoke('local:configure'), localFolder: invoke('local:folder'), startLocal: invoke('local:start'), stopLocal: invoke('local:stop'), unloadLocal: invoke('local:unload'), localRelease: invoke('local:release'), installLocal: invoke('local:install'), cancelLocal: invoke('local:cancel'), localCatalogInfo: invoke('local:catalog-info'), pullLocal: invoke('local:pull'), chooseGGUF: invoke('local:choose-gguf'), importGGUF: invoke('local:import'),
  onLocalProgress: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('local-progress', listener); return () => ipcRenderer.removeListener('local-progress', listener); },
  listGitHistory: invoke('git:list'), getGitRevision: invoke('git:revision'), commitGitSnapshot: invoke('git:snapshot'),
  chooseCodex: invoke('choose-codex'), reveal: invoke('reveal'), finishClose: invoke('finish-close'),
  window: action => ipcRenderer.send('window', action),
  onCommand: callback => { const listener = (_event, command) => callback(command); ipcRenderer.on('command', listener); return () => ipcRenderer.removeListener('command', listener); }
});
