import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import TOML from '@iarna/toml';
import { Manager } from '../src/core/manager';
import { resolvePaths } from '../src/core/paths';
import { readText } from '../src/core/files';

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
