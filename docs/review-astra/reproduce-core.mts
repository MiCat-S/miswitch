// All keys and files are synthetic. Network: two ephemeral 127.0.0.1 servers only.
// Run: ./node_modules/.bin/tsx docs/review-astra/reproduce-core.mts
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
import { providerSchema } from '../../src/core/types.ts';
import { asJson, providerDefinition, managedFingerprint, liveProvider } from '../../src/core/adapters.ts';
import { parseConfigText, splitConfig } from '../../src/core/config-editor.ts';
import { publicError, SAVED_NOT_APPLIED } from '../../src/core/errors.ts';
import { autoIcon } from '../../src/ui/vendor.ts';
const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'miswitch-astra-')));
const put = async (path: string, text: string) => { await fs.mkdir(dirname(path), { recursive: true }); await fs.writeFile(path, text); };
const fixture = (name: string) => { const paths = resolvePaths(join(root, name, 'store'), join(root, name, 'home'), {}); return { paths, manager: new Manager(paths, {}) }; };
const claude = { app: 'claude' as const, name: 'A', mode: 'api' as const, baseUrl: 'https://saved.example', apiKey: 'sk-astra-synthetic', model: 'm', protocol: 'anthropic-messages' as const };
const codex = { ...claude, app: 'chatgpt' as const, protocol: 'openai-responses' as const };
const results: any[] = [];
const log = (name: string, data: any) => { results.push({ name, ...data }); console.log(JSON.stringify(results.at(-1))); };
try {
  // A saved key crosses to a URL never saved in the Hub. No external request is made.
  {
    const { manager } = fixture('models'); let received = '';
    const server = createServer((req, res) => { received = String(req.headers['x-api-key']); res.setHeader('content-type', 'application/json'); res.end('{"data":[{"id":"mock-model"}]}'); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const url = `http://127.0.0.1:${(server.address() as any).port}`;
      const p = (await manager.save(claude)).providers[0];
      assert.ok(!JSON.stringify(await manager.snapshot()).includes(claude.apiKey));
      const response = await manager.listModels({ app: 'claude', providerId: p.id, baseUrl: url, protocol: 'anthropic-messages' });
      assert.equal(received, claude.apiKey); assert.equal((await manager.snapshot()).providers[0].baseUrl, claude.baseUrl);
      log('saved-key-sent-to-unsaved-origin', { receivedSavedKey: true, savedOriginUnchanged: true, models: response.models });
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  }
  // A first import saves a non-custom Codex route key to Hub. Both read APIs expose that same key.
  {
    const { paths, manager } = fixture('preview');
    await put(paths.targets.chatgpt[0], 'model="m"\nmodel_provider="work"\n[model_providers.work]\nname="Work"\nbase_url="https://saved.example/v1"\nwire_api="responses"\nexperimental_bearer_token="sk-astra-imported"\n');
    const p = (await manager.importLive()).providers[0];
    assert.ok(p.hasKey); assert.ok(!JSON.stringify(await manager.snapshot()).includes('sk-astra-imported'));
    const preview = await manager.configView({ app: 'chatgpt', providerId: p.id, draft: { name: p.name, mode: 'api', baseUrl: p.baseUrl, model: p.model } });
    const global = await manager.globalView('chatgpt');
    assert.ok(preview.text!.includes('sk-astra-imported')); assert.ok(global.text!.includes('sk-astra-imported'));
    log('saved-import-key-reaches-renderer', { previewLeaks: true, globalViewLeaks: true, snapshotLeaks: false });
  }
  // Dates are TOML values, not strings. Merely adding an unrelated key changes their type.
  {
    const { paths, manager } = fixture('toml-dates');
    const path = paths.targets.chatgpt[0];
    const before = 'model="m"\nstamp=1979-05-27T07:32:00Z\nday=1979-05-27\nclock=07:32:00.000\nitems=[{name="one", enabled=true}]\n[[rows]]\nname="r"\n';
    await put(path, before);
    const view = await manager.globalView('chatgpt');
    await manager.saveGlobal({ app: 'chatgpt', base: view.base!, text: 'approval_policy="on-request"\n' + view.text });
    const after = (await readText(path))!; const parsed: any = TOML.parse(after);
    assert.ok((TOML.parse(before) as any).stamp instanceof Date); assert.equal(typeof parsed.stamp, 'string');
    assert.equal(parsed.rows[0].name, 'r'); assert.equal(parsed.items[0].enabled, true);
    const backup = (await manager.snapshot()).backups[0]; await manager.restore(backup.id); assert.equal(await readText(path), before);
    log('toml-date-type-lost', { beforeType: 'Date', afterType: typeof parsed.stamp, stamp: parsed.stamp, day: parsed.day, clock: parsed.clock, backupRestoresOriginal: true, arraysPreserved: true });
  }
  // Codex API name is currently a routing definition field, violating the requested display-only invariant.
  {
    const { paths, manager } = fixture('name');
    const p = (await manager.save(codex, { activate: true })).providers[0]; const before = await readText(paths.targets.chatgpt[0]);
    const s = await manager.save({ ...codex, id: p.id, name: 'Display rename only', apiKey: undefined });
    assert.notEqual(await readText(paths.targets.chatgpt[0]), before);
    log('codex-display-rename-writes-target', { rewritten: true, active: s.active.chatgpt?.providerId === p.id });
  }
  // Hub writers bypass transaction's output-size check. Seed a valid, readable near-limit Hub to avoid 800 save calls.
  {
    const { paths, manager } = fixture('hub-limit');
    const providers: any[] = []; const template = { ...providerSchema.parse({ ...claude, notes: 'n'.repeat(2000), apiKey: 'k'.repeat(8192) }), updatedAt: new Date().toISOString() };
    let hub: any; let before = '';
    for (;;) {
      const p = { ...template, id: randomUUID() }; providers.push(p);
      const candidate = asJson({ version: 1, providers, active: {} });
      if (Buffer.byteLength(candidate) > TARGET_LIMIT) { providers.pop(); break; }
      before = candidate;
    }
    hub = { version: 1, providers, active: {} }; await put(join(paths.data, 'hub.json'), before);
    assert.equal((await manager.snapshot()).providers.length, providers.length);
    let error = ''; try { await manager.save({ ...claude, notes: template.notes, apiKey: template.apiKey }); } catch (e) { error = publicError(e); }
    const bytes = (await fs.stat(join(paths.data, 'hub.json'))).size;
    assert.ok(bytes > TARGET_LIMIT); await assert.rejects(() => manager.snapshot());
    log('hub-written-over-read-limit', { countBefore: providers.length, bytesBefore: Buffer.byteLength(before), bytesAfter: bytes, limit: TARGET_LIMIT, error, snapshotRejected: true, backups: await fs.readdir(join(paths.data, 'backups')) });
  }
  {
    const { paths, manager } = fixture('pi-prototype');
    const input = { app: 'pi' as const, name: 'Prototype ID', mode: 'login' as const, loginProvider: '__proto__', model: 'm', protocol: 'openai-completions' as const };
    const s = await manager.save(input, { activate: true });
    assert.equal(s.diagnostics[2].state, 'written');
    assert.equal(JSON.parse((await readText(paths.targets.pi[2]))!).defaultProvider, '__proto__');
    assert.deepEqual(JSON.parse((await readText(paths.targets.pi[1]))!), {});
    const icon = autoIcon({ ...input, baseUrl: '' });
    assert.equal(typeof icon, 'object'); assert.notEqual(icon, null);
    log('pi-prototype-provider-accepted', { nonexistentProviderWritten: true, iconType: typeof icon, iconIsNull: icon === null });
  }
  // Specific successful checks: rollback after a save, pending refusal, ordering, rules 1/2 icon exclusion.
  {
    const { paths, manager } = fixture('save-failure');
    const input = { ...claude, app: 'pi' as const, protocol: 'openai-completions' as const };
    const p = (await manager.save(input, { activate: true })).providers[0];
    const before = await Promise.all(paths.targets.pi.map(p => readText(p)));
    let calls = 0;
    const failing = new Manager(paths, {}, 10, async (...args) => { calls++; if (calls === 2) throw new Error('synthetic-write-failure'); return replaceText(...args); });
    await assert.rejects(() => failing.save({ ...input, id: p.id, model: 'new-model' }), e => publicError(e).startsWith(SAVED_NOT_APPLIED));
    assert.deepEqual(await Promise.all(paths.targets.pi.map(p => readText(p))), before);
    const s = await manager.snapshot(); assert.equal(s.providers[0].model, 'new-model'); assert.equal(s.diagnostics[2].edited, true); assert.equal(s.pending, null);
    await put(join(paths.data, 'pending.json'), '{malformed-synthetic');
    const hubBefore = await readText(join(paths.data, 'hub.json'));
    await assert.rejects(() => manager.save({ ...claude, name: 'Blocked' })); assert.equal(await readText(join(paths.data, 'hub.json')), hubBefore);
    log('save-failure-and-pending-safe', { providerSaved: true, targetRollbackExact: true, pendingBlocksSave: true });
    const f = fixture('new-failure'); await put(f.paths.targets.claude[0], '{"apiKeyHelper":"synthetic-helper"}');
    await assert.rejects(() => f.manager.save(claude, { activate: true }), e => publicError(e).startsWith(SAVED_NOT_APPLIED));
    assert.equal((await f.manager.snapshot()).providers.length, 1); assert.equal(await readText(f.paths.targets.claude[0]), '{"apiKeyHelper":"synthetic-helper"}');
    log('new-save-failure-safe', { savedExactlyOnce: true, targetUnchanged: true });
  }
  {
    for (const rules of [1, 2]) {
      const { paths, manager } = fixture('icon-' + rules);
      const p = (await manager.save(claude, { activate: true })).providers[0];
      const path = join(paths.data, 'hub.json'); const hub = JSON.parse((await readText(path))!);
      hub.active.claude.rules = rules; hub.active.claude.definition = hash(providerDefinition(hub.providers[0], rules));
      hub.active.claude.fingerprint = hash(managedFingerprint('claude', [await readText(paths.targets.claude[0])], rules));
      await put(path, asJson(hub)); const before = await readText(paths.targets.claude[0]);
      const s = await manager.save({ ...claude, id: p.id, icon: 'kimi', notes: 'only display' });
      assert.equal(s.diagnostics[0].edited, false); assert.equal(await readText(paths.targets.claude[0]), before);
    }
    log('icon-rules-1-and-2-safe', { noWriteOrEdited: true });
  }
  {
    const input = 'model="m"\nmodel_provider="custom"\n[model_providers.custom]\nname="A"\nbase_url="https://saved.example"\nwire_api="responses"\nenv_key="SYNTHETIC_ENV"\nexperimental_bearer_token="sk-synthetic"\n';
    assert.ok(liveProvider('chatgpt', [input, null]));
    log('import-env-key-with-bearer-accepted', { imported: true, note: 'not claiming env-only configurations are accepted' });
    const api = (baseUrl: string) => ({ app: 'claude' as const, mode: 'api' as const, baseUrl, loginProvider: 'anthropic' });
    const domains = ['https://API.DEEPSEEK.COM:443', 'https://api.deepseek.com.', 'https://deepseek.com.evil.example', 'https://evil-deepseek.com', 'http://127.0.0.1:1234', 'https://xn--deepsek-g8a.com'];
    const icons = domains.map(url => [url, autoIcon(api(url))]); assert.equal(icons[0][1], 'deepseek'); assert.equal(icons[1][1], null);
    log('domain-cases', { icons });
  }
  {
    const f = fixture('json-boundaries'); const path = f.paths.targets.claude[0];
    await put(path, '\uFEFF{\r\n"env":{"TZ":"Asia/Taipei"},"permissions":{"allow":[]}\r\n}');
    const view = await f.manager.globalView('claude'); assert.ok(view.base);
    await f.manager.saveGlobal({ app: 'claude', base: view.base!, text: '{"permissions":{"allow":[]},"env":{"TZ":"Asia/Taipei"}}' });
    assert.ok((await readText(path))!.startsWith('\uFEFF'));
    const duplicate = parseConfigText('claude', '{"theme":"a","theme":"b"}'); assert.equal(duplicate.theme, 'b');
    assert.throws(() => parseConfigText('chatgpt', 'a=1\na=2'), e => !publicError(e).includes('a=1'));
    const deep = '{"a":'.repeat(10000) + '0' + '}'.repeat(10000);
    let deepError = ''; try { splitConfig('claude', parseConfigText('claude', deep)); } catch (e) { deepError = publicError(e); }
    assert.ok(deepError && !deepError.includes('stack'));
    log('format-boundaries', { jsonBomCrLfNoopPreserved: true, duplicateJson: 'last key wins', duplicateToml: 'static error', deepNesting: 'static error, no writes' });
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('All supplemental core assertions passed: ' + results.length + ' cases.');
