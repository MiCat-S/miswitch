// Run: ./node_modules/.bin/tsx docs/review-sol/reproduce-cache-race.mts
// Deterministic scheduling at the filesystem boundary, not a Manager private-method override.
// Simulates an external writer corrupting a newly renamed backup before fileVersion() stats it.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Manager } from '../../src/core/manager.ts';
import { resolvePaths } from '../../src/core/paths.ts';

const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'miswitch-sol-race-')));
const paths = resolvePaths(join(root, 'store'), join(root, 'home'), {});
const manager = new Manager(paths, {});
const originalLstat = fs.lstat;
let altered: string | undefined;
try {
  const input = { app: 'claude' as const, name: 'A', mode: 'api' as const, baseUrl: 'https://review.example', apiKey: 'sk-synthetic-only', model: 'review-a', protocol: 'anthropic-messages' as const };
  const a = (await manager.save(input)).providers[0];
  await manager.activate(a.id); // Backup of the missing file, retained as a control.
  // A newly edited key is also manually synchronized into the isolated target. Re-activation is a
  // target no-op, so the poisoned before digest will still match on the following switch to B.
  const uniqueKey = 'sk-synthetic-key-known-only-to-new-A';
  await manager.save({ ...input, id: a.id, apiKey: uniqueKey });
  const settings = JSON.parse(await fs.readFile(paths.targets.claude[0], 'utf8'));
  settings.env.ANTHROPIC_API_KEY = uniqueKey;
  await fs.writeFile(paths.targets.claude[0], JSON.stringify(settings, null, 2) + '\n');
  const originalBytes = await fs.readFile(paths.targets.claude[0], 'utf8');
  // The next backup should be the only one capable of restoring A's written bytes.
  fs.lstat = (async (path: any, options: any) => {
    const s = await originalLstat(path, options);
    // fileVersion's bigint stat is the first stat after rename of this new backup.
    if (!altered && options?.bigint && String(path).includes('/backups/') && s.isFile()) {
      const contents = await fs.readFile(path, 'utf8');
      if (JSON.parse(contents).entries[0].before === originalBytes) {
        altered = String(path);
        await fs.writeFile(path, '{broken-by-synthetic-external-writer');
        // Return the real version of the changed bytes, exactly as lstat would after that interleaving.
        return originalLstat(path, options);
      }
    }
    return s;
  }) as typeof fs.lstat;
  syncBuiltinESMExports();
  const created = await manager.activate(a.id);
  fs.lstat = originalLstat; syncBuiltinESMExports();
  assert.ok(altered); assert.equal(created.backups.length, 2); assert.deepEqual(created.warnings, []);
  const staleId = created.backups[0].id;
  const b = (await manager.save({ ...input, name: 'B', model: 'review-b' })).providers.find(p => p.name === 'B')!;
  const switched = await manager.activate(b.id);
  assert.equal(switched.backups.length, 2); assert.deepEqual(switched.warnings, []);
  assert.ok(switched.backups.some(x => x.id === staleId));
  await manager.remove(a.id); // Supported after switching away; backups should retain the removed key.
  const fresh = await new Manager(paths, {}).snapshot();
  assert.equal(fresh.backups.length, 1); assert.equal(fresh.warnings.length, 1);
  await assert.rejects(() => manager.restore(staleId), /变化或无法解析/);
  const names = await fs.readdir(join(paths.data, 'backups'));
  const archives = await Promise.all(names.map(n => fs.readFile(join(paths.data, 'backups', n), 'utf8').then(t => { try { return JSON.parse(t); } catch { return null; } })));
  assert.ok(archives.every(b => !b || b.entries[0].before !== originalBytes));
  assert.ok(archives.every(b => !b || !JSON.stringify(b).includes(uniqueKey)));
  assert.ok(!(await fs.readFile(paths.targets.claude[0], 'utf8')).includes(uniqueKey));
  assert.ok(!(await fs.readFile(join(paths.data, 'hub.json'), 'utf8')).includes(uniqueKey));
  console.log(JSON.stringify({ injectedAt: 'rename -> fileVersion lstat', cachedBackups: switched.backups.length, freshBackups: fresh.backups.length, warningsInCachedManager: switched.warnings.length, restoreRejected: true, recoverablePreSwitchState: false }));
} finally {
  fs.lstat = originalLstat; syncBuiltinESMExports();
  await fs.rm(root, { recursive: true, force: true });
}
