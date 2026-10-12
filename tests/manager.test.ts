import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat, symlink, readdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import TOML from '@iarna/toml';
import { Manager } from '../src/core/manager';
import { resolvePaths } from '../src/core/paths';
import { atomicWrite, hash, readText, replaceText, withLocks } from '../src/core/files';
import { providerSchema, type AppId, type ProviderInput } from '../src/core/types';
import { INVALID_INPUT_MESSAGE, PublicError, publicError } from '../src/core/errors';

async function fixture(retention = 10, write = replaceText, read = readText) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'miswitch-test-')));
  const paths = resolvePaths(join(root, 'data'), join(root, 'home'), {});
  const manager = new Manager(paths, {}, retention, write, read);
  const cleanup = () => rm(root, { recursive: true, force: true });
  const put = async (path: string, value: string) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, value); };
  return { root, paths, manager, cleanup, put };
}
function input(app: AppId, name = 'Test'): ProviderInput {
  return { app, name, mode: 'api', baseUrl: app === 'claude' ? 'https://api.anthropic.com' : 'https://example.test/v1', model: 'test-model', protocol: app === 'claude' ? 'anthropic-messages' : 'openai-responses', apiKey: 'sk-test-only' };
}
async function add(manager: Manager, data = input('claude')) {
  const snapshot = await manager.save(data);
  return snapshot.providers.find(p => p.name === data.name)!;
}

