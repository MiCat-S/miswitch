import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import TOML from '@iarna/toml';
import { Manager } from '../src/core/manager';
import { resolvePaths } from '../src/core/paths';
import { readText } from '../src/core/files';
import { SAVED_KEY_TEXT } from '../src/core/config-editor';
import type { ProviderInput } from '../src/core/types';

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'miswitch-config-')));
  const paths = resolvePaths(join(root, 'data'), join(root, 'home'), {});
  const put = async (path: string, value: string) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, value); };
  return { paths, manager: new Manager(paths, {}), put, cleanup: () => rm(root, { recursive: true, force: true }) };
}
const gateway: ProviderInput = { app: 'claude', name: 'Gateway', mode: 'api', baseUrl: 'https://gateway.example', apiKey: 'sk-test-only', claudeAuth: 'bearer', protocol: 'anthropic-messages', model: 'main', smallFastModel: 'small' };

test('the preview projects the draft onto the whole settings.json and hides a saved key', async () => {
  const f = await fixture();
  try {
    const path = f.paths.targets.claude[0];
    await f.put(path, JSON.stringify({ permissions: { deny: ['Read(secret)'] }, hooks: { Stop: [] }, model: 'opus', env: { TZ: 'Asia/Taipei', ANTHROPIC_API_KEY: 'sk-from-another-tool' } }));
    let view = await f.manager.configView({ app: 'claude', draft: { mode: 'api', baseUrl: 'https://gateway.example', apiKey: 'sk-typed', claudeAuth: 'bearer', model: 'main', smallFastModel: 'small' } });
    assert.equal(view.name, 'settings.json'); assert.equal(view.format, 'json');
    const shown = JSON.parse(view.text!);
    assert.deepEqual(shown.permissions, { deny: ['Read(secret)'] }); assert.deepEqual(shown.hooks, { Stop: [] });
    assert.deepEqual(shown.env, { TZ: 'Asia/Taipei', ANTHROPIC_BASE_URL: 'https://gateway.example', ANTHROPIC_AUTH_TOKEN: 'sk-typed', ANTHROPIC_MODEL: 'main', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'small' });
    const saved = (await f.manager.save({ ...gateway, apiKey: 'sk-saved-secret' })).providers[0];
    view = await f.manager.configView({ app: 'claude', providerId: saved.id, draft: { mode: 'api', baseUrl: 'https://gateway.example', claudeAuth: 'bearer', model: 'main' } });
    assert.ok(!view.text!.includes('sk-saved-secret')); assert.equal(JSON.parse(view.text!).env.ANTHROPIC_AUTH_TOKEN, SAVED_KEY_TEXT);
    await f.put(path, '{"apiKeyHelper":"x"}');
    assert.match((await f.manager.configView({ app: 'claude', draft: { mode: 'login', model: 'opus' } })).error!, /apiKeyHelper/);
  } finally { await f.cleanup(); }
});

test('global settings show the file without provider fields and save without touching them', async () => {
  const f = await fixture();
  try {
    const path = f.paths.targets.claude[0];
    const p = (await f.manager.save(gateway)).providers[0];
    await f.manager.activate(p.id);
    const written = (await readText(path))!;
    const view = await f.manager.globalView('claude');
    assert.equal(view.name, 'settings.json'); assert.match(view.base!, /^[a-f0-9]{64}$/);
    assert.deepEqual(JSON.parse(view.text!), {});
    const s = await f.manager.saveGlobal({ app: 'claude', text: JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, env: { DISABLE_AUTOUPDATER: '1' } }), base: view.base! });
    const live = JSON.parse((await readText(path))!);
    assert.deepEqual(live.permissions, { allow: ['Bash(ls)'] }); assert.equal(live.env.DISABLE_AUTOUPDATER, '1');
    assert.equal(live.env.ANTHROPIC_BASE_URL, 'https://gateway.example'); assert.equal(live.model, 'main'); assert.equal(live.env.ANTHROPIC_AUTH_TOKEN, 'sk-test-only');
    // Our own write is neither drift nor reported as a reformat, and the previous file is backed up.
    assert.equal(s.diagnostics[0].state, 'written'); assert.equal(s.diagnostics[0].reformatted, false);
    const backups = await readdir(join(f.paths.data, 'backups'));
    const restorable = await Promise.all(backups.map(async name => JSON.parse((await readText(join(f.paths.data, 'backups', name), 128 * 1024 * 1024))!).entries[0].before));
    assert.ok(restorable.includes(written));
    // Provider fields are refused by name; an unchanged text writes nothing.
    const again = await f.manager.globalView('claude');
    await assert.rejects(() => f.manager.saveGlobal({ app: 'claude', text: JSON.stringify({ model: 'x', env: { ANTHROPIC_BASE_URL: 'y' } }), base: again.base! }), /供应商管理.*model、ANTHROPIC_BASE_URL/);
    const bytes = await readText(path);
    await f.manager.saveGlobal({ app: 'claude', text: again.text!, base: again.base! });
    assert.equal(await readText(path), bytes);
  } finally { await f.cleanup(); }
});

test('global settings refuse a save when the file changed after they were read', async () => {
  const f = await fixture();
  try {
    const path = f.paths.targets.claude[0];
    await f.put(path, '{"theme":"dark"}');
    const view = await f.manager.globalView('claude');
    await f.put(path, '{"theme":"light"}');
    await assert.rejects(() => f.manager.saveGlobal({ app: 'claude', text: '{"theme":"mine"}', base: view.base! }), /已被其他程序修改/);
    assert.equal(await readText(path), '{"theme":"light"}');
    const fresh = await f.manager.globalView('claude');
    await assert.rejects(() => f.manager.saveGlobal({ app: 'claude', text: '{oops', base: fresh.base! }), /第 1 行附近 JSON 格式错误/);
    await f.put(path, '{oops');
    assert.match((await f.manager.globalView('claude')).error!, /无法解析/);
  } finally { await f.cleanup(); }
});

