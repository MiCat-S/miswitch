import TOML from '@iarna/toml';
import { PublicError } from './errors';
import type { AppId, Provider, ProviderInput } from './types';

export function jsonObject(text: string | null): Record<string, any> {
  const obj = text === null ? {} : JSON.parse(text.replace(/^﻿/, ''));
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new PublicError('配置必须是 JSON 对象');
  return obj;
}
const isObject = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
function objectField(obj: Record<string, any>, key: string): Record<string, any> {
  if (obj[key] === undefined) obj[key] = {};
  // `key` is always one of our own literal field names, never user data.
  if (!isObject(obj[key])) throw new PublicError(`配置字段 ${key} 必须为对象`);
  return obj[key];
}
export const asJson = (obj: unknown) => JSON.stringify(obj, null, 2) + '\n';
export const managedId = (p: Provider) => `miswitch_${p.id.replaceAll('-', '')}`;
export const codexRouteId = 'custom';
// Mirrors cc-switch's codex_auth_has_credential_login_material plus an API-key login:
// anything Codex would accept for `requires_openai_auth`.
export function codexLoginMaterial(authText: string | null): boolean {
  try {
    const auth = jsonObject(authText);
    const tokens = isObject(auth.tokens) ? auth.tokens : {};
    return [auth.OPENAI_API_KEY, auth.personal_access_token, tokens.access_token, tokens.refresh_token].some(v => typeof v === 'string' && v.length > 0);
  } catch { return false; }
}
// Pi refuses to load models.json when a custom provider has no `apiKey`, but resolves the real
// key from auth.json first (verified against pi-coding-agent 0.73.1 in the container test).
// This literal is only a fallback marker; it is not an env var name and not a command.
export const piApiKeyPlaceholder = 'managed-by-miswitch:auth.json';
const managedPattern = /^miswitch_[a-f0-9]{32}$/;
// Model alias routes are provider-specific IDs. ANTHROPIC_SMALL_FAST_MODEL is the legacy name of the
// haiku route and is cleared the same way cc-switch does (src/components/providers/forms/hooks/useModelState.ts).
export const claudeEnvKeys = [
  'ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL', 'ANTHROPIC_SMALL_FAST_MODEL',
  'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDE_CODE_OAUTH_TOKEN'
];
// Claude Code's model alias routes in the order the editor shows them.
export const claudeAliasRoutes = (p: Pick<Provider, 'smallFastModel' | 'sonnetModel' | 'opusModel' | 'fableModel'>): [string, string | undefined][] => [
  ['ANTHROPIC_DEFAULT_HAIKU_MODEL', p.smallFastModel], ['ANTHROPIC_DEFAULT_SONNET_MODEL', p.sonnetModel],
  ['ANTHROPIC_DEFAULT_OPUS_MODEL', p.opusModel], ['ANTHROPIC_DEFAULT_FABLE_MODEL', p.fableModel]
];
// Managed-field rule sets, recorded on every active record. Rule set 1 (up to 722c119) did not manage the
// fable and legacy small/fast routes, and its definition hashed nearly the whole provider. Rule set 3 changes only
// Pi: several providers stay registered at once, so only the provider in use and the selection are managed.
// Records keep the rule set they were written with, so an upgrade alone never turns into drift or an edit.
export const RULES = 3;
const claudeEnvKeysV1 = claudeEnvKeys.filter(k => k !== 'ANTHROPIC_DEFAULT_FABLE_MODEL' && k !== 'ANTHROPIC_SMALL_FAST_MODEL');
// The provider fields patchProvider() writes for this app and mode. Any other edit leaves the target unchanged.
export function providerDefinition(p: Provider, rules = RULES): string {
  if (rules === 1) {
    // Rule set 1 predates `icon`; leaving it out keeps those hashes and keeps the icon out of what counts as an edit.
    const { notes, updatedAt, name, icon, ...rest } = p;
    return canonical(p.app === 'chatgpt' ? { ...rest, name } : rest);
  }
  const api = p.mode === 'api';
  const fields = p.app === 'claude' ? { model: p.model, ...(api ? { baseUrl: p.baseUrl, apiKey: p.apiKey, claudeAuth: p.claudeAuth, smallFastModel: p.smallFastModel, sonnetModel: p.sonnetModel, opusModel: p.opusModel, fableModel: p.fableModel } : {}) }
    : p.app === 'chatgpt' ? { model: p.model, contextWindow: p.contextWindow, autoCompactTokenLimit: p.autoCompactTokenLimit, reasoningEffort: p.reasoningEffort, ...(api ? { name: p.name, baseUrl: p.baseUrl, apiKey: p.apiKey } : {}) }
    : rules === 2 ? { model: p.model, ...(api ? { id: p.id, baseUrl: p.baseUrl, protocol: p.protocol, apiKey: p.apiKey } : { loginProvider: p.loginProvider }) }
    : { model: p.model, ...(api ? { id: piId(p), name: p.name, baseUrl: p.baseUrl, protocol: p.protocol, apiKey: p.apiKey } : { loginProvider: p.loginProvider }) };
  return canonical({ app: p.app, mode: p.mode, ...fields });
}
// Input order matches resolvePaths(). Unknown fields survive semantic merge.
// `owned` (Pi only): the IDs of every Pi API provider Mi-Switch has, so entries left by deleted ones can be removed.
export function patchProvider(p: Provider, originals: (string | null)[], key?: string, owned?: string[]): (string | null)[] {
  if (p.app === 'claude') {
    const settings = jsonObject(originals[0]);
    const env = objectField(settings, 'env');
    for (const name of claudeEnvKeys) delete env[name];
    // Refuse to silently erase user-defined dynamic authentication.
    if (settings.apiKeyHelper) throw new PublicError('检测到 apiKeyHelper；请先在 Claude Code 中处理该鉴权设置');
    settings.model = p.model;
    if (p.mode === 'api') {
      env.ANTHROPIC_BASE_URL = p.baseUrl;
      env[p.claudeAuth === 'bearer' ? 'ANTHROPIC_AUTH_TOKEN' : 'ANTHROPIC_API_KEY'] = key;
      env.ANTHROPIC_MODEL = p.model;
      // Without the haiku route, background tasks request Anthropic's default haiku ID, which gateways often lack.
      for (const [name, value] of claudeAliasRoutes(p)) if (value !== undefined) env[name] = value;
    }
    return [asJson(settings)];
  }
  if (p.app === 'chatgpt') {
    const config = TOML.parse(originals[0] ?? '') as Record<string, any>;
    // A selected profile can shadow all three root keys. Keep the profile table intact.
    delete config.profile;
    if (config.forced_login_method || config.forced_chatgpt_workspace_id) {
      throw new PublicError('检测到 Codex 登录限制；请先确认管理员策略与目标 Provider 相容');
    }
    config.model = p.model;
    // These two are managed keys: cleared on every switch, written only when the provider sets them.
    delete config.model_context_window; delete config.model_auto_compact_token_limit;
    if (p.contextWindow !== undefined) config.model_context_window = p.contextWindow;
    if (p.autoCompactTokenLimit !== undefined) config.model_auto_compact_token_limit = p.autoCompactTokenLimit;
    // A one-time default, not a managed key: Codex itself may rewrite it when the user changes the effort.
    if (p.reasoningEffort !== undefined) config.model_reasoning_effort = p.reasoningEffort;
    // cc-switch template (src-tauri/src/live/project/codex.rs): the third-party route is the fixed
    // table `model_providers.custom` with the key in `experimental_bearer_token`; the official route
    // is the absence of `model_provider`, with the table left dormant and its token removed.
    // `requires_openai_auth = true` only while auth.json holds login material. Codex 0.162 sends the
    // bearer token regardless, so auth.json itself is never rewritten.
    const providers = objectField(config, 'model_providers');
    for (const id of Object.keys(providers)) if (managedPattern.test(id)) delete providers[id];
    if (p.mode === 'api') {
      config.model_provider = codexRouteId;
      const table = { name: p.name, base_url: p.baseUrl, wire_api: 'responses' } as Record<string, unknown>;
      if (codexLoginMaterial(originals[1])) table.requires_openai_auth = true;
      table.experimental_bearer_token = key;
      providers[codexRouteId] = table;
    } else {
      delete config.model_provider;
      const custom = providers[codexRouteId];
      if (isObject(custom)) { delete custom.experimental_bearer_token; delete custom.requires_openai_auth; }
    }
    if (Object.keys(providers).length === 0) delete config.model_providers;
    return [TOML.stringify(config as TOML.JsonMap), originals[1]];
  }
  const files = readPi(originals);
  const id = piId(p);
  if (p.mode === 'login') {
    // An existing provider: a login or key in auth.json, or an entry in models.json or custom-providers.json. Used as-is.
    if (!own(files.auth, id) && !own(files.providers, id) && !own(files.relays, id)) throw new PublicError('Pi 中找不到该 Provider；请先在 Pi 中 /login，或在 models.json、custom-providers.json 中定义它');
  } else {
    writePiEntries(files, p, key ?? '', piUsesRelays(originals));
  }
  // Older versions kept a single `miswitch_` entry; ones that no longer belong to any provider are cleared away.
  if (owned) for (const store of [files.providers, files.auth]) for (const entry of Object.keys(store)) if (managedPattern.test(entry) && !owned.includes(entry)) delete store[entry];
  files.settings.defaultProvider = id;
  if (p.model) files.settings.defaultModel = p.model; else delete files.settings.defaultModel;
  return serializePi(files, originals);
}

