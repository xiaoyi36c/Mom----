const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadConfig: () => ipcRenderer.invoke('config-load'),
  saveConfig: (cfg) => ipcRenderer.invoke('config-save', cfg),
  startTask: (cfg) => ipcRenderer.invoke('task-start', cfg),
  stopTask: () => ipcRenderer.invoke('task-stop'),
  isRunning: () => ipcRenderer.invoke('task-isrunning'),
  winMinimize: () => ipcRenderer.send('win-minimize'),
  winMaximize: () => ipcRenderer.send('win-maximize'),
  winClose: () => ipcRenderer.send('win-close'),
  on: (channel, cb) => {
    const allow = ['task-log', 'task-stats', 'task-phase', 'task-current', 'task-started', 'task-stopped'];
    if (allow.includes(channel)) {
      ipcRenderer.on(channel, (_e, data) => cb(data));
    }
  },
});