test('Codex and Pi global settings keep provider-owned tables and keys', async () => {
  const f = await fixture();
  try {
    const [toml, auth] = f.paths.targets.chatgpt;
    await f.put(toml, 'model = "old"\nmodel_provider = "custom"\nsandbox_mode = "workspace-write"\n[mcp_servers.docs]\ncommand = "docs"\n[model_providers.custom]\nbase_url = "https://gw.example/v1"\nexperimental_bearer_token = "sk-live"\n[model_providers.other]\nname = "Other"\n');
    await f.put(auth, '{"auth_mode":"chatgpt","tokens":{"access_token":"fake-access"}}');
    const view = await f.manager.globalView('chatgpt');
    assert.ok(!view.text!.includes('sk-live')); assert.ok(!view.text!.includes('model_provider ='));
    const edited = view.text!.replace('sandbox_mode = "workspace-write"', 'sandbox_mode = "read-only"\napproval_policy = "on-request"');
    await f.manager.saveGlobal({ app: 'chatgpt', text: edited, base: view.base! });
    const live = TOML.parse((await readText(toml))!) as any;
    assert.equal(live.sandbox_mode, 'read-only'); assert.equal(live.approval_policy, 'on-request'); assert.equal(live.mcp_servers.docs.command, 'docs');
    assert.equal(live.model, 'old'); assert.equal(live.model_providers.custom.experimental_bearer_token, 'sk-live'); assert.equal(live.model_providers.other.name, 'Other');
    assert.equal(await readText(auth), '{"auth_mode":"chatgpt","tokens":{"access_token":"fake-access"}}');
    const codexBase = (await f.manager.globalView('chatgpt')).base!;
    await assert.rejects(() => f.manager.saveGlobal({ app: 'chatgpt', text: '[model_providers.custom]\nname = "x"\n', base: codexBase }), /model_providers\.custom/);

    const piSettings = f.paths.targets.pi[2];
    await f.put(piSettings, '{"defaultProvider":"mi","defaultModel":"m","theme":"dark"}');
    const piView = await f.manager.globalView('pi');
    assert.deepEqual(JSON.parse(piView.text!), { theme: 'dark' });
    await f.manager.saveGlobal({ app: 'pi', text: '{"theme":"light","compaction":{"enabled":true}}', base: piView.base! });
    assert.deepEqual(JSON.parse((await readText(piSettings))!), { theme: 'light', compaction: { enabled: true }, defaultProvider: 'mi', defaultModel: 'm' });
  } finally { await f.cleanup(); }
});

test('saving the provider in use applies it at once; "save and use" applies any other', async () => {
  const f = await fixture();
  try {
    const path = f.paths.targets.claude[0];
    const p = (await f.manager.save(gateway)).providers[0];
    await f.manager.activate(p.id);
    // Editing the provider in use writes the file in the same action: no "waiting for a rewrite" state.
    let s = await f.manager.save({ ...gateway, id: p.id, apiKey: undefined, model: 'changed' });
    assert.equal(JSON.parse((await readText(path))!).model, 'changed');
    assert.equal(s.diagnostics[0].state, 'written'); assert.equal(s.diagnostics[0].edited, false);
    // A notes-only edit changes nothing a switch writes, so the file is left alone.
    const bytes = await readText(path); const backups = s.backups.length;
    s = await f.manager.save({ ...gateway, id: p.id, apiKey: undefined, model: 'changed', notes: 'n' });
    assert.equal(await readText(path), bytes); assert.equal(s.backups.length, backups);
    // Another provider is only stored, unless saved with activate.
    s = await f.manager.save({ ...gateway, name: 'Other', model: 'other' });
    assert.equal(JSON.parse((await readText(path))!).model, 'changed');
    s = await f.manager.save({ ...gateway, name: 'Third', model: 'third' }, { activate: true });
    assert.equal(JSON.parse((await readText(path))!).model, 'third');
    assert.equal(s.providers.find(x => x.id === s.active.claude?.providerId)?.name, 'Third');
  } finally { await f.cleanup(); }
});

test('editing a provider keeps its place in the list', async () => {
  const f = await fixture();
  try {
    const a = (await f.manager.save({ ...gateway, name: 'A' })).providers[0];
    await f.manager.save({ ...gateway, name: 'B' });
    const s = await f.manager.save({ ...gateway, id: a.id, apiKey: undefined, name: 'A2' });
    assert.deepEqual(s.providers.map(p => p.name), ['A2', 'B']);
  } finally { await f.cleanup(); }
});

test('the icon is display only: changing it never rewrites the file or counts as an edit', async () => {
  const f = await fixture();
  try {
    const path = f.paths.targets.claude[0];
    const p = (await f.manager.save(gateway)).providers[0];
    await f.manager.activate(p.id);
    const bytes = await readText(path); const before = (await f.manager.snapshot()).backups.length;
    const s = await f.manager.save({ ...gateway, id: p.id, apiKey: undefined, icon: 'kimi' });
    assert.equal(s.providers[0].icon, 'kimi'); assert.equal(await readText(path), bytes);
    assert.equal(s.backups.length, before); assert.equal(s.diagnostics[0].edited, false);
  } finally { await f.cleanup(); }
});
