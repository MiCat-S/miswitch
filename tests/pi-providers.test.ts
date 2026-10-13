// Pi keeps several providers at once (auth.json, models.json, and pi-custom-providers' custom-providers.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { join, dirname } from 'node:path';
import { Manager } from '../src/core/manager';
import { managedFingerprint } from '../src/core/adapters';
import { resolvePaths } from '../src/core/paths';
import { hash, readText } from '../src/core/files';
import type { ProviderInput } from '../src/core/types';

async function fixture({ relays = true } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'miswitch-pi-')));
  const paths = resolvePaths(join(root, 'data'), join(root, 'home'), {});
  const put = async (path: string, value: unknown) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n'); };
  const [models, auth, settings, custom] = paths.targets.pi;
  await put(auth, { anthropic: { type: 'oauth', access: 'fake-access', refresh: 'fake-refresh', expires: 1 }, mi: { type: 'api_key', key: 'sk-mi-only' }, openrouter: { type: 'api_key', key: 'sk-or-only' } });
  await put(models, { providers: {
    mi: { name: 'opencode', baseUrl: 'https://relay.example/v1', api: 'openai-responses', apiKey: 'sk-mi-only', models: [], modelOverrides: { 'mi-model': { reasoning: true } } },
    local: { baseUrl: 'http://localhost:11434/v1', api: 'openai-completions', apiKey: 'not-needed', models: [{ id: 'llama' }] } } });
  await put(settings, { defaultProvider: 'mi', defaultModel: 'mi-model', theme: 'dark', ...(relays ? { packages: ['npm:pi-custom-providers'] } : {}) });
  if (relays) await put(custom, { $schema: './npm/node_modules/pi-custom-providers/custom-providers.schema.json', relay: { baseUrl: 'https://relay2.example/v1', api: 'openai-responses', costMultiplier: 0.5 } });
  await put(paths.piModelStore, { relay: { checkedAt: 1, models: [{ id: 'relay-model' }] }, gone: { checkedAt: 1, models: [{ id: 'old-model' }] } });
  const files = () => Promise.all(paths.targets.pi.map(path => readText(path)));
  return { root, paths, put, files, manager: new Manager(paths, {}), cleanup: () => rm(root, { recursive: true, force: true }) };
}
const api = (name: string, piProviderId: string, extra: Partial<ProviderInput> = {}): ProviderInput =>
  ({ app: 'pi', name, mode: 'api', piProviderId, baseUrl: 'https://new.example/v1', protocol: 'openai-responses', apiKey: `sk-${piProviderId}-only`, model: 'new-model', ...extra });

test('every provider Pi defines is imported, the default one in use, without touching any file', async () => {
  const f = await fixture();
  try {
    const before = await f.files();
    const s = await f.manager.importLive();
    const pi = s.providers.filter(p => p.app === 'pi');
    assert.deepEqual(pi.map(p => [p.name, p.mode, p.loginProvider, p.model, p.baseUrl, p.protocol, p.piAuth]).sort(), [
      ['anthropic', 'login', 'anthropic', '', '', 'openai-completions', 'oauth'],
      ['local', 'login', 'local', 'llama', 'http://localhost:11434/v1', 'openai-completions', 'models'],
      ['mi', 'login', 'mi', 'mi-model', 'https://relay.example/v1', 'openai-responses', 'api_key'],
      ['openrouter', 'login', 'openrouter', '', '', 'openai-completions', 'api_key'],
      ['relay', 'login', 'relay', 'relay-model', 'https://relay2.example/v1', 'openai-responses', 'none']
    ]);
    // A cache entry with no configuration behind it (`gone`) is not a provider.
    assert.ok(!pi.some(p => p.name === 'gone'));
    assert.equal(s.active.pi?.providerId, pi.find(p => p.name === 'mi')!.id);
    assert.equal(s.diagnostics.find(d => d.app === 'pi')!.state, 'written');
    assert.equal(s.piRelays, true);
    assert.deepEqual(await f.files(), before);
    assert.ok(!JSON.stringify(s).includes('sk-mi-only'));
  } finally { await f.cleanup(); }
});

