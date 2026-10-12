// Verifies the fixes for SOL HIGH A5 and A8 with the review's own method: the real main/preload/React app in a
// temporary root, where only the delivery of genuine IPC responses is delayed. Run after `npm run build`:
//   ./node_modules/.bin/electron docs/review-fixes/verify-races-desktop.cjs
const { app, ipcMain, Tray, Notification, nativeTheme } = require('electron');
const fs = require('node:fs'); const { join, dirname } = require('node:path'); const { tmpdir } = require('node:os'); const assert = require('node:assert/strict');
const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'miswitch-race-fixes-')));
process.env.MISWITCH_SANDBOX_ROOT = root;
nativeTheme.themeSource = 'light'; Notification.isSupported = () => false;
let trayMenu, holdClaude = false, releaseClaude, holdSave = false, releaseSave, observed;
const setMenu = Tray.prototype.setContextMenu;
Tray.prototype.setContextMenu = function (menu) { trayMenu = menu; return setMenu.call(this, menu); };
const register = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (name, handler) => register(name, async (...args) => {
  const result = await handler(...args);
  if (name === 'miswitch:save' && holdSave) { holdSave = false; await new Promise(resolve => { releaseSave = resolve; }); }
  if (name === 'miswitch:globalView' && args[1] === 'claude' && holdClaude) { holdClaude = false; await new Promise(resolve => { releaseClaude = resolve; }); }
  return result;
});
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async fn => { for (let i = 0; i < 200; i++) { if (fn()) return; await wait(25); } throw Error('main wait timeout'); };
const put = (p, s) => { fs.mkdirSync(dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
const prelude = `const tick=()=>new Promise(r=>requestAnimationFrame(r));
const until=async(fn,what='UI')=>{for(let i=0;i<300;i++){if(fn())return;await tick();}throw Error(what+' timeout');};
const click=(s,t)=>{const e=[...document.querySelectorAll(s)].find(x=>!t||x.textContent.includes(t));if(!e)throw Error('missing '+s+' '+t);e.click();};
const set=(e,v)=>{Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value').set.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));};`;
const finish = code => { fs.rmSync(root, { recursive: true, force: true }); app.exit(code); };
setTimeout(() => { console.error('race verification timeout'); finish(1); }, 60000);
app.on('browser-window-created', (_e, window) => {
  if (observed) return; observed = window;
  const run = code => window.webContents.executeJavaScript(`(async()=>{${prelude}${code}})()`);
  window.webContents.once('did-finish-load', async () => {
    try {
      await run(`await until(()=>document.querySelector('.page-bar .primary')&&!document.querySelector('.page-bar .primary').disabled);
        await window.miswitch.save({app:'claude',name:'A',mode:'login',model:'m',protocol:'anthropic-messages'});
        await window.miswitch.save({app:'claude',name:'B',mode:'login',model:'m',protocol:'anthropic-messages'});`);
      const ids = await run(`const s=await window.miswitch.snapshot();return s.providers.map(p=>p.id);`);
      await run(`await window.miswitch.activate(${JSON.stringify(ids[0])});window.dispatchEvent(new Event('focus'));await until(()=>document.querySelector('.summary h3')?.textContent==='A');`);
      await until(() => trayMenu?.items.find(x => x.label === 'A')?.checked);
      // A8: the menu bar switches to B while a save of A is waiting for its answer; once the save finishes, the window shows B.
      holdSave = true;
      await run(`click('.summary button','编辑');await until(()=>document.querySelector('form.editor'));set(document.querySelector('[name=notes]'),'display note');click('.page-footer .primary');`);
      await until(() => !!releaseSave);
      trayMenu.items.find(x => x.label === 'B').click(); await until(() => trayMenu.items.find(x => x.label === 'B')?.checked);
      await wait(100); releaseSave();
      const shown = await run(`await until(()=>!document.querySelector('form.editor'));await until(()=>document.querySelector('.summary h3')?.textContent==='B','refresh after busy');return document.querySelector('.summary h3').textContent;`);
      assert.equal(shown, 'B');
      console.log(JSON.stringify({ name: 'A8-menu-change-during-save-is-shown', ui: shown }));
      // A5: the Claude read is answered after the Pi read; the Pi tab keeps Pi's file, and a save goes to Pi only.
      put(join(root, 'home/.claude/settings.json'), '{"shared":"original"}');
      put(join(root, 'home/.pi/agent/settings.json'), '{"shared":"original"}');
      holdClaude = true;
      await run(`click('.nav-item','全局设置');`); await until(() => !!releaseClaude);
      await run(`click('[role=tab]','Pi');await until(()=>document.querySelector('.config-editor')&&document.querySelector('.path').textContent.includes('.pi'));`);
      releaseClaude(); await wait(150);
      const race = await run(`return {selected:document.querySelector('[role=tab][aria-selected=true]').textContent,path:document.querySelector('.path').textContent};`);
      assert.equal(race.selected, 'Pi'); assert.ok(race.path.includes('.pi'), race.path);
      await run(`set(document.querySelector('.config-editor'),'{"shared":"original","piOnly":"saved on the Pi tab"}');click('.page-footer .primary');await until(()=>document.querySelector('.hint.ok'));`);
      assert.equal(JSON.parse(fs.readFileSync(join(root, 'home/.pi/agent/settings.json'), 'utf8')).piOnly, 'saved on the Pi tab');
      assert.equal(JSON.parse(fs.readFileSync(join(root, 'home/.claude/settings.json'), 'utf8')).piOnly, undefined);
      console.log(JSON.stringify({ name: 'A5-late-read-is-ignored', ...race, claudeUnchanged: true }));
      console.log('Race fixes verified: A5, A8');
      finish(0);
    } catch (error) { console.error('Race verification failed:', error.message); finish(1); }
  });
});
require('../../dist-desktop/main.cjs');