// Pi keeps any number of providers side by side (docs/models.md, docs/providers.md, docs/configuration.md):
// credentials in auth.json keyed by provider ID, custom endpoints in models.json, and, with the pi-custom-providers
// extension, relays in custom-providers.json (no key there; it resolves through auth.json). settings.json only
// chooses the startup provider and model. Mi-Switch selects among them, and keeps the entries of the API providers
// it created itself registered all at once, so Pi's own /model lists every one of them.
export const piId = (p: Pick<Provider, 'mode' | 'loginProvider' | 'piProviderId' | 'id'>) => p.mode === 'login' ? p.loginProvider : p.piProviderId ?? `miswitch_${p.id.replaceAll('-', '')}`;
// Built-in provider IDs (docs/providers.md). A custom entry under one of these names would shadow the built-in provider.
export const piBuiltinIds = ['anthropic', 'openai', 'openai-codex', 'google', 'google-vertex', 'azure', 'amazon-bedrock', 'deepseek', 'mistral', 'groq',
  'cerebras', 'xai', 'openrouter', 'vercel-ai-gateway', 'zai', 'opencode', 'github-copilot', 'huggingface', 'fireworks', 'together', 'baseten',
  'kimi-coding', 'moonshot', 'minimax', 'meta', 'nvidia', 'radius', 'typesafe', 'xiaomi', 'qwen', 'cloudflare-ai-gateway', 'cloudflare-workers-ai'];
