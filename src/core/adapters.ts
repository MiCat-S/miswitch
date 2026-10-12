import TOML from '@iarna/toml';
import { PublicError } from './errors';
import type { AppId, Provider } from './types';

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
export const claudeEnvKeys = [
  'ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDE_CODE_OAUTH_TOKEN'
];
// Input order matches resolvePaths(). Unknown fields survive semantic merge.
export function patchProvider(p: Provider, originals: (string | null)[], key?: string): (string | null)[] {
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
  const models = jsonObject(originals[0]);
  const auth = jsonObject(originals[1]);
  const settings = jsonObject(originals[2]);
  const providers = objectField(models, 'providers');
  for (const id of Object.keys(providers)) if (managedPattern.test(id)) delete providers[id];
  for (const id of Object.keys(auth)) if (managedPattern.test(id)) delete auth[id];
  const id = p.mode === 'login' ? p.loginProvider : managedId(p);
  if (p.mode === 'login') {
    if (auth[id]?.type !== 'oauth') throw new PublicError('Pi 该 Provider 没有已保存的 OAuth 登录；请先运行 pi 的 /login');
  } else {
    providers[id] = { baseUrl: p.baseUrl, api: p.protocol, apiKey: piApiKeyPlaceholder, authHeader: true, models: [{ id: p.model }] };
    auth[id] = { type: 'api_key', key };
  }
  settings.defaultProvider = id;
  settings.defaultModel = p.model;
  return [asJson(models), asJson(auth), asJson(settings)];
}

// Canonical JSON with sorted object keys: CLI rewrites that only reorder or reformat do not count as drift.
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) => isObject(v) && !(v instanceof Date)
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]]))
    : v) ?? 'null';
}
const pick = (obj: Record<string, any>, keys: string[]) => Object.fromEntries(keys.filter(k => k in obj).map(k => [k, obj[k]]));
const managedEntries = (obj: unknown) => isObject(obj) ? pick(obj, Object.keys(obj).filter(id => managedPattern.test(id))) : {};
// Serializes only the fields patchProvider() controls. Returns null when a file cannot be parsed.
export function managedFingerprint(app: AppId, originals: (string | null)[]): string | null {
  try {
    if (app === 'claude') {
      const settings = jsonObject(originals[0]);
      const env = isObject(settings.env) ? settings.env : {};
      return canonical({ model: settings.model, apiKeyHelper: settings.apiKeyHelper !== undefined, env: pick(env, claudeEnvKeys) });
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
    const models = jsonObject(originals[0]);
    const auth = jsonObject(originals[1]);
    const settings = jsonObject(originals[2]);
    const defaultProvider = settings.defaultProvider;
    // For login mode the relevant state is whether the official OAuth entry still exists.
    const loginType = typeof defaultProvider === 'string' && !managedPattern.test(defaultProvider) && isObject(auth[defaultProvider]) ? auth[defaultProvider].type : undefined;
    return canonical({ defaultProvider, defaultModel: settings.defaultModel, providers: managedEntries(models.providers), auth: managedEntries(auth), loginType });
  } catch { return null; }
}
