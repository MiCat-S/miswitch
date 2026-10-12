// Run after npm run build: ./node_modules/.bin/electron docs/review-astra/reproduce-desktop.cjs
// Actual bundled main/preload/React, isolated filesystem. Only delay delivery of one genuine IPC result.
const { app, BrowserWindow, ipcMain, Tray, Notification, shell, nativeTheme } = require('electron');
const fs = require('node:fs'); const { join } = require('node:path'); const { tmpdir } = require('node:os'); const assert = require('node:assert/strict');
const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'miswitch-astra-desktop-')));
process.env.MISWITCH_SANDBOX_ROOT = root;
nativeTheme.themeSource = 'light'; Notification.isSupported = () => false;
let trayMenu, openHandler, holdClaude = false, releaseClaude, observedWindow;
const handlers = new Map(); const external = [];
shell.openExternal = async url => { external.push(url); };
const setMenu = Tray.prototype.setContextMenu;
Tray.prototype.setContextMenu = function(menu) { trayMenu = menu; return setMenu.call(this, menu); };
const register = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (name, handler) => {
  handlers.set(name, handler);
  register(name, async (...args) => {
    const result = await handler(...args);
    if (name === 'miswitch:globalView' && args[1] === 'claude' && holdClaude) {
      holdClaude = false; await new Promise(resolve => { releaseClaude = resolve; });
    }
    return result;
  });
};
const out = (name, value) => console.log(JSON.stringify({ name, ...value }));
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async fn => { for(let i=0;i<200;i++){if(fn())return;await wait(25);}throw Error('main wait timeout'); };
const prelude = `const tick=()=>new Promise(r=>requestAnimationFrame(r));
const until=async(fn)=>{for(let i=0;i<300;i++){if(fn())return;await tick();}throw Error('UI timeout');};
const click=(s,t)=>{const e=[...document.querySelectorAll(s)].find(x=>!t||x.textContent.includes(t));if(!e)throw Error('missing '+s+' '+t);e.click();};
const set=(e,v)=>{Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value').set.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));};`;
const timer = setTimeout(()=>{console.error('desktop supplement timeout');app.exit(1);},60000);
app.on('browser-window-created', (_e, window) => {
  const original = window.webContents.setWindowOpenHandler.bind(window.webContents);
  window.webContents.setWindowOpenHandler = handler => { openHandler = handler; return original(handler); };
  if (observedWindow) return;
  observedWindow = window;
  const run = code => window.webContents.executeJavaScript(`(async()=>{${prelude}${code}})()`);
  window.webContents.once('did-finish-load', async () => {
    try {
      await run(`await until(()=>document.querySelector('.page-bar .primary')&&!document.querySelector('.page-bar .primary').disabled);`);
      await run(`await window.miswitch.save({app:'claude',name:'A',mode:'api',baseUrl:'https://saved.example',apiKey:'sk-synthetic',model:'m',protocol:'anthropic-messages'});
      await window.miswitch.save({app:'claude',name:'B',mode:'api',baseUrl:'https://saved.example',apiKey:'sk-synthetic',model:'m',protocol:'anthropic-messages'});`);
      await until(()=>trayMenu?.items.filter(x=>x.type==='radio').length===2);
      const snapshot = await run('return window.miswitch.snapshot();');
      const checks = trayMenu.items.filter(x=>x.type==='radio').map(x=>({name:x.label, checked:x.checked}));
      assert.equal(snapshot.active.claude, undefined); assert.ok(checks.every(x=>!x.checked));
      out('tray-checks-with-no-active-provider', { active: null, menu: checks });
      // Genuine results, reversed delivery: the selected Pi tab receives an earlier Claude result.
      const put=(p,s)=>{fs.mkdirSync(join(p,'..'),{recursive:true});fs.writeFileSync(p,s);};
      put(join(root,'home/.claude/settings.json'),'{"claudeOnly":"original"}');
      put(join(root,'home/.pi/agent/settings.json'),'{"piOnly":"original"}');
      holdClaude = true;
      await run(`click('.nav-item','全局设置');`); await until(()=>!!releaseClaude);
      await run(`click('[role=tab]','Pi');await until(()=>document.querySelector('.config-editor')?.value.includes('piOnly'));`);
      releaseClaude(); await wait(120);
      const race=await run(`return {selected:document.querySelector('[role=tab][aria-selected=true]').textContent,path:document.querySelector('.path').textContent,text:document.querySelector('.config-editor').value};`);
      assert.equal(race.selected,'Pi');assert.ok(race.path.includes('.claude'));assert.ok(race.text.includes('claudeOnly'));
      fs.writeFileSync(join(__dirname,'global-race.png'),(await window.webContents.capturePage()).toPNG());
      out('global-view-out-of-order',race);
      // Untrusted same-page second window has the bridge but cannot invoke the main window's handler.
      const second=new BrowserWindow({show:false,webPreferences:{preload:join(__dirname,'../../dist-desktop/preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false}});
      await second.loadFile(join(__dirname,'../../dist/index.html'));
      const denied=await second.webContents.executeJavaScript(`window.miswitch.snapshot().then(()=>false,e=>e.message.includes('未授权'))`);
      assert.equal(denied,true);second.destroy();
      const handler=handlers.get('miswitch:snapshot');
      const wc=window.webContents;
      await assert.rejects(()=>handler({sender:wc,senderFrame:{url:wc.getURL()}}),/未授权/);
      out('ipc-source-controls',{otherWindowRejected:true,nonMainFrameRejected:true});
      // Static allowlist decisions tested without opening a browser or sending a request.
      const allowed='https://www.anthropic.com/';
      // Read actual allowlist from compiled behavior via known preset source links, not guessed successes.
      const source=fs.readFileSync(join(__dirname,'../../src/core/presets.ts'),'utf8');
      const urls=[...source.matchAll(/(?:websiteUrl|apiKeyUrl):\s*'([^']+)'/g)].map(x=>x[1]);
      const realHandler = openHandler; // second window never installs a window-open handler in its own main.
      for(const url of [urls[0], urls[0]+'?unexpected=1','https://evil.example','file:///synthetic','javascript:alert(1)']) assert.deepEqual(realHandler({url}),{action:'deny'});
      assert.deepEqual(external,[urls[0]]);
      out('window-open-allowlist',{allowedExternalCalls:external.length,otherUrlsDenied:true});
      // Layout measurements at 1140 and min-size 200%; modal default focus and Escape are real UI events.
      await run(`click('.nav-item','Claude Code');window.dispatchEvent(new Event('focus'));await until(()=>document.querySelectorAll('.card').length===2);`);
      const alignment=await run(`const x=s=>document.querySelector(s).getBoundingClientRect().x;return {toolbar:x('.page-bar h1'),section:x('.sec-head h2'),tile:x('.summary > .tile')};`);
      out('alignment-1140',alignment);
      await run(`click('.card .icon-button');await until(()=>document.querySelector('form.editor'));click('.page-footer .danger');await until(()=>document.querySelector('dialog[open]'));`);
      assert.equal(await run('return document.activeElement.textContent;'),'取消');
      window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});window.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
      await run(`await until(()=>!document.querySelector('dialog'));click('.page-footer button','取消');await until(()=>document.querySelector('.summary'));`);
      out('dialog-keyboard',{cancelInitiallyFocused:true,escapeCloses:true});
      const palettes=[];
      for(const theme of ['light','dark']){
        nativeTheme.themeSource=theme;await wait(100);
        palettes.push(await run(`const s=getComputedStyle(document.documentElement);return {theme:${JSON.stringify(theme)},tokens:Object.fromEntries(['secondary','window','sidebar','panel','panel-2','on-accent','accent','warn-text','warn-soft','danger','danger-soft'].map(k=>[k,s.getPropertyValue('--'+k).trim()]))};`));
      }
      out('theme-tokens',{palettes});nativeTheme.themeSource='light';
      window.setSize(840,600);window.webContents.setZoomFactor(2);await wait(100);
      await run(`click('.nav-item','全局设置');await until(()=>document.querySelector('.config-editor'));`);
      const layout=await run(`return {width:innerWidth,page:document.documentElement.scrollWidth,toolbar:document.querySelector('.page-bar').scrollWidth,toolbarBox:document.querySelector('.page-bar').clientWidth};`);
      out('global-200pct',layout);
      fs.writeFileSync(join(__dirname,'global-200pct.png'),(await window.webContents.capturePage()).toPNG());
      await run(`await window.miswitch.save({app:'pi',name:'Prototype ID',mode:'login',loginProvider:'__proto__',model:'m',protocol:'openai-completions'});window.dispatchEvent(new Event('focus'));await tick();await tick();click('.nav-item','Pi');`);
      await wait(250);
      const blank=await run(`return document.querySelector('#root').childElementCount===0;`);
      assert.equal(blank,true);out('pi-prototype-blank-renderer',{blank:true});
      fs.writeFileSync(join(__dirname,'pi-prototype-blank.png'),(await window.webContents.capturePage()).toPNG());
      window.close();await wait(100);
      assert.equal(BrowserWindow.getAllWindows().length,0);
      trayMenu.items.find(x=>x.label==='打开 Mi-Switch').click();await until(()=>BrowserWindow.getAllWindows().length===1);
      out('tray-reopens-closed-window',{passed:true});
      clearTimeout(timer);for(const w of BrowserWindow.getAllWindows())w.destroy();fs.rmSync(root,{recursive:true,force:true});app.exit(0);
    }catch(e){console.error(e);clearTimeout(timer);for(const w of BrowserWindow.getAllWindows())w.destroy();fs.rmSync(root,{recursive:true,force:true});app.exit(1);}
  });
});
require('../../dist-desktop/main.cjs');
