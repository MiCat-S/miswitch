// Independent review assertions. Synthetic files only; all HTTP is 127.0.0.1.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import TOML from '@iarna/toml';
import { Manager } from '../../src/core/manager.ts';
import { resolvePaths } from '../../src/core/paths.ts';
import { TARGET_LIMIT, hash, readText, replaceText } from '../../src/core/files.ts';
import { providerSchema, baseUrlIssues } from '../../src/core/types.ts';
import { asJson, providerDefinition, managedFingerprint, patchProvider, liveProvider } from '../../src/core/adapters.ts';
import { parseConfigText, splitConfig } from '../../src/core/config-editor.ts';
import { publicError, SAVED_NOT_APPLIED } from '../../src/core/errors.ts';
import { autoIcon } from '../../src/ui/vendor.ts';
const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'miswitch-sol-high-')));
const put = async (path: string, text: string) => { await fs.mkdir(dirname(path), { recursive: true }); await fs.writeFile(path, text); };
const fixture = (name: string) => { const paths = resolvePaths(join(root, name, 'store'), join(root, name, 'home'), {}); return { paths, manager: new Manager(paths, {}) }; };
const claude = { app: 'claude' as const, name: 'A', mode: 'api' as const, baseUrl: 'https://saved.example', apiKey: 'sk-review-synthetic', model: 'm', protocol: 'anthropic-messages' as const };
const codex = { ...claude, app: 'chatgpt' as const, protocol: 'openai-responses' as const };
let count = 0;
const log = (name: string, detail: unknown) => { count++; console.log(JSON.stringify({ name, detail })); };
try {
  {
    const f = fixture('key-recipient'); let received = '';
    const server = createServer((req, res) => { received = String(req.headers['x-api-key']); res.end('{"data":[{"id":"mock-model"}]}'); });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    try {
      const url = `http://127.0.0.1:${(server.address() as any).port}`;
      const p = (await f.manager.save(claude)).providers[0];
      await f.manager.listModels({ app: 'claude', providerId: p.id, baseUrl: url, protocol: 'anthropic-messages' });
      assert.equal(received, claude.apiKey);
      assert.equal((await f.manager.snapshot()).providers[0].baseUrl, claude.baseUrl);
      log('saved-key-to-unsaved-url', { sent: true, hubUrlUnchanged: true });
    } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
  }
  {
    const f = fixture('preview'); const secret = 'sk-imported-review-only';
    await put(f.paths.targets.chatgpt[0], `model="m"\nmodel_provider="work"\n[model_providers.work]\nname="Work"\nbase_url="https://saved.example/v1"\nwire_api="responses"\nexperimental_bearer_token="${secret}"\n`);
    const s = await f.manager.importLive(); const p = s.providers[0];
    const preview = await f.manager.configView({ app: 'chatgpt', providerId: p.id, draft: { name: p.name, mode: 'api', baseUrl: p.baseUrl, model: p.model } });
    const global = await f.manager.globalView('chatgpt');
    assert.ok(preview.text!.includes(secret)); assert.ok(global.text!.includes(secret));
    assert.ok(!JSON.stringify(s).includes(secret));
    log('imported-key-in-read-apis', { snapshotRedacted: true, configViewLeaks: true, globalViewLeaks: true });
  }
  {
    const f = fixture('dates'); const path = f.paths.targets.chatgpt[0];
    const before = 'model="m"\nstamp=1979-05-27T07:32:00Z\nday=1979-05-27\nclock=07:32:00.000\nitems=[{name="one", enabled=true}]\n[[rows]]\nname="r"\n';
    await put(path, before); const view = await f.manager.globalView('chatgpt');
    await f.manager.saveGlobal({ app: 'chatgpt', base: view.base!, text: 'approval_policy="on-request"\n' + view.text });
    const after: any = TOML.parse((await readText(path))!);
    assert.ok((TOML.parse(before) as any).stamp instanceof Date); assert.equal(typeof after.stamp, 'string');
    assert.equal(after.rows[0].name, 'r'); assert.equal(after.items[0].enabled, true);
    await f.manager.restore((await f.manager.snapshot()).backups[0].id); assert.equal(await readText(path), before);
    log('toml-date-type-loss', { afterTypes: [typeof after.stamp, typeof after.day, typeof after.clock], values: [after.stamp, after.day, after.clock], exactRestore: true });
  }
  {
    const f = fixture('hub-limit'); const providers: any[] = [];
    const template = { ...providerSchema.parse({ ...claude, notes: 'n'.repeat(2000), apiKey: 'k'.repeat(8192) }), updatedAt: '2026-10-12T00:00:00.000Z' };
    let before = '';
    for (;;) { providers.push({ ...template, id: randomUUID() }); const next = asJson({ version: 1, providers, active: {} }); if (Buffer.byteLength(next) > TARGET_LIMIT) { providers.pop(); break; } before = next; }
    const hubPath = join(f.paths.data, 'hub.json'); await put(hubPath, before);
    assert.equal((await f.manager.snapshot()).providers.length, providers.length);
    let message = ''; try { await f.manager.save({ ...claude, notes: template.notes, apiKey: template.apiKey }); } catch (e) { message = publicError(e); }
    const bytes = (await fs.stat(hubPath)).size; assert.ok(bytes > TARGET_LIMIT);
    await assert.rejects(() => f.manager.snapshot());
    log('hub-save-over-read-limit', { providersBefore: providers.length, bytesBefore: Buffer.byteLength(before), bytesAfter: bytes, limit: TARGET_LIMIT, message, backupCount: (await fs.readdir(join(f.paths.data, 'backups'))).length });
  }
  {
    const f = fixture('rules1'); const login = { ...codex, mode: 'login' as const, apiKey: undefined, baseUrl: '' };
    const p = (await f.manager.save(login, { activate: true })).providers[0];
    const hubPath = join(f.paths.data, 'hub.json'); const hub = JSON.parse((await readText(hubPath))!);
    hub.active.chatgpt.rules = 1; hub.active.chatgpt.definition = hash(providerDefinition(hub.providers[0], 1)); await put(hubPath, asJson(hub));
    const target = f.paths.targets.chatgpt[0];
    await put(target, '# externally added comment must survive a display rename\n' + await readText(target));
    const before = (await fs.stat(target)).ino;
    const s = await f.manager.save({ ...login, id: p.id, name: 'Display rename' });
    const after = (await fs.stat(target)).ino;
    // Bytes may stay the same, but activate runs, changes appliedAt/rules and creates a backup.
    assert.equal(JSON.parse((await readText(hubPath))!).active.chatgpt.rules, 2);
    assert.ok(s.backups.length > 1);
    assert.notEqual(before, after); assert.ok(!(await readText(target))!.includes('externally added comment'));
    log('legacy-login-rename-activates', { targetInodeChanged: before !== after, backups: s.backups.length, upgradedRules: 2 });
  }
  {
    const f = fixture('rollback'); const pi = { ...claude, app: 'pi' as const, protocol: 'openai-completions' as const };
    const p = (await f.manager.save(pi, { activate: true })).providers[0]; const before = await Promise.all(f.paths.targets.pi.map(p => readText(p)));
    let writes = 0; const failing = new Manager(f.paths, {}, 10, async (...args) => { if (++writes === 2) throw new Error('synthetic failure'); return replaceText(...args); });
    await assert.rejects(() => failing.save({ ...pi, id: p.id, model: 'new' }), e => publicError(e).startsWith(SAVED_NOT_APPLIED));
    assert.deepEqual(await Promise.all(f.paths.targets.pi.map(p => readText(p))), before);
    const s = await f.manager.snapshot(); assert.equal(s.providers[0].model, 'new'); assert.equal(s.diagnostics[2].edited, true); assert.equal(s.pending, null);
    await put(join(f.paths.data, 'pending.json'), '{invalid-synthetic'); const hub = await readText(join(f.paths.data, 'hub.json'));
    await assert.rejects(() => f.manager.save(claude)); assert.equal(await readText(join(f.paths.data, 'hub.json')), hub);
    const fresh = fixture('new-failure'); await put(fresh.paths.targets.claude[0], '{"apiKeyHelper":"synthetic"}');
    await assert.rejects(() => fresh.manager.save(claude, { activate: true }), e => publicError(e).startsWith(SAVED_NOT_APPLIED));
    assert.equal((await fresh.manager.snapshot()).providers.length, 1);
    log('save-rollback-pending-new-failure', { exactRollback: true, providerSavedOnce: true, edited: true, pendingBlocksSave: true });
  }
  {
    for (const rules of [1, 2]) {
      const f = fixture('icon-' + rules); const p = (await f.manager.save(claude, { activate: true })).providers[0];
      const path = join(f.paths.data, 'hub.json'); const hub = JSON.parse((await readText(path))!);
      hub.active.claude.rules = rules; hub.active.claude.definition = hash(providerDefinition(hub.providers[0], rules));
      hub.active.claude.fingerprint = hash(managedFingerprint('claude', [await readText(f.paths.targets.claude[0])], rules)); await put(path, asJson(hub));
      const bytes = await readText(f.paths.targets.claude[0]); const s = await f.manager.save({ ...claude, id: p.id, icon: 'kimi', notes: 'display only' });
      assert.equal(s.diagnostics[0].edited, false); assert.equal(await readText(f.paths.targets.claude[0]), bytes);
      assert.equal(providerDefinition(hub.providers[0], rules), providerDefinition({ ...hub.providers[0], icon: 'kimi' }, rules));
    }
    log('icon-excluded-both-rules', true);
    for (const app of ['claude', 'chatgpt', 'pi'] as const) for (const mode of ['api', 'login'] as const) {
      const p: any = { ...providerSchema.parse({ ...claude, app, mode, protocol: app === 'claude' ? 'anthropic-messages' : 'openai-responses' }), id: '00000000-0000-4000-8000-000000000001', updatedAt: '2026-10-12T00:00:00.000Z' };
      const display = { ...p, notes: 'changed', icon: 'kimi', ...(app === 'chatgpt' && mode === 'api' ? {} : { name: 'renamed' }) };
      assert.equal(providerDefinition(p, 2), providerDefinition(display, 2));
      const originals = app === 'pi' ? ['{}', '{"anthropic":{"type":"oauth"}}', '{}'] : app === 'chatgpt' ? ['', null] : [null];
      assert.deepEqual(patchProvider(p, originals, p.apiKey), patchProvider(display, originals, display.apiKey));
    }
    log('rules2-display-projection-six-modes', true);
  }
  {
    const f = fixture('global'); const p = (await f.manager.save(claude, { activate: true })).providers[0]; const path = f.paths.targets.claude[0];
    const view = await f.manager.globalView('claude'); const original = await readText(path);
    await assert.rejects(() => f.manager.saveGlobal({ app: 'claude', text: '{"model":"secret-original-input"}', base: view.base! }), e => !publicError(e).includes('secret-original-input'));
    assert.equal(await readText(path), original);
    await put(path, asJson({ ...JSON.parse(original!), permissions: { allow: [] } }));
    const external = await readText(path);
    await assert.rejects(() => f.manager.saveGlobal({ app: 'claude', text: '{"hooks":{}}', base: view.base! })); assert.equal(await readText(path), external);
    const fresh = await f.manager.globalView('claude'); const inode = (await fs.stat(path)).ino;
    await f.manager.saveGlobal({ app: 'claude', text: fresh.text!, base: fresh.base! }); assert.equal((await fs.stat(path)).ino, inode);
    const s = await f.manager.saveGlobal({ app: 'claude', text: '{"permissions":{"allow":[]},"hooks":{}}', base: fresh.base! });
    assert.equal(s.active.claude?.providerId, p.id); assert.equal(s.diagnostics[0].reformatted, true); // Prior external global edit remains a reformat.
    log('global-conflict-noop-and-backup', { ownedRefused: true, conflictNoWrite: true, noopInodeSame: true, backups: s.backups.length });
  }
  {
    // Normal unit assertions only: no prototype mutation, no malicious IPC or provider activation.
    const input = { app: 'pi' as const, name: 'Test', mode: 'login' as const, loginProvider: '__proto__', model: 'm', protocol: 'openai-completions' as const };
    assert.equal(providerSchema.safeParse(input).success, true);
    assert.equal(Object.hasOwn({}, '__proto__'), false);
    assert.equal(typeof autoIcon({ ...input, baseUrl: '' }), 'object');
    assert.notEqual(autoIcon({ ...input, baseUrl: '' }), null);
    log('special-key-static-unit-check', { schemaAllowsInheritedName: true, ownEntryAbsent: true, autoIconReturnsNonNullObject: true });
    const api = (baseUrl: string) => ({ app: 'claude' as const, mode: 'api' as const, baseUrl, loginProvider: 'anthropic' });
    const cases = ['https://API.DEEPSEEK.COM:443', 'https://api.deepseek.com.', 'https://deepseek.com.evil.example', 'https://evil-deepseek.com', 'http://127.0.0.1:1234', 'https://xn--deepsek-g8a.com'];
    assert.deepEqual(cases.map(url => autoIcon(api(url))), ['deepseek', null, null, null, null, null]);
    assert.ok(baseUrlIssues('http://remote.example').length); assert.ok(baseUrlIssues('https://example.com/?x=1').length);
    assert.deepEqual(baseUrlIssues('http://127.0.0.1:1234'), []);
    log('vendor-and-url-units', cases.map(url => [url, autoIcon(api(url))]));
  }
  {
    const input = 'model="m"\nmodel_provider="custom"\n[model_providers.custom]\nname="A"\nbase_url="https://saved.example"\nwire_api="responses"\nenv_key="SYNTHETIC_ENV"\nexperimental_bearer_token="sk-synthetic"\n';
    assert.ok(liveProvider('chatgpt', [input, null]));
    assert.equal(liveProvider('chatgpt', [input.replace('experimental_bearer_token="sk-synthetic"', ''), null]), null);
    log('env-key-plus-literal-import', { accepted: true, envOnlyRefused: true });
    const f = fixture('bom'); const text = '\uFEFF{\r\n"env":{"TZ":"Asia/Taipei"}\r\n}'; await put(f.paths.targets.claude[0], text);
    const view = await f.manager.globalView('claude'); await f.manager.saveGlobal({ app: 'claude', text: view.text!, base: view.base! }); assert.equal(await readText(f.paths.targets.claude[0]), text);
    assert.equal(parseConfigText('claude', '{"theme":"a","theme":"b"}').theme, 'b');
    assert.throws(() => parseConfigText('chatgpt', 'a=1\na=2'), e => !publicError(e).includes('a=1'));
    const deep = '{"a":'.repeat(10000) + '0' + '}'.repeat(10000); assert.throws(() => splitConfig('claude', parseConfigText('claude', deep)), e => !publicError(e).includes('stack'));
    log('parser-boundaries', { bomCrLfNoopExact: true, jsonDuplicateLastWins: true, tomlDuplicateRefused: true, deepStaticError: true });
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log(`Independent core assertions completed: ${count} groups.`);
