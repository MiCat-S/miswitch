import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, unlink, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import lockfile from 'proper-lockfile';
import { PublicError } from './errors';

export const hash = (text: string | null) => text === null ? 'missing' : createHash('sha256').update(text).digest('hex');
// Target configuration files and the Hub are bounded by TARGET_LIMIT. Backups and journals aggregate
// before/after text of several targets, so they get their own larger bound. transaction() checks every
// output against these limits before touching any file, so everything we write can be read back.
export const TARGET_LIMIT = 8 * 1024 * 1024;
export const ARCHIVE_LIMIT = 128 * 1024 * 1024;
export const byteLength = (text: string | null) => text === null ? 0 : Buffer.byteLength(text, 'utf8');
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

export async function rejectSymlinks(path: string): Promise<void> {
  let current = resolve(path);
  for (;;) {
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) throw new PublicError('拒绝写入符号链接；请使用实际配置目录');
      if (current === resolve(path) && !stat.isFile() && !stat.isDirectory()) throw new PublicError('配置路径不是普通文件或目录');
    } catch (error) { if (!missing(error)) throw error; }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
export async function ensureDirectory(path: string): Promise<void> {
  await rejectSymlinks(path);
  await mkdir(path, { recursive: true, mode: 0o700 });
  await rejectSymlinks(path);
}
export async function readText(path: string, limit = TARGET_LIMIT): Promise<string | null> {
  await rejectSymlinks(path);
  try {
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > limit) throw new PublicError(limit === TARGET_LIMIT ? '配置不是普通文件，或超过 8 MiB 限制' : '备份或恢复日志不是普通文件，或超过 128 MiB 限制');
      return await file.readFile('utf8');
    } finally { await file.close(); }
  } catch (error) { if (missing(error)) return null; throw error; }
}
export async function syncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') return;
  const dir = await open(path, constants.O_RDONLY);
  try { await dir.sync(); } finally { await dir.close(); }
}
export async function atomicWrite(path: string, text: string, expected?: string | null): Promise<void> {
  await ensureDirectory(dirname(path));
  const temporary = `${path}.miswitch-${randomUUID()}.tmp`;
  const file = await open(temporary, 'wx', 0o600);
  try {
    try { await file.writeFile(text, 'utf8'); await file.sync(); }
    finally { await file.close(); }
    if (expected !== undefined && await readText(path) !== expected) throw new PublicError('配置被其他进程修改；已停止切换');
    await rejectSymlinks(path);
    await rename(temporary, path);
    await syncDirectory(dirname(path));
  } finally { await unlink(temporary).catch(error => { if (!missing(error)) throw error; }); }
}
export async function replaceText(path: string, text: string | null, expected: string | null): Promise<void> {
  if (text !== null) return atomicWrite(path, text, expected);
  if (await readText(path) !== expected) throw new PublicError('恢复时检测到外部修改；保留恢复日志');
  if (expected !== null) { await unlink(path); await syncDirectory(dirname(path)); }
}
// Same proper-lockfile convention as Pi's auth storage. File creation is not required.
export async function withLocks<T>(paths: string[], fn: (check: () => void) => Promise<T>): Promise<T> {
  const releases: (() => Promise<void>)[] = [];
  let compromised = false;
  const check = () => { if (compromised) throw new PublicError('文件锁已失效；操作停止'); };
  try {
    for (const path of [...new Set(paths)].sort()) {
      await ensureDirectory(dirname(path));
      await rejectSymlinks(path);
      releases.push(await lockfile.lock(path, {
        realpath: false, retries: { retries: 8, minTimeout: 50, maxTimeout: 200 },
        stale: 30_000, update: 5_000, onCompromised: () => { compromised = true; }
      }));
    }
    check();
    return await fn(check);
  } finally {
    const results = await Promise.allSettled(releases.reverse().map(release => release()));
    if (results.some(r => r.status === 'rejected')) compromised = true;
  }
}
// Test fixtures can canonicalize OS temp roots (macOS /var is a symlink).
export const canonicalDirectory = async (path: string) => realpath(path);
