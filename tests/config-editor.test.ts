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

test('the Claude view projects the draft onto the whole settings.json and hides a saved key', async () => {
  const f = await fixture();
  try {
    const path = f.paths.targets.claude[0];
    await f.put(path, JSON.stringify({ permissions: { deny: ['Read(secret)'] }, hooks: { Stop: [] }, model: 'opus', env: { TZ: 'Asia/Taipei', ANTHROPIC_API_KEY: 'sk-from-another-tool' } }));
    let view = await f.manager.configView({ app: 'claude', draft: { mode: 'api', baseUrl: 'https://gateway.example', apiKey: 'sk-typed', claudeAuth: 'bearer', model: 'main', smallFastModel: 'small' } });
    assert.equal(view.name, 'settings.json'); assert.equal(view.format, 'json'); assert.match(view.base!, /^[a-f0-9]{64}$/);
    let shown = JSON.parse(view.text!);
    assert.deepEqual(shown.permissions, { deny: ['Read(secret)'] }); assert.deepEqual(shown.hooks, { Stop: [] });
    assert.deepEqual(shown.env, { TZ: 'Asia/Taipei', ANTHROPIC_BASE_URL: 'https://gateway.example', ANTHROPIC_AUTH_TOKEN: 'sk-typed', ANTHROPIC_MODEL: 'main', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'small' });
    assert.equal(shown.model, 'main');
    // An existing provider with an empty key field: the saved key never reaches the view.
    const saved = (await f.manager.save({ ...gateway, apiKey: 'sk-saved-secret' })).providers[0];
    view = await f.manager.configView({ app: 'claude', providerId: saved.id, draft: { mode: 'api', baseUrl: 'https://gateway.example', claudeAuth: 'bearer', model: 'main' } });
    assert.ok(!view.text!.includes('sk-saved-secret')); assert.equal(JSON.parse(view.text!).env.ANTHROPIC_AUTH_TOKEN, SAVED_KEY_TEXT);
    // Recomposing onto edited text keeps the user's global edits and replaces only provider fields.
    const edited = JSON.stringify({ ...JSON.parse(view.text!), statusLine: { type: 'command' } });
    shown = JSON.parse((await f.manager.configView({ app: 'claude', providerId: saved.id, text: edited, draft: { mode: 'login', model: 'opus' } })).text!);
    assert.deepEqual(shown.statusLine, { type: 'command' }); assert.equal(shown.model, 'opus'); assert.deepEqual(shown.env, { TZ: 'Asia/Taipei' });
    assert.match((await f.manager.configView({ app: 'claude', text: '{\n  "a": 1,\n  oops\n}', draft: {} })).error!, /第 3 行附近 JSON 格式错误/);
  } finally { await f.cleanup(); }
});

test('the form reads provider fields back from edited text, keeping a saved key behind its placeholder', async () => {
  const f = await fixture();
  try {
    const text = JSON.stringify({ model: 'x', env: { ANTHROPIC_BASE_URL: 'https://edited.example', ANTHROPIC_AUTH_TOKEN: SAVED_KEY_TEXT, ANTHROPIC_MODEL: 'edited', ANTHROPIC_DEFAULT_OPUS_MODEL: 'big' } });
    assert.deepEqual(await f.manager.parseConfig({ app: 'claude', text }), { keptKey: true, fields: {
      mode: 'api', model: 'edited', baseUrl: 'https://edited.example', claudeAuth: 'bearer', apiKey: undefined, smallFastModel: '', sonnetModel: '', opusModel: 'big', fableModel: '' } });
    assert.deepEqual((await f.manager.parseConfig({ app: 'claude', text: '{"model":"opus"}' })).fields, { mode: 'login', model: 'opus' });
    assert.match((await f.manager.parseConfig({ app: 'claude', text: '{"apiKeyHelper":"x"}' })).error!, /表单无法表示/);
    const codex = 'model = "m"\nmodel_provider = "custom"\nmodel_reasoning_effort = "high"\nmodel_context_window = 200000\n[model_providers.custom]\nname = "GW"\nbase_url = "https://gw.example/v1"\nexperimental_bearer_token = "sk-typed"\n';
    assert.deepEqual((await f.manager.parseConfig({ app: 'chatgpt', text: codex })).fields, {
      mode: 'api', model: 'm', contextWindow: '200000', autoCompactTokenLimit: '', reasoningEffort: 'high', baseUrl: 'https://gw.example/v1', name: 'GW', apiKey: 'sk-typed' });
    assert.deepEqual((await f.manager.parseConfig({ app: 'pi', text: '{"defaultProvider":"mi","defaultModel":"m"}' })).fields, { model: 'm', mode: 'login', loginProvider: 'mi' });
    assert.match((await f.manager.parseConfig({ app: 'chatgpt', text: 'model = \n' })).error!, /config\.toml 第 1 行附近 TOML 格式错误/);
  } finally { await f.cleanup(); }
});

