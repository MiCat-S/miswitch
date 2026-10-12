// Runs inside the container (see Dockerfile). Writes configuration through the
// real Manager, then launches each CLI non-interactively against the mock API
// and asserts what the CLI actually sent: path, credential header and model.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Manager } from '../../src/core/manager';
import { resolvePaths } from '../../src/core/paths';
import type { AppId, ProviderInput } from '../../src/core/types';

const home = process.env.HOME!;
const port = 8787;
const base = `http://127.0.0.1:${port}`;
const log = '/tmp/mock-requests.jsonl';
const work = '/work';
const officialAuth = join(home, '.codex', 'auth.json');
const officialAuthText = JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-official-login-stays' }) + '\n';
type Request = { method: string; path: string; model?: string; stream: boolean; authorization?: string; xApiKey?: string; userAgent?: string };
type Case = { app: AppId; name: string; provider: ProviderInput; command: string[]; env?: Record<string, string>; expect: { path: RegExp; model: string; header: 'authorization' | 'xApiKey'; value: string }; before?(): void; after?(output: string): string | null };

const cases: Case[] = [
  { app: 'claude', name: 'Claude Code · x-api-key', expect: { path: /^\/v1\/messages$/, model: 'claude-container-model', header: 'xApiKey', value: 'sk-claude-container-test' },
    provider: { app: 'claude', name: 'Claude mock', mode: 'api', baseUrl: base, apiKey: 'sk-claude-container-test', model: 'claude-container-model', protocol: 'anthropic-messages', claudeAuth: 'api-key' },
    command: ['claude', '-p', 'Reply with ok', '--output-format', 'text'],
    env: { DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1' } },
  { app: 'claude', name: 'Claude Code · bearer', expect: { path: /^\/v1\/messages$/, model: 'claude-container-model', header: 'authorization', value: 'Bearer sk-claude-bearer-test' },
    provider: { app: 'claude', name: 'Claude bearer mock', mode: 'api', baseUrl: base, apiKey: 'sk-claude-bearer-test', model: 'claude-container-model', protocol: 'anthropic-messages', claudeAuth: 'bearer' },
    command: ['claude', '-p', 'Reply with ok', '--output-format', 'text'],
    env: { DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1' } },
  // The haiku alias resolves through ANTHROPIC_DEFAULT_HAIKU_MODEL, the route the docs give for background tasks.
  // This request is the main conversation under that alias; no background request is triggered here.
  { app: 'claude', name: 'Claude Code · haiku alias uses the small/fast model', expect: { path: /^\/v1\/messages$/, model: 'claude-container-small', header: 'authorization', value: 'Bearer sk-claude-small-test' },
    provider: { app: 'claude', name: 'Claude small mock', mode: 'api', baseUrl: base, apiKey: 'sk-claude-small-test', model: 'claude-container-model', smallFastModel: 'claude-container-small', protocol: 'anthropic-messages', claudeAuth: 'bearer' },
    command: ['claude', '-p', '--model', 'haiku', 'Reply with ok', '--output-format', 'text'],
    env: { DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1' } },
  { app: 'chatgpt', name: 'Codex CLI · experimental_bearer_token', expect: { path: /^\/v1\/responses$/, model: 'codex-container-model', header: 'authorization', value: 'Bearer sk-codex-container-test' },
    provider: { app: 'chatgpt', name: 'Codex mock', mode: 'api', baseUrl: `${base}/v1`, apiKey: 'sk-codex-container-test', model: 'codex-container-model', protocol: 'openai-responses' },
    command: ['codex', 'exec', '--skip-git-repo-check', '--sandbox', 'read-only', 'Reply with ok'] },
  // An existing official login must neither be used for the third-party route nor be modified, and the
  // optional context keys must land in config.toml. (Codex still warns about unknown model metadata;
  // that warning concerns the model catalog, not the context window.)
  { app: 'chatgpt', name: 'Codex CLI · official auth.json kept, third-party token wins, context keys written', expect: { path: /^\/v1\/responses$/, model: 'codex-container-model', header: 'authorization', value: 'Bearer sk-codex-second-test' },
    provider: { app: 'chatgpt', name: 'Codex mock 2', mode: 'api', baseUrl: `${base}/v1`, apiKey: 'sk-codex-second-test', model: 'codex-container-model', protocol: 'openai-responses', contextWindow: 200_000, autoCompactTokenLimit: 150_000 },
    command: ['codex', 'exec', '--skip-git-repo-check', '--sandbox', 'read-only', 'Reply with ok'],
    before: () => { mkdirSync(join(home, '.codex'), { recursive: true }); writeFileSync(officialAuth, officialAuthText); },
    after: () => readFileSync(officialAuth, 'utf8') !== officialAuthText ? 'auth.json was modified'
      : !/model_context_window = 200_?000\n/.test(readFileSync(join(home, '.codex', 'config.toml'), 'utf8')) ? 'context fields missing' : null },
  { app: 'pi', name: 'Pi · openai-completions', expect: { path: /^\/v1\/chat\/completions$/, model: 'pi-container-model', header: 'authorization', value: 'Bearer sk-pi-container-test' },
    provider: { app: 'pi', name: 'Pi mock', mode: 'api', baseUrl: `${base}/v1`, apiKey: 'sk-pi-container-test', model: 'pi-container-model', protocol: 'openai-completions' },
    command: ['pi', '-p', '--no-session', 'Reply with ok'] },
  // Pi's anthropic-messages client appends /v1/messages itself, so the base URL carries no /v1.
  { app: 'pi', name: 'Pi · anthropic-messages', expect: { path: /^\/v1\/messages$/, model: 'pi-container-model', header: 'xApiKey', value: 'sk-pi-anthropic-test' },
    provider: { app: 'pi', name: 'Pi anthropic mock', mode: 'api', baseUrl: base, apiKey: 'sk-pi-anthropic-test', model: 'pi-container-model', protocol: 'anthropic-messages' },
    command: ['pi', '-p', '--no-session', 'Reply with ok'] }
];

function readLog(): Request[] {
  return existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
}
async function run(command: string[], env: Record<string, string> = {}, seconds = 90): Promise<{ code: number | null; output: string; timedOut: boolean }> {
  return new Promise(resolve => {
    const child = spawn(command[0], command.slice(1), { cwd: work, env: { ...process.env, ...env, HOME: home, TERM: 'dumb', NO_COLOR: '1', CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let timedOut = false;
    child.stdout.on('data', d => { output += d; });
    child.stderr.on('data', d => { output += d; });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, seconds * 1000);
    child.on('close', code => { clearTimeout(timer); resolve({ code, output, timedOut }); });
  });
}

async function main() {
  mkdirSync(work, { recursive: true });
  rmSync(log, { force: true });
  const mock = spawn(process.execPath, [join(import.meta.dirname, 'mock-server.mjs'), String(port), log], { stdio: 'inherit' });
  await new Promise(r => setTimeout(r, 500));
  // Claude Code first-run gates: completed onboarding and an approved custom API key suffix (last 20 chars).
  const approve = (key: string) => writeFileSync(join(home, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, customApiKeyResponses: { approved: [key.slice(-20)], rejected: [] } }));
  const manager = new Manager(resolvePaths('/tmp/miswitch-store', home, {}), {});
  const results: { name: string; ok: boolean; detail: string }[] = [];
  for (const c of cases) {
    const before = readLog().length;
    c.before?.();
    const saved = await manager.save(c.provider);
    const provider = saved.providers.find(p => p.name === c.provider.name)!;
    await manager.activate(provider.id);
    if (c.app === 'claude') approve(c.provider.apiKey!);
    const result = await run(c.command, c.env);
    const requests = readLog().slice(before);
    const afterProblem = c.after?.(result.output) ?? null;
    const matched = afterProblem ? [] : requests.filter(r => c.expect.path.test(r.path) && r.model === c.expect.model && r[c.expect.header] === c.expect.value);
    const summary = [...new Set(requests.map(r => `${r.method} ${r.path} model=${r.model ?? '-'} auth=${r.authorization ? 'Bearer ' + r.authorization.slice(7, 15) + '…' : r.xApiKey ? 'x-api-key ' + r.xApiKey.slice(0, 8) + '…' : 'none'}`))];
    const detail = [
      `exit=${result.code}${result.timedOut ? ' (timeout)' : ''}`,
      `requests=${requests.length} matched=${matched.length}${afterProblem ? ' ' + afterProblem : ''}`,
      ...summary.map(s => `  ${s}`),
      `  cli output: ${result.output.trim().split('\n').slice(-4).join(' | ').slice(0, 600)}`
    ].join('\n');
    // Routing proof (a matching request) and CLI completion (exit 0, no timeout) are both required.
    const ok = matched.length > 0 && result.code === 0 && !result.timedOut;
    results.push({ name: c.name, ok, detail });
    console.log(`\n=== ${c.name}: ${ok ? 'PASS' : 'FAIL'}${matched.length > 0 && !ok ? ' (routed, but CLI did not complete cleanly)' : ''}\n${detail}`);
  }
  mock.kill();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} CLI integration cases passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch(error => { console.error(error); process.exit(1); });