test('re-reading adds new Pi providers once and corrects names in the older "name（id）" form', async () => {
  const f = await fixture();
  try {
    let s = await f.manager.importLive();
    const mi = s.providers.find(p => p.app === 'pi' && p.name === 'mi')!;
    const { updatedAt: _u, hasKey: _h, ...stored } = mi;
    await f.manager.save({ ...stored, name: 'opencode（mi）' });
    const [, auth, , custom] = f.paths.targets.pi;
    await f.put(custom, { relay: { baseUrl: 'https://relay2.example/v1', api: 'openai-responses' }, fresh: { baseUrl: 'https://fresh.example', api: 'anthropic-messages' } });
    await f.put(auth, { ...JSON.parse((await readText(auth))!), fresh: { type: 'api_key', key: 'sk-fresh-only' } });
    s = await f.manager.importLive('pi');
    assert.ok(s.warnings.includes('已从 Pi 读取 1 个新的 Provider'));
    const names = s.providers.filter(p => p.app === 'pi').map(p => p.name).sort();
    assert.deepEqual(names, ['anthropic', 'fresh', 'local', 'mi', 'openrouter', 'relay']);
    assert.equal(s.providers.find(p => p.name === 'fresh')!.protocol, 'anthropic-messages');
    s = await f.manager.importLive('pi');
    assert.ok(s.warnings.includes('Pi 中没有新的 Provider'));
    assert.equal(s.providers.filter(p => p.app === 'pi').length, 6);
    assert.equal(s.diagnostics.find(d => d.app === 'pi')!.edited, false);
  } finally { await f.cleanup(); }
});

test('switching among existing providers only moves the selection; no model leaves the choice to Pi', async () => {
  const f = await fixture();
  try {
    const s = await f.manager.importLive();
    const [models, auth, settings, custom] = f.paths.targets.pi;
    const untouched = [await readText(models), await readText(auth), await readText(custom)];
    await f.manager.activate(s.providers.find(p => p.name === 'anthropic')!.id);
    const now = JSON.parse((await readText(settings))!);
    assert.equal(now.defaultProvider, 'anthropic'); assert.equal('defaultModel' in now, false); assert.equal(now.theme, 'dark');
    assert.deepEqual([await readText(models), await readText(auth), await readText(custom)], untouched);
    assert.equal((await f.manager.snapshot()).diagnostics.find(d => d.app === 'pi')!.state, 'written');
    assert.deepEqual(await f.manager.piModels('relay'), ['relay-model']);
    assert.deepEqual(await f.manager.piModels('mi'), ['mi-model']);
  } finally { await f.cleanup(); }
});