test('saving writes the global part of the editor text now and leaves provider fields to the switch', async () => {
  const f = await fixture();
  try {
    const path = f.paths.targets.claude[0];
    const p = (await f.manager.save(gateway)).providers[0];
    await f.manager.activate(p.id);
    const written = (await readText(path))!;
    const view = await f.manager.configView({ app: 'claude', providerId: p.id, draft: { mode: 'api', baseUrl: 'https://gateway.example', claudeAuth: 'bearer', model: 'changed' } });
    const text = JSON.parse(view.text!);
    text.permissions = { allow: ['Bash(ls)'] }; text.env.DISABLE_AUTOUPDATER = '1';
    // Provider fields edited in the text are not written by a save.
    text.env.ANTHROPIC_BASE_URL = 'https://not-written.example';
    const s = await f.manager.save({ ...gateway, id: p.id, apiKey: undefined, model: 'changed' }, { text: JSON.stringify(text), base: view.base! });
    const live = JSON.parse((await readText(path))!);
    assert.deepEqual(live.permissions, { allow: ['Bash(ls)'] }); assert.equal(live.env.DISABLE_AUTOUPDATER, '1');
    assert.equal(live.env.ANTHROPIC_BASE_URL, 'https://gateway.example'); assert.equal(live.model, 'main'); assert.equal(live.env.ANTHROPIC_AUTH_TOKEN, 'sk-test-only');
    assert.equal(s.providers[0].model, 'changed'); assert.equal(s.diagnostics[0].edited, true);
    // Our own write is neither drift nor reported as a reformat, and the previous file is backed up.
    assert.equal(s.diagnostics[0].state, 'written'); assert.equal(s.diagnostics[0].reformatted, false);
    const backups = await readdir(join(f.paths.data, 'backups'));
    const restorable = await Promise.all(backups.map(async name => JSON.parse((await readText(join(f.paths.data, 'backups', name), 128 * 1024 * 1024))!).entries[0].before));
    assert.ok(restorable.includes(written));
    // Saving without global changes writes no target file.
    const bytes = await readText(path);
    const again = await f.manager.configView({ app: 'claude', providerId: p.id, draft: {} });
    await f.manager.save({ ...gateway, id: p.id, apiKey: undefined, notes: 'n' }, { text: again.text!, base: again.base! });
    assert.equal(await readText(path), bytes);
  } finally { await f.cleanup(); }
});

