import { app, BrowserWindow, ipcMain, nativeTheme, net, shell } from 'electron';
import { isAbsolute, join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Manager } from '../core/manager';
import { dataFolder, resolvePaths } from '../core/paths';
import { publicError } from '../core/errors';
import { presetLinks } from '../core/presets';
import type { AppId, ConfigViewRequest, GlobalEdit, ModelListRequest, ProviderInput } from '../core/types';
import { createTray } from './tray';

// Development-only isolation for smoke tests. Packaged builds ignore this override.
const sandboxRoot = !app.isPackaged && process.env.MISWITCH_SANDBOX_ROOT;
if (sandboxRoot) {
  if (!isAbsolute(sandboxRoot)) throw new Error('测试目录必须使用绝对路径');
  const userData = join(sandboxRoot, 'electron');
  mkdirSync(userData, { recursive: true, mode: 0o700 });
  app.setPath('userData', userData);
} else {
  // The app is shown as Mi-Switch, but its data stays where earlier versions kept it, so the rename loses nothing.
  app.setPath('userData', dataFolder(app.getPath('appData'), existsSync));
}
app.setName('Mi-Switch');
if (!app.requestSingleInstanceLock()) app.quit();
else {
  let window: BrowserWindow | undefined;
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  void app.whenReady().then(() => {
    const manager = new Manager(sandboxRoot
      ? resolvePaths(join(sandboxRoot, 'store'), join(sandboxRoot, 'home'), {})
      : resolvePaths(join(app.getPath('userData'), 'store')));
    const entry = join(__dirname, '../dist/index.html');
    const entryUrl = pathToFileURL(entry).href;
    const handlers: Record<string, (payload: any) => Promise<unknown>> = {
      snapshot: () => manager.snapshot(), save: ({ input, options }: { input: ProviderInput; options?: { activate?: boolean } }) => manager.save(input, { activate: options?.activate === true }),
      remove: (id: string) => manager.remove(id), activate: (id: string) => manager.activate(id),
      restore: (id: string) => manager.restore(id), resolveJournal: (id: string) => manager.resolveJournal(id),
      importLive: (app?: AppId) => manager.importLive(app),
      // Chromium's network stack honours the system proxy, which some vendor endpoints need.
      listModels: (request: ModelListRequest) => manager.listModels(request, (url, init) => net.fetch(url, init)),
      configView: (request: ConfigViewRequest) => manager.configView(request),
      globalView: (app: AppId) => manager.globalView(app), saveGlobal: (request: GlobalEdit) => manager.saveGlobal(request)
    };
    // Calls that can change which provider is in use; the menu bar is rebuilt after each of them.
    const mutating = new Set(['save', 'remove', 'activate', 'restore', 'resolveJournal', 'importLive', 'saveGlobal']);
    const tray = createTray(manager, {
      open: () => { if (!window) createWindow(); window?.show(); window?.focus(); },
      changed: () => window?.webContents.send('miswitch:changed')
    });
    for (const [name, handler] of Object.entries(handlers)) {
      ipcMain.handle(`miswitch:${name}`, async (event, payload: unknown) => {
        if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== entryUrl) throw new Error('未授权的调用来源');
        // publicError() forwards only static messages; raw JSON/TOML/Zod errors may echo secrets.
        try { return await handler(payload); } catch (error) { throw new Error(publicError(error)); }
        finally { if (mutating.has(name)) void tray.refresh(); }
      });
    }
    function createWindow() {
      window = new BrowserWindow({ width: 1140, height: 820, minWidth: 840, minHeight: 600, title: 'Mi-Switch', backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e20' : '#f5f5f7', webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
      // Only the vendor pages listed in the presets open, and only in the system browser.
      window.webContents.setWindowOpenHandler(({ url }) => { if (presetLinks.has(url)) void shell.openExternal(url); return { action: 'deny' }; });
      window.webContents.on('will-navigate', event => event.preventDefault());
      window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      window.on('closed', () => { window = undefined; });
      void window.loadFile(entry);
    }
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
