// The provider editor's view of a CLI configuration file. Following cc-switch's key-field model, every file is
// split into the provider's fields, which this tool writes on switch, and everything else, which is a global
// setting of the CLI: edited in place, written on save, and never stored per provider.
import TOML from '@iarna/toml';
import { asJson, canonical, claudeEnvKeys, codexRouteId, patchProvider } from './adapters';
import { PublicError } from './errors';
import type { AppId, ConfigDraft, Provider } from './types';

const isObject = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const managedPattern = /^miswitch_[a-f0-9]{32}$/;
// Shown instead of a saved key: the renderer never receives one. Saving the text never stores it as a key.
export const SAVED_KEY_TEXT = '（已保存的密钥，此处不显示）';
// A provider that is not saved yet has no ID, so its Pi provider entry has no name yet either.
export const NEW_PI_PROVIDER_TEXT = 'miswitch_（保存后生成）';

// The one file each app's editor shows: Claude settings.json, Codex config.toml, Pi settings.json.
export const editorFile = (app: AppId) => ({ index: app === 'pi' ? 2 : 0, format: app === 'chatgpt' ? 'toml' as const : 'json' as const });

// Parse errors carry only the file name and a line number; the parser's own message can quote the content.
export function parseConfigText(app: AppId, text: string): Record<string, any> {
  const { format } = editorFile(app);
  const name = app === 'chatgpt' ? 'config.toml' : 'settings.json';
  if (format === 'toml') {
    try { return TOML.parse(text) as Record<string, any>; }
    catch (error) { const line = (error as { line?: number }).line; throw new PublicError(typeof line === 'number' ? `${name} 第 ${line + 1} 行附近 TOML 格式错误` : `${name} 不是有效的 TOML`); }
  }
  if (!text.trim()) return {};
  let value: unknown;
  try { value = JSON.parse(text.replace(/^﻿/, '')); }
  catch (error) {
    const message = String((error as Error).message);
    const line = message.match(/line (\d+)/)?.[1] ?? (message.match(/position (\d+)/) ? String(text.slice(0, Number(message.match(/position (\d+)/)![1])).split('\n').length) : undefined);
    throw new PublicError(line ? `${name} 第 ${line} 行附近 JSON 格式错误` : `${name} 不是有效的 JSON`);
  }
  if (!isObject(value)) throw new PublicError(`${name} 必须是 JSON 对象`);
  return value;
}
export const serializeConfig = (app: AppId, value: Record<string, any>) => editorFile(app).format === 'toml' ? TOML.stringify(value as TOML.JsonMap) : asJson(value);

// Top-level keys the provider owns. Codex also owns its route tables under model_providers, and Claude the env
// keys a switch clears. `profile` is owned because a switch removes it; model_reasoning_effort because the
// editor treats it as a provider field.
const ownedTop: Record<AppId, string[]> = {
  claude: ['model'],
  chatgpt: ['model', 'model_provider', 'profile', 'model_context_window', 'model_auto_compact_token_limit', 'model_reasoning_effort'],
  pi: ['defaultProvider', 'defaultModel']
};
export function splitConfig(app: AppId, value: Record<string, any>): { global: Record<string, any>; owned: Record<string, any> } {
  const global = clone(value);
  const owned: Record<string, any> = {};
  for (const key of ownedTop[app]) if (key in global) { owned[key] = global[key]; delete global[key]; }
  if (app === 'claude' && isObject(global.env)) {
    for (const key of claudeEnvKeys) if (key in global.env) { (owned.env ??= {})[key] = global.env[key]; delete global.env[key]; }
    if (Object.keys(global.env).length === 0) delete global.env;
  }
  if (app === 'chatgpt' && isObject(global.model_providers)) {
    for (const id of Object.keys(global.model_providers)) {
      if (id === codexRouteId || managedPattern.test(id)) { (owned.model_providers ??= {})[id] = global.model_providers[id]; delete global.model_providers[id]; }
    }
    if (Object.keys(global.model_providers).length === 0) delete global.model_providers;
  }
  return { global, owned };
}
export function joinConfig(global: Record<string, any>, owned: Record<string, any>): Record<string, any> {
  const result = clone(global);
  for (const [key, value] of Object.entries(owned)) {
    result[key] = isObject(value) && isObject(result[key]) ? { ...result[key], ...clone(value) } : clone(value);
  }
  return result;
}
export const globalDigest = (app: AppId, value: Record<string, any>) => canonical(splitConfig(app, value).global);