test('a save refuses global edits when the file changed after the editor opened', async () => {
  const f = await fixture();
  try {
    const path = f.paths.targets.claude[0];
    await f.put(path, '{"theme":"dark"}');
    const view = await f.manager.configView({ app: 'claude', draft: { mode: 'login', model: 'opus' } });
    await f.put(path, '{"theme":"light"}');
    await assert.rejects(() => f.manager.save({ app: 'claude', name: 'L', mode: 'login', protocol: 'anthropic-messages', model: 'opus' }, { text: '{"theme":"mine"}', base: view.base! }), /已被其他程序修改/);
    assert.equal(await readText(path), '{"theme":"light"}'); assert.deepEqual((await f.manager.snapshot()).providers, []);
    const fresh = await f.manager.configView({ app: 'claude', draft: { mode: 'login', model: 'opus' } });
    await assert.rejects(() => f.manager.save({ app: 'claude', name: 'L', mode: 'login', protocol: 'anthropic-messages', model: 'opus' }, { text: '{oops', base: fresh.base! }), /第 1 行附近 JSON 格式错误/);
  } finally { await f.cleanup(); }
});

test('Codex config.toml and Pi settings.json keep their global settings and provider-owned tables', async () => {
  const f = await fixture();
  try {
    const [toml, auth] = f.paths.targets.chatgpt;
    await f.put(toml, 'model = "old"\nsandbox_mode = "workspace-write"\n[mcp_servers.docs]\ncommand = "docs"\n[model_providers.other]\nname = "Other"\n');
    await f.put(auth, '{"auth_mode":"chatgpt","tokens":{"access_token":"fake-access"}}');
    const draft = { mode: 'api' as const, name: 'GW', baseUrl: 'https://gw.example/v1', apiKey: 'sk-typed', model: 'm', contextWindow: '200000', reasoningEffort: 'high' };
    const view = await f.manager.configView({ app: 'chatgpt', draft });
    const shown = TOML.parse(view.text!) as any;
    assert.equal(view.name, 'config.toml'); assert.equal(shown.sandbox_mode, 'workspace-write'); assert.equal(shown.mcp_servers.docs.command, 'docs');
    assert.deepEqual(shown.model_providers.custom, { name: 'GW', base_url: 'https://gw.example/v1', wire_api: 'responses', requires_openai_auth: true, experimental_bearer_token: 'sk-typed' });
    assert.equal(shown.model_context_window, 200000); assert.equal(shown.model_reasoning_effort, 'high');
    const edited = view.text!.replace('sandbox_mode = "workspace-write"', 'sandbox_mode = "read-only"\napproval_policy = "on-request"');
    await f.manager.save({ app: 'chatgpt', name: 'GW', mode: 'api', baseUrl: 'https://gw.example/v1', apiKey: 'sk-typed', protocol: 'openai-responses', model: 'm' }, { text: edited, base: view.base! });
    const live = TOML.parse((await readText(toml))!) as any;
    assert.equal(live.sandbox_mode, 'read-only'); assert.equal(live.approval_policy, 'on-request'); assert.equal(live.mcp_servers.docs.command, 'docs');
    // Provider-owned keys stay as the file had them until a switch: no custom table, the old model.
    assert.equal(live.model, 'old'); assert.equal(live.model_providers.custom, undefined); assert.equal(live.model_providers.other.name, 'Other');
    assert.equal(await readText(auth), '{"auth_mode":"chatgpt","tokens":{"access_token":"fake-access"}}');

    const piSettings = f.paths.targets.pi[2];
    await f.put(piSettings, '{"defaultProvider":"mi","defaultModel":"m","theme":"dark"}');
    const piView = await f.manager.configView({ app: 'pi', draft: { mode: 'api', model: 'pm' } });
    assert.deepEqual(JSON.parse(piView.text!), { defaultProvider: 'miswitch_（保存后生成）', defaultModel: 'pm', theme: 'dark' });
    const text = JSON.stringify({ ...JSON.parse(piView.text!), theme: 'light', compaction: { enabled: true } });
    await f.manager.save({ app: 'pi', name: 'P', mode: 'login', loginProvider: 'mi', protocol: 'openai-completions', model: 'pm' }, { text, base: piView.base! });
    assert.deepEqual(JSON.parse((await readText(piSettings))!), { theme: 'light', compaction: { enabled: true }, defaultProvider: 'mi', defaultModel: 'm' });
  } finally { await f.cleanup(); }
});