type PiFiles = { models: Record<string, any>; providers: Record<string, any>; auth: Record<string, any>; settings: Record<string, any>; relays: Record<string, any> | null };
// An entry the object itself holds; an inherited property such as `__proto__` never counts.
const own = (obj: unknown, id: string): boolean => isObject(obj) && Object.hasOwn(obj, id) && isObject((obj as Record<string, any>)[id]);
function readPi(originals: (string | null)[]): PiFiles {
  const models = jsonObject(originals[0] ?? null);
  return { models, providers: objectField(models, 'providers'), auth: jsonObject(originals[1] ?? null), settings: jsonObject(originals[2] ?? null),
    relays: (originals[3] ?? null) === null ? null : jsonObject(originals[3] ?? null) };
}
// custom-providers.json is only written when it exists or Mi-Switch put a relay into it; otherwise it stays absent.
const serializePi = (files: PiFiles, originals: (string | null)[]) =>
  [asJson(files.models), asJson(files.auth), asJson(files.settings), files.relays === null ? originals[3] ?? null : asJson(files.relays)];
// pi-custom-providers is in use when its config file exists or settings.json lists the package.
export function piUsesRelays(originals: (string | null)[]): boolean {
  if ((originals[3] ?? null) !== null) return true;
  try {
    const packages = jsonObject(originals[2] ?? null).packages;
    return Array.isArray(packages) && packages.some(entry => typeof entry === 'string' ? entry.includes('pi-custom-providers') : isObject(entry) && String(entry.source ?? '').includes('pi-custom-providers'));
  } catch { return false; }
}
// One Mi-Switch provider's entries. An entry stays in the file it is already in; a new one goes to
// custom-providers.json when the extension is in use, otherwise to models.json. Other fields of the entry stay.
function writePiEntries(files: PiFiles, p: Provider, key: string, relays: boolean) {
  const id = piId(p);
  if (own(files.relays, id) || (!own(files.providers, id) && relays)) {
    files.relays ??= {};
    files.relays[id] = { ...(own(files.relays, id) ? files.relays[id] : {}), baseUrl: p.baseUrl, api: p.protocol };
    delete files.providers[id];
  } else {
    const entry = own(files.providers, id) ? files.providers[id] : {};
    const models = Array.isArray(entry.models) ? entry.models.filter((m: unknown) => isObject(m)) : [];
    if (!models.some((m: Record<string, any>) => m.id === p.model)) models.push({ id: p.model });
    files.providers[id] = { ...entry, name: p.name, baseUrl: p.baseUrl, api: p.protocol, apiKey: piApiKeyPlaceholder, authHeader: true, models };
  }
  files.auth[id] = { ...(own(files.auth, id) ? files.auth[id] : {}), type: 'api_key', key };
}
function removePiEntries(files: PiFiles, id: string) {
  delete files.providers[id]; delete files.auth[id];
  if (files.relays) delete files.relays[id];
}
// Writes a Mi-Switch Pi API provider's entries without touching the selection; `previousId` is removed when the ID changed.
export function registerPiProvider(p: Provider, originals: (string | null)[], key: string, previousId?: string): (string | null)[] {
  const files = readPi(originals);
  if (previousId && previousId !== piId(p)) removePiEntries(files, previousId);
  writePiEntries(files, p, key, piUsesRelays(originals));
  return serializePi(files, originals);
}
export function unregisterPiProvider(id: string, originals: (string | null)[]): (string | null)[] {
  const files = readPi(originals);
  removePiEntries(files, id);
  return serializePi(files, originals);
}
// Why `id` cannot be used for a new or renamed Mi-Switch provider, or null. `previousId` is the provider's own current ID.
export function piIdConflict(id: string, originals: (string | null)[], previousId?: string): string | null {
  if (id === previousId) return null;
  if (piBuiltinIds.includes(id)) return `“${id}”是 Pi 的内置 Provider，请换一个 ID（例如 ${id}-relay）`;
  const files = readPi(originals);
  if (own(files.auth, id) || own(files.providers, id) || own(files.relays, id)) return `Pi 中已有名为“${id}”的 Provider，请换一个 ID`;
  return null;
}
// Every provider Pi's files define, as existing providers. The default one carries the default model; the others
// take the first model Pi already knows for them (models.json or the extension's model cache), or none, which
// leaves the choice to Pi. IDs in `skip` are already in Mi-Switch.
export function livePiProviders(originals: (string | null)[], store: string | null, skip: string[] = []): ProviderInput[] {
  const files = readPi(originals);
  const text = (v: unknown) => typeof v === 'string' && v.trim() ? v.trim() : undefined;
  let cache: Record<string, any> = {};
  try { cache = jsonObject(store); } catch { /* the cache is only a hint */ }
  const ids = [...new Set([...Object.keys(files.auth), ...Object.keys(files.providers), ...Object.keys(files.relays ?? {})])]
    .filter(id => id !== '$schema' && /^[a-zA-Z0-9_-]+$/.test(id) && id.length <= 100 && !managedPattern.test(id) && !skip.includes(id))
    .filter(id => own(files.auth, id) || own(files.providers, id) || own(files.relays, id));
  return ids.map(id => {
    const custom = own(files.providers, id) ? files.providers[id] : {};
    const relay = own(files.relays, id) ? files.relays![id] : {};
    const known = [...(Array.isArray(custom.models) ? custom.models.map((m: any) => m?.id) : []), ...Object.keys(isObject(custom.modelOverrides) ? custom.modelOverrides : {}),
      ...(own(cache, id) && Array.isArray(cache[id].models) ? cache[id].models.map((m: any) => m?.id) : [])].filter((m): m is string => typeof m === 'string' && !!m.trim());
    const model = id === files.settings.defaultProvider ? text(files.settings.defaultModel) ?? '' : known[0] ?? '';
    const api = relay.api ?? custom.api;
    const auth = own(files.auth, id) ? files.auth[id] : null;
    return { app: 'pi' as const, name: id, mode: 'login' as const, loginProvider: id, model: model.slice(0, 200),
      baseUrl: (text(relay.baseUrl) ?? text(custom.baseUrl) ?? '').slice(0, 2048),
      protocol: ['anthropic-messages', 'openai-responses', 'openai-completions'].includes(api) ? api : 'openai-completions',
      // No note: the card's "已有 Provider" label already says it comes from Pi.
      piAuth: auth?.type === 'oauth' ? 'oauth' as const : auth ? 'api_key' as const : text(custom.apiKey) ? 'models' as const : 'none' as const };
  });
}
// Model IDs Pi already knows for `id`, for suggestions in the editor.
export function piKnownModels(originals: (string | null)[], store: string | null, id: string): string[] {
  let files: PiFiles; let cache: Record<string, any> = {};
  try { files = readPi(originals); } catch { return []; }
  try { cache = jsonObject(store); } catch { /* optional */ }
  const custom = own(files.providers, id) ? files.providers[id] : {};
  const ids = [...(Array.isArray(custom.models) ? custom.models.map((m: any) => m?.id) : []), ...Object.keys(isObject(custom.modelOverrides) ? custom.modelOverrides : {}),
    ...(own(cache, id) && Array.isArray(cache[id].models) ? cache[id].models.map((m: any) => m?.id) : [])];
  return [...new Set(ids.filter((m): m is string => typeof m === 'string' && !!m.trim()))];
}

