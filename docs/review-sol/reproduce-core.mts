// Run: ./node_modules/.bin/tsx docs/review-sol/reproduce-core.mts
// Public Manager API, synthetic keys, explicit temporary homes; no real CLI configuration is read.
import assert from 'node:assert/strict';
import { mkdtemp, realpath, mkdir, writeFile, readFile, rm, symlink, readdir, utimes, lstat, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Manager } from '../../src/core/manager.ts';
import { resolvePaths } from '../../src/core/paths.ts';
import { patchProvider } from '../../src/core/adapters.ts';
import { replaceText, readText } from '../../src/core/files.ts';
import { providerSchema, type AppId } from '../../src/core/types.ts';

const repo = resolve(import.meta.dirname, '../..');
const root = await realpath(await mkdtemp(join(tmpdir(), 'miswitch-sol-core-')));
const put = async (path: string, text: string) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text); };
const input = (app: AppId = 'claude', extra = {}) => ({ app, name: 'Synthetic review', mode: 'api' as const, baseUrl: 'https://gateway.example/v1', model: 'review-main', protocol: app === 'claude' ? 'anthropic-messages' as const : 'openai-responses' as const, apiKey: 'sk-sol-synthetic-only', ...extra });
const fixture = (name: string, retention = 10, write = replaceText) => {
  const paths = resolvePaths(join(root, name, 'store'), join(root, name, 'home'), {});
  return { paths, manager: new Manager(paths, {}, retention, write) };
};
async function saved(manager: Manager, value = input()) {
  const s = await manager.save(value); return s.providers.at(-1)!;
}
async function stored(paths: ReturnType<typeof resolvePaths>) {
  return JSON.parse(await readFile(join(paths.data, 'hub.json'), 'utf8')).providers.at(-1);
}
const pass = (label: string, detail: unknown) => console.log(`${label}: ${JSON.stringify(detail)}`);

