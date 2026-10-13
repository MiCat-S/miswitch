import { contextBridge, ipcRenderer } from 'electron';
import type { Bridge } from '../core/types';
const bridge: Bridge = {
  snapshot: () => ipcRenderer.invoke('miswitch:snapshot'),
  save: (input, options) => ipcRenderer.invoke('miswitch:save', { input, options }),
  remove: id => ipcRenderer.invoke('miswitch:remove', id),
  activate: id => ipcRenderer.invoke('miswitch:activate', id),
  restore: id => ipcRenderer.invoke('miswitch:restore', id),
  resolveJournal: id => ipcRenderer.invoke('miswitch:resolveJournal', id),
  importLive: app => ipcRenderer.invoke('miswitch:importLive', app),
  listModels: request => ipcRenderer.invoke('miswitch:listModels', request),
  piModels: id => ipcRenderer.invoke('miswitch:piModels', id),
  configView: request => ipcRenderer.invoke('miswitch:configView', request),
  globalView: app => ipcRenderer.invoke('miswitch:globalView', app),
  saveGlobal: request => ipcRenderer.invoke('miswitch:saveGlobal', request),
  onChanged: listener => { const handler = () => listener(); ipcRenderer.on('miswitch:changed', handler); return () => { ipcRenderer.removeListener('miswitch:changed', handler); }; }
};
contextBridge.exposeInMainWorld('miswitch', bridge);