test('Claude preserves permissions/hooks/MCP and clears competing user-level provider env', async () => {
  const f = await fixture();
  try {
    const original = '{"permissions":{"deny":["Read(secret)"]},"hooks":{},"env":{"KEEP":"yes","ANTHROPIC_AUTH_TOKEN":"stale","CLAUDE_CODE_USE_VERTEX":"1"}}\n';
    await f.put(f.paths.targets.claude[0], original);
    const global = join(f.paths.home, '.claude.json'); await f.put(global, '{"mcpServers":{"keep":{}}}');
    const p = await add(f.manager); const s = await f.manager.activate(p.id);
    const config = JSON.parse((await readText(f.paths.targets.claude[0]))!);
    assert.equal(config.env.ANTHROPIC_API_KEY, 'sk-test-only');
    assert.equal(config.env.ANTHROPIC_AUTH_TOKEN, undefined); assert.equal(config.env.CLAUDE_CODE_USE_VERTEX, undefined);
    assert.equal(config.env.KEEP, 'yes'); assert.deepEqual(config.permissions.deny, ['Read(secret)']);
    assert.equal(await readFile(global, 'utf8'), '{"mcpServers":{"keep":{}}}');
    assert.equal(s.diagnostics[0].state, 'written');
    const backup = JSON.parse(await readFile(join(f.paths.data, 'backups', `${s.backups[0].id}.json`), 'utf8'));
    assert.equal(backup.entries[0].before, original);
    assert.ok((await readFile(join(f.paths.data, 'hub.json'), 'utf8')).includes('sk-test-only'));
    assert.ok(!JSON.stringify(s).includes('sk-test-only'));
    assert.ok(!JSON.stringify(s).includes('ANTHROPIC_API_KEY'));
    if (process.platform !== 'win32') assert.equal((await stat(f.paths.targets.claude[0])).mode & 0o777, 0o600);
  } finally { await f.cleanup(); }
});
test('Codex follows the cc-switch template: custom table, bearer token, login-dependent requires_openai_auth, auth.json backed up but untouched', async () => {
  const f = await fixture();
  try {
    const [path, authPath] = f.paths.targets.chatgpt;
    await f.put(path, 'profile = "work"\nmodel_context_window = 5\n[profiles.work]\nmodel = "old"\n[mcp_servers.keep]\ncommand = "keep"\n[model_providers.other]\nname = "Other"\n[model_providers.miswitch_00000000000000000000000000000000]\nexperimental_bearer_token = "legacy"\n');
    const authText = '{"auth_mode":"chatgpt","OPENAI_API_KEY":null,"tokens":{"refresh_token":"fake-oauth","access_token":"fake-access"}}';
    await f.put(authPath, authText);
    const p = await add(f.manager, { ...input('chatgpt'), contextWindow: 1_000_000, autoCompactTokenLimit: 900_000 });
    const s = await f.manager.activate(p.id);
    let parsed = TOML.parse((await readText(path))!) as any;
    assert.equal(parsed.profile, undefined); assert.equal(parsed.profiles.work.model, 'old'); assert.equal(parsed.mcp_servers.keep.command, 'keep');
    assert.equal(parsed.model_provider, 'custom');
    assert.deepEqual(parsed.model_providers.custom, { name: 'Test', base_url: 'https://example.test/v1', wire_api: 'responses', requires_openai_auth: true, experimental_bearer_token: 'sk-test-only' });
    assert.deepEqual(Object.keys(parsed.model_providers).sort(), ['custom', 'other']);
    assert.equal(parsed.model_context_window, 1_000_000); assert.equal(parsed.model_auto_compact_token_limit, 900_000);
    assert.equal(await readText(authPath), authText);
    const backup = JSON.parse(await readFile(join(f.paths.data, 'backups', `${s.backups[0].id}.json`), 'utf8'));
    assert.deepEqual(backup.info.files, ['config.toml', 'auth.json']); assert.equal(backup.entries[1].before, authText);
    assert.equal(s.diagnostics[1].state, 'written');
    // Login state is part of the managed fingerprint: logging out makes requires_openai_auth stale.
    await f.put(authPath, '{"auth_mode":"apikey","OPENAI_API_KEY":null,"tokens":{}}');
    assert.equal((await f.manager.snapshot()).diagnostics[1].state, 'drift');
    const again = await add(f.manager, { ...input('chatgpt', 'NoLogin'), apiKey: 'sk-two' }); await f.manager.activate(again.id);
    parsed = TOML.parse((await readText(path))!) as any;
    assert.equal(parsed.model_providers.custom.requires_openai_auth, undefined); assert.equal(parsed.model_context_window, undefined);
    const login = await add(f.manager, { ...input('chatgpt', 'Login'), mode: 'login', apiKey: undefined });
    await f.manager.activate(login.id); parsed = TOML.parse((await readText(path))!) as any;
    assert.equal(parsed.model_provider, undefined);
    assert.deepEqual(parsed.model_providers.custom, { name: 'NoLogin', base_url: 'https://example.test/v1', wire_api: 'responses' });
    assert.equal(parsed.model_providers.other.name, 'Other');
    await assert.rejects(() => f.manager.save({ ...input('claude'), contextWindow: 10 }), /仅适用于 Codex/);
    await assert.rejects(() => f.manager.save({ ...input('chatgpt'), contextWindow: 10, autoCompactTokenLimit: 20 }), /不能大于/);
  } finally { await f.cleanup(); }
});
test('Pi writes all three official files and preserves unrelated OAuth/settings', async () => {
  const f = await fixture();
  try {
    const [models, auth, settings] = f.paths.targets.pi;
    await f.put(models, '{"providers":{"other":{"baseUrl":"https://keep.test"}}}');
    await f.put(auth, '{"anthropic":{"type":"oauth","refresh":"fake-refresh","access":"fake-access","expires":123456}}');
    await f.put(settings, '{"theme":"dark"}');
    const p = await add(f.manager, input('pi')); await f.manager.activate(p.id);
    const s = JSON.parse((await readText(settings))!); const a = JSON.parse((await readText(auth))!); const m = JSON.parse((await readText(models))!);
    assert.equal(s.theme, 'dark'); assert.equal(s.defaultModel, 'test-model');
    assert.equal(a[s.defaultProvider].type, 'api_key'); assert.equal(a[s.defaultProvider].key, 'sk-test-only');
    assert.equal(m.providers[s.defaultProvider].authHeader, true); assert.deepEqual(m.providers[s.defaultProvider].models, [{ id: 'test-model' }]);
    // Pi requires apiKey on custom providers; the real key lives only in auth.json.
    assert.equal(m.providers[s.defaultProvider].apiKey, 'managed-by-miswitch:auth.json'); assert.ok(!(await readText(models))!.includes('sk-test-only'));
    assert.equal(a.anthropic.refresh, 'fake-refresh');
    const login = await add(f.manager, { ...input('pi', 'Login'), mode: 'login', apiKey: undefined, loginProvider: 'anthropic' });
    await f.manager.activate(login.id);
    assert.deepEqual(JSON.parse((await readText(auth))!), { anthropic: a.anthropic });
    assert.equal(JSON.parse((await readText(settings))!).defaultProvider, 'anthropic');
  } finally { await f.cleanup(); }
});
test('invalid JSON/TOML fail before any target writes or backups', async () => {
  for (const app of ['claude', 'chatgpt'] as AppId[]) {
    const f = await fixture();
    try {
      const path = f.paths.targets[app][0]; await f.put(path, app === 'claude' ? '{broken' : '[broken');
      const p = await add(f.manager, input(app)); await assert.rejects(() => f.manager.activate(p.id));
      assert.equal(await readText(path), app === 'claude' ? '{broken' : '[broken');
      assert.equal((await f.manager.snapshot()).backups.length, 0);
    } finally { await f.cleanup(); }
  }
});
test('validation rejects protocol mismatch, nonlocal HTTP and Pi command interpolation', async () => {
  const f = await fixture();
  try {
    await assert.rejects(() => f.manager.save({ ...input('claude'), protocol: 'openai-completions' }));
    await assert.rejects(() => f.manager.save({ ...input('pi'), baseUrl: 'http://remote.test' }));
    await assert.rejects(() => f.manager.save({ ...input('pi'), apiKey: '!steal-key' }));
    await assert.rejects(() => f.manager.save({ ...input('pi'), apiKey: '$SECRET' }));
    await add(f.manager, { ...input('pi'), baseUrl: 'http://127.0.0.1:11434/v1', apiKey: 'local' });
  } finally { await f.cleanup(); }
});
test('restore recreates exact original bytes, backs up current state and clears active indicator', async () => {
  const f = await fixture();
  try {
    const original = '{ "theme": "original" }\n'; const path = f.paths.targets.claude[0]; await f.put(path, original);
    const p = await add(f.manager); const s = await f.manager.activate(p.id);
    const restored = await f.manager.restore(s.backups[0].id);
    assert.equal(await readText(path), original); assert.equal(restored.active.claude, undefined); assert.equal(restored.backups.length, 2);
  } finally { await f.cleanup(); }
});
test('restore of uninitialized configuration removes only files created by switch', async () => {
  const f = await fixture();
  try {
    const p = await add(f.manager, input('pi')); const s = await f.manager.activate(p.id);
    await f.manager.restore(s.backups[0].id);
    for (const path of f.paths.targets.pi) assert.equal(await readText(path), null);
  } finally { await f.cleanup(); }
});
test('external change marks drift; active delete is refused and editing keeps the record without touching the target', async () => {
  const f = await fixture();
  try {
    const p = await add(f.manager); await f.manager.activate(p.id);
    await f.put(f.paths.targets.claude[0], '{"external":"change"}');
    assert.equal((await f.manager.snapshot()).diagnostics[0].state, 'drift');
    await assert.rejects(() => f.manager.remove(p.id));
    const edited = await f.manager.save({ ...input('claude'), id: p.id, model: 'changed-model' });
    assert.equal(edited.active.claude?.providerId, p.id); assert.equal(edited.diagnostics[0].edited, true);
    assert.equal(await readText(f.paths.targets.claude[0]), '{"external":"change"}');
  } finally { await f.cleanup(); }
});
test('editing the active provider is reported until rewritten; notes and Claude names do not count', async () => {
  const f = await fixture();
  try {
    const p = await add(f.manager); await f.manager.activate(p.id);
    let s = await f.manager.save({ ...input('claude'), id: p.id, name: 'Renamed', notes: 'only metadata' });
    assert.equal(s.diagnostics[0].state, 'written'); assert.equal(s.diagnostics[0].edited, false);
    s = await f.manager.save({ ...input('claude'), id: p.id, model: 'changed-model' });
    assert.equal(s.diagnostics[0].state, 'written'); assert.equal(s.diagnostics[0].edited, true);
    assert.ok(s.diagnostics[0].warnings.some(w => w.includes('写入后已被编辑')));
    await assert.rejects(() => f.manager.remove(p.id), /请先切换/);
    // Editing back to what was written clears the report without a rewrite.
    s = await f.manager.save({ ...input('claude'), id: p.id });
    assert.equal(s.diagnostics[0].edited, false);
    s = await f.manager.save({ ...input('claude'), id: p.id, model: 'changed-model' });
    s = await f.manager.activate(p.id);
    assert.equal(s.diagnostics[0].edited, false); assert.equal(JSON.parse((await readText(f.paths.targets.claude[0]))!).model, 'changed-model');
    // The Codex name reaches config.toml, so renaming an active Codex provider counts.
    const codex = await add(f.manager, input('chatgpt', 'Codex')); await f.manager.activate(codex.id);
    s = await f.manager.save({ ...input('chatgpt', 'Codex renamed'), id: codex.id });
    assert.equal(s.diagnostics[1].edited, true);
  } finally { await f.cleanup(); }
});
test('an active record written before definitions is backfilled from the unedited provider on its first edit', async () => {
  const f = await fixture();
  try {
    const p = await add(f.manager); await f.manager.activate(p.id);
    const hubPath = join(f.paths.data, 'hub.json'); const hub = JSON.parse(await readFile(hubPath, 'utf8'));
    delete hub.active.claude.definition; await writeFile(hubPath, JSON.stringify(hub));
    assert.equal((await f.manager.snapshot()).diagnostics[0].edited, false);
    const s = await f.manager.save({ ...input('claude'), id: p.id, baseUrl: 'https://gateway.test' });
    assert.equal(s.active.claude?.providerId, p.id); assert.equal(s.diagnostics[0].edited, true);
  } finally { await f.cleanup(); }
});
test('Claude small/fast model is written to the haiku route; legacy and alias routes are cleared', async () => {
  const f = await fixture();
  try {
    const path = f.paths.targets.claude[0];
    await f.put(path, JSON.stringify({ env: { ANTHROPIC_SMALL_FAST_MODEL: 'stale-small', ANTHROPIC_DEFAULT_FABLE_MODEL: 'stale-fable', CLAUDE_CODE_SUBAGENT_MODEL: 'haiku' } }));
    const p = await add(f.manager, { ...input('claude'), smallFastModel: ' gateway-small ' });
    assert.equal((await f.manager.snapshot()).providers[0].smallFastModel, 'gateway-small');
    await f.manager.activate(p.id);
    let env = JSON.parse((await readText(path))!).env;
    assert.equal(env.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'gateway-small'); assert.equal(env.ANTHROPIC_MODEL, 'test-model');
    assert.equal(env.ANTHROPIC_SMALL_FAST_MODEL, undefined); assert.equal(env.ANTHROPIC_DEFAULT_FABLE_MODEL, undefined);
    assert.equal(env.CLAUDE_CODE_SUBAGENT_MODEL, 'haiku');
    // The haiku route is a managed field.
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = 'other'; await f.put(path, JSON.stringify({ env, model: 'test-model' }));
    assert.equal((await f.manager.snapshot()).diagnostics[0].state, 'drift');
    const plain = await add(f.manager, input('claude', 'Plain')); await f.manager.activate(plain.id);
    env = JSON.parse((await readText(path))!).env;
    assert.equal(env.ANTHROPIC_DEFAULT_HAIKU_MODEL, undefined);
    await assert.rejects(() => f.manager.save({ ...input('chatgpt'), smallFastModel: 'x' }), /仅适用于 Claude Code 的 API 模式/);
    await assert.rejects(() => f.manager.save({ ...input('claude'), mode: 'login', apiKey: undefined, smallFastModel: 'x' }), /仅适用于 Claude Code 的 API 模式/);
  } finally { await f.cleanup(); }
});
test('a Hub with duplicate provider IDs is rejected', async () => {
  const f = await fixture();
  try {
    await add(f.manager);
    const hubPath = join(f.paths.data, 'hub.json'); const hub = JSON.parse(await readFile(hubPath, 'utf8'));
    hub.providers.push({ ...hub.providers[0], name: 'Copy' }); await writeFile(hubPath, JSON.stringify(hub));
    await assert.rejects(() => f.manager.snapshot(), /重复的配置 ID/);
  } finally { await f.cleanup(); }
});
test('concurrent managers serialize Hub updates without dropping providers', async () => {
  const f = await fixture();
  try {
    const second = new Manager(f.paths, {});
    await Promise.all([f.manager.save(input('claude', 'A')), second.save(input('claude', 'B'))]);
    assert.equal((await second.snapshot()).providers.length, 2);
  } finally { await f.cleanup(); }
});
test('separate Node processes serialize updates through the same filesystem lock', async () => {
  const f = await fixture();
  try {
    const code = `import {Manager} from './src/core/manager.ts'; import {resolvePaths} from './src/core/paths.ts';
      const [root,name]=process.argv.slice(1); const manager=new Manager(resolvePaths(root+'/data',root+'/home',{}),{});
      await manager.save({app:'claude',name,mode:'api',baseUrl:'https://api.anthropic.com',model:'test',protocol:'anthropic-messages',apiKey:'test-only'});`;
    await Promise.all(['Process A', 'Process B'].map(name => promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code, f.root, name], { cwd: process.cwd() })));
    const snapshot = await f.manager.snapshot();
    assert.deepEqual(snapshot.providers.map(p => p.name).sort(), ['Process A', 'Process B']);
  } finally { await f.cleanup(); }
});
test('re-activating the same configuration does not add a backup identical to the newest one', async () => {
  const f = await fixture();
  try {
    const p = await add(f.manager); const other = await add(f.manager, { ...input('claude', 'Other'), model: 'other-model' });
    for (let i = 0; i < 3; i++) await f.manager.activate(p.id);
    // The missing original, then p's output; the third activation would back up p's output again.
    assert.equal((await f.manager.snapshot()).backups.length, 2);
    // Switching away backs up p's output too, which the newest backup already holds; switching back adds other's output.
    await f.manager.activate(other.id); await f.manager.activate(p.id);
    const backups = (await f.manager.snapshot()).backups;
    assert.equal(backups.length, 3);
    await f.manager.restore(backups[0].id);
    assert.equal(JSON.parse((await readText(f.paths.targets.claude[0]))!).model, 'other-model');
  } finally { await f.cleanup(); }
});
test('listing reads each backup version once and re-reads only changed files; restore reads only the chosen file', async () => {
  const f = await fixture();
  try {
    const p = await add(f.manager); const q = await add(f.manager, { ...input('claude', 'Q'), model: 'other-model' });
    await f.manager.activate(p.id); await f.manager.activate(q.id); const s = await f.manager.activate(p.id);
    const dir = join(f.paths.data, 'backups'); const file = (id: string) => join(dir, `${id}.json`);
    const reads: string[] = [];
    const cold = new Manager(f.paths, {}, 10, replaceText, (path, limit) => { reads.push(path); return readText(path, limit); });
    const backupReads = () => { const r = reads.filter(path => dirname(path) === dir).sort(); reads.length = 0; return r; };
    await cold.snapshot();
    assert.deepEqual(backupReads(), s.backups.map(b => file(b.id)).sort());
    await cold.snapshot();
    assert.deepEqual(backupReads(), []);
    // Same content, compact formatting: a new version of one file.
    const changed = file(s.backups[2].id);
    await writeFile(changed, JSON.stringify(JSON.parse(await readFile(changed, 'utf8'))));
    assert.equal((await cold.snapshot()).backups.length, 3);
    assert.deepEqual(backupReads(), [changed]);
    const restored = await cold.restore(s.backups[1].id);
    // The chosen file, plus the backup this restore wrote, listed once afterwards.
    assert.deepEqual(backupReads(), [file(s.backups[1].id), file(restored.backups[0].id)].sort());
  } finally { await f.cleanup(); }
});
test('a backup that changes while it is read is not cached', async () => {
  const f = await fixture();
  try {
    const p = await add(f.manager); const s = await f.manager.activate(p.id);
    const target = join(f.paths.data, 'backups', `${s.backups[0].id}.json`);
    let reads = 0;
    const manager = new Manager(f.paths, {}, 10, replaceText, async (path, limit) => {
      if (path === target && ++reads === 1) await writeFile(target, '{"damaged by a concurrent writer":true}');
      return readText(path, limit);
    });
    assert.equal((await manager.snapshot()).backups.length, 0);
    await manager.snapshot(); await manager.snapshot();
    // Read once while it changed, once more for the stable version, then cached.
    assert.equal(reads, 2);
  } finally { await f.cleanup(); }
});
test('skipping a backup re-reads the candidate; one that no longer matches its listing is replaced', async () => {
  const f = await fixture();
  try {
    const p = await add(f.manager); await f.manager.activate(p.id); const s = await f.manager.activate(p.id);
    const candidate = join(f.paths.data, 'backups', `${s.backups[0].id}.json`);
    let reads = 0;
    // The first read lists the candidate as it was; later reads see it damaged, as a stale cache entry would hide.
    const manager = new Manager(f.paths, {}, 10, replaceText, async (path, limit) => path === candidate && ++reads > 1 ? '{broken' : readText(path, limit));
    assert.equal((await manager.snapshot()).backups.length, 2);
    const next = await manager.activate(p.id);
    assert.equal(reads, 2); assert.equal(next.backups.length, 3);
    const written = JSON.parse(await readFile(join(f.paths.data, 'backups', `${next.backups[0].id}.json`), 'utf8'));
    assert.equal(written.entries[0].before, await readText(f.paths.targets.claude[0]));
  } finally { await f.cleanup(); }
});
test('backup order follows the sequence, not the clock; the backup a switch writes is never pruned', async () => {
  const f = await fixture(2);
  try {
    const path = f.paths.targets.claude[0];
    const original = '{"model":"before-switch"}\n'; await f.put(path, original);
    // Earlier backups stamped by a clock that later moved back, one of them without a sequence.
    const old = (id: string, sequence: number | undefined, createdAt: string) => f.put(join(f.paths.data, 'backups', `${id}.json`), JSON.stringify({ version: 1, info: { id, app: 'claude', createdAt, ...(sequence ? { sequence } : {}), files: ['settings.json'] }, entries: [{ path, before: `{"seq":${sequence ?? 0}}`, after: null }] }));
    await old('00000000-0000-4000-8000-000000000005', 5, '2099-01-01T00:00:00.000Z');
    await old('00000000-0000-4000-8000-000000000006', 6, '2099-01-01T00:00:00.000Z');
    await old('00000000-0000-4000-8000-000000000009', undefined, '2100-01-01T00:00:00.000Z');
    const p = await add(f.manager); const s = await f.manager.activate(p.id);
    assert.deepEqual(s.backups.map(b => [b.sequence, b.createdAt.startsWith('2099')]), [[7, false], [6, true]]);
    const kept = JSON.parse(await readFile(join(f.paths.data, 'backups', `${s.backups[0].id}.json`), 'utf8'));
    assert.equal(kept.entries[0].before, original);
  } finally { await f.cleanup(); }
});
test('backup retention is per app and keeps the newest distinct states', async () => {
  const f = await fixture(2);
  try {
    const p = await add(f.manager); const q = await add(f.manager, { ...input('claude', 'Q'), model: 'other-model' });
    const pi = await add(f.manager, input('pi', 'Pi'));
    await f.manager.activate(pi.id);
    // Alternating gives every switch a new before state: missing, p, q, p, q.
    for (let i = 0; i < 5; i++) await f.manager.activate((i % 2 ? q : p).id);
    const s = await f.manager.snapshot();
    const claude = s.backups.filter(b => b.app === 'claude');
    assert.equal(claude.length, 2); assert.equal(s.backups.filter(b => b.app === 'pi').length, 1);
    const befores = await Promise.all(claude.map(async b => JSON.parse(JSON.parse(await readFile(join(f.paths.data, 'backups', `${b.id}.json`), 'utf8')).entries[0].before).model));
    assert.deepEqual(befores, ['other-model', 'test-model']);
  } finally { await f.cleanup(); }
});
test('second-file failure rolls Pi and Hub back, with no success indicator', async () => {
  let calls = 0;
  const f = await fixture(10, async (...args) => { if (++calls === 2) throw new Error('simulated disk full'); return replaceText(...args); });
  try {
    const p = await add(f.manager, input('pi')); const beforeHub = await readText(join(f.paths.data, 'hub.json'));
    await assert.rejects(() => f.manager.activate(p.id), /simulated/);
    for (const path of f.paths.targets.pi) assert.equal(await readText(path), null);
    assert.equal(await readText(join(f.paths.data, 'hub.json')), beforeHub);
    assert.equal(await readText(join(f.paths.data, 'pending.json')), null);
    assert.equal((await f.manager.snapshot()).active.pi, undefined);
  } finally { await f.cleanup(); }
});
test('journal recovery restores an interrupted write; external edits are reported, block writes, never get overwritten', async () => {
  for (const external of [false, true]) {
    const f = await fixture();
    try {
      const path = f.paths.targets.claude[0]; const before = '{"original":true}'; const after = '{"switched":true}';
      const journalId = randomUUID();
      await f.put(path, external ? '{"someoneElse":true}' : after);
      await f.put(join(f.paths.data, 'pending.json'), JSON.stringify({ version: 1, id: journalId, app: 'claude', createdAt: new Date().toISOString(), entries: [{ path, before, after }] }));
      if (external) {
        const s = await f.manager.snapshot();
        assert.deepEqual(s.pending, { id: journalId, app: 'claude', createdAt: s.pending!.createdAt, paths: [path], conflicts: [path], valid: true });
        await assert.rejects(() => f.manager.save(input('claude')), /待决日志/);
        assert.equal(await readText(path), '{"someoneElse":true}'); assert.ok(await readText(join(f.paths.data, 'pending.json')));
      } else {
        const s = await f.manager.snapshot(); assert.equal(s.pending, null);
        assert.equal(await readText(path), before); assert.equal(await readText(join(f.paths.data, 'pending.json')), null);
      }
    } finally { await f.cleanup(); }
  }
});
test('resolving a conflicting journal rolls back only our own bytes and keeps external edits', async () => {
  const f = await fixture();
  try {
    const [models, auth] = f.paths.targets.pi;
    const hubPath = join(f.paths.data, 'hub.json');
    await f.put(models, '{"ours":true}'); await f.put(auth, '{"external":true}'); await f.put(hubPath, '{"version":1,"providers":[],"active":{}}\n');
    const id = randomUUID();
    await f.put(join(f.paths.data, 'pending.json'), JSON.stringify({ version: 1, id, app: 'pi', createdAt: new Date().toISOString(), entries: [
      { path: models, before: null, after: '{"ours":true}' }, { path: auth, before: '{"old":true}', after: '{"ours":true}' },
      { path: hubPath, before: '{"version":1,"providers":[],"active":{}}\n', after: '{"version":1,"providers":[],"active":{"pi":{}}}\n' }
    ] }));
    const s = await f.manager.snapshot();
    assert.deepEqual(s.pending!.conflicts, [auth]);
    await assert.rejects(() => f.manager.resolveJournal(randomUUID()), /已变化/);
    const resolved = await f.manager.resolveJournal(id);
    assert.equal(resolved.pending, null);
    assert.equal(await readText(models), null); assert.equal(await readText(auth), '{"external":true}');
    assert.equal(await readText(join(f.paths.data, 'pending.json')), null);
    assert.equal((await f.manager.save(input('pi'))).providers.length, 1);
  } finally { await f.cleanup(); }
});
test('an unparsable pending.json is reported and can be discarded by content hash', async () => {
  const f = await fixture();
  try {
    await f.put(join(f.paths.data, 'pending.json'), '{not json');
    const s = await f.manager.snapshot();
    assert.equal(s.pending!.valid, false); assert.equal(s.pending!.id, hash('{not json'));
    await assert.rejects(() => f.manager.activate(randomUUID()), /待决日志/);
    assert.equal((await f.manager.resolveJournal(s.pending!.id)).pending, null);
    assert.equal(await readText(join(f.paths.data, 'pending.json')), null);
  } finally { await f.cleanup(); }
});
test('CLI reformatting keeps written state; changing a managed field is drift', async () => {
  const f = await fixture();
  try {
    const path = f.paths.targets.claude[0];
    const p = await add(f.manager); await f.manager.activate(p.id);
    const settings = JSON.parse((await readText(path))!);
    // Claude Code style rewrite: new unrelated key, reordered keys, compact formatting.
    await f.put(path, JSON.stringify({ feedbackSurveyState: { lastShown: 1 }, env: Object.fromEntries(Object.entries(settings.env).reverse()), model: settings.model }));
    let d = (await f.manager.snapshot()).diagnostics[0];
    assert.equal(d.state, 'written'); assert.equal(d.reformatted, true);
    settings.env.ANTHROPIC_BASE_URL = 'https://other.test';
    await f.put(path, JSON.stringify(settings));
    d = (await f.manager.snapshot()).diagnostics[0];
    assert.equal(d.state, 'drift');
    const codex = await add(f.manager, input('chatgpt', 'Codex')); await f.manager.activate(codex.id);
    const toml = f.paths.targets.chatgpt[0];
    await f.put(toml, `# added by codex\n${await readText(toml)}\n[projects."/tmp/x"]\ntrust_level = "trusted"\n`);
    assert.equal((await f.manager.snapshot()).diagnostics[1].state, 'written');
    await f.put(toml, (await readText(toml))!.replace('wire_api = "responses"', 'wire_api = "chat"'));
    assert.equal((await f.manager.snapshot()).diagnostics[1].state, 'drift');
  } finally { await f.cleanup(); }
});
test('a malformed backup file is skipped with a warning instead of blocking snapshot', async () => {
  const f = await fixture();
  try {
    const p = await add(f.manager); const s = await f.manager.activate(p.id);
    const bad = `${randomUUID()}.json`;
    await f.put(join(f.paths.data, 'backups', bad), '{"version":1,"info":{"id":"nope"}}');
    const next = await f.manager.snapshot();
    assert.equal(next.backups.length, 1); assert.equal(next.backups[0].id, s.backups[0].id);
    assert.deepEqual(next.warnings, [`有 1 个备份文件无法解析，已跳过：${bad}`]);
    await assert.rejects(() => f.manager.restore(bad.slice(0, 36)), /备份不存在/);
    await f.manager.restore(s.backups[0].id);
  } finally { await f.cleanup(); }
});
test('oversized outputs are refused before any write; large but legal backups and journals stay readable', async () => {
  const f = await fixture();
  try {
    // 4 MB compact JSON expands to ~9 MB when pretty-printed: must be refused before touching anything.
    const path = f.paths.targets.claude[0];
    const compact = JSON.stringify({ unrelated: Array(1_000_000).fill('x') });
    await f.put(path, compact);
    const p = await add(f.manager);
    await assert.rejects(() => f.manager.activate(p.id), /超过 8 MiB/);
    assert.equal(await readText(path), compact);
    const s = await f.manager.snapshot();
    assert.equal(s.backups.length, 0); assert.equal(s.pending, null); assert.equal(s.diagnostics[0].state, 'none');
    // 4.2 MiB target → ~8.8 MB backup: larger than a target but still a readable archive.
    await f.put(path, JSON.stringify({ unrelated: 'x'.repeat(Math.ceil(4.2 * 1024 * 1024)) }));
    const applied = await f.manager.activate(p.id);
    assert.equal(applied.backups.length, 1); assert.deepEqual(applied.warnings, []);
    const raw = await readFile(join(f.paths.data, 'backups', `${applied.backups[0].id}.json`), 'utf8');
    assert.ok(raw.length > 8 * 1024 * 1024);
    const journal = { version: 1, id: randomUUID(), app: 'claude', createdAt: new Date().toISOString(), entries: JSON.parse(raw).entries };
    await f.put(join(f.paths.data, 'pending.json'), JSON.stringify(journal));
    const recovered = await f.manager.snapshot();
    assert.equal(recovered.pending, null); assert.equal(await readText(join(f.paths.data, 'pending.json')), null);
    assert.equal((await readText(path))!.length, JSON.parse(raw).entries[0].before.length);
  } finally { await f.cleanup(); }
});
test('an incomplete backup is skipped and cannot be restored; the legacy Codex single-file set is accepted', async () => {
  const f = await fixture();
  try {
    const a = await add(f.manager, input('pi', 'A')); await f.manager.activate(a.id);
    const b = await add(f.manager, input('pi', 'B')); const switched = await f.manager.activate(b.id);
    const file = join(f.paths.data, 'backups', `${switched.backups[0].id}.json`);
    const broken = JSON.parse(await readFile(file, 'utf8')); broken.entries = broken.entries.slice(0, 1); await writeFile(file, JSON.stringify(broken));
    const listed = await f.manager.snapshot();
    assert.ok(!listed.backups.some(x => x.id === switched.backups[0].id)); assert.equal(listed.warnings.length, 1);
    await assert.rejects(() => f.manager.restore(switched.backups[0].id), /备份不存在/);
    const settings = JSON.parse((await readText(f.paths.targets.pi[2]))!); const models = JSON.parse((await readText(f.paths.targets.pi[0]))!);
    assert.ok(models.providers[settings.defaultProvider]);
    // Legacy Codex backup with only config.toml (written before auth.json became a target) restores that file only.
    const [toml, auth] = f.paths.targets.chatgpt; await f.put(auth, '{"auth_mode":"chatgpt","tokens":{"access_token":"keep"}}');
    const legacyId = randomUUID();
    await f.put(join(f.paths.data, 'backups', `${legacyId}.json`), JSON.stringify({ version: 1, info: { id: legacyId, app: 'chatgpt', createdAt: new Date().toISOString(), files: ['config.toml'] }, entries: [{ path: toml, before: 'model = "legacy"\n', after: null }] }));
    const restored = await f.manager.restore(legacyId);
    assert.equal(await readText(toml), 'model = "legacy"\n'); assert.equal(await readText(auth), '{"auth_mode":"chatgpt","tokens":{"access_token":"keep"}}');
    assert.equal(restored.warnings.length, 1);
  } finally { await f.cleanup(); }
});
test('a legacy active record without fingerprint is judged by its byte hashes, not reported as drift', async () => {
  const f = await fixture();
  try {
    const p = await add(f.manager); await f.manager.activate(p.id);
    const hubPath = join(f.paths.data, 'hub.json'); const hub = JSON.parse(await readFile(hubPath, 'utf8'));
    delete hub.active.claude.fingerprint; await writeFile(hubPath, JSON.stringify(hub));
    let d = (await f.manager.snapshot()).diagnostics[0];
    assert.equal(d.state, 'written'); assert.ok(d.warnings.some(w => w.includes('旧版本')));
    await f.put(f.paths.targets.claude[0], '{"changed":true}');
    d = (await f.manager.snapshot()).diagnostics[0];
    assert.equal(d.state, 'drift');
  } finally { await f.cleanup(); }
});
test('publicError forwards only static messages', () => {
  assert.equal(publicError(new PublicError('配置不存在')), '配置不存在');
  assert.throws(() => providerSchema.parse({ ...input('claude'), baseUrl: 'http://gateway.test', apiKey: 'sk SECRET' }), (error: unknown) => {
    assert.equal(publicError(error), 'Base URL 必须为 HTTPS，或本机 HTTP 地址；API Key 必须为字面密钥，不得含空白或命令/环境变量表达式');
    return true;
  });
  assert.throws(() => providerSchema.parse({ ...input('claude'), extra: 'sk-LEAK' }), (error: unknown) => {
    const message = publicError(error);
    assert.ok(!message.includes('LEAK')); assert.equal(message, INVALID_INPUT_MESSAGE);
    return true;
  });
  assert.ok(!publicError(new SyntaxError('Unexpected token sk-LEAK')).includes('LEAK'));
  assert.equal(publicError(Object.assign(new Error('x'), { code: 'ELOCKED' })), '配置正在被另一进程使用，请稍后重试');
});
test('compare-before-replace refuses a noncooperating writer', async () => {
  const f = await fixture();
  try {
    const path = f.paths.targets.claude[0]; await f.put(path, 'new');
    await assert.rejects(() => atomicWrite(path, 'ours', 'old'), /其他进程/);
    assert.equal(await readText(path), 'new'); assert.deepEqual((await readdir(dirname(path))), ['settings.json']);
  } finally { await f.cleanup(); }
});
test('target or parent symlinks are refused without touching destination', async () => {
  const f = await fixture();
  try {
    const destination = join(f.root, 'elsewhere.json'); await f.put(destination, '{}');
    const path = f.paths.targets.claude[0]; await mkdir(dirname(path), { recursive: true }); await symlink(destination, path);
    const p = await add(f.manager); await assert.rejects(() => f.manager.activate(p.id), /符号链接/);
    assert.equal(await readFile(destination, 'utf8'), '{}');
  } finally { await f.cleanup(); }
});
test('Pi activation respects the official auth storage lock convention', async () => {
  const f = await fixture();
  try {
    const p = await add(f.manager, input('pi'));
    await withLocks([f.paths.targets.pi[1]], async () => { await assert.rejects(() => f.manager.activate(p.id), (error: any) => error.code === 'ELOCKED'); });
    for (const path of f.paths.targets.pi) assert.equal(await readText(path), null);
  } finally { await f.cleanup(); }
});
test('directory overrides use platform home or explicit absolute paths', () => {
  const p = resolvePaths('/data', '/users/example', { CODEX_HOME: '/custom/codex', PI_CODING_AGENT_DIR: '~/pi-custom', CLAUDE_CONFIG_DIR: '/custom/claude' });
  assert.equal(p.targets.chatgpt[0], '/custom/codex/config.toml'); assert.equal(p.targets.pi[0], '/users/example/pi-custom/models.json');
  assert.throws(() => resolvePaths('/data', '/home', { CODEX_HOME: 'relative' }));
  assert.equal(hash(null), 'missing');
});
