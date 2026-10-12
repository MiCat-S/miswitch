import { contextBridge, ipcRenderer } from 'electron';
import type { Bridge } from '../core/types';
const bridge: Bridge = {
  snapshot: () => ipcRenderer.invoke('miswitch:snapshot'),
  save: input => ipcRenderer.invoke('miswitch:save', input),
  remove: id => ipcRenderer.invoke('miswitch:remove', id),
  activate: id => ipcRenderer.invoke('miswitch:activate', id),
  restore: id => ipcRenderer.invoke('miswitch:restore', id),
  resolveJournal: id => ipcRenderer.invoke('miswitch:resolveJournal', id),
  importLive: app => ipcRenderer.invoke('miswitch:importLive', app),
  listModels: request => ipcRenderer.invoke('miswitch:listModels', request)
};
contextBridge.exposeInMainWorld('miswitch', bridge);
