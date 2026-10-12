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
        // Adding starts at the preset picker: search, apply a preset, then start over from a custom form.
        document.querySelector('header .primary').click();
        await until(() => document.querySelector('dialog[open] .preset-row'));
        const search = document.querySelector('dialog[open] input[type=search]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, '深度求索'); search.dispatchEvent(new Event('input', { bubbles: true }));
        await until(() => document.querySelectorAll('dialog[open] .preset-row:not(.custom)').length === 1);
        document.querySelector('dialog[open] .preset-row:not(.custom)').click();
        await until(() => document.querySelector('input[name=baseUrl]'));
        const preset = { url: document.querySelector('input[name=baseUrl]').value, haiku: document.querySelector('input[name=smallFastModel]').value, link: !!document.querySelector('.field-head a[href*="deepseek"]') };
        if (preset.url !== 'https://api.deepseek.com/anthropic' || preset.haiku !== 'deepseek-flash' || !preset.link) throw new Error('Preset not applied: ' + JSON.stringify(preset));
        [...document.querySelectorAll('.preset-bar button')].find(b => b.textContent === '更换预设').click();
        await until(() => document.querySelector('dialog[open] .preset-row.custom'));
        document.querySelector('dialog[open] .preset-row.custom').click();
        await until(() => document.querySelector('input[name=name]'));
        document.querySelector('input[name=name]').value = 'Smoke Claude';
        document.querySelector('input[name=model]').value = 'smoke-model';
        document.querySelector('input[name=apiKey]').value = 'sk-smoke-only';
        document.querySelector('input[name=smallFastModel]').value = ' smoke-small ';
        document.querySelector('form').requestSubmit();
        await until(() => !document.querySelector('dialog') && document.querySelector('.provider-row'));
        document.querySelector('.card-actions button').click();
        await until(() => document.querySelector('.badge.green'));
        // Validation messages from the main process must reach the form (static Zod custom issues only).
        document.querySelector('header .primary').click();
        await until(() => document.querySelector('dialog[open] .preset-row.custom'));
        document.querySelector('dialog[open] .preset-row.custom').click();
        await until(() => document.querySelector('input[name=name]'));
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
      assert.equal(config.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'smoke-small');
      // Draft survives API → login → API; a login save drops the key, an API save keeps it.
      const draft = await window.webContents.executeJavaScript(`(async () => {
        const tick = () => new Promise(resolve => requestAnimationFrame(resolve));
        const until = async fn => { for(let i=0;i<120;i++){if(fn())return;await tick();}throw new Error('UI state timeout'); };
        document.querySelector('.card-actions button:nth-child(2)').click();
        await until(() => document.querySelector('dialog[open]'));
        document.querySelector('input[name=baseUrl]').value = 'https://unsaved.test';
        document.querySelector('input[name=apiKey]').value = 'sk-unsaved-draft';
        const mode = document.querySelector('dialog[open] select');
        const set = v => { const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(mode, v); mode.dispatchEvent(new Event('change', { bubbles: true })); };
        set('login'); await tick(); const hiddenWhileLogin = document.querySelector('input[name=baseUrl]').closest('fieldset').hidden && document.querySelector('input[name=smallFastModel]').closest('fieldset').hidden;
        set('api'); await tick();
        const result = { hiddenWhileLogin, url: document.querySelector('input[name=baseUrl]').value, keyLength: document.querySelector('input[name=apiKey]').value.length, small: document.querySelector('input[name=smallFastModel]').value };
        document.querySelector('dialog[open] .dialog-actions button').click();
        await until(() => !document.querySelector('dialog'));
        return result;
      })()`);
      assert.deepEqual(draft, { hiddenWhileLogin: true, url: 'https://unsaved.test', keyLength: 16, small: 'smoke-small' });
      // The configuration file: the saved key stays hidden, provider fields edited in the text sync back to the form,
      // and a save writes only the global part (permissions) while the model waits for the next switch.
      const configEdit = await window.webContents.executeJavaScript(`(async () => {
        const tick = () => new Promise(resolve => requestAnimationFrame(resolve));
        const until = async fn => { for(let i=0;i<240;i++){if(fn())return;await tick();}throw new Error('UI state timeout'); };
        document.querySelector('.card-actions button:nth-child(2)').click();
        await until(() => document.querySelector('#config-text')?.value.includes('ANTHROPIC_MODEL'));
        const area = document.querySelector('#config-text');
        const shown = area.value;
        const value = JSON.parse(shown); value.permissions = { allow: ['Bash(ls)'] }; value.env.ANTHROPIC_MODEL = 'smoke-from-text';
        area.focus();
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(area, JSON.stringify(value, null, 2));
        area.dispatchEvent(new Event('input', { bubbles: true }));
        area.blur();
        await until(() => document.querySelector('input[name=model]').value === 'smoke-from-text');
        document.querySelector('form').requestSubmit();
        await until(() => !document.querySelector('dialog'));
        return { keyHidden: !shown.includes('sk-smoke-only') && shown.includes('已保存的密钥'), badge: document.querySelector('.provider-row .badge').textContent };
      })()`);
      assert.deepEqual(configEdit, { keyHidden: true, badge: '已编辑，待重新写入' });
      const afterEdit = JSON.parse(readFileSync(join(root, 'home', '.claude', 'settings.json'), 'utf8'));
      assert.deepEqual(afterEdit.permissions, { allow: ['Bash(ls)'] }); assert.equal(afterEdit.env.ANTHROPIC_MODEL, 'smoke-model');
      // Long user text and 200 % zoom of the minimum window must not widen the page. Changing the model of the
      // active provider keeps it marked as written, flagged as edited until it is written again.
      const editedBadge = await window.webContents.executeJavaScript(`(async () => {
        const s = await window.miswitch.snapshot(); const p = s.providers[0];
        await window.miswitch.save({ id: p.id, app: 'claude', name: 'A'.repeat(100), mode: 'api', baseUrl: 'https://example.test', model: 'model'.repeat(40), protocol: 'anthropic-messages', notes: 'X'.repeat(2000) });
        document.querySelector('.status-panel button').click();
        for (let i = 0; i < 200; i++) { if (document.querySelector('.provider-row h2')?.textContent.length === 100 && !document.querySelector('header .primary').disabled) return document.querySelector('.provider-row .badge').textContent; await new Promise(r => requestAnimationFrame(r)); }
        throw new Error('long text refresh timeout');
      })()`);
      assert.equal(editedBadge, '已编辑，待重新写入');
      const measure = () => window.webContents.executeJavaScript(`({ viewport: innerWidth, page: document.documentElement.scrollWidth, card: document.querySelector('.provider-row').scrollWidth, cardBox: document.querySelector('.provider-row').clientWidth })`);
      window.setSize(840, 600); await new Promise(r => setTimeout(r, 250));
      const longText = await measure();
      assert.ok(longText.page <= longText.viewport && longText.card <= longText.cardBox, 'long text overflow: ' + JSON.stringify(longText));
      window.webContents.setZoomFactor(2); await new Promise(r => setTimeout(r, 250));
      const zoomed = await measure();
      assert.ok(zoomed.viewport <= 440 && zoomed.page <= zoomed.viewport, '200% zoom overflow: ' + JSON.stringify(zoomed));
      window.webContents.setZoomFactor(1); window.setSize(1140, 820); await new Promise(r => setTimeout(r, 250));
      await window.webContents.executeJavaScript(`(async () => {
        const s = await window.miswitch.snapshot(); const p = s.providers[0];
        await window.miswitch.save({ id: p.id, app: 'claude', name: 'Smoke Claude', mode: 'api', baseUrl: 'https://api.anthropic.com', model: 'smoke-model', protocol: 'anthropic-messages', notes: '' });
        await window.miswitch.activate(p.id);
        document.querySelector('.status-panel button').click();
        for (let i = 0; i < 200; i++) { if (document.querySelector('.badge.green') && !document.querySelector('header .primary').disabled) return; await new Promise(r => requestAnimationFrame(r)); }
        throw new Error('restore refresh timeout');
      })()`);
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
      console.log('Desktop smoke passed: real preload IPC, preset picker, React form save, configuration file editing, small/fast model, validation message, draft persistence, edited badge, long text, 200% zoom, activation, backup, restore, no snapshot key leak.');
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