// The inverse of patchProvider(): what a CLI is configured with now, as provider input for the first import.
// Returns null when the configuration is not one this tool can represent; the caller validates the result.
export function liveProvider(app: AppId, originals: (string | null)[]): ProviderInput | null {
  const text = (v: unknown) => typeof v === 'string' && v.trim() ? v.trim() : undefined;
  const count = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined;
  const host = (url: string) => { try { return new URL(url).host; } catch { return url; } };
  const notes = '首次运行时从本机配置导入';
  if (app === 'claude') {
    const settings = jsonObject(originals[0]);
    const env = isObject(settings.env) ? settings.env : {};
    // Dynamic keys and cloud platform routes have no provider equivalent; writing one would remove them.
    if (settings.apiKeyHelper !== undefined || ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'].some(k => env[k])) return null;
    // `default` is Claude Code's alias for its recommended model; it stands in when no model is set.
    const model = text(env.ANTHROPIC_MODEL) ?? text(settings.model) ?? 'default';
    const key = text(env.ANTHROPIC_AUTH_TOKEN) ?? text(env.ANTHROPIC_API_KEY);
    if (!key) return { app, name: 'Claude 官方登录', mode: 'login', model, protocol: 'anthropic-messages', notes };
    const baseUrl = text(env.ANTHROPIC_BASE_URL) ?? 'https://api.anthropic.com';
    return { app, name: host(baseUrl), mode: 'api', baseUrl, apiKey: key, claudeAuth: text(env.ANTHROPIC_AUTH_TOKEN) ? 'bearer' : 'api-key', model,
      smallFastModel: text(env.ANTHROPIC_DEFAULT_HAIKU_MODEL) ?? text(env.ANTHROPIC_SMALL_FAST_MODEL), sonnetModel: text(env.ANTHROPIC_DEFAULT_SONNET_MODEL),
      opusModel: text(env.ANTHROPIC_DEFAULT_OPUS_MODEL), fableModel: text(env.ANTHROPIC_DEFAULT_FABLE_MODEL), protocol: 'anthropic-messages', notes };
  }
  if (app === 'chatgpt') {
    const config = TOML.parse(originals[0] ?? '') as Record<string, any>;
    const model = text(config.model);
    if (!model) return null;
    const context = { contextWindow: count(config.model_context_window), autoCompactTokenLimit: count(config.model_auto_compact_token_limit) };
    const route = text(config.model_provider);
    if (!route) return { app, name: 'ChatGPT 官方登录', mode: 'login', model, protocol: 'openai-responses', notes, ...context };
    // Only a route with a literal base URL and bearer token over Responses is representable (env_key needs the terminal's env).
    const table = isObject(config.model_providers) && isObject(config.model_providers[route]) ? config.model_providers[route] : {};
    const baseUrl = text(table.base_url); const token = text(table.experimental_bearer_token);
    if (!baseUrl || !token || (table.wire_api !== undefined && table.wire_api !== 'responses')) return null;
    return { app, name: text(table.name) ?? route, mode: 'api', baseUrl, apiKey: token, model, protocol: 'openai-responses', notes, ...context };
  }
  // Pi: the default provider among all of them (see livePiProviders for the full import).
  const id = text(jsonObject(originals[2] ?? null).defaultProvider);
  return livePiProviders(originals, null).find(p => p.loginProvider === id) ?? null;
}

// Canonical JSON with sorted object keys: CLI rewrites that only reorder or reformat do not count as drift.
export function canonical(value: unknown): string {
  // The replacer sees a Date only through its holder: JSON.stringify has already turned `v` into a string.
  return JSON.stringify(value, function (this: any, key, v) {
    const raw = key === '' ? value : this[key];
    if (raw instanceof Date) return { '\u0000date': raw.toISOString() };
    return isObject(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v;
  }) ?? 'null';
}
const pick = (obj: Record<string, any>, keys: string[]) => Object.fromEntries(keys.filter(k => k in obj).map(k => [k, obj[k]]));
const managedEntries = (obj: unknown) => isObject(obj) ? pick(obj, Object.keys(obj).filter(id => managedPattern.test(id))) : {};
// Serializes only the fields patchProvider() controls under the given rule set. Returns null when a file cannot be parsed.
// `managed` (Pi, rule set 3): whether the provider in use is one Mi-Switch writes; its own entries are then managed too.
export function managedFingerprint(app: AppId, originals: (string | null)[], rules = RULES, managed = false): string | null {
  try {
    if (app === 'claude') {
      const settings = jsonObject(originals[0]);
      const env = isObject(settings.env) ? settings.env : {};
      return canonical({ model: settings.model, apiKeyHelper: settings.apiKeyHelper !== undefined, env: pick(env, rules === 1 ? claudeEnvKeysV1 : claudeEnvKeys) });
    }
    if (app === 'chatgpt') {
      const config = TOML.parse(originals[0] ?? '') as Record<string, any>;
      const providers = isObject(config.model_providers) ? config.model_providers : {};
      return canonical({
        model: config.model, model_provider: config.model_provider, profile: config.profile,
        contextWindow: config.model_context_window, autoCompact: config.model_auto_compact_token_limit,
        forced: [config.forced_login_method, config.forced_chatgpt_workspace_id],
        custom: providers[codexRouteId], providers: managedEntries(providers),
        // Login state decides requires_openai_auth; a login/logout after the switch is real drift.
        login: codexLoginMaterial(originals[1])
      });
    }
    if (rules >= 3) {
      const files = readPi(originals);
      const id = typeof files.settings.defaultProvider === 'string' ? files.settings.defaultProvider : '';
      const entry = managed
        ? { model: own(files.providers, id) ? pick(files.providers[id], ['baseUrl', 'api', 'apiKey', 'authHeader', 'name']) : null,
            relay: own(files.relays, id) ? pick(files.relays![id], ['baseUrl', 'api']) : null, auth: own(files.auth, id) ? pick(files.auth[id], ['type', 'key']) : null }
        : { loginType: own(files.auth, id) ? files.auth[id].type : undefined, defined: own(files.auth, id) || own(files.providers, id) || own(files.relays, id) };
      return canonical({ defaultProvider: files.settings.defaultProvider, defaultModel: files.settings.defaultModel, entry });
    }
    const models = jsonObject(originals[0]);
    const auth = jsonObject(originals[1]);
    const settings = jsonObject(originals[2]);
    const defaultProvider = settings.defaultProvider;
    // For an existing provider the relevant state is which kind of auth.json entry it has, if any.
    const loginType = typeof defaultProvider === 'string' && !managedPattern.test(defaultProvider) && isObject(auth[defaultProvider]) ? auth[defaultProvider].type : undefined;
    return canonical({ defaultProvider, defaultModel: settings.defaultModel, providers: managedEntries(models.providers), auth: managedEntries(auth), loginType });
  } catch { return null; }
}