test('Mi-Switch Pi providers are relays in custom-providers.json when the extension is used, and all stay registered', async () => {
  const f = await fixture();
  try {
    await f.manager.importLive();
    const [models, auth, settings, custom] = f.paths.targets.pi;
    const modelsBefore = await readText(models); const settingsBefore = await readText(settings);
    let s = await f.manager.save(api('Work', 'work-relay'));
    s = await f.manager.save(api('Backup', 'backup-relay', { baseUrl: 'https://backup.example/v1', model: 'backup-model' }));
    let relays = JSON.parse((await readText(custom))!); let keys = JSON.parse((await readText(auth))!);
    assert.deepEqual(relays['work-relay'], { baseUrl: 'https://new.example/v1', api: 'openai-responses' });
    assert.deepEqual(relays['backup-relay'], { baseUrl: 'https://backup.example/v1', api: 'openai-responses' });
    assert.equal(relays.relay.costMultiplier, 0.5); assert.ok(relays.$schema);
    assert.deepEqual(keys['work-relay'], { type: 'api_key', key: 'sk-work-relay-only' }); assert.equal(keys.anthropic.refresh, 'fake-refresh');
    // Saving registers; it does not switch.
    assert.equal(await readText(models), modelsBefore); assert.equal(await readText(settings), settingsBefore);
    const work = s.providers.find(p => p.name === 'Work')!; const backup = s.providers.find(p => p.name === 'Backup')!;
    s = await f.manager.activate(work.id);
    assert.deepEqual([JSON.parse((await readText(settings))!).defaultProvider, JSON.parse((await readText(settings))!).defaultModel], ['work-relay', 'new-model']);
    // Editing another provider changes its own entry only: the one in use stays written and is not reported as rewritten.
    s = await f.manager.save({ ...api('Backup', 'backup-relay'), id: backup.id, apiKey: undefined, baseUrl: 'https://backup2.example/v1' });
    const d = s.diagnostics.find(x => x.app === 'pi')!;
    assert.equal(d.state, 'written'); assert.equal(d.reformatted, false); assert.equal(d.edited, false);
    assert.equal(JSON.parse((await readText(custom))!)['backup-relay'].baseUrl, 'https://backup2.example/v1');
    // Renaming the ID moves the entries; removing a provider takes its entries out of Pi.
    s = await f.manager.save({ ...api('Backup', 'spare-relay'), id: backup.id, apiKey: undefined, baseUrl: 'https://backup2.example/v1' });
    relays = JSON.parse((await readText(custom))!); keys = JSON.parse((await readText(auth))!);
    assert.ok(!('backup-relay' in relays) && !('backup-relay' in keys)); assert.equal(keys['spare-relay'].key, 'sk-backup-relay-only');
    s = await f.manager.remove(backup.id);
    relays = JSON.parse((await readText(custom))!); keys = JSON.parse((await readText(auth))!);
    assert.ok(!('spare-relay' in relays) && !('spare-relay' in keys));
    assert.equal(s.diagnostics.find(x => x.app === 'pi')!.state, 'written');
    assert.ok(!JSON.stringify(s).includes('sk-work-relay-only'));
  } finally { await f.cleanup(); }
});

test('without the extension Mi-Switch Pi providers go to models.json, and custom-providers.json is not created', async () => {
  const f = await fixture({ relays: false });
  try {
    await f.manager.importLive();
    const [models, auth, , custom] = f.paths.targets.pi;
    const s = await f.manager.save(api('Work', 'work-relay'));
    assert.equal(s.piRelays, false);
    const entry = JSON.parse((await readText(models))!).providers['work-relay'];
    assert.deepEqual(entry, { name: 'Work', baseUrl: 'https://new.example/v1', api: 'openai-responses', apiKey: 'managed-by-miswitch:auth.json', authHeader: true, models: [{ id: 'new-model' }] });
    assert.equal(JSON.parse((await readText(models))!).providers.mi.name, 'opencode');
    assert.equal(JSON.parse((await readText(auth))!)['work-relay'].key, 'sk-work-relay-only');
    assert.equal(await readText(custom), null);
  } finally { await f.cleanup(); }
});

test('a Pi provider ID must be free: not the user\'s own, not built in, not another Mi-Switch provider\'s', async () => {
  const f = await fixture();
  try {
    await f.manager.importLive();
    const before = await f.files();
    await assert.rejects(() => f.manager.save(api('Mine', 'mi')), /Pi 中已有名为“mi”的 Provider/);
    await assert.rejects(() => f.manager.save(api('Builtin', 'openai')), /内置 Provider/);
    await assert.rejects(() => f.manager.save(api('Prefixed', 'miswitch_abc')), /不能以 miswitch_ 开头/);
    assert.deepEqual(await f.files(), before);
    await f.manager.save(api('Work', 'work-relay'));
    await assert.rejects(() => f.manager.save(api('Again', 'work-relay')), /另一个供应商已经使用/);
    // The model may only be left empty for an existing provider.
    await assert.rejects(() => f.manager.save(api('Empty', 'empty-relay', { model: '' })), /请填写模型/);
  } finally { await f.cleanup(); }
});

