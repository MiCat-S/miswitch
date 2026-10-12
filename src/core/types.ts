import { z } from 'zod';

export const appSchema = z.enum(['claude', 'chatgpt', 'pi']);
export type AppId = z.infer<typeof appSchema>;
export const protocolSchema = z.enum(['anthropic-messages', 'openai-responses', 'openai-completions']);
// Values Codex 0.162 accepts for model_reasoning_effort; support also depends on the model.
export const reasoningEfforts = ['minimal', 'low', 'medium', 'high', 'xhigh'] as const;
// Static messages; shared by provider validation and the model list request, which sends the key to this URL.
export function baseUrlIssues(value: string): string[] {
  try {
    const url = new URL(value);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    const issues: string[] = [];
    if (!(url.protocol === 'https:' || (url.protocol === 'http:' && loopback))) issues.push('Base URL 必须为 HTTPS，或本机 HTTP 地址');
    if (url.username || url.password || url.search || url.hash) issues.push('Base URL 不得含账号、查询参数或片段');
    return issues;
  } catch { return ['Base URL 格式无效']; }
}
// Vendor marks the interface can show for a provider; `letter` forces the initial. Unset means automatic.
export const vendorIcons = ['claude', 'anthropic', 'openai', 'codex', 'deepseek', 'kimi', 'zhipu', 'zai', 'minimax', 'qwen', 'doubao', 'volcengine', 'mimo', 'qianfan', 'openrouter', 'siliconflow'] as const;
export type VendorIcon = typeof vendorIcons[number];
export const providerIcons = [...vendorIcons, 'letter'] as const;
export type ProviderIcon = typeof providerIcons[number];
const aliasModel = z.string().trim().min(1).max(200).optional();
export const providerSchema = z.object({
  id: z.string().uuid().optional(), app: appSchema,
  name: z.string().trim().min(1).max(100),
  mode: z.enum(['api', 'login']),
  baseUrl: z.string().trim().max(2048).default(''),
  model: z.string().trim().min(1).max(200),
  protocol: protocolSchema,
  claudeAuth: z.enum(['api-key', 'bearer']).default('api-key'),
  loginProvider: z.string().regex(/^[a-zA-Z0-9_-]+$/).max(100).default('anthropic'),
  notes: z.string().max(2000).default(''),
  // Display only: never written to a target file and not part of what a switch compares.
  icon: z.enum(providerIcons).optional(),
  // Claude API mode only: model alias routes. The haiku route also serves background tasks.
  smallFastModel: aliasModel,
  sonnetModel: aliasModel,
  opusModel: aliasModel,
  fableModel: aliasModel,
  // Codex only: written as model_reasoning_effort when set; an unset value leaves the file's own value.
  reasoningEffort: z.enum(reasoningEfforts).optional(),
  // Codex only: written as model_context_window / model_auto_compact_token_limit.
  contextWindow: z.number().int().positive().max(100_000_000).optional(),
  autoCompactTokenLimit: z.number().int().positive().max(100_000_000).optional(),
  apiKey: z.string().max(8192).optional()
}).strict().superRefine((p, ctx) => {
  // These messages are static and are forwarded to the UI by publicError().
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (p.mode === 'api') {
    baseUrlIssues(p.baseUrl).forEach(issue);
    if (p.app === 'claude' && p.protocol !== 'anthropic-messages') issue('Claude Code 需要 Anthropic Messages 协议');
    if (p.app === 'chatgpt' && p.protocol !== 'openai-responses') issue('Codex 需要 OpenAI Responses 协议');
    if (p.apiKey && (/\s/.test(p.apiKey) || /^[!$]/.test(p.apiKey))) issue('API Key 必须为字面密钥，不得含空白或命令/环境变量表达式');
  }
  if ([p.smallFastModel, p.sonnetModel, p.opusModel, p.fableModel].some(m => m !== undefined) && (p.app !== 'claude' || p.mode !== 'api')) issue('模型别名映射仅适用于 Claude Code 的 API 模式');
  if (p.reasoningEffort !== undefined && p.app !== 'chatgpt') issue('推理强度仅适用于 Codex');
  if (p.app !== 'chatgpt' && (p.contextWindow !== undefined || p.autoCompactTokenLimit !== undefined)) issue('上下文窗口与自动压缩阈值仅适用于 Codex');
  if (p.contextWindow !== undefined && p.autoCompactTokenLimit !== undefined && p.autoCompactTokenLimit > p.contextWindow) issue('自动压缩阈值不能大于上下文窗口');
});
export type ProviderInput = z.input<typeof providerSchema>;
export type Provider = Omit<z.output<typeof providerSchema>, 'apiKey' | 'id'> & { id: string; apiKey?: string; updatedAt: string };
export type PublicProvider = Omit<Provider, 'apiKey'> & { hasKey: boolean };
// `fingerprint` hashes only the fields this tool manages; `hashes` are the exact bytes written;
// `definition` hashes the provider fields that reach a target file, as they were when written.
// `rules` is the managed-field rule set both hashes were computed with; absent means rule set 1.
export type ActiveRecord = { providerId: string; appliedAt: string; rules?: number; fingerprint?: string; definition?: string; hashes: Record<string, string> };
// `imported` records when each app's local configuration was imported, so the automatic import runs once.
export type Hub = { version: 1; providers: Provider[]; active: Partial<Record<AppId, ActiveRecord>>; imported?: Partial<Record<AppId, string>> };
// written: managed fields still equal the last write. reformatted: bytes differ but managed fields do not.
// edited: the active provider was edited after it was written, so the target still holds the old settings.
export type Diagnosis = { app: AppId; paths: string[]; initialized: boolean; state: 'none' | 'written' | 'drift'; reformatted: boolean; edited: boolean; warnings: string[] };
// `sequence` orders backups across all apps; createdAt only has millisecond resolution and follows the clock.
// Backups written before it existed have none and sort as the oldest.
export type BackupInfo = { id: string; app: AppId; createdAt: string; sequence?: number; files: string[] };
// A journal whose target files were changed by someone else. `valid` is false when pending.json itself cannot be parsed.
export type PendingInfo = { id: string; app: AppId | null; createdAt: string | null; paths: string[]; conflicts: string[]; valid: boolean };
// The renderer only needs which provider is active; the hashes stay in the main process.
export type Snapshot = { providers: PublicProvider[]; active: Partial<Record<AppId, Pick<ActiveRecord, 'providerId' | 'appliedAt'>>>; diagnostics: Diagnosis[]; backups: BackupInfo[]; pending: PendingInfo | null; warnings: string[]; home: string };
// Fetches the provider's model IDs. An empty apiKey with providerId uses that provider's saved key.
export const modelListRequestSchema = z.object({
  app: appSchema, baseUrl: z.string().trim().max(2048), protocol: protocolSchema,
  claudeAuth: z.enum(['api-key', 'bearer']).default('api-key'),
  apiKey: z.string().max(8192).optional(), providerId: z.string().uuid().optional()
}).strict();
export type ModelListRequest = z.input<typeof modelListRequestSchema>;
export type ModelList = { models: string[]; url: string };
// Form values as text, for projecting a draft onto a configuration file and reading it back. Empty clears a field.
const draftText = z.string().max(8192).optional();
export const configDraftSchema = z.object({
  name: draftText, mode: z.enum(['api', 'login']).optional(), baseUrl: draftText, apiKey: draftText, claudeAuth: z.enum(['api-key', 'bearer']).optional(),
  loginProvider: draftText, model: draftText, smallFastModel: draftText, sonnetModel: draftText, opusModel: draftText, fableModel: draftText,
  contextWindow: draftText, autoCompactTokenLimit: draftText, reasoningEffort: draftText
}).strict();
export type ConfigDraft = z.infer<typeof configDraftSchema>;
export const configViewRequestSchema = z.object({ app: appSchema, draft: configDraftSchema, providerId: z.string().uuid().optional() }).strict();
export type ConfigViewRequest = z.input<typeof configViewRequestSchema>;
// `base` (global settings only) digests the global part of the file when it was read; a save compares it.
export type ConfigView = { name: string; path: string; format: 'json' | 'toml'; text?: string; base?: string; error?: string };
export const globalEditSchema = z.object({ app: appSchema, text: z.string().max(8 * 1024 * 1024), base: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type GlobalEdit = z.input<typeof globalEditSchema>;
export interface Bridge {
  snapshot(): Promise<Snapshot>;
  save(input: ProviderInput, options?: { activate?: boolean }): Promise<Snapshot>;
  remove(id: string): Promise<Snapshot>;
  activate(id: string): Promise<Snapshot>;
  restore(id: string): Promise<Snapshot>;
  resolveJournal(id: string): Promise<Snapshot>;
  importLive(app?: AppId): Promise<Snapshot>;
  listModels(request: ModelListRequest): Promise<ModelList>;
  configView(request: ConfigViewRequest): Promise<ConfigView>;
  globalView(app: AppId): Promise<ConfigView>;
  saveGlobal(request: GlobalEdit): Promise<Snapshot>;
  // Called when providers change outside the window, e.g. from the menu bar.
  onChanged(listener: () => void): () => void;
}
