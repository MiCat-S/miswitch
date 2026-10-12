import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { lstat, readdir, unlink } from 'node:fs/promises';
import { z } from 'zod';
import { patchProvider, claudeEnvKeys, jsonObject, asJson, managedFingerprint, providerDefinition, liveProvider, RULES } from './adapters';
import { PENDING_MESSAGE, PublicError, publicError } from './errors';
import { ARCHIVE_LIMIT, TARGET_LIMIT, atomicWrite, byteLength, ensureDirectory, hash, readText, replaceText, syncDirectory, withLocks } from './files';
import type { Paths } from './paths';
import { appSchema, providerSchema, type AppId, type BackupInfo, type Hub, type PendingInfo, type Provider, type ProviderInput, type Snapshot } from './types';

type Entry = { path: string; before: string | null; after: string | null };
type Journal = { version: 1; id: string; app: AppId; createdAt: string; entries: Entry[] };
type Backup = { version: 1; info: BackupInfo; entries: Entry[] };
// What listing a backup yields. `digest` covers what a restore would write: each target's path and before text.
type BackupMeta = { info: BackupInfo; digest: string };
const backupDigest = (entries: Entry[]) => hash(JSON.stringify([...entries].sort((a, b) => a.path < b.path ? -1 : 1).map(e => [e.path, e.before])));
// Newest first. The sequence decides; the timestamp only orders backups written before sequences existed.
const newestFirst = (a: BackupMeta, b: BackupMeta) => (b.info.sequence ?? 0) - (a.info.sequence ?? 0) || b.info.createdAt.localeCompare(a.info.createdAt) || b.info.id.localeCompare(a.info.id);
const uuid = z.string().uuid();
// A pending id is the journal UUID, or the SHA-256 of pending.json when the file cannot be parsed.
const pendingId = z.string().regex(/^[a-f0-9-]{36}$|^[a-f0-9]{64}$|^unreadable$/);
const unreadable = Symbol('unreadable');
const invalidArchive = Symbol('invalid-archive');
const apps: AppId[] = ['claude', 'chatgpt', 'pi'];
const labels: Record<AppId, string> = { claude: 'Claude Code', chatgpt: 'Codex', pi: 'Pi' };

