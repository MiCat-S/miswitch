import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readdir, unlink } from 'node:fs/promises';
import { z } from 'zod';
import { patchProvider, claudeEnvKeys, jsonObject, asJson, managedFingerprint } from './adapters';
import { PENDING_MESSAGE, PublicError } from './errors';
import { atomicWrite, ensureDirectory, hash, readText, replaceText, syncDirectory, withLocks } from './files';
import type { Paths } from './paths';
import { appSchema, providerSchema, type AppId, type BackupInfo, type Hub, type PendingInfo, type Provider, type ProviderInput, type Snapshot } from './types';

type Entry = { path: string; before: string | null; after: string | null };
type Journal = { version: 1; id: string; app: AppId; createdAt: string; entries: Entry[] };
type Backup = { version: 1; info: BackupInfo; entries: Entry[] };
const uuid = z.string().uuid();
// A pending id is the journal UUID, or the SHA-256 of pending.json when the file cannot be parsed.
const pendingId = z.string().regex(/^[a-f0-9-]{36}$|^[a-f0-9]{64}$/);
const apps: AppId[] = ['claude', 'chatgpt', 'pi'];

export class Manager {
  private hubPath: string;
  private journalPath: string;
  private backupDir: string;
  constructor(private paths: Paths, private env: NodeJS.ProcessEnv = process.env, private retention = 10, private write: typeof replaceText = replaceText) {
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
    for (const [app, record] of Object.entries(hub.active)) {
      appSchema.parse(app);
      z.object({ providerId: uuid, appliedAt: z.string().datetime(), fingerprint: z.string().optional(), hashes: z.record(z.string(), z.string()) }).parse(record);
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
  private parseJournal(raw: string): Journal {
    const j = z.object({ version: z.literal(1), id: uuid, app: appSchema, createdAt: z.string().datetime(), entries: z.unknown() }).parse(this.decode(raw));
    return { ...j, entries: this.validateEntries(j.entries, true) };
  }
  private targetsOf(journal: Journal): string[] { return journal.entries.filter(e => e.path !== this.hubPath).map(e => e.path); }
  // Rolls back entries that still hold our own bytes. Conflicting files are skipped or rejected; the journal is removed afterwards.
  private async rollback(journal: Journal, current: (string | null)[], check: () => void, skipConflicts: boolean): Promise<void> {
    for (let i = journal.entries.length - 1; i >= 0; i--) {
      check();
      const e = journal.entries[i];
      if (current[i] === e.before) continue;
      if (current[i] !== e.after) { if (skipConflicts) continue; throw new PublicError(PENDING_MESSAGE); }
      await replaceText(e.path, e.before, current[i]);
    }
    await unlink(this.journalPath); await syncDirectory(this.paths.data);
  }
  // Recovery rolls incomplete transactions back. An external edit is reported, never overwritten.
  private async recover(check: () => void): Promise<PendingInfo | null> {
    const raw = await readText(this.journalPath);
    if (raw === null) return null;
    let journal: Journal;
    try { journal = this.parseJournal(raw); }
    catch { return { id: hash(raw), app: null, createdAt: null, paths: [], conflicts: [], valid: false }; }
    return withLocks(this.targetsOf(journal), async targetCheck => {
      const current = await Promise.all(journal.entries.map(e => readText(e.path)));
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
    const backup: Backup = { version: 1, info: { id: journal.id, app, createdAt: journal.createdAt, files: targets.map(e => basename(e.path)) }, entries: targets };
    await ensureDirectory(this.backupDir);
    await atomicWrite(join(this.backupDir, `${journal.id}.json`), this.encode(backup), null);
    await atomicWrite(this.journalPath, this.encode(journal), null);
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
    await this.prune().catch(() => undefined);
  }
  // A malformed backup is skipped and reported; it must not block every other operation.
  private async backups(): Promise<{ list: Backup[]; skipped: string[] }> {
    await ensureDirectory(this.backupDir);
    const names = (await readdir(this.backupDir)).filter(n => /^[a-f0-9-]{36}\.json$/.test(n));
    const list: Backup[] = [];
    const skipped: string[] = [];
    for (const name of names) {
      try {
        const raw = await readText(join(this.backupDir, name));
        if (!raw) throw new Error('empty');
        const b = z.object({ version: z.literal(1), info: z.object({ id: uuid, app: appSchema, createdAt: z.string().datetime(), files: z.array(z.string()) }), entries: z.unknown() }).parse(this.decode(raw));
        if (`${b.info.id}.json` !== name) throw new Error('id mismatch');
        const entries = this.validateEntries(b.entries, false);
        if (entries.some(e => !this.paths.targets[b.info.app].includes(e.path))) throw new Error('app mismatch');
        list.push({ ...b, entries });
      } catch { skipped.push(name); }
    }
    return { list: list.sort((a, b) => b.info.createdAt.localeCompare(a.info.createdAt)), skipped: skipped.sort() };
  }
  private async prune(): Promise<void> {
    const { list } = await this.backups();
    for (const app of apps) {
      for (const b of list.filter(b => b.info.app === app).slice(this.retention)) await unlink(join(this.backupDir, `${b.info.id}.json`));
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
      const bytesMatch = !!record && !unreadable && paths.every((path, i) => record.hashes[path] === hash(originals[i]));
      const current = unreadable ? null : managedFingerprint(app, originals);
      const written = !!record && record.fingerprint !== undefined && current !== null && hash(current) === record.fingerprint;
      const state = !record ? 'none' as const : written ? 'written' as const : 'drift' as const;
      const warnings: string[] = ['配置写入仅保证文件同步；运行中会话、项目配置与管理员策略可能覆盖选择。'];
      if (unreadable) warnings.push('部分配置无法读取，请检查符号链接、文件类型和目录权限。');
      if (state === 'written' && !bytesMatch) warnings.push('目标文件已被其他程序重写（例如 CLI 自行保存设置），但本工具管理的字段未变。');
      if (state === 'drift') warnings.push('本工具管理的字段已被外部修改，或文件无法解析；重新启用会先备份再覆盖这些字段。');
      const variables = app === 'claude' ? [...claudeEnvKeys, 'ANTHROPIC_PROFILE', 'ANTHROPIC_FEDERATION_RULE_ID', 'CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST'] : app === 'chatgpt' ? ['OPENAI_API_KEY', 'OPENAI_BASE_URL'] : ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'];
      const present = variables.filter(key => this.env[key]);
      if (present.length) warnings.push(`本进程检测到环境变量：${present.join('、')}。其他终端环境需单独检查。`);
      if (app === 'claude') warnings.push('官方登录由 Claude Code 管理，请运行 /status 验证；API Key 首次使用可能需要 CLI 批准。');
      if (app === 'chatgpt') warnings.push('API 模式按 cc-switch 模板写入 model_providers.custom 与 experimental_bearer_token，密钥明文保存在 config.toml；auth.json 只备份不改写，恢复备份会一并恢复当时的登录凭据。');
      return { app, paths, initialized: originals.some(s => s !== null), state, reformatted: state === 'written' && !bytesMatch, warnings };
    }));
    const { list, skipped } = await this.backups();
    const warnings = skipped.length ? [`有 ${skipped.length} 个备份文件无法解析，已跳过：${skipped.join('、')}`] : [];
    return { providers: hub.providers.map(({ apiKey, ...p }) => ({ ...p, hasKey: !!apiKey })), active: hub.active, diagnostics, backups: list.map(b => b.info), pending, warnings };
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
      // Editing metadata does not write target files; clear the indicator until explicit activation.
      if (hub.active[input.app]?.providerId === id) delete hub.active[input.app];
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
        const before = await Promise.all(paths.map(readText));
        const key = provider.apiKey;
        if (provider.mode === 'api' && !key) throw new PublicError('API 密钥不可用');
        const after = patchProvider(provider, before, key);
        // Stored as a hash: the fingerprint text contains the key, and `active` is returned to the renderer.
        const fingerprint = managedFingerprint(provider.app, after);
        if (fingerprint === null) throw new PublicError('切换后的配置验证失败');
        hub.active[provider.app] = { providerId: id, appliedAt: new Date().toISOString(), fingerprint: hash(fingerprint), hashes: Object.fromEntries(paths.map((path, i) => [path, hash(after[i])])) };
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
      const backup = (await this.backups()).list.find(b => b.info.id === id);
      if (!backup) throw new PublicError('备份不存在');
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
  // Resolves a conflicting journal: files still holding our own bytes are rolled back, external edits are left untouched.
  // The id must match what the last snapshot reported so the user confirms the exact journal they inspected.
  async resolveJournal(id: string): Promise<Snapshot> {
    pendingId.parse(id);
    return withLocks([this.hubPath], async check => {
      const raw = await readText(this.journalPath);
      if (raw === null) throw new PublicError('没有待决日志');
      let journal: Journal | null = null;
      try { journal = this.parseJournal(raw); } catch { journal = null; }
      if ((journal ? journal.id : hash(raw)) !== id) throw new PublicError('待决日志已变化，请刷新后重试');
      if (!journal) { await unlink(this.journalPath); await syncDirectory(this.paths.data); return this.snapshotUnlocked(); }
      const valid = journal;
      await withLocks(this.targetsOf(valid), async targetCheck => {
        const current = await Promise.all(valid.entries.map(e => readText(e.path)));
        await this.rollback(valid, current, () => { check(); targetCheck(); }, true);
      });
      return this.snapshotUnlocked();
    });
  }
}
