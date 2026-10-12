// Run after npm run build: ./node_modules/.bin/electron docs/review-sol/reproduce-desktop.cjs
// Real Electron/preload/React, synthetic Hub in an OS temporary sandbox.
const { app } = require('electron');
const { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const root = realpathSync(mkdtempSync(join(tmpdir(), 'miswitch-sol-ui-')));
process.env.MISWITCH_SANDBOX_ROOT = root;
const id = '00000000-0000-4000-8000-000000000001';
const provider = { id, app: 'claude', name: 'Synthetic A', mode: 'api', model: 'review-main', baseUrl: 'https://review.example', protocol: 'anthropic-messages', claudeAuth: 'api-key', loginProvider: 'anthropic', notes: '', apiKey: 'sk-synthetic-only', updatedAt: '2026-10-12T00:00:00.000Z' };
const hubPath = join(root, 'store', 'hub.json');
mkdirSync(join(root, 'store'), { recursive: true });
writeFileSync(hubPath, JSON.stringify({ version: 1, providers: [provider, { ...provider, name: 'Conflicting B' }], active: {} }));
let finished = false;
function finish(code) { if (finished) return; finished = true; clearTimeout(timer); rmSync(root, { recursive: true, force: true }); app.exit(code); }
const timer = setTimeout(() => { console.error('Review UI timed out'); finish(1); }, 45000);
app.on('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', async () => {
    try {
      const initial = await window.webContents.executeJavaScript(`(async () => {
        const until = async fn => { for(let i=0;i<300;i++){if(fn())return;await new Promise(r=>requestAnimationFrame(r));}throw Error('UI timeout'); };
        await until(() => document.querySelector('[role=alert]'));
        return { error: document.querySelector('[role=alert]').textContent, status: document.querySelector('.status-panel strong').textContent, addDisabled: document.querySelector('header .primary').disabled, cards: document.querySelectorAll('.provider-card').length };
      })()`);
      assert.equal(initial.status, '无法读取本地配置'); assert.equal(initial.addDisabled, true); assert.equal(initial.cards, 0);
      assert.ok(!initial.error.includes('重复'));
      console.log('duplicate Hub UI:', initial);
      // Model an external, safe manual repair, then verify the built-in refresh.
      writeFileSync(hubPath, JSON.stringify({ version: 1, providers: [provider], active: {} }));
      const repaired = await window.webContents.executeJavaScript(`(async () => {
        const until = async fn => { for(let i=0;i<300;i++){if(fn())return;await new Promise(r=>requestAnimationFrame(r));}throw Error('UI timeout'); };
        document.querySelector('.status-panel button').click();
        await until(() => document.querySelector('.success'));
        return { status: document.querySelector('.status-panel strong').textContent, cards: document.querySelectorAll('.provider-card').length, addDisabled: document.querySelector('header .primary').disabled };
      })()`);
      assert.equal(repaired.status, '无法读取本地配置'); assert.equal(repaired.cards, 1); assert.equal(repaired.addDisabled, false);
      console.log('after repair + successful refresh:', repaired);
      // The ordinary UI operation of renaming an active Codex login provider causes false edited.
      const result = await window.webContents.executeJavaScript(`(async () => {
        const until = async fn => { for(let i=0;i<300;i++){if(fn())return;await new Promise(r=>requestAnimationFrame(r));}throw Error('UI timeout'); };
        const s = await window.miswitch.save({app:'chatgpt',name:'Login original',mode:'login',baseUrl:'',model:'review-codex',protocol:'openai-responses'});
        const p=s.providers.find(p=>p.app==='chatgpt'); await window.miswitch.activate(p.id);
        document.querySelectorAll('nav button')[1].click(); document.querySelector('.status-panel button').click();
        await until(()=>document.querySelector('.provider-card h2')?.textContent==='Login original');
        document.querySelectorAll('.card-actions button')[1].click(); await until(()=>document.querySelector('dialog[open]'));
        document.querySelector('input[name=name]').value='Login renamed'; document.querySelector('form').requestSubmit();
        await until(()=>!document.querySelector('dialog') && document.querySelector('.provider-card h2')?.textContent==='Login renamed');
        const next=await window.miswitch.snapshot();
        return { badge:document.querySelector('.badge').textContent, notice:document.querySelector('.success').textContent, edited:next.diagnostics.find(d=>d.app==='chatgpt').edited, deleteDisabled:document.querySelectorAll('.card-actions button')[2].disabled };
      })()`);
      assert.equal(result.edited, true); assert.equal(result.badge, '已编辑，待重新写入'); assert.ok(result.notice.includes('仍使用编辑前')); assert.equal(result.deleteDisabled, true);
      const config = readFileSync(join(root, 'home', '.codex', 'config.toml'), 'utf8');
      assert.ok(!config.includes('Login original') && !config.includes('Login renamed'));
      console.log('Codex login rename:', result, 'neither name appears in config.toml');
      finish(0);
    } catch (error) { console.error(error); finish(1); }
  });
});
require('../../dist-desktop/main.cjs');