// The draft's provider fields projected onto `text`, with the same patch a switch applies.
export function composeConfig(app: AppId, text: string, draft: ConfigDraft, others: (string | null)[], provider: { id?: string; hasSavedKey: boolean }): string {
  const value = parseConfigText(app, text);
  const mode = draft.mode ?? 'api';
  if (app === 'pi') {
    value.defaultProvider = mode === 'login' ? (draft.loginProvider || 'anthropic') : provider.id ? `miswitch_${provider.id.replaceAll('-', '')}` : NEW_PI_PROVIDER_TEXT;
    value.defaultModel = draft.model ?? '';
    return serializeConfig(app, value);
  }
  const p = {
    app, id: provider.id ?? '00000000-0000-4000-8000-000000000000', name: draft.name ?? '', mode, baseUrl: draft.baseUrl ?? '', model: draft.model ?? '',
    protocol: app === 'claude' ? 'anthropic-messages' : 'openai-responses', claudeAuth: draft.claudeAuth ?? 'api-key', loginProvider: 'anthropic', notes: '', updatedAt: '',
    smallFastModel: draft.smallFastModel || undefined, sonnetModel: draft.sonnetModel || undefined, opusModel: draft.opusModel || undefined, fableModel: draft.fableModel || undefined,
    contextWindow: Number(draft.contextWindow) || undefined, autoCompactTokenLimit: Number(draft.autoCompactTokenLimit) || undefined, reasoningEffort: draft.reasoningEffort || undefined
  } as Provider;
  const key = draft.apiKey || (provider.hasSavedKey ? SAVED_KEY_TEXT : '');
  return patchProvider(p, [serializeConfig(app, value), ...others], key)[0]!;
}

// The provider fields a configuration text sets, for two-way sync with the form. Empty strings clear a field.
// `keptKey` is true when the text still carries the saved-key placeholder. Null when the text uses settings
// the form cannot represent (Claude apiKeyHelper or cloud platform routes).
export function fieldsFromConfig(app: AppId, text: string): { fields: ConfigDraft; keptKey: boolean } | null {
  const value = parseConfigText(app, text);
  const str = (v: unknown) => typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
  let keptKey = false;
  const key = (v: unknown) => { if (v === SAVED_KEY_TEXT) { keptKey = true; return undefined; } return typeof v === 'string' ? v : undefined; };
  if (app === 'claude') {
    const env = isObject(value.env) ? value.env : {};
    if (value.apiKeyHelper !== undefined || ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'].some(k => env[k])) return null;
    const token = env.ANTHROPIC_AUTH_TOKEN ?? env.ANTHROPIC_API_KEY;
    const api = token !== undefined || env.ANTHROPIC_BASE_URL !== undefined;
    const fields: ConfigDraft = { mode: api ? 'api' : 'login', model: str(env.ANTHROPIC_MODEL) || str(value.model) };
    if (api) Object.assign(fields, {
      baseUrl: str(env.ANTHROPIC_BASE_URL), claudeAuth: env.ANTHROPIC_AUTH_TOKEN !== undefined ? 'bearer' : 'api-key', apiKey: key(token),
      smallFastModel: str(env.ANTHROPIC_DEFAULT_HAIKU_MODEL) || str(env.ANTHROPIC_SMALL_FAST_MODEL), sonnetModel: str(env.ANTHROPIC_DEFAULT_SONNET_MODEL),
      opusModel: str(env.ANTHROPIC_DEFAULT_OPUS_MODEL), fableModel: str(env.ANTHROPIC_DEFAULT_FABLE_MODEL)
    });
    return { fields, keptKey };
  }
  if (app === 'chatgpt') {
    const route = str(value.model_provider);
    const table = route && isObject(value.model_providers) && isObject(value.model_providers[route]) ? value.model_providers[route] : {};
    const fields: ConfigDraft = { mode: route ? 'api' : 'login', model: str(value.model), contextWindow: str(value.model_context_window),
      autoCompactTokenLimit: str(value.model_auto_compact_token_limit), reasoningEffort: str(value.model_reasoning_effort) };
    if (route) Object.assign(fields, { baseUrl: str(table.base_url), name: str(table.name) || undefined, apiKey: key(table.experimental_bearer_token) });
    return { fields, keptKey };
  }
  const id = str(value.defaultProvider);
  const fields: ConfigDraft = { model: str(value.defaultModel) };
  if (id && !managedPattern.test(id) && id !== NEW_PI_PROVIDER_TEXT) Object.assign(fields, { mode: 'login', loginProvider: id });
  return { fields, keptKey };
}
