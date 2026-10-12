// Run only INSIDE miswitch-cli-test; see the report's docker command.
// Actual Claude Code 2.1.296, an OS temp HOME and synthetic localhost API.
import assert from 'node:assert/strict';
import { mkdtemp, realpath, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { Manager } from '../../src/core/manager.ts';
import { resolvePaths } from '../../src/core/paths.ts';

assert.equal(process.platform, 'linux', 'Use the pinned disposable test container');
const version = execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim();
assert.ok(version.startsWith('2.1.296 '));
const root = await realpath(await mkdtemp(join(tmpdir(), 'miswitch-sol-claude-')));
const home = join(root, 'home'); await mkdir(home);
const paths = resolvePaths(join(root, 'store'), home, {});
const log = join(root, 'requests.jsonl');
const mock = spawn(process.execPath, ['/app/tests/container/mock-server.mjs', '8877', log], { stdio: ['ignore', 'pipe', 'pipe'] });
let running: ReturnType<typeof spawn> | undefined;
try {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('mock readiness timeout')), 10000);
    mock.stdout!.once('data', () => { clearTimeout(timer); resolve(); });
    mock.once('error', error => { clearTimeout(timer); reject(error); });
  });
  // Verify a retained DEFAULT_MODEL does not override the model written by this adapter.
  await mkdir(join(home, '.claude'));
  await writeFile(paths.targets.claude[0], JSON.stringify({ env: { ANTHROPIC_DEFAULT_MODEL: 'stale-default', CLAUDE_CODE_SUBAGENT_MODEL: 'stale-subagent' } }));
  const manager = new Manager(paths, {});
  const p = (await manager.save({ app: 'claude', name: 'Review', mode: 'api', baseUrl: 'http://127.0.0.1:8877', model: 'review-main', smallFastModel: 'review-small', protocol: 'anthropic-messages', apiKey: 'sk-synthetic-only' })).providers[0];
  await manager.activate(p.id);
  await writeFile(join(home, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, customApiKeyResponses: { approved: ['sk-synthetic-only'], rejected: [] } }));
  for (const [args, expected] of [[[], 'review-main'], [['--model', 'haiku'], 'review-small']] as const) {
    const before = await readFile(log, 'utf8').catch(() => '');
    const result = await new Promise<{ code: number | null; timeout: boolean }>((resolve, reject) => {
      running = spawn('claude', ['-p', ...args, 'Reply with ok', '--output-format', 'text'], { cwd: root, env: { PATH: process.env.PATH, HOME: home, TERM: 'dumb', CI: '1', NO_COLOR: '1', DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1' }, stdio: ['ignore', 'ignore', 'ignore'] });
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; running?.kill('SIGKILL'); }, 60000);
      running.once('error', error => { clearTimeout(timer); reject(error); });
      running.once('close', code => { clearTimeout(timer); resolve({ code, timeout: timedOut }); });
    });
    assert.equal(result.code, 0); assert.equal(result.timeout, false);
    const requests = (await readFile(log, 'utf8')).slice(before.length).trim().split('\n').filter(Boolean).map(t => JSON.parse(t));
    assert.ok(requests.some(r => r.path === '/v1/messages' && r.model === expected && r.xApiKey === 'sk-synthetic-only'));
    console.log(JSON.stringify({ version, args, expected, observedModels: requests.filter(r => r.path === '/v1/messages').map(r => r.model), exit: result.code }));
  }
  // Inspect the actual pinned executable's embedded implementation, keeping code excerpts small.
  // This is STATIC evidence for background routing, not a executed background-task assertion.
  const binary = await readFile('/usr/local/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe');
  const text = binary.toString('utf8');
  const helper = text.match(/function xw\(\)\{.{0,900}?function i3e/)[0];
  assert.ok(helper.includes('a.ANTHROPIC_SMALL_FAST_MODEL'));
  assert.ok(helper.includes('a.ANTHROPIC_DEFAULT_HAIKU_MODEL!==void 0?fv(iz())'));
  assert.ok(text.includes('function iz(){let e=a.ANTHROPIC_DEFAULT_HAIKU_MODEL;'));
  assert.ok(text.includes('function jte(){let e=a.CLAUDE_CODE_SUBAGENT_MODEL;'));
  console.log(JSON.stringify({ staticEvidence: '2.1.296 embedded xw -> iz haiku helper; jte retains explicit subagent override', liveBackgroundTaskVerified: false }));
} finally {
  running?.kill('SIGKILL'); mock.kill('SIGKILL');
  await rm(root, { recursive: true, force: true });
}
