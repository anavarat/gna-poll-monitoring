const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  runCli: (args) => ipcRenderer.invoke('run-cli', args),
  onLog: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on('cli-log', handler);
    return () => ipcRenderer.removeListener('cli-log', handler);
  },
  onStart: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on('cli-start', handler);
    return () => ipcRenderer.removeListener('cli-start', handler);
  },
  onComplete: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on('cli-complete', handler);
    return () => ipcRenderer.removeListener('cli-complete', handler);
  },
});