try {
  // Load the actual baseline into an OS temp directory, resolving only repository dependencies.
  const base = join(root, 'baseline');
  for (const file of ['manager', 'adapters', 'types', 'files', 'paths', 'errors']) {
    await put(join(base, 'src/core', `${file}.ts`), execFileSync('git', ['show', `37e2673:src/core/${file}.ts`], { cwd: repo, encoding: 'utf8' }));
  }
  await put(join(base, 'package.json'), '{"type":"module"}');
  await symlink(join(repo, 'node_modules'), join(base, 'node_modules'), 'dir');
  const { Manager: BaselineManager } = await import(pathToFileURL(join(base, 'src/core/manager.ts')).href);

  // R3: fields ignored by the selected adapter branch nevertheless alter the definition hash.
  for (const [app, original, edit] of [
    ['claude', input('claude'), { loginProvider: 'openai' }],
    ['chatgpt', input('chatgpt'), { claudeAuth: 'bearer' }],
    ['chatgpt', input('chatgpt', { mode: 'login', apiKey: undefined }), { name: 'Renamed login' }],
    ['pi', input('pi'), { loginProvider: 'openai' }]
  ] as const) {
    const f = fixture(`definition-${app}-${edit.name ?? Object.keys(edit)[0]}`);
    const p = await saved(f.manager, original as any); await f.manager.activate(p.id);
    const beforeProvider = await stored(f.paths);
    const originals = await Promise.all(f.paths.targets[app].map(p => readText(p)));
    const s = await f.manager.save({ ...original, ...edit, id: p.id } as any);
    const afterProvider = await stored(f.paths);
    assert.deepEqual(patchProvider(beforeProvider, originals, beforeProvider.apiKey), patchProvider(afterProvider, originals, afterProvider.apiKey));
    assert.equal(s.diagnostics.find(d => d.app === app)!.edited, true);
    pass('R3 false edited', { app, edit, identicalOutput: true });
  }

  // R4: a real baseline write leaves the two newly managed keys in place.
  const upgrade = fixture('upgrade');
  const old = new BaselineManager(upgrade.paths, {});
  await put(upgrade.paths.targets.claude[0], JSON.stringify({ env: { ANTHROPIC_SMALL_FAST_MODEL: 'old-small', ANTHROPIC_DEFAULT_FABLE_MODEL: 'old-fable' } }));
  const p = await saved(old); await old.activate(p.id);
  const bytes = await readText(upgrade.paths.targets.claude[0]);
  assert.equal((await old.snapshot()).diagnostics[0].state, 'written');
  const newDiagnosis = (await upgrade.manager.snapshot()).diagnostics[0];
  assert.equal(newDiagnosis.state, 'drift'); assert.equal(await readText(upgrade.paths.targets.claude[0]), bytes);
  pass('R4 unchanged upgrade', { state: newDiagnosis.state, sameBytes: true });

  // R2: existing sorting has no tie breaker. Fix the clock to model equal createdAt timestamps.
  // A deterministic old UUID sorts ahead of a newly generated UUID on this filesystem.
  for (const retention of [1, 10]) {
  const tie = fixture(`timestamp-tie-${retention}`, retention);
  const tieProvider = await saved(tie.manager);
  const id = '00000000-0000-4000-8000-000000000001';
  const stamp = '2026-10-12T00:00:00.000Z';
  const precious = '{"model":"external-model","env":{"ANTHROPIC_API_KEY":"sk-synthetic-tie-state-only"}}\n';
  await put(tie.paths.targets.claude[0], precious);
  for (let i = 1; i <= retention; i++) {
    const oldId = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    await put(join(tie.paths.data, 'backups', `${oldId}.json`), JSON.stringify({ version: 1, info: { id: oldId, app: 'claude', createdAt: stamp, files: ['settings.json'] }, entries: [{ path: tie.paths.targets.claude[0], before: JSON.stringify({ older: i }), after: null }] }));
  }
  const RealDate = Date;
  class FixedDate extends RealDate { constructor(value?: any) { super(value ?? stamp); } static now() { return new RealDate(stamp).getTime(); } }
  let tied;
  try { globalThis.Date = FixedDate as DateConstructor; tied = await tie.manager.activate(tieProvider.id); }
  finally { globalThis.Date = RealDate; }
  assert.equal(tied.backups.length, retention); assert.equal(tied.backups[0].id, id);
  const remaining = await readdir(join(tie.paths.data, 'backups'));
  const surviving = await Promise.all(remaining.map(n => readFile(join(tie.paths.data, 'backups', n), 'utf8')));
  assert.ok(surviving.every(s => JSON.parse(s).entries[0].before !== precious));
  assert.ok(surviving.every(s => !s.includes('sk-synthetic-tie-state-only')));
  assert.ok(!(await readText(tie.paths.targets.claude[0]))!.includes('sk-synthetic-tie-state-only'));
  pass('R2 equal timestamp prune', { remaining: remaining.length, recoverablePreciousState: false, retention });
  }

  // Duplicate validation and downgrade compatibility are intentional fail-closed behavior.
  const dup = fixture('duplicate'); const dp = await saved(dup.manager); const ds = await dup.manager.activate(dp.id);
  const hubPath = join(dup.paths.data, 'hub.json'); const hub = JSON.parse(await readFile(hubPath, 'utf8'));
  hub.providers.push({ ...hub.providers[0], name: 'Conflicting copy', model: 'other' });
  await put(hubPath, JSON.stringify(hub));
  await assert.rejects(() => dup.manager.snapshot(), /重复/);
  await assert.rejects(() => dup.manager.restore(ds.backups[0].id), /重复/);
  pass('duplicate Hub', { snapshotRejected: true, restoreRejected: true });
  const down = fixture('downgrade'); await saved(down.manager, input('claude', { smallFastModel: 'review-small' }));
  await assert.rejects(() => new BaselineManager(down.paths, {}).snapshot());
  pass('downgrade', { baselineRejectsSmallFastModel: true });

  // Positive controls: same size and restored mtime still invalidate through ctime; another Manager prunes safely.
  const cache = fixture('cache', 2); const cp = await saved(cache.manager);
  await cache.manager.activate(cp.id); let cs = await cache.manager.activate(cp.id);
  const selected = cs.backups[0].id; const selectedPath = join(cache.paths.data, 'backups', `${selected}.json`);
  const stat = await lstat(selectedPath); const archive = await readFile(selectedPath, 'utf8');
  // Normalize to a whole-second mtime first, so utimes can restore the EXACT mtimeNs on this filesystem.
  const fixedMtime = new Date(Math.floor(stat.mtimeMs / 1000) * 1000);
  await utimes(selectedPath, stat.atime, fixedMtime); await cache.manager.snapshot();
  const versionBefore = await lstat(selectedPath, { bigint: true });
  assert.ok(archive.includes('review-main'));
  await writeFile(selectedPath, archive.replaceAll('review-main', 'review-xxxx')); await utimes(selectedPath, stat.atime, fixedMtime);
  const versionAfter = await lstat(selectedPath, { bigint: true });
  assert.equal(versionBefore.size, versionAfter.size); assert.equal(versionBefore.mtimeNs, versionAfter.mtimeNs);
  assert.notEqual(versionBefore.ctimeNs, versionAfter.ctimeNs);
  const beforeRestore = JSON.parse(await readFile(selectedPath, 'utf8')).entries[0].before;
  await cache.manager.restore(selected); assert.equal(await readText(cache.paths.targets.claude[0]), beforeRestore);
  await writeFile(selectedPath, '!'.repeat(Buffer.byteLength(archive))); await utimes(selectedPath, stat.atime, fixedMtime);
  cs = await cache.manager.snapshot(); assert.ok(!cs.backups.some(b => b.id === selected)); assert.ok(cs.warnings.length);
  // Atomic replacement by another writer must invalidate a cached-invalid entry through the inode.
  const replacement = `${selectedPath}.replacement`;
  await writeFile(replacement, archive); await utimes(replacement, stat.atime, fixedMtime);
  const corruptInode = (await lstat(selectedPath, { bigint: true })).ino;
  await rename(replacement, selectedPath);
  assert.notEqual((await lstat(selectedPath, { bigint: true })).ino, corruptInode);
  cs = await cache.manager.snapshot(); assert.ok(cs.backups.some(b => b.id === selected));
  await rm(selectedPath); const second = new Manager(cache.paths, {}, 2);
  await second.activate(cp.id); await second.activate(cp.id);
  const s1 = await cache.manager.snapshot(); const s2 = await second.snapshot(); assert.deepEqual(s1.backups, s2.backups);
  // Symlinks, directories and FIFOs are skipped without being followed or blocked on.
  for (const [i, kind] of ['symlink', 'directory', 'fifo'].entries()) {
    const abnormal = join(cache.paths.data, 'backups', `00000000-0000-4000-8000-${String(i + 100).padStart(12, '0')}.json`);
    if (kind === 'symlink') await symlink(cache.paths.targets.claude[0], abnormal);
    if (kind === 'directory') await mkdir(abnormal);
    if (kind === 'fifo') execFileSync('mkfifo', [abnormal]);
  }
  assert.ok((await cache.manager.snapshot()).warnings[0].includes('3 个'));
  pass('cache controls', { restoredFromFreshBytes: true, sameSizeMtimeCorruptionDetected: true, atomicReplacementDetected: true, managersAgree: true, abnormalFilesSkipped: 3 });

  // Positive controls: deleted or damaged dedup candidate causes a replacement backup; skipped transaction rollback.
  let fail = false;
  const rollback = fixture('rollback', 10, async (...args) => { if (fail && args[0].endsWith('hub.json')) throw new Error('synthetic failure'); return replaceText(...args); });
  const a = await saved(rollback.manager); const b = await saved(rollback.manager, input('claude', { name: 'B', model: 'review-other' }));
  await rollback.manager.activate(a.id); let rs = await rollback.manager.activate(a.id);
  const newest = rs.backups[0].id; const current = await readText(rollback.paths.targets.claude[0]);
  fail = true; await assert.rejects(() => rollback.manager.activate(b.id), /synthetic/); fail = false;
  assert.equal(await readText(rollback.paths.targets.claude[0]), current); assert.equal((await rollback.manager.snapshot()).pending, null);
  assert.equal((await rollback.manager.snapshot()).backups.length, 2);
  await rm(join(rollback.paths.data, 'backups', `${newest}.json`)); rs = await rollback.manager.activate(a.id);
  assert.equal(rs.backups.length, 2);
  await put(join(rollback.paths.data, 'backups', `${rs.backups[0].id}.json`), '{broken'); rs = await rollback.manager.activate(a.id);
  assert.equal(rs.backups.length, 2); assert.ok(rs.warnings.length);
  pass('dedup controls', { skippedRollbackRestored: true, deletedCandidateReplaced: true, corruptCandidateReplaced: true });

  assert.equal(providerSchema.parse(input('claude', { smallFastModel: ' small ' })).smallFastModel, 'small');
  for (const smallFastModel of ['', '   ']) assert.equal(providerSchema.safeParse(input('claude', { smallFastModel })).success, false);
  assert.equal(providerSchema.safeParse(input('pi', { smallFastModel: 'small' })).success, false);
  assert.equal(providerSchema.safeParse(input('claude', { mode: 'login', smallFastModel: 'small' })).success, false);
  pass('smallFastModel schema', { trimmed: true, blankRejected: true, otherAppAndLoginRejected: true });
} finally { await rm(root, { recursive: true, force: true }); }
