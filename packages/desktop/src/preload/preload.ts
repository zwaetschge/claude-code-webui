import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Device registration (called from setup page)
  registerDevice: (serverUrl: string, username: string, password: string) =>
    ipcRenderer.invoke('register-device', serverUrl, username, password),

  // Device info
  getDeviceInfo: () => ipcRenderer.invoke('get-device-info'),

  // Platform detection
  isElectron: true,
  platform: process.platform,

  // Window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
});
