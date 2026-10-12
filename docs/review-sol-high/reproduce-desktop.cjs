// Real main/preload/React in a canonical temporary root. Only genuine IPC delivery is delayed.
// No remote browser/network and no special-key input. Run after npm run build.
const { app, BrowserWindow, ipcMain, Tray, Notification, shell, nativeTheme } = require('electron');
const fs = require('node:fs'); const { join, dirname } = require('node:path'); const { tmpdir } = require('node:os'); const assert = require('node:assert/strict');
const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'miswitch-sol-high-desktop-')));
process.env.MISWITCH_SANDBOX_ROOT = root;
nativeTheme.themeSource = 'light'; Notification.isSupported = () => false;
let trayMenu, openHandler, holdClaude = false, releaseClaude, holdSave = false, releaseSave, observedWindow;
const handlers = new Map(); const external = [];
shell.openExternal = async url => { external.push(url); };
const setMenu = Tray.prototype.setContextMenu;
Tray.prototype.setContextMenu = function(menu) { trayMenu = menu; return setMenu.call(this, menu); };
const register = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (name, handler) => {
  handlers.set(name, handler);
  register(name, async (...args) => {
    const result = await handler(...args);
    if (name === 'miswitch:save' && holdSave) { holdSave = false; await new Promise(resolve => { releaseSave = resolve; }); }
    if (name === 'miswitch:globalView' && args[1] === 'claude' && holdClaude) {
      holdClaude = false; await new Promise(resolve => { releaseClaude = resolve; });
    }
    return result;
  });
};
const out = (name, value) => console.log(JSON.stringify({ name, ...value }));
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async fn => { for(let i=0;i<200;i++){if(fn())return;await wait(25);}throw Error('main wait timeout'); };
const put=(p,s)=>{fs.mkdirSync(dirname(p),{recursive:true});fs.writeFileSync(p,s);};
const prelude = `const tick=()=>new Promise(r=>requestAnimationFrame(r));
const until=async(fn)=>{for(let i=0;i<300;i++){if(fn())return;await tick();}throw Error('UI timeout');};
const click=(s,t)=>{const e=[...document.querySelectorAll(s)].find(x=>!t||x.textContent.includes(t));if(!e)throw Error('missing '+s+' '+t);e.click();};
const set=(e,v)=>{Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value').set.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));};`;
const cleanup = code => { for(const w of BrowserWindow.getAllWindows()) w.destroy(); fs.rmSync(root,{recursive:true,force:true});app.exit(code); };
const timer = setTimeout(()=>{console.error('desktop supplement timeout');cleanup(1);},60000);
app.on('browser-window-created', (_e, window) => {
  const original = window.webContents.setWindowOpenHandler.bind(window.webContents);
  window.webContents.setWindowOpenHandler = handler => { openHandler = handler; return original(handler); };
  if (observedWindow) return;
  observedWindow = window;
  const run = code => window.webContents.executeJavaScript(`(async()=>{${prelude}${code}})()`);
  window.webContents.once('did-finish-load', async () => {
    try {
      await run(`await until(()=>document.querySelector('.page-bar .primary')&&!document.querySelector('.page-bar .primary').disabled);`);
      await run(`await window.miswitch.save({app:'claude',name:'A',mode:'login',model:'m',protocol:'anthropic-messages'});await window.miswitch.save({app:'claude',name:'B',mode:'login',model:'m',protocol:'anthropic-messages'});`);
      await until(()=>trayMenu?.items.filter(x=>x.type==='radio').length===2);
      const snapshot = await run('return window.miswitch.snapshot();');
      const checks = trayMenu.items.filter(x=>x.type==='radio').map(x=>({name:x.label, checked:x.checked}));
      assert.equal(snapshot.active.claude, undefined); assert.ok(checks.every(x=>!x.checked));
      out('tray-no-active', { menu: checks });
      const firstId = snapshot.providers[0].id; const secondId = snapshot.providers[1].id;
      await run(`await window.miswitch.activate(${JSON.stringify(firstId)});window.dispatchEvent(new Event('focus'));await until(()=>document.querySelector('.card.in-use')&&document.querySelector('.summary h3').textContent==='A');`);
      await until(()=>trayMenu.items.find(x=>x.label==='A')?.checked);
      holdSave = true;
      await run(`click('.summary button','编辑');await until(()=>document.querySelector('form.editor'));set(document.querySelector('[name=notes]'),'display note');click('.page-footer .primary');`);
      await until(()=>!!releaseSave);
      trayMenu.items.find(x=>x.label==='B').click();await until(()=>trayMenu.items.find(x=>x.label==='B')?.checked);
      await wait(100);releaseSave();
      await run(`await until(()=>!document.querySelector('form.editor'));`);
      const stale = await run(`return {ui:document.querySelector('.summary h3').textContent,actual:(await window.miswitch.snapshot()).active.claude.providerId};`);
      assert.equal(stale.ui,'A');assert.equal(stale.actual,secondId);
      out('tray-changed-event-dropped-while-busy',{ui:stale.ui,actual:'B',controlledIpcDelivery:true});
      fs.writeFileSync(join(__dirname,'tray-stale.png'),(await window.webContents.capturePage()).toPNG());
      put(join(root,'home/.claude/settings.json'),'{"shared":"original"}');
      put(join(root,'home/.pi/agent/settings.json'),'{"shared":"original"}');
      holdClaude = true;
      await run(`click('.nav-item','全局设置');`); await until(()=>!!releaseClaude);
      await run(`click('[role=tab]','Pi');await until(()=>document.querySelector('.config-editor')&&document.querySelector('.path').textContent.includes('.pi'));`);
      releaseClaude(); await wait(120);
      const race=await run(`return {selected:document.querySelector('[role=tab][aria-selected=true]').textContent,path:document.querySelector('.path').textContent,text:document.querySelector('.config-editor').value};`);
      assert.equal(race.selected,'Pi'); assert.ok(race.path.includes('.claude'));
      fs.writeFileSync(join(__dirname,'global-race.png'),(await window.webContents.capturePage()).toPNG());
      await run(`set(document.querySelector('.config-editor'),'{"shared":"original","claudeOnly":"added while Claude path is displayed"}');click('.page-footer .primary');await until(()=>document.querySelector('.hint.ok'));`);
      assert.equal(JSON.parse(fs.readFileSync(join(root,'home/.pi/agent/settings.json'),'utf8')).claudeOnly, 'added while Claude path is displayed');
      assert.equal(JSON.parse(fs.readFileSync(join(root,'home/.claude/settings.json'),'utf8')).claudeOnly, undefined);
      out('global-view-race-writes-wrong-file', { ...race, piReceivedClaudeDraft: true, claudeUnchanged: true });
      const second=new BrowserWindow({show:false,webPreferences:{preload:join(__dirname,'../../dist-desktop/preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false}});
      await second.loadFile(join(__dirname,'../../dist/index.html'));
      assert.equal(await second.webContents.executeJavaScript(`window.miswitch.snapshot().then(()=>false,e=>e.message.includes('未授权'))`),true);second.destroy();
      const wc=window.webContents; const handler=handlers.get('miswitch:snapshot');
      await assert.rejects(()=>handler({sender:wc,senderFrame:{url:wc.getURL()}}),/未授权/);
      // Same actual frame with wrong URL is covered statically by equality in main.ts; no navigation to a remote URL.
      out('ipc-source-controls',{otherWindowRejected:true,nonMainFrameRejected:true});
      const source=fs.readFileSync(join(__dirname,'../../src/core/presets.ts'),'utf8');
      const urls=[...source.matchAll(/(?:websiteUrl|apiKeyUrl):\s*'([^']+)'/g)].map(x=>x[1]);
      for(const url of [urls[0], urls[0]+'?unexpected=1','https://not-allowed.example','file:///synthetic']) assert.deepEqual(openHandler({url}),{action:'deny'});
      assert.deepEqual(external,[urls[0]]);
      out('external-link-exact-allowlist',{allowedExternalCalls:external.length,variantsRejected:true});
      await run(`click('.nav-item','Claude Code');window.dispatchEvent(new Event('focus'));await until(()=>document.querySelectorAll('.card').length===2);`);
      const alignment=await run(`const x=s=>document.querySelector(s).getBoundingClientRect().x;return {toolbar:x('.page-bar h1'),section:x('.sec-head h2'),tile:x('.summary > .tile')};`);
      out('alignment-1140',alignment);
      await run(`click('.card:not(.in-use) .icon-button');await until(()=>document.querySelector('form.editor'));click('.page-footer .danger');await until(()=>document.querySelector('dialog[open]'));`);
      assert.equal(await run('return document.activeElement.textContent;'),'取消');
      window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});window.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
      await run(`await until(()=>!document.querySelector('dialog'));click('.page-footer button','取消');await until(()=>document.querySelector('.summary'));`);
      out('dialog-keyboard',{cancelFocused:true,escapeCloses:true});
      window.setSize(840,600);window.webContents.setZoomFactor(2);await wait(150);
      await run(`click('.nav-item','全局设置');await until(()=>document.querySelector('.config-editor'));`);
      const layout=await run(`const h=document.querySelector('.page-bar');const tabs=document.querySelector('.segmented');return {viewport:innerWidth,page:document.documentElement.scrollWidth,toolbarScroll:h.scrollWidth,toolbarBox:h.clientWidth,tabsRight:tabs.getBoundingClientRect().right,footerVisible:document.querySelector('.page-footer').getBoundingClientRect().bottom<=innerHeight};`);
      out('global-200pct',layout);
      fs.writeFileSync(join(__dirname,'global-200pct.png'),(await window.webContents.capturePage()).toPNG());
      window.close();await wait(100);assert.equal(BrowserWindow.getAllWindows().length,0);
      trayMenu.items.find(x=>x.label==='打开 Mi-Switch').click();await until(()=>BrowserWindow.getAllWindows().length===1);
      out('tray-reopen',{passed:true});
      clearTimeout(timer);cleanup(0);
    }catch(e){console.error(e);clearTimeout(timer);cleanup(1);}
  });
});
require('../../dist-desktop/main.cjs');
