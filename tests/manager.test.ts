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

async function fixture(retention = 10, write = replaceText) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'miswitch-test-')));
  const paths = resolvePaths(join(root, 'data'), join(root, 'home'), {});
  const manager = new Manager(paths, {}, retention, write);
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
test('Codex uses Responses, preserves semantic TOML and OAuth auth.json, retires managed tokens', async () => {
  const f = await fixture();
  try {
    const path = f.paths.targets.chatgpt[0];
    await f.put(path, 'profile = "work"\n[profiles.work]\nmodel = "old"\n[mcp_servers.keep]\ncommand = "keep"\n[model_providers.other]\nname = "Other"\n');
    const authPath = join(dirname(path), 'auth.json'); await f.put(authPath, '{"tokens":{"refresh_token":"fake-oauth"}}');
    const p = await add(f.manager, input('chatgpt')); await f.manager.activate(p.id);
    let parsed = TOML.parse((await readText(path))!) as any;
    assert.equal(parsed.profile, undefined); assert.equal(parsed.profiles.work.model, 'old'); assert.equal(parsed.mcp_servers.keep.command, 'keep');
    assert.equal(parsed.model_providers[parsed.model_provider].wire_api, 'responses');
    assert.equal(parsed.model_providers[parsed.model_provider].experimental_bearer_token, 'sk-test-only');
    const login = await add(f.manager, { ...input('chatgpt', 'Login'), mode: 'login', apiKey: undefined });
    await f.manager.activate(login.id); parsed = TOML.parse((await readText(path))!) as any;
    assert.equal(parsed.model_provider, 'openai'); assert.deepEqual(Object.keys(parsed.model_providers), ['other']);
    assert.equal(await readText(authPath), '{"tokens":{"refresh_token":"fake-oauth"}}');
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
test('external change marks drift; active delete is refused and editing clears the applied indicator', async () => {
  const f = await fixture();
  try {
    const p = await add(f.manager); await f.manager.activate(p.id);
    await f.put(f.paths.targets.claude[0], '{"external":"change"}');
    assert.equal((await f.manager.snapshot()).diagnostics[0].state, 'drift');
    await assert.rejects(() => f.manager.remove(p.id));
    const edited = await f.manager.save({ ...input('claude'), id: p.id, model: 'changed-model' });
    assert.equal(edited.active.claude, undefined);
    assert.equal(await readText(f.paths.targets.claude[0]), '{"external":"change"}');
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
test('backup retention is per app', async () => {
  const f = await fixture(2);
  try {
    const p = await add(f.manager); const pi = await add(f.manager, input('pi', 'Pi'));
    await f.manager.activate(pi.id);
    for (let i = 0; i < 4; i++) await f.manager.activate(p.id);
    const s = await f.manager.snapshot();
    assert.equal(s.backups.filter(b => b.app === 'claude').length, 2); assert.equal(s.backups.filter(b => b.app === 'pi').length, 1);
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
