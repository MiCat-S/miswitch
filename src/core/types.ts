import { z } from 'zod';

export const appSchema = z.enum(['claude', 'chatgpt', 'pi']);
export type AppId = z.infer<typeof appSchema>;
export const providerSchema = z.object({
  id: z.string().uuid().optional(), app: appSchema,
  name: z.string().trim().min(1).max(100),
  mode: z.enum(['api', 'login']),
  baseUrl: z.string().trim().max(2048).default(''),
  model: z.string().trim().min(1).max(200),
  protocol: z.enum(['anthropic-messages', 'openai-responses', 'openai-completions']),
  claudeAuth: z.enum(['api-key', 'bearer']).default('api-key'),
  loginProvider: z.string().regex(/^[a-zA-Z0-9_-]+$/).max(100).default('anthropic'),
  notes: z.string().max(2000).default(''),
  // Codex only: written as model_context_window / model_auto_compact_token_limit.
  contextWindow: z.number().int().positive().max(100_000_000).optional(),
  autoCompactTokenLimit: z.number().int().positive().max(100_000_000).optional(),
  apiKey: z.string().max(8192).optional()
}).strict().superRefine((p, ctx) => {
  // These messages are static and are forwarded to the UI by publicError().
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (p.mode === 'api') {
    try {
      const url = new URL(p.baseUrl);
      const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if (!(url.protocol === 'https:' || (url.protocol === 'http:' && loopback))) issue('Base URL 必须为 HTTPS，或本机 HTTP 地址');
      if (url.username || url.password || url.search || url.hash) issue('Base URL 不得含账号、查询参数或片段');
    } catch { issue('Base URL 格式无效'); }
    if (p.app === 'claude' && p.protocol !== 'anthropic-messages') issue('Claude Code 需要 Anthropic Messages 协议');
    if (p.app === 'chatgpt' && p.protocol !== 'openai-responses') issue('Codex 需要 OpenAI Responses 协议');
    if (p.apiKey && (/\s/.test(p.apiKey) || /^[!$]/.test(p.apiKey))) issue('API Key 必须为字面密钥，不得含空白或命令/环境变量表达式');
  }
  if (p.app !== 'chatgpt' && (p.contextWindow !== undefined || p.autoCompactTokenLimit !== undefined)) issue('上下文窗口与自动压缩阈值仅适用于 Codex');
  if (p.contextWindow !== undefined && p.autoCompactTokenLimit !== undefined && p.autoCompactTokenLimit > p.contextWindow) issue('自动压缩阈值不能大于上下文窗口');
});
export type ProviderInput = z.input<typeof providerSchema>;
export type Provider = Omit<z.output<typeof providerSchema>, 'apiKey' | 'id'> & { id: string; apiKey?: string; updatedAt: string };
export type PublicProvider = Omit<Provider, 'apiKey'> & { hasKey: boolean };
// `fingerprint` hashes only the fields this tool manages; `hashes` are the exact bytes written.
export type ActiveRecord = { providerId: string; appliedAt: string; fingerprint?: string; hashes: Record<string, string> };
export type Hub = { version: 1; providers: Provider[]; active: Partial<Record<AppId, ActiveRecord>> };
// written: managed fields still equal the last write. reformatted: bytes differ but managed fields do not.
export type Diagnosis = { app: AppId; paths: string[]; initialized: boolean; state: 'none' | 'written' | 'drift'; reformatted: boolean; warnings: string[] };
export type BackupInfo = { id: string; app: AppId; createdAt: string; files: string[] };
// A journal whose target files were changed by someone else. `valid` is false when pending.json itself cannot be parsed.
export type PendingInfo = { id: string; app: AppId | null; createdAt: string | null; paths: string[]; conflicts: string[]; valid: boolean };
export type Snapshot = { providers: PublicProvider[]; active: Hub['active']; diagnostics: Diagnosis[]; backups: BackupInfo[]; pending: PendingInfo | null; warnings: string[] };
export interface Bridge {
  snapshot(): Promise<Snapshot>;
  save(input: ProviderInput): Promise<Snapshot>;
  remove(id: string): Promise<Snapshot>;
  activate(id: string): Promise<Snapshot>;
  restore(id: string): Promise<Snapshot>;
  resolveJournal(id: string): Promise<Snapshot>;
}
