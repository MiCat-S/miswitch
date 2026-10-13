// Launch with: ./node_modules/.bin/electron scripts/smoke-desktop.cjs
// Runs the actual bundled main/preload/React app against a temporary home.
const { app, nativeTheme, Notification, Tray } = require('electron');
// The preview image in the docs is always the light appearance.
nativeTheme.themeSource = 'light';
// Keep the menu bar menu reachable from the test, and keep its switch notifications off the desktop.
let trayMenu = null;
const setContextMenu = Tray.prototype.setContextMenu;
Tray.prototype.setContextMenu = function (menu) { trayMenu = menu; return setContextMenu.call(this, menu); };
Notification.isSupported = () => false;
const { mkdtempSync, realpathSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const root = realpathSync(mkdtempSync(join(tmpdir(), 'miswitch-desktop-')));
process.env.MISWITCH_SANDBOX_ROOT = root;
const settingsPath = join(root, 'home', '.claude', 'settings.json');
const settings = () => JSON.parse(readFileSync(settingsPath, 'utf8'));
const timeout = setTimeout(() => { console.error('Desktop smoke test timed out'); app.exit(1); }, 45000);
// Helpers available to every page script: wait for a condition, set a field the way typing does, find by text.
const prelude = `
  const tick = () => new Promise(resolve => requestAnimationFrame(resolve));
  const until = async (fn, what = 'UI state') => { for (let i = 0; i < 300; i++) { if (fn()) return; await tick(); } throw new Error(what + ' timeout'); };
  const set = (el, value) => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, value); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); };
  const field = name => document.querySelector('[name=' + name + ']');
  const byText = (selector, text) => [...document.querySelectorAll(selector)].find(el => el.textContent.includes(text));
  const click = (selector, text) => { const el = text === undefined ? document.querySelector(selector) : byText(selector, text); if (!el) throw new Error('missing ' + selector + ' ' + (text ?? '')); el.click(); };
  const idle = () => !document.querySelector('.page-bar .primary')?.disabled;
`;
app.on('browser-window-created', (_event, window) => {
  const run = code => window.webContents.executeJavaScript(`(async () => { ${prelude} ${code} })()`);
  window.webContents.once('did-finish-load', async () => {
    try {
      // Adding is one page: a preset fills the endpoint and models in place and keeps the key and notes already typed.
      const preset = await run(`
        if (!window.miswitch) throw new Error('Preload bridge missing');
        await until(() => document.querySelector('.page-bar .primary') && idle(), 'first load');
        click('.page-bar .primary');
        await until(() => document.querySelector('.presets .chip'), 'preset chips');
        set(field('apiKey'), 'sk-smoke-only'); set(field('notes'), 'kept note');
        set(document.querySelector('.preset-search'), '深度求索');
        await until(() => document.querySelectorAll('.presets .chip').length === 2, 'preset search');
        document.querySelectorAll('.presets .chip')[1].click(); await tick();
        return { url: field('baseUrl').value, haiku: field('smallFastModel').value, name: field('name').value, key: field('apiKey').value, notes: field('notes').value, link: !!document.querySelector('.field-head a[href*="deepseek"]') };
      `);
      assert.deepEqual(preset, { url: 'https://api.deepseek.com/anthropic', haiku: 'deepseek-flash', name: 'DeepSeek', key: 'sk-smoke-only', notes: 'kept note', link: true });
      // "Save and use" stores the provider and writes it in one action.
      const first = await run(`
        click('.presets .chip', '自定义'); await tick();
        set(field('name'), 'Smoke Claude'); set(field('model'), 'smoke-model'); set(field('baseUrl'), 'https://api.anthropic.com'); set(field('smallFastModel'), ' smoke-small ');
        set(field('claudeAuth'), 'api-key');
        click('.page-footer button', '保存并使用');
        await until(() => !document.querySelector('form.editor') && document.querySelector('.card.in-use'), 'save and use');
        return { name: document.querySelector('.summary h3').textContent, state: document.querySelector('.summary .state').className, nav: document.querySelector('.nav-item.on small').textContent,
          mark: !!document.querySelector('.summary .tile svg') && !document.querySelector('.summary .tile.letter') };
      `);
      assert.deepEqual(first, { name: 'Smoke Claude', state: 'state ok', nav: 'Smoke Claude', mark: true });
      assert.equal(settings().env.ANTHROPIC_API_KEY, 'sk-smoke-only');
      assert.equal(settings().env.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'smoke-small');
      // Validation messages from the main process reach the editor footer (static Zod custom issues only).
      const validation = await run(`
        click('.page-bar .primary'); await until(() => document.querySelector('form.editor'));
        set(field('name'), 'Bad URL'); set(field('model'), 'm'); set(field('apiKey'), 'sk-smoke-two'); set(field('baseUrl'), 'http://gateway.example');
        click('.page-footer button', '保存');
        await until(() => document.querySelector('.page-footer .error'), 'validation');
        const text = document.querySelector('.page-footer .error').textContent;
        click('.page-footer button', '取消'); await until(() => document.querySelector('.summary'));
        return text;
      `);
      assert.match(validation, /HTTPS/);
      // A draft survives API → login → API.
      const draft = await run(`
        click('.card .icon-button'); await until(() => document.querySelector('form.editor'));
        set(field('baseUrl'), 'https://unsaved.test'); set(field('apiKey'), 'sk-unsaved-draft');
        const mode = document.querySelector('form.editor .panel select');
        set(mode, 'login'); await tick();
        // Hidden on screen, not just marked hidden: a later CSS display rule once kept the API fields visible.
        const hiddenWhileLogin = ['baseUrl', 'apiKey', 'smallFastModel'].every(name => field(name).closest('fieldset').hidden && !field(name).getClientRects().length);
        set(mode, 'api'); await tick();
        const result = { hiddenWhileLogin, url: field('baseUrl').value, keyLength: field('apiKey').value.length, small: field('smallFastModel').value, footer: [...document.querySelectorAll('.page-footer button')].map(b => b.textContent) };
        click('.page-footer button', '取消'); await until(() => document.querySelector('.summary'));
        return result;
      `);
      assert.deepEqual(draft, { hiddenWhileLogin: true, url: 'https://unsaved.test', keyLength: 16, small: 'smoke-small', footer: ['删除供应商', '取消', '保存并应用'] });
      // The preview hides the saved key; saving the provider in use writes the file at once.
      const preview = await run(`
        click('.summary button', '编辑'); await until(() => document.querySelector('form.editor'));
        const details = document.querySelector('details.preview'); details.open = true; details.dispatchEvent(new Event('toggle'));
        await until(() => document.querySelector('.config-preview')?.textContent.includes('ANTHROPIC_MODEL'), 'preview');
        const shown = document.querySelector('.config-preview').textContent;
        set(field('model'), 'smoke-edited');
        click('.icon-row button'); await until(() => document.querySelector('.icon-picker'));
        click('.icon-option', '名称首字'); await until(() => document.querySelector('.icon-option.on')?.textContent.includes('名称首字'), 'icon choice');
        click('.page-footer button', '保存并应用');
        await until(() => !document.querySelector('form.editor') && idle(), 'save in use');
        return { keyHidden: !shown.includes('sk-smoke-only') && shown.includes('已保存的密钥'), state: document.querySelector('.summary .state').className, letter: document.querySelector('.summary .tile.letter')?.textContent };
      `);
      assert.deepEqual(preview, { keyHidden: true, state: 'state ok', letter: 'S' });
      assert.equal(settings().env.ANTHROPIC_MODEL, 'smoke-edited');
      // Global settings: provider fields are refused by name; other settings are written and the provider's stay.
      const global = await run(`
        click('.nav-item', '全局设置'); await until(() => document.querySelector('.config-editor'), 'global view');
        const area = document.querySelector('.config-editor');
        const shown = area.value;
        set(area, JSON.stringify({ model: 'x' })); click('.page-footer .primary');
        await until(() => document.querySelector('.page-footer .error'), 'owned field refusal');
        const refused = document.querySelector('.page-footer .error').textContent;
        set(area, JSON.stringify({ permissions: { allow: ['Bash(ls)'] } }, null, 2)); click('.page-footer .primary');
        await until(() => document.querySelector('.hint.ok'), 'global save');
        return { providerFieldsHidden: !shown.includes('ANTHROPIC'), refused: refused.includes('供应商管理') };
      `);
      assert.deepEqual(global, { providerFieldsHidden: true, refused: true });
      assert.deepEqual(settings().permissions, { allow: ['Bash(ls)'] });
      assert.equal(settings().env.ANTHROPIC_MODEL, 'smoke-edited');
      // A change made by another program shows when the window regains focus, and "re-apply" writes the provider back.
      const changed = settings(); changed.env.ANTHROPIC_MODEL = 'changed-outside'; writeFileSync(settingsPath, JSON.stringify(changed));
      const drift = await run(`
        click('.nav-item', 'Claude Code'); window.dispatchEvent(new Event('focus'));
        await until(() => document.querySelector('.summary .state.warn'), 'drift on focus');
        const text = document.querySelector('.summary .state').textContent;
        click('.summary button', '重新应用');
        await until(() => document.querySelector('.summary .state.ok'), 're-apply');
        return text;
      `);
      assert.equal(drift, '配置文件被其他程序改过');
      assert.equal(settings().env.ANTHROPIC_MODEL, 'smoke-edited');
      // Long user text and 200 % zoom of the minimum window must not widen the page.
      await run(`
        const p = (await window.miswitch.snapshot()).providers[0];
        await window.miswitch.save({ app: 'claude', name: 'A'.repeat(100), mode: 'api', baseUrl: 'https://example.test/' + 'p'.repeat(200), apiKey: 'sk-long', model: 'model'.repeat(40), protocol: 'anthropic-messages', notes: 'X'.repeat(2000) });
        await window.miswitch.save({ id: p.id, app: 'claude', name: 'B'.repeat(100), mode: 'api', baseUrl: 'https://api.anthropic.com', model: 'm'.repeat(200), protocol: 'anthropic-messages', notes: 'Y'.repeat(2000) });
        window.dispatchEvent(new Event('focus'));
        await until(() => document.querySelectorAll('.card').length === 2 && document.querySelector('.summary h3').textContent.length === 100, 'long text refresh');
      `);
      const measure = () => run(`return { viewport: innerWidth, page: document.documentElement.scrollWidth, body: document.querySelector('.page-body').scrollWidth, bodyBox: document.querySelector('.page-body').clientWidth,
        cards: [...document.querySelectorAll('.card, .summary')].every(c => c.scrollWidth <= c.clientWidth) };`);
      window.setSize(840, 600); await new Promise(r => setTimeout(r, 250));
      const longText = await measure();
      assert.ok(longText.page <= longText.viewport && longText.body <= longText.bodyBox && longText.cards, 'long text overflow: ' + JSON.stringify(longText));
      window.webContents.setZoomFactor(2); await new Promise(r => setTimeout(r, 250));
      const zoomed = await measure();
      assert.ok(zoomed.viewport <= 440 && zoomed.page <= zoomed.viewport && zoomed.body <= zoomed.bodyBox && zoomed.cards, '200% zoom overflow: ' + JSON.stringify(zoomed));
      window.webContents.setZoomFactor(1); window.setSize(1140, 820); await new Promise(r => setTimeout(r, 250));
      // Tidy names for the preview image, switch with ▶, then delete the other provider from its editor.
      const switched = await run(`
        const s = await window.miswitch.snapshot();
        const active = s.providers.find(p => p.id === s.active.claude.providerId), other = s.providers.find(p => p !== active);
        await window.miswitch.save({ id: active.id, app: 'claude', name: 'Smoke Claude', mode: 'api', baseUrl: 'https://api.anthropic.com', model: 'smoke-model', smallFastModel: 'smoke-small', protocol: 'anthropic-messages', notes: '' });
        await window.miswitch.save({ id: other.id, app: 'claude', name: 'Gateway', mode: 'api', baseUrl: 'https://gateway.example', model: 'gateway-model', protocol: 'anthropic-messages', claudeAuth: 'bearer', notes: '备用线路' });
        window.dispatchEvent(new Event('focus'));
        await until(() => byText('.card h3', 'Gateway') && idle(), 'rename refresh');
        click('.card .play'); await until(() => document.querySelector('.summary h3').textContent === 'Gateway' && idle(), 'switch');
        const viaPlay = document.querySelector('.summary h3').textContent;
        click('.card:not(.in-use) .icon-button'); await until(() => document.querySelector('form.editor'));
        click('.page-footer .danger'); await until(() => document.querySelector('dialog[open]'));
        click('dialog[open] .danger'); await until(() => !document.querySelector('dialog') && !document.querySelector('form.editor') && document.querySelectorAll('.card').length === 1, 'delete');
        click('.card .icon-button'); await until(() => document.querySelector('form.editor'));
        const deleteLocked = document.querySelector('.page-footer .danger').disabled;
        click('.page-footer button', '取消'); await until(() => document.querySelector('.summary'));
        return { viaPlay, deleteLocked, gatewayTile: document.querySelector('.card .tile.letter')?.textContent };
      `);
      assert.deepEqual(switched, { viaPlay: 'Gateway', deleteLocked: true, gatewayTile: 'G' });
      await run(`
        const s = await window.miswitch.snapshot();
        await window.miswitch.save({ app: 'claude', name: 'Smoke Claude', mode: 'api', baseUrl: 'https://api.anthropic.com', apiKey: 'sk-smoke-only', model: 'smoke-model', smallFastModel: 'smoke-small', protocol: 'anthropic-messages', notes: '' });
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => undefined)));
      `);
      // The menu bar lists every provider; choosing one switches and the open window follows without a refocus.
      await new Promise(r => setTimeout(r, 300));
      const items = trayMenu.items.filter(item => item.type === 'radio');
      assert.deepEqual(items.map(item => [item.label, item.checked]), [['Gateway', true], ['Smoke Claude', false]]);
      items[1].click();
      await run(`await until(() => document.querySelector('.summary h3').textContent === 'Smoke Claude' && document.querySelectorAll('.card').length === 2 && idle(), 'menu bar switch');`);
      assert.equal(trayMenu.items.find(item => item.label === 'Smoke Claude').checked, true);
      await run(`document.querySelector('.toast-region').hidden = true; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));`);
      writeFileSync(join(__dirname, '../docs/desktop-preview.png'), (await window.webContents.capturePage()).toPNG());
      await run(`document.querySelector('.toast-region').hidden = false;`);
      // Restoring from the backups page clears the in-use marker.
      const restored = await run(`
        click('.nav-item', '历史备份'); await until(() => document.querySelector('.backup-row'), 'backups');
        click('.backup-row button'); await until(() => document.querySelector('dialog[open]'));
        click('dialog[open] .primary'); await until(() => !document.querySelector('dialog') && document.querySelector('.toast'), 'restore');
        const s = await window.miswitch.snapshot();
        if (JSON.stringify(s).includes('sk-smoke') || JSON.stringify(s).includes('sk-long')) throw new Error('Secret leaked in snapshot');
        return { active: !!s.active.claude, backups: s.backups.length > 0 };
      `);
      assert.deepEqual(restored, { active: false, backups: true });
      console.log('Desktop smoke passed: real preload IPC, preset chips keep key and notes, save and use, vendor mark and chosen initial, validation message, draft persistence, read-only preview without the key, save applies the provider in use, global settings refuse provider fields and keep them, drift on focus and re-apply, long text, 200% zoom, switch with ▶, delete from the editor, menu bar switch, restore from backups, no snapshot key leak.');
      clearTimeout(timeout);
      window.destroy();
      // Electron may still have cache handles open; test data is synthetic and safe to clean up.
      rmSync(root, { recursive: true, force: true });
      app.exit(0);
    } catch (error) {
      console.error('Desktop smoke failed:', error.message, error.actual === undefined ? '' : JSON.stringify(error.actual));
      clearTimeout(timeout); app.exit(1);
    }
  });
});
require('../dist-desktop/main.cjs');
