import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import TOML from '@iarna/toml';
import { Manager } from '../src/core/manager';
import { resolvePaths } from '../src/core/paths';
import { readText } from '../src/core/files';
import { fetchModelList, modelIds, modelListUrls } from '../src/core/models';

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'miswitch-editor-')));
  const paths = resolvePaths(join(root, 'data'), join(root, 'home'), {});
  const put = async (path: string, value: string) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, value); };
  return { paths, manager: new Manager(paths, {}), put, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test('Claude alias routes are written and cleared; Codex reasoning effort is a one-time default that never drifts', async () => {
  const f = await fixture();
  try {
    const claude = f.paths.targets.claude[0];
    const routed = (await f.manager.save({ app: 'claude', name: 'Gateway', mode: 'api', baseUrl: 'https://gateway.example', apiKey: 'sk-test-only', claudeAuth: 'bearer', protocol: 'anthropic-messages',
      model: 'main', smallFastModel: 'small', sonnetModel: 'sonnet', opusModel: 'opus', fableModel: 'fable' })).providers[0];
    await f.manager.activate(routed.id);
    const env = JSON.parse((await readText(claude))!).env;
    assert.deepEqual([env.ANTHROPIC_DEFAULT_HAIKU_MODEL, env.ANTHROPIC_DEFAULT_SONNET_MODEL, env.ANTHROPIC_DEFAULT_OPUS_MODEL, env.ANTHROPIC_DEFAULT_FABLE_MODEL], ['small', 'sonnet', 'opus', 'fable']);
    const plain = (await f.manager.save({ app: 'claude', name: 'Plain', mode: 'api', baseUrl: 'https://gateway.example', apiKey: 'sk-test-only', protocol: 'anthropic-messages', model: 'main' })).providers.find(p => p.name === 'Plain')!;
    await f.manager.activate(plain.id);
    assert.deepEqual(Object.keys(JSON.parse((await readText(claude))!).env).filter(k => k.startsWith('ANTHROPIC_DEFAULT_')), []);
    await assert.rejects(() => f.manager.save({ app: 'claude', name: 'X', mode: 'login', protocol: 'anthropic-messages', model: 'm', opusModel: 'o' }), /别名映射仅适用于/);
    await assert.rejects(() => f.manager.save({ app: 'pi', name: 'X', mode: 'api', baseUrl: 'https://x.example/v1', apiKey: 'k', protocol: 'openai-completions', model: 'm', reasoningEffort: 'high' }), /推理强度仅适用于 Codex/);

    const toml = f.paths.targets.chatgpt[0];
    await f.put(toml, 'model_reasoning_effort = "low"\n');
    const codex = (await f.manager.save({ app: 'chatgpt', name: 'Codex', mode: 'api', baseUrl: 'https://gateway.example/v1', apiKey: 'sk-test-only', protocol: 'openai-responses', model: 'm', reasoningEffort: 'high' })).providers.find(p => p.app === 'chatgpt')!;
    await f.manager.activate(codex.id);
    assert.equal((TOML.parse((await readText(toml))!) as any).model_reasoning_effort, 'high');
    // Codex rewriting the effort later is the user's choice, not drift; a provider without one leaves it alone.
    await f.put(toml, (await readText(toml))!.replace('"high"', '"medium"'));
    assert.equal((await f.manager.snapshot()).diagnostics[1].state, 'written');
    const other = (await f.manager.save({ app: 'chatgpt', name: 'Other', mode: 'api', baseUrl: 'https://gateway.example/v1', apiKey: 'sk-test-only', protocol: 'openai-responses', model: 'm2' })).providers.find(p => p.name === 'Other')!;
    await f.manager.activate(other.id);
    assert.equal((TOML.parse((await readText(toml))!) as any).model_reasoning_effort, 'medium');
    // Editing the effort is an edit of what the switch writes.
    assert.equal((await f.manager.save({ app: 'chatgpt', name: 'Other', id: other.id, mode: 'api', baseUrl: 'https://gateway.example/v1', protocol: 'openai-responses', model: 'm2', reasoningEffort: 'xhigh' })).diagnostics[1].edited, true);
  } finally { await f.cleanup(); }
});

test('an imported Claude gateway keeps all alias routes, so it stays the active provider', async () => {
  const f = await fixture();
  try {
    await f.put(f.paths.targets.claude[0], JSON.stringify({ model: 'main', env: { ANTHROPIC_BASE_URL: 'https://gateway.example', ANTHROPIC_AUTH_TOKEN: 'sk-test-only', ANTHROPIC_MODEL: 'main', ANTHROPIC_DEFAULT_SONNET_MODEL: 's', ANTHROPIC_DEFAULT_OPUS_MODEL: 'o', ANTHROPIC_DEFAULT_FABLE_MODEL: 'f' } }));
    const s = await f.manager.importLive();
    assert.deepEqual(s.providers.map(p => [p.mode, p.claudeAuth, p.sonnetModel, p.opusModel, p.fableModel]), [['api', 'bearer', 's', 'o', 'f']]);
    assert.equal(s.diagnostics[0].state, 'written');
  } finally { await f.cleanup(); }
});

test('model lists use the right auth headers, fall back across candidate URLs and never follow redirects', async () => {
  const seen: { url: string; headers: IncomingHttpHeaders }[] = [];
  const server = createServer((req, res) => {
    seen.push({ url: req.url!, headers: req.headers });
    if (req.url === '/redirect/v1/models') { res.writeHead(302, { location: 'https://elsewhere.example/v1/models' }); return res.end(); }
    if (req.url === '/denied/v1/models') { res.writeHead(401); return res.end('{"error":"bad key sk-echoed"}'); }
    if (req.url === '/v1/models') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'model-b' }, { id: 'model-a' }, { id: 'model-a' }, { id: 'has space' }] })); }
    res.writeHead(404); res.end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    // Anthropic-style compatibility path: /anthropic/v1/models misses, the vendor root answers.
    const claude = await fetchModelList({ app: 'claude', baseUrl: `${base}/anthropic`, protocol: 'anthropic-messages', claudeAuth: 'bearer', apiKey: 'sk-test-only' });
    assert.deepEqual(claude, { models: ['model-a', 'model-b'], url: `${base}/v1/models` });
    assert.deepEqual(seen.map(s => s.url), ['/anthropic/v1/models', '/v1/models']);
    assert.equal(seen[1].headers.authorization, 'Bearer sk-test-only'); assert.equal(seen[1].headers['x-api-key'], undefined); assert.equal(seen[1].headers['anthropic-version'], '2023-06-01');
    seen.length = 0;
    await fetchModelList({ app: 'claude', baseUrl: base, protocol: 'anthropic-messages', claudeAuth: 'api-key', apiKey: 'sk-test-only' });
    assert.equal(seen[0].headers['x-api-key'], 'sk-test-only'); assert.equal(seen[0].headers.authorization, undefined);
    seen.length = 0;
    await fetchModelList({ app: 'pi', baseUrl: base, protocol: 'anthropic-messages', claudeAuth: 'api-key', apiKey: 'sk-test-only' });
    assert.equal(seen[0].headers['x-api-key'], 'sk-test-only'); assert.equal(seen[0].headers.authorization, 'Bearer sk-test-only');
    seen.length = 0;
    await fetchModelList({ app: 'chatgpt', baseUrl: `${base}/v1`, protocol: 'openai-responses', claudeAuth: 'api-key', apiKey: 'sk-test-only' });
    assert.deepEqual(seen.map(s => s.url), ['/v1/models']); assert.equal(seen[0].headers['x-api-key'], undefined);
    await assert.rejects(() => fetchModelList({ app: 'chatgpt', baseUrl: `${base}/redirect`, protocol: 'openai-responses', claudeAuth: 'api-key', apiKey: 'k' }), /HTTP 404|HTTP 302/);
    assert.ok(!seen.some(s => s.url.includes('elsewhere')));
    await assert.rejects(() => fetchModelList({ app: 'chatgpt', baseUrl: `${base}/denied`, protocol: 'openai-responses', claudeAuth: 'api-key', apiKey: 'k' }), (e: Error) => e.message === '获取模型列表失败：HTTP 401');
    await assert.rejects(() => fetchModelList({ app: 'chatgpt', baseUrl: 'http://gateway.example/v1', protocol: 'openai-responses', claudeAuth: 'api-key', apiKey: 'k' }), /HTTPS/);
    await assert.rejects(() => fetchModelList({ app: 'chatgpt', baseUrl: `${base}/v1`, protocol: 'openai-responses', claudeAuth: 'api-key' }), /需要 API Key/);

    // An existing provider's saved key is used when the field is left empty.
    const f = await fixture();
    try {
      const saved = (await f.manager.save({ app: 'chatgpt', name: 'Saved', mode: 'api', baseUrl: `${base}/v1`, apiKey: 'sk-saved-key', protocol: 'openai-responses', model: 'm' })).providers[0];
      seen.length = 0;
      assert.deepEqual((await f.manager.listModels({ app: 'chatgpt', baseUrl: `${base}/v1`, protocol: 'openai-responses', providerId: saved.id })).models, ['model-a', 'model-b']);
      assert.equal(seen[0].headers.authorization, 'Bearer sk-saved-key');
      await assert.rejects(() => f.manager.listModels({ app: 'claude', baseUrl: `${base}/v1`, protocol: 'anthropic-messages', providerId: saved.id }), /需要 API Key/);
    } finally { await f.cleanup(); }
  } finally { server.close(); }
});

test('model list parsing and candidate URLs', () => {
  assert.deepEqual(modelListUrls('https://api.example.com/v1/'), ['https://api.example.com/v1/models']);
  assert.deepEqual(modelListUrls('https://api.deepseek.com/anthropic'), ['https://api.deepseek.com/anthropic/v1/models', 'https://api.deepseek.com/v1/models', 'https://api.deepseek.com/anthropic/models']);
  assert.deepEqual(modelIds({ models: ['a', { name: 'b' }, { id: 'c' }, 3, null] }), ['a', 'b', 'c']);
  assert.deepEqual(modelIds([{ id: 'x' }]), ['x']);
  assert.deepEqual(modelIds({ error: 'nope' }), []);
});
