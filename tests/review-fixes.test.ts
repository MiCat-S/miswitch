// Regressions for the SOL HIGH review (docs/SOL_HIGH_REVIEW_2026-10-12.md), one test per finding where the core is involved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import TOML from '@iarna/toml';
import { Manager } from '../src/core/manager';
import { canonical, managedFingerprint, providerDefinition } from '../src/core/adapters';
import { HIDDEN_SECRET_TEXT } from '../src/core/config-editor';
import { dataFolder, resolvePaths } from '../src/core/paths';
import { hash, readText, TARGET_LIMIT } from '../src/core/files';

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'miswitch-review-')));
  const paths = resolvePaths(join(root, 'data'), join(root, 'home'), {});
  const put = async (path: string, value: string) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, value); };
  return { root, paths, manager: new Manager(paths, {}), put, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test('A2: credentials outside the provider fields never reach the preview or the global settings, and survive a save', async () => {
  const f = await fixture();
  try {
    const [toml, auth] = f.paths.targets.chatgpt;
    await f.put(toml, 'model = "m"\nmodel_provider = "work"\nsandbox_mode = "workspace-write"\n\n[model_providers.work]\nname = "Work"\nbase_url = "https://work.example/v1"\nwire_api = "responses"\nexperimental_bearer_token = "sk-work-secret"\n\n[mcp_servers.docs]\ncommand = "docs"\n\n[mcp_servers.docs.env]\nGITHUB_TOKEN = "ghp-docs-secret"\nPLAIN = "visible"\n');
    await f.put(auth, '{"auth_mode":"chatgpt"}');
    const imported = await f.manager.importLive('chatgpt');
    const provider = imported.providers.find(p => p.app === 'chatgpt')!;
    assert.equal(provider.hasKey, true);
    const preview = await f.manager.configView({ app: 'chatgpt', providerId: provider.id, draft: { mode: 'api', baseUrl: 'https://work.example/v1', model: 'm', name: 'Work' } });
    const global = await f.manager.globalView('chatgpt');
    for (const text of [preview.text!, global.text!]) {
      assert.ok(!text.includes('sk-work-secret') && !text.includes('ghp-docs-secret'), text);
      assert.ok(text.includes(HIDDEN_SECRET_TEXT) && text.includes('"visible"'));
    }
    // A key the user is typing stays visible in the preview: the renderer already has it.
    const typed = await f.manager.configView({ app: 'chatgpt', draft: { mode: 'api', baseUrl: 'https://new.example/v1', model: 'm', apiKey: 'sk-typed-now' } });
    assert.ok(typed.text!.includes('sk-typed-now') && !typed.text!.includes('sk-work-secret'));
    // Saving with the placeholders left in keeps the file's values; only the edited setting changes.
    await f.manager.saveGlobal({ app: 'chatgpt', text: global.text!.replace('"workspace-write"', '"read-only"'), base: global.base! });
    const live = TOML.parse((await readText(toml))!) as any;
    assert.equal(live.sandbox_mode, 'read-only');
    assert.equal(live.model_providers.work.experimental_bearer_token, 'sk-work-secret');
    assert.equal(live.mcp_servers.docs.env.GITHUB_TOKEN, 'ghp-docs-secret');
    // A placeholder where the file has no value cannot be resolved.
    const again = await f.manager.globalView('chatgpt');
    const moved = again.text!.replace('[mcp_servers.docs]', `[mcp_servers.other]\ncommand = "x"\n\n[mcp_servers.other.env]\nAPI_TOKEN = "${HIDDEN_SECRET_TEXT}"\n\n[mcp_servers.docs]`);
    await assert.rejects(() => f.manager.saveGlobal({ app: 'chatgpt', text: moved, base: again.base! }), /隐藏值在原文件中不存在/);
    // A new value typed over the placeholder is written.
    await f.manager.saveGlobal({ app: 'chatgpt', text: again.text!.replace(`GITHUB_TOKEN = "${HIDDEN_SECRET_TEXT}"`, 'GITHUB_TOKEN = "ghp-new"'), base: again.base! });
    assert.equal((TOML.parse((await readText(toml))!) as any).mcp_servers.docs.env.GITHUB_TOKEN, 'ghp-new');

    // Claude: a token in env that is not a provider field is hidden the same way.
    const settings = f.paths.targets.claude[0];
    await f.put(settings, JSON.stringify({ env: { GITHUB_TOKEN: 'ghp-claude-secret', TZ: 'UTC' }, permissions: { allow: [] } }));
    const claude = await f.manager.globalView('claude');
    assert.ok(!claude.text!.includes('ghp-claude-secret') && claude.text!.includes(HIDDEN_SECRET_TEXT));
    await f.manager.saveGlobal({ app: 'claude', text: claude.text!.replace('"UTC"', '"Asia/Taipei"'), base: claude.base! });
    assert.deepEqual(JSON.parse((await readText(settings))!).env, { GITHUB_TOKEN: 'ghp-claude-secret', TZ: 'Asia/Taipei' });
  } finally { await f.cleanup(); }
});

test('A3: TOML dates and times keep their type through the global settings', async () => {
  const f = await fixture();
  try {
    const [toml, auth] = f.paths.targets.chatgpt;
    await f.put(toml, 'stamp = 1979-05-27T07:32:00Z\nday = 1979-05-27\nclock = 07:32:00.000\nlocal = 1979-05-27T07:32:00\nsandbox_mode = "workspace-write"\n');
    await f.put(auth, '{}');
    const view = await f.manager.globalView('chatgpt');
    assert.match(view.text!, /^stamp = 1979-05-27T07:32:00/m); assert.match(view.text!, /^day = 1979-05-27$/m);
    await f.manager.saveGlobal({ app: 'chatgpt', text: `${view.text!}approval_policy = "on-request"\n`, base: view.base! });
    const text = (await readText(toml))!;
    assert.ok(!/"1979/.test(text), text);
    const live = TOML.parse(text) as any;
    assert.ok(live.stamp instanceof Date); assert.equal(live.day.isDate, true); assert.equal(live.clock.isTime, true);
    assert.equal(live.approval_policy, 'on-request');
    // A date and the string it prints as are different values.
    assert.notEqual(canonical({ stamp: live.stamp }), canonical({ stamp: live.stamp.toISOString() }));
  } finally { await f.cleanup(); }
});

test('A4: a save that would make the Hub unreadable is refused and the Hub stays as it was', async () => {
  const f = await fixture();
  try {
    const hubPath = join(f.paths.data, 'hub.json');
    const now = new Date().toISOString();
    const provider = () => ({ id: randomUUID(), app: 'claude', name: 'Big', mode: 'api', baseUrl: 'https://big.example', model: 'm', protocol: 'anthropic-messages',
      claudeAuth: 'api-key', loginProvider: 'anthropic', notes: 'n'.repeat(2000), apiKey: `sk-${'k'.repeat(8180)}`, updatedAt: now });
    // A Hub just under the limit: one more provider of this size cannot fit.
    const providers: ReturnType<typeof provider>[] = [];
    const encode = () => JSON.stringify({ version: 1, providers, active: {} }, null, 2) + '\n';
    while (Buffer.byteLength(encode()) < TARGET_LIMIT - 12_000) providers.push(provider());
    const text = encode();
    await f.put(hubPath, text);
    assert.equal((await f.manager.snapshot()).providers.length, providers.length);
    await assert.rejects(() => f.manager.save({ app: 'claude', name: 'One more', mode: 'api', baseUrl: 'https://big.example', apiKey: `sk-${'k'.repeat(8180)}`, protocol: 'anthropic-messages', model: 'm', notes: 'x'.repeat(2000) }), /8 MiB 上限，没有保存/);
    assert.equal(await readText(hubPath), text);
    assert.equal((await f.manager.snapshot()).providers.length, providers.length);
  } finally { await f.cleanup(); }
});

test('A6: under an older rule set, renaming a Codex login provider neither rewrites the file nor counts as an edit', async () => {
  const f = await fixture();
  try {
    const [toml, auth] = f.paths.targets.chatgpt;
    await f.put(toml, '# kept comment\nmodel = "gpt"\n');
    await f.put(auth, '{"auth_mode":"chatgpt"}');
    const input = { app: 'chatgpt' as const, name: 'Login', mode: 'login' as const, protocol: 'openai-responses' as const, model: 'gpt' };
    const p = (await f.manager.save(input)).providers[0];
    await f.manager.activate(p.id);
    // Turn the record into one written before rule sets existed (rule set 1).
    const hubPath = join(f.paths.data, 'hub.json');
    const hub = JSON.parse((await readText(hubPath))!);
    const stored = hub.providers[0];
    const originals = await Promise.all(f.paths.targets.chatgpt.map(path => readText(path)));
    delete hub.active.chatgpt.rules;
    hub.active.chatgpt.fingerprint = hash(managedFingerprint('chatgpt', originals, 1)!);
    hub.active.chatgpt.definition = hash(providerDefinition(stored, 1));
    await writeFile(hubPath, JSON.stringify(hub, null, 2) + '\n');
    const bytes = await readText(toml);
    const before = (await readdir(join(f.paths.data, 'backups'))).length;
    const s = await f.manager.save({ ...input, id: p.id, name: 'Renamed' });
    assert.equal(await readText(toml), bytes);
    assert.equal((await readdir(join(f.paths.data, 'backups'))).length, before);
    assert.equal(s.diagnostics.find(d => d.app === 'chatgpt')!.edited, false);
    assert.equal(s.diagnostics.find(d => d.app === 'chatgpt')!.state, 'written');
    // A change that is written still applies.
    await f.manager.save({ ...input, id: p.id, name: 'Renamed', model: 'gpt-next' });
    assert.equal((TOML.parse((await readText(toml))!) as any).model, 'gpt-next');
  } finally { await f.cleanup(); }
});

test('A7: a Pi provider ID only counts when the Pi files define it, never through an inherited property', async () => {
  const f = await fixture();
  try {
    const [models, auth, settings] = f.paths.targets.pi;
    await f.put(models, '{"providers":{}}'); await f.put(auth, '{}'); await f.put(settings, '{}');
    for (const loginProvider of ['__proto__', 'constructor', 'toString']) {
      const p = (await f.manager.save({ app: 'pi', name: loginProvider, mode: 'login', loginProvider, protocol: 'anthropic-messages', model: 'm' })).providers.at(-1)!;
      await assert.rejects(() => f.manager.activate(p.id), /Pi 中找不到该 Provider/);
    }
    assert.equal(await readText(settings), '{}');
  } finally { await f.cleanup(); }
});

test('A9: the data folder that already holds a Hub is used, MiSwitch first', () => {
  const appData = '/data';
  const has = (...folders: string[]) => (path: string) => folders.some(folder => path === join(appData, folder, 'store', 'hub.json'));
  assert.equal(dataFolder(appData, has()), join(appData, 'MiSwitch'));
  assert.equal(dataFolder(appData, has('miswitch')), join(appData, 'miswitch'));
  assert.equal(dataFolder(appData, has('MiSwitch', 'miswitch')), join(appData, 'MiSwitch'));
});