export class Manager {
  private hubPath: string;
  private journalPath: string;
  private backupDir: string;
  // Listing parses each backup file once per version (device, inode, size, mtime, ctime). Only metadata read from
  // that same version is cached; skipping a backup and restoring one both re-read the file itself.
  private backupCache = new Map<string, { version: string; meta: BackupMeta | null }>();
  // `write` replaces target files and `read` loads backups and the journal; tests substitute both to inject failures and observe I/O.
  constructor(private paths: Paths, private env: NodeJS.ProcessEnv = process.env, private retention = 10, private write: typeof replaceText = replaceText, private read: typeof readText = readText) {
    this.hubPath = join(paths.data, 'hub.json');
    this.journalPath = join(paths.data, 'pending.json');
    this.backupDir = join(paths.data, 'backups');
    const all = [this.hubPath, ...Object.values(paths.targets).flat()];
    if (new Set(all).size !== all.length) throw new PublicError('配置路径不能重叠');
    if (!Number.isInteger(retention) || retention < 1 || retention > 100) throw new PublicError('备份保留数必须为 1–100');
  }
  private async readHub(): Promise<Hub> {
    const raw = await readText(this.hubPath);
    if (raw === null) return { version: 1, providers: [], active: {} };
    const hub = jsonObject(raw) as Hub;
    if (hub.version !== 1 || !Array.isArray(hub.providers) || !hub.active || typeof hub.active !== 'object' || Array.isArray(hub.active)) throw new PublicError('Hub 版本或格式无效');
    for (const p of hub.providers) {
      const { apiKey, updatedAt, ...input } = p;
      uuid.parse(input.id); providerSchema.parse({ ...input, apiKey }); z.string().datetime().parse(updatedAt);
      if (apiKey !== undefined) z.string().parse(apiKey);
    }
    if (hub.imported !== undefined) z.partialRecord(appSchema, z.string().datetime()).parse(hub.imported);
    if (new Set(hub.providers.map(p => p.id)).size !== hub.providers.length) throw new PublicError('Hub 包含重复的配置 ID；请先备份 hub.json，再手动删除或改正重复项');
    for (const [app, record] of Object.entries(hub.active)) {
      appSchema.parse(app);
      z.object({ providerId: uuid, appliedAt: z.string().datetime(), rules: z.number().int().positive().optional(), fingerprint: z.string().optional(), definition: z.string().optional(), hashes: z.record(z.string(), z.string()) }).parse(record);
    }
    return hub;
  }
  private encode(value: unknown): string { return asJson(value); }
  private decode(text: string): unknown { return JSON.parse(text); }
  private validateEntries(value: unknown, allowHub: boolean): Entry[] {
    const entries = z.array(z.object({ path: z.string(), before: z.string().nullable(), after: z.string().nullable() }).strict()).max(4).parse(value);
    const allowed = new Set([...Object.values(this.paths.targets).flat(), ...(allowHub ? [this.hubPath] : [])]);
    if (new Set(entries.map(e => e.path)).size !== entries.length || entries.some(e => !allowed.has(e.path))) throw new PublicError('恢复日志包含未授权路径');
    return entries;
  }
  // A backup must hold the complete file set of its app. Older backups written before a target was
  // added are accepted only through the explicit legacy sets below; any other subset is rejected,
  // because restoring part of a multi-file configuration can leave the CLI pointing at nothing.
  private static legacySets: Partial<Record<AppId, string[][]>> = { chatgpt: [['config.toml']] };
  private validateBackupSet(app: AppId, entries: Entry[]): void {
    const names = entries.map(e => basename(e.path)).sort();
    const full = this.paths.targets[app].map(p => basename(p)).sort();
    const same = (a: string[], b: string[]) => a.length === b.length && a.every((n, i) => n === b[i]);
    if (entries.some(e => !this.paths.targets[app].includes(e.path))) throw new PublicError('备份应用与路径不符');
    if (same(names, full) || (Manager.legacySets[app] ?? []).some(set => same(names, [...set].sort()))) return;
    throw new PublicError('备份文件集合不完整');
  }
  private readArchive(path: string): Promise<string | null> { return this.read(path, ARCHIVE_LIMIT); }
  private parseJournal(raw: string): Journal {
    const j = z.object({ version: z.literal(1), id: uuid, app: appSchema, createdAt: z.string().datetime(), entries: z.unknown() }).parse(this.decode(raw));
    return { ...j, entries: this.validateEntries(j.entries, true) };
  }
  private targetsOf(journal: Journal): string[] { return journal.entries.filter(e => e.path !== this.hubPath).map(e => e.path); }
  // Rolls back entries that still hold our own bytes. Conflicting files are skipped or rejected; the journal is removed afterwards.
  private async rollback(journal: Journal, current: (string | null | typeof unreadable)[], check: () => void, skipConflicts: boolean): Promise<void> {
    for (let i = journal.entries.length - 1; i >= 0; i--) {
      check();
      const e = journal.entries[i];
      const now = current[i];
      if (now === e.before) continue;
      if (now === unreadable || now !== e.after) { if (skipConflicts) continue; throw new PublicError(PENDING_MESSAGE); }
      await replaceText(e.path, e.before, now);
    }
    await unlink(this.journalPath); await syncDirectory(this.paths.data);
  }
  // Recovery rolls incomplete transactions back. An external edit is reported, never overwritten.
  // Files that cannot be read (symlinked, oversized, wrong type) are treated as conflicts, never rolled back.
  private readCurrent(entries: Entry[]): Promise<(string | null | typeof unreadable)[]> {
    return Promise.all(entries.map(e => readText(e.path).catch((): typeof unreadable => unreadable)));
  }
  private async recover(check: () => void): Promise<PendingInfo | null> {
    const raw = await this.readArchive(this.journalPath).catch(() => invalidArchive);
    if (raw === null) return null;
    let journal: Journal;
    try { journal = this.parseJournal(raw as string); }
    catch { return { id: raw === invalidArchive ? 'unreadable' : hash(raw as string), app: null, createdAt: null, paths: [], conflicts: [], valid: false }; }
    return withLocks(this.targetsOf(journal), async targetCheck => {
      const current = await this.readCurrent(journal.entries);
      const conflicts = journal.entries.filter((e, i) => current[i] !== e.before && current[i] !== e.after).map(e => e.path);
      if (conflicts.length) return { id: journal.id, app: journal.app, createdAt: journal.createdAt, paths: this.targetsOf(journal), conflicts, valid: true };
      await this.rollback(journal, current, () => { check(); targetCheck(); }, false);
      return null;
    });
  }
  // Mutations refuse to run while a conflicting journal exists; snapshot() reports it instead so the UI can offer a resolution.
  private async exclusive<T>(fn: (check: () => void, pending: PendingInfo | null) => Promise<T>, tolerant = false): Promise<T> {
    return withLocks([this.hubPath], async check => {
      const pending = await this.recover(check);
      if (pending && !tolerant) throw new PublicError(PENDING_MESSAGE);
      return fn(check, pending);
    });
  }
  private async transaction(app: AppId, entries: Entry[], check: () => void): Promise<void> {
    const journal: Journal = { version: 1, id: randomUUID(), app, createdAt: new Date().toISOString(), entries };
    const targets = entries.filter(e => e.path !== this.hubPath);
    const { list } = await this.backups();
    const sequence = Math.max(0, ...list.map(b => b.info.sequence ?? 0)) + 1;
    const info: BackupInfo = { id: journal.id, app, createdAt: journal.createdAt, sequence, files: targets.map(e => basename(e.path)) };
    const backup: Backup = { version: 1, info, entries: targets };
    // Every output is bounded before anything is written, so the verify, rollback and recovery reads cannot fail on size.
    if (entries.some(e => byteLength(e.after) > TARGET_LIMIT)) throw new PublicError('切换后的配置超过 8 MiB 限制；已停止，未修改任何文件');
    const encodedBackup = this.encode(backup);
    const encodedJournal = this.encode(journal);
    if (byteLength(encodedBackup) > ARCHIVE_LIMIT || byteLength(encodedJournal) > ARCHIVE_LIMIT) throw new PublicError('备份或恢复日志超过 128 MiB 限制；已停止，未修改任何文件');
    // Re-activating the same configuration would back up the same before texts again and push distinct history
    // out of the retention window. A newest backup with the same digest is only a candidate: it is read again,
    // so a file changed or damaged since it was listed never stands in for the backup this switch needs.
    const digest = backupDigest(targets);
    const newest = list.find(b => b.info.app === app);
    const covered = newest?.digest === digest && await this.readBackup(`${newest.info.id}.json`).then(b => backupDigest(b.entries) === digest, () => false);
    if (!covered) await atomicWrite(join(this.backupDir, `${journal.id}.json`), encodedBackup, null);
    await atomicWrite(this.journalPath, encodedJournal, null);
    try {
      // Unchanged entries (e.g. Codex auth.json) stay locked, backed up and verified but are not rewritten.
      for (const e of entries) { check(); if (e.after !== e.before) await this.write(e.path, e.after, e.before); }
      // Verify before declaring the transaction committed.
      for (const e of entries) if (await readText(e.path) !== e.after) throw new PublicError('切换后的配置验证失败');
      check();
      await unlink(this.journalPath); await syncDirectory(this.paths.data);
    } catch (error) {
      // We already hold target locks. Only roll back our own exact written bytes.
      let conflict = false;
      for (const e of [...entries].reverse()) {
        try {
          const now = await readText(e.path);
          if (now === e.before) continue;
          if (now !== e.after) { conflict = true; continue; }
          check(); await replaceText(e.path, e.before, now);
        } catch { conflict = true; }
      }
      if (!conflict) { await unlink(this.journalPath); await syncDirectory(this.paths.data); }
      throw error;
    }
    // Retention is housekeeping after commit; it cannot turn a successful switch into a failure.
    await this.prune(covered ? undefined : journal.id).catch(() => undefined);
  }
  private async fileVersion(path: string): Promise<string> {
    const s = await lstat(path, { bigint: true });
    return `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
  }
  private async readBackup(name: string): Promise<Backup> {
    const raw = await this.readArchive(join(this.backupDir, name));
    if (!raw) throw new Error('empty');
    const b = z.object({ version: z.literal(1), info: z.object({ id: uuid, app: appSchema, createdAt: z.string().datetime(), sequence: z.number().int().positive().optional(), files: z.array(z.string()) }), entries: z.unknown() }).parse(this.decode(raw));
    if (`${b.info.id}.json` !== name) throw new Error('id mismatch');
    const entries = this.validateEntries(b.entries, false);
    this.validateBackupSet(b.info.app, entries);
    if (!entries.every(e => b.info.files.includes(basename(e.path)))) throw new Error('files mismatch');
    return { ...b, entries };
  }
  // A malformed backup is skipped and reported; it must not block every other operation.
  private async backups(): Promise<{ list: BackupMeta[]; skipped: string[] }> {
    await ensureDirectory(this.backupDir);
    const names = (await readdir(this.backupDir)).filter(n => /^[a-f0-9-]{36}\.json$/.test(n));
    for (const name of this.backupCache.keys()) if (!names.includes(name)) this.backupCache.delete(name);
    const list: BackupMeta[] = [];
    const skipped: string[] = [];
    for (const name of names) {
      const path = join(this.backupDir, name);
      const version = await this.fileVersion(path).catch(() => null);
      const cached = this.backupCache.get(name);
      let meta = version !== null && cached?.version === version ? cached.meta : undefined;
      if (meta === undefined) {
        meta = await this.readBackup(name).then(b => ({ info: b.info, digest: backupDigest(b.entries) }), () => null);
        // Cached only when the file kept one version across the read, so the metadata belongs to that version.
        if (version !== null && version === await this.fileVersion(path).catch(() => null)) this.backupCache.set(name, { version, meta });
        else this.backupCache.delete(name);
      }
      if (meta) list.push(meta); else skipped.push(name);
    }
    return { list: list.sort(newestFirst), skipped: skipped.sort() };
  }
  // `keep` is the backup the current transaction wrote; it is never a deletion candidate.
  private async prune(keep?: string): Promise<void> {
    const { list } = await this.backups();
    for (const app of apps) {
      const own = list.filter(b => b.info.app === app);
      for (const b of [...own.filter(b => b.info.id === keep), ...own.filter(b => b.info.id !== keep)].slice(this.retention)) {
        await unlink(join(this.backupDir, `${b.info.id}.json`)); this.backupCache.delete(`${b.info.id}.json`);
      }
    }
    await syncDirectory(this.backupDir);
  }
  private async snapshotUnlocked(pending: PendingInfo | null = null): Promise<Snapshot> {
    const hub = await this.readHub();
    const diagnostics = await Promise.all(apps.map(async app => {
      const paths = this.paths.targets[app];
      let unreadable = false;
      const originals = await Promise.all(paths.map(async path => {
        try { return await readText(path); } catch { unreadable = true; return null; }
      }));
      const record = hub.active[app];
      // Records written before fingerprints (or before a target was added) only know the bytes they wrote.
      // They are judged by those bytes alone; a missing schema field is not evidence of external edits.
      const legacy = !!record && record.fingerprint === undefined;
      const bytesMatch = !!record && !unreadable && paths.every((path, i) => legacy && !(path in record.hashes) ? true : record.hashes[path] === hash(originals[i]));
      const rules = record?.rules ?? 1;
      const current = unreadable ? null : managedFingerprint(app, originals, rules);
      const written = !!record && (legacy ? bytesMatch : current !== null && hash(current) === record.fingerprint);
      const state = !record ? 'none' as const : written ? 'written' as const : 'drift' as const;
      // Records without `definition` were written by versions that cleared the record on every edit.
      const provider = record && hub.providers.find(p => p.id === record.providerId);
      const edited = !!record?.definition && !!provider && hash(providerDefinition(provider, rules)) !== record.definition;
      // Judged under its own rule set, an older record is not drift; it only lacks the newer clean-up.
      const outdated = state === 'written' && !legacy && rules < RULES && current !== managedFingerprint(app, originals);
      const warnings: string[] = ['配置写入仅保证文件同步；运行中会话、项目配置与管理员策略可能覆盖选择。'];
      if (unreadable) warnings.push('部分配置无法读取，请检查符号链接、文件类型和目录权限。');
      if (legacy) warnings.push('当前写入记录来自旧版本，按原文逐字节比较；重新启用后改为字段级判定。');
      if (state === 'written' && !bytesMatch) warnings.push('目标文件已被其他程序重写（例如 CLI 自行保存设置），但本工具管理的字段未变。');
      if (state === 'drift') warnings.push('本工具管理的字段已被外部修改，或文件无法解析；重新启用会先备份再覆盖这些字段。');
      if (outdated) warnings.push('当前写入记录来自旧版本，文件中仍有新版本会清理的模型路由（例如 ANTHROPIC_SMALL_FAST_MODEL）；重新写入后按新规则清理。');
      if (edited) warnings.push('当前配置在写入后已被编辑，目标文件仍是编辑前的设置；点击“重新写入”后生效。');
      const variables = app === 'claude' ? [...claudeEnvKeys, 'ANTHROPIC_PROFILE', 'ANTHROPIC_FEDERATION_RULE_ID', 'CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST'] : app === 'chatgpt' ? ['OPENAI_API_KEY', 'OPENAI_BASE_URL'] : ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'];
      const present = variables.filter(key => this.env[key]);
      if (present.length) warnings.push(`本进程检测到环境变量：${present.join('、')}。其他终端环境需单独检查。`);
      if (app === 'claude') warnings.push('官方登录由 Claude Code 管理，请运行 /status 验证；API Key 首次使用可能需要 CLI 批准。');
      if (app === 'chatgpt') warnings.push('API 模式按 cc-switch 模板写入 model_providers.custom 与 experimental_bearer_token，密钥明文保存在 config.toml；auth.json 只备份不改写，恢复备份会一并恢复当时的登录凭据。');
      return { app, paths, initialized: originals.some(s => s !== null), state, reformatted: state === 'written' && !bytesMatch, edited, warnings };
    }));
    const { list, skipped } = await this.backups();
    const warnings = skipped.length ? [`有 ${skipped.length} 个备份文件无法解析，已跳过：${skipped.join('、')}`] : [];
    const active = Object.fromEntries(Object.entries(hub.active).map(([app, r]) => [app, { providerId: r!.providerId, appliedAt: r!.appliedAt }]));
    return { providers: hub.providers.map(({ apiKey, ...p }) => ({ ...p, hasKey: !!apiKey })), active, diagnostics, backups: list.map(b => b.info), pending, warnings };
  }
  snapshot(): Promise<Snapshot> { return this.exclusive((_check, pending) => this.snapshotUnlocked(pending), true); }
  async save(raw: ProviderInput): Promise<Snapshot> {
    const input = providerSchema.parse(raw);
    return this.exclusive(async check => {
      const before = await readText(this.hubPath);
      const hub = await this.readHub();
      const id = input.id ?? randomUUID();
      const old = hub.providers.find(p => p.id === id);
      if (input.id && !old) throw new PublicError('配置不存在');
      if (old && old.app !== input.app) throw new PublicError('不能跨应用修改配置');
      // Editing does not write target files. The record stays because the target still holds what was
      // written, which also keeps the provider undeletable; snapshot() reports the edit by comparing definitions.
      const record = hub.active[input.app];
      if (old && record?.providerId === id && record.definition === undefined) record.definition = hash(providerDefinition(old, record.rules ?? 1));
      const { apiKey, ...rest } = input;
      const storedKey = input.mode === 'login' ? undefined : apiKey || old?.apiKey;
      if (input.mode === 'api' && !storedKey) throw new PublicError('API 模式需要密钥');
      const provider: Provider = { ...rest, id, apiKey: storedKey, updatedAt: new Date().toISOString() };
      hub.providers = [...hub.providers.filter(p => p.id !== id), provider];
      check(); await atomicWrite(this.hubPath, asJson(hub), before);
      return this.snapshotUnlocked();
    });
  }
  async remove(id: string): Promise<Snapshot> {
    uuid.parse(id);
    return this.exclusive(async check => {
      const before = await readText(this.hubPath);
      const hub = await this.readHub();
      if (Object.values(hub.active).some(a => a?.providerId === id)) throw new PublicError('请先切换到另一配置再删除当前配置');
      if (!hub.providers.some(p => p.id === id)) throw new PublicError('配置不存在');
      hub.providers = hub.providers.filter(p => p.id !== id);
      check(); await atomicWrite(this.hubPath, asJson(hub), before);
      return this.snapshotUnlocked();
    });
  }
  async activate(id: string): Promise<Snapshot> {
    uuid.parse(id);
    return this.exclusive(async hubCheck => {
      const beforeHub = await readText(this.hubPath);
      const hub = await this.readHub();
      const provider = hub.providers.find(p => p.id === id);
      if (!provider) throw new PublicError('配置不存在');
      const paths = this.paths.targets[provider.app];
      await withLocks(paths, async targetCheck => {
        const before = await Promise.all(paths.map(path => readText(path)));
        const key = provider.apiKey;
        if (provider.mode === 'api' && !key) throw new PublicError('API 密钥不可用');
        const after = patchProvider(provider, before, key);
        // Stored as a hash: the fingerprint text contains the key.
        const fingerprint = managedFingerprint(provider.app, after);
        if (fingerprint === null) throw new PublicError('切换后的配置验证失败');
        hub.active[provider.app] = { providerId: id, appliedAt: new Date().toISOString(), rules: RULES, fingerprint: hash(fingerprint), definition: hash(providerDefinition(provider)), hashes: Object.fromEntries(paths.map((path, i) => [path, hash(after[i])])) };
        const entries = paths.map((path, i) => ({ path, before: before[i], after: after[i] }));
        entries.push({ path: this.hubPath, before: beforeHub, after: asJson(hub) });
        await this.transaction(provider.app, entries, () => { hubCheck(); targetCheck(); });
      });
      return this.snapshotUnlocked();
    });
  }
  async restore(id: string): Promise<Snapshot> {
    uuid.parse(id);
    return this.exclusive(async hubCheck => {
      if (!(await this.backups()).list.some(b => b.info.id === id)) throw new PublicError('备份不存在');
      // The list holds metadata only; the chosen file is read and validated again before use.
      const backup = await this.readBackup(`${id}.json`).catch(() => { throw new PublicError('备份文件已变化或无法解析，请刷新后重试'); });
      await withLocks(backup.entries.map(e => e.path), async targetCheck => {
        const beforeHub = await readText(this.hubPath);
        const hub = await this.readHub();
        delete hub.active[backup.info.app];
        const entries = await Promise.all(backup.entries.map(async e => ({ path: e.path, before: await readText(e.path), after: e.before })));
        entries.push({ path: this.hubPath, before: beforeHub, after: asJson(hub) });
        await this.transaction(backup.info.app, entries, () => { hubCheck(); targetCheck(); });
      });
      return this.snapshotUnlocked();
    });
  }
  // Adopts what each CLI is configured with now as the first provider of that app. Without `app` it runs once per
  // app, for apps without providers; with `app` it is the explicit import from the empty list. Target files are only
  // read. An import that writing back would leave every managed field unchanged is recorded as the active provider.
  async importLive(app?: AppId): Promise<Snapshot> {
    if (app !== undefined) appSchema.parse(app);
    return this.exclusive(async (check, pending) => {
      if (pending) return this.snapshotUnlocked(pending);
      const before = await readText(this.hubPath);
      const hub = await this.readHub();
      const now = new Date().toISOString();
      const notices: string[] = [];
      let changed = false;
      for (const target of app ? [app] : apps) {
        if (!app && (hub.imported?.[target] || hub.providers.some(p => p.app === target))) continue;
        const paths = this.paths.targets[target];
        const originals = await Promise.all(paths.map(path => readText(path))).catch(() => null);
        if (!originals) { notices.push(`${labels[target]} 的本机配置无法读取，未导入`); continue; }
        if (originals.every(text => text === null)) { if (app) notices.push(`没有找到 ${labels[target]} 的本机配置`); continue; }
        hub.imported = { ...hub.imported, [target]: now }; changed = true;
        let input: ProviderInput | null;
        try { input = liveProvider(target, originals); } catch { input = null; }
        if (!input) { notices.push(`${labels[target]} 的本机配置无法表示为配置项（例如未设置模型或使用了环境变量密钥），未导入`); continue; }
        const parsed = providerSchema.safeParse(input);
        if (!parsed.success) { notices.push(`${labels[target]} 的本机配置未导入：${publicError(parsed.error)}`); continue; }
        const { apiKey, ...rest } = parsed.data;
        const provider: Provider = { ...rest, id: randomUUID(), apiKey: rest.mode === 'api' ? apiKey : undefined, updatedAt: now };
        hub.providers.push(provider);
        if (hub.active[target]) continue;
        try {
          const current = managedFingerprint(target, originals);
          const after = patchProvider(provider, originals, provider.apiKey);
          if (current !== null && managedFingerprint(target, after) === current) {
            hub.active[target] = { providerId: provider.id, appliedAt: now, rules: RULES, fingerprint: hash(current), definition: hash(providerDefinition(provider)), hashes: Object.fromEntries(paths.map((path, i) => [path, hash(originals[i])])) };
          }
        } catch { /* Not representable as written (e.g. a Pi provider that no longer exists): imported but not active. */ }
      }
      if (changed) { check(); await atomicWrite(this.hubPath, asJson(hub), before); }
      const snapshot = await this.snapshotUnlocked();
      return { ...snapshot, warnings: [...notices, ...snapshot.warnings] };
    }, true);
  }
  // Resolves a conflicting journal: files still holding our own bytes are rolled back, external edits are left untouched.
  // The id must match what the last snapshot reported so the user confirms the exact journal they inspected.
  async resolveJournal(id: string): Promise<Snapshot> {
    pendingId.parse(id);
    return withLocks([this.hubPath], async check => {
      const raw = await this.readArchive(this.journalPath).catch(() => invalidArchive);
      if (raw === null) throw new PublicError('没有待决日志');
      let journal: Journal | null = null;
      try { journal = this.parseJournal(raw as string); } catch { journal = null; }
      const actual = journal ? journal.id : raw === invalidArchive ? 'unreadable' : hash(raw as string);
      if (actual !== id) throw new PublicError('待决日志已变化，请刷新后重试');
      if (!journal) { await unlink(this.journalPath); await syncDirectory(this.paths.data); return this.snapshotUnlocked(); }
      const valid = journal;
      await withLocks(this.targetsOf(valid), async targetCheck => {
        const current = await this.readCurrent(valid.entries);
        await this.rollback(valid, current, () => { check(); targetCheck(); }, true);
      });
      return this.snapshotUnlocked();
    });
  }
}
