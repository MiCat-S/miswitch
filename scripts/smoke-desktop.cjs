// Launch with: ./node_modules/.bin/electron scripts/smoke-desktop.cjs
// Runs the actual bundled main/preload/React app against a temporary home.
const { app } = require('electron');
const { mkdtempSync, realpathSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const root = realpathSync(mkdtempSync(join(tmpdir(), 'miswitch-desktop-')));
process.env.MISWITCH_SANDBOX_ROOT = root;
const timeout = setTimeout(() => { console.error('Desktop smoke test timed out'); app.exit(1); }, 30000);
app.on('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', async () => {
    try {
      const state = await window.webContents.executeJavaScript(`(async () => {
        const tick = () => new Promise(resolve => requestAnimationFrame(resolve));
        const until = async fn => { for(let i=0;i<120;i++){if(fn())return;await tick();}throw new Error('UI state timeout'); };
        if (!window.miswitch) throw new Error('Preload bridge missing');
        await until(() => document.querySelector('header .primary') && !document.querySelector('header .primary').disabled);
        document.querySelector('header .primary').click();
        await until(() => document.querySelector('dialog[open]'));
        document.querySelector('input[name=name]').value = 'Smoke Claude';
        document.querySelector('input[name=model]').value = 'smoke-model';
        document.querySelector('input[name=apiKey]').value = 'sk-smoke-only';
        document.querySelector('form').requestSubmit();
        await until(() => !document.querySelector('dialog') && document.querySelector('.provider-card'));
        document.querySelector('.card-actions button').click();
        await until(() => document.querySelector('.badge.green'));
        // Validation messages from the main process must reach the form (static Zod custom issues only).
        document.querySelector('header .primary').click();
        await until(() => document.querySelector('dialog[open]'));
        document.querySelector('input[name=name]').value = 'Bad URL';
        document.querySelector('input[name=model]').value = 'm';
        document.querySelector('input[name=apiKey]').value = 'sk-smoke-two';
        document.querySelector('input[name=baseUrl]').value = 'http://gateway.example';
        document.querySelector('form').requestSubmit();
        await until(() => document.querySelector('dialog[open] .error'));
        const validation = document.querySelector('dialog[open] .error').textContent;
        if (!validation.includes('HTTPS')) throw new Error('Validation message lost: ' + validation);
        document.querySelector('dialog[open] .dialog-actions button').click();
        await until(() => !document.querySelector('dialog'));
        const s = await window.miswitch.snapshot();
        if (JSON.stringify(s).includes('sk-smoke')) throw new Error('Secret leaked in snapshot');
        return { name: s.providers[0].name, status: s.diagnostics[0].state, backups: s.backups.length, dialog: !!document.querySelector('dialog') };
      })()`);
      assert.deepEqual(state, { name: 'Smoke Claude', status: 'written', backups: 1, dialog: false });
      const config = JSON.parse(readFileSync(join(root, 'home', '.claude', 'settings.json'), 'utf8'));
      assert.equal(config.env.ANTHROPIC_API_KEY, 'sk-smoke-only');
      await window.webContents.executeJavaScript(`(async () => {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => undefined)));
      })()`);
      const screenshot = await window.webContents.capturePage();
      writeFileSync(join(__dirname, '../docs/desktop-preview.png'), screenshot.toPNG());
      await window.webContents.executeJavaScript(`(async () => {
        const s=await window.miswitch.snapshot(); await window.miswitch.restore(s.backups[0].id);
        const restored=await window.miswitch.snapshot();
        if(restored.active.claude) throw new Error('Restore kept active marker');
      })()`);
      console.log('Desktop smoke passed: real preload IPC, React form save, validation message, activation, backup, restore, no snapshot key leak.');
      clearTimeout(timeout);
      window.destroy();
      // Electron may still have cache handles open; test data is synthetic and safe to clean up.
      rmSync(root, { recursive: true, force: true });
      app.exit(0);
    } catch (error) {
      console.error('Desktop smoke failed:', error.message);
      clearTimeout(timeout); app.exit(1);
    }
  });
});
require('../dist-desktop/main.cjs');