test('a Pi record written under rule set 2 stays written after the upgrade, with the new file present', async () => {
  const f = await fixture();
  try {
    const s = await f.manager.importLive();
    const hubPath = join(f.paths.data, 'hub.json');
    const hub = JSON.parse((await readText(hubPath))!);
    const originals = await f.files();
    hub.active.pi.rules = 2;
    hub.active.pi.fingerprint = hash(managedFingerprint('pi', originals.slice(0, 3), 2)!);
    hub.active.pi.hashes = Object.fromEntries(f.paths.targets.pi.slice(0, 3).map((path, i) => [path, hash(originals[i])]));
    await writeFile(hubPath, JSON.stringify(hub, null, 2) + '\n');
    const d = (await f.manager.snapshot()).diagnostics.find(x => x.app === 'pi')!;
    assert.equal(d.state, 'written'); assert.equal(d.reformatted, false); assert.equal(d.edited, false);
    assert.ok(s.active.pi);
  } finally { await f.cleanup(); }
});

test('data from a version that read one Pi provider is re-read once on startup, quietly', async () => {
  const f = await fixture();
  try {
    let s = await f.manager.importLive();
    const mi = s.providers.find(p => p.app === 'pi' && p.name === 'mi')!;
    // Shape the Hub as the older version left it: only the default provider, named "name（id）", no upgrade record.
    const hubPath = join(f.paths.data, 'hub.json');
    const hub = JSON.parse((await readText(hubPath))!);
    hub.providers = hub.providers.filter((p: any) => p.app !== 'pi' || p.id === mi.id).map((p: any) => p.id === mi.id ? { ...p, name: 'opencode（mi）', piAuth: undefined } : p);
    delete hub.upgrades;
    await writeFile(hubPath, JSON.stringify(hub, null, 2) + '\n');
    const before = await f.files();
    s = await f.manager.importLive();
    assert.deepEqual(s.providers.filter(p => p.app === 'pi').map(p => p.name).sort(), ['anthropic', 'local', 'mi', 'openrouter', 'relay']);
    assert.equal(s.active.pi?.providerId, mi.id);
    assert.equal(s.providers.find(p => p.id === mi.id)!.piAuth, 'api_key');
    assert.deepEqual(s.warnings.filter(w => w.includes('Provider')), []);
    assert.deepEqual(JSON.parse((await readText(hubPath))!).upgrades, ['pi-providers']);
    assert.deepEqual(await f.files(), before);
    // Later startups leave Pi alone; only the re-read button looks again.
    const [, auth, , custom] = f.paths.targets.pi;
    await f.put(custom, { relay: { baseUrl: 'https://relay2.example/v1', api: 'openai-responses' }, fresh: { baseUrl: 'https://fresh.example', api: 'anthropic-messages' } });
    await f.put(auth, { ...JSON.parse((await readText(auth))!), fresh: { type: 'api_key', key: 'sk-fresh-only' } });
    s = await f.manager.importLive();
    assert.ok(!s.providers.some(p => p.name === 'fresh'));
    s = await f.manager.importLive('pi');
    assert.ok(s.providers.some(p => p.name === 'fresh'));
  } finally { await f.cleanup(); }
});

test('an interrupted Pi write (four files and the Hub) is rolled back on the next start', async () => {
  const f = await fixture();
  try {
    await f.manager.importLive();
    const hubPath = join(f.paths.data, 'hub.json');
    const paths = [...f.paths.targets.pi, hubPath];
    const before = await Promise.all(paths.map(path => readText(path)));
    const after = before.map((text, i) => `${text ?? ''}\n{"interrupted":${i}}`);
    await Promise.all(paths.map((path, i) => writeFile(path, after[i])));
    const entries = paths.map((path, i) => ({ path, before: before[i], after: after[i] }));
    await f.put(join(f.paths.data, 'pending.json'), { version: 1, id: randomUUID(), app: 'pi', createdAt: new Date().toISOString(), entries });
    const s = await f.manager.snapshot();
    assert.equal(s.pending, null);
    assert.deepEqual(await Promise.all(paths.map(path => readText(path))), before);
  } finally { await f.cleanup(); }
});
