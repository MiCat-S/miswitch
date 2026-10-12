// Provider presets. Endpoints and model IDs are adapted from cc-switch (src/config/*ProviderPresets.ts,
// MIT License, Copyright (c) 2025 Jason Young; see THIRD_PARTY_NOTICES.md) with affiliate and invite parameters
// removed. Codex entries are limited to vendors that serve the Responses API natively: MiSwitch has no proxy that
// could translate Chat Completions. Model IDs go stale; the editor can fetch the current list from the provider.
import type { AppId, ProviderInput } from './types';

export type PresetCategory = 'official' | 'vendor' | 'aggregator';
export type PresetFields = Omit<Partial<ProviderInput>, 'app' | 'name' | 'notes' | 'apiKey' | 'id'>;
export type Preset = { id: string; name: string; category: PresetCategory; aliases: string[]; websiteUrl: string; apiKeyUrl?: string; apps: Partial<Record<AppId, PresetFields>> };

const claude = (baseUrl: string, model: string, routes: { small?: string; sonnet?: string; opus?: string } = {}): PresetFields => ({
  mode: 'api', baseUrl, protocol: 'anthropic-messages', claudeAuth: 'bearer', model,
  // A gateway that serves one model should also serve the alias routes, or background tasks ask for Anthropic IDs.
  smallFastModel: routes.small ?? model, sonnetModel: routes.sonnet ?? model, opusModel: routes.opus ?? model
});
const codex = (baseUrl: string, model?: string): PresetFields => ({ mode: 'api', baseUrl, protocol: 'openai-responses', model });
const pi = (baseUrl: string, protocol: PresetFields['protocol'], model?: string): PresetFields => ({ mode: 'api', baseUrl, protocol, model });

export const presets: Preset[] = [
  { id: 'anthropic', name: 'Anthropic API', category: 'official', aliases: ['claude', '官方'], websiteUrl: 'https://www.anthropic.com/api', apps: {
    claude: { mode: 'api', baseUrl: 'https://api.anthropic.com', protocol: 'anthropic-messages', claudeAuth: 'api-key', model: 'claude-sonnet-5-5' },
    pi: pi('https://api.anthropic.com', 'anthropic-messages', 'claude-sonnet-5-5') } },
  { id: 'claude-login', name: 'Claude 官方登录', category: 'official', aliases: ['claude', 'anthropic', 'login', '订阅'], websiteUrl: 'https://www.anthropic.com/claude-code', apps: {
    claude: { mode: 'login', protocol: 'anthropic-messages', model: 'default' } } },
  { id: 'openai', name: 'OpenAI API', category: 'official', aliases: ['gpt', '官方'], websiteUrl: 'https://platform.openai.com', apiKeyUrl: 'https://platform.openai.com/api-keys', apps: {
    chatgpt: codex('https://api.openai.com/v1'), pi: pi('https://api.openai.com/v1', 'openai-responses') } },
  { id: 'chatgpt-login', name: 'ChatGPT 官方登录', category: 'official', aliases: ['openai', 'codex', 'login', '订阅'], websiteUrl: 'https://chatgpt.com/codex', apps: {
    chatgpt: { mode: 'login', protocol: 'openai-responses' } } },
  { id: 'deepseek', name: 'DeepSeek', category: 'vendor', aliases: ['深度求索'], websiteUrl: 'https://platform.deepseek.com', apiKeyUrl: 'https://platform.deepseek.com/api_keys', apps: {
    claude: claude('https://api.deepseek.com/anthropic', 'deepseek-v4-pro', { small: 'deepseek-flash' }),
    chatgpt: codex('https://api.deepseek.com', 'deepseek-flash'), pi: pi('https://api.deepseek.com/v1', 'openai-completions', 'deepseek-v4-pro') } },
  { id: 'kimi', name: 'Kimi', category: 'vendor', aliases: ['moonshot', '月之暗面'], websiteUrl: 'https://platform.kimi.com', apiKeyUrl: 'https://platform.kimi.com/console/api-keys', apps: {
    claude: claude('https://api.moonshot.cn/anthropic', 'kimi-k2.7-code'),
    chatgpt: codex('https://api.moonshot.cn/v1', 'kimi-k3'), pi: pi('https://api.moonshot.cn/v1', 'openai-completions', 'kimi-k2.7-code') } },
  { id: 'kimi-global', name: 'Kimi Global', category: 'vendor', aliases: ['moonshot', '月之暗面', '国际'], websiteUrl: 'https://platform.kimi.ai', apiKeyUrl: 'https://platform.kimi.ai/console/api-keys', apps: {
    claude: claude('https://api.moonshot.ai/anthropic', 'kimi-k2.7-code'),
    chatgpt: codex('https://api.moonshot.ai/v1', 'kimi-k3'), pi: pi('https://api.moonshot.ai/v1', 'openai-completions', 'kimi-k2.7-code') } },
  { id: 'kimi-coding', name: 'Kimi For Coding', category: 'vendor', aliases: ['moonshot', '月之暗面', 'coding plan'], websiteUrl: 'https://www.kimi.com/code/', apps: {
    claude: claude('https://api.kimi.com/coding/', 'kimi-for-coding'),
    chatgpt: codex('https://api.kimi.com/coding/v1', 'kimi-for-coding'), pi: pi('https://api.kimi.com/coding', 'anthropic-messages', 'kimi-for-coding') } },
  { id: 'zhipu', name: '智谱 GLM', category: 'vendor', aliases: ['zhipu', 'bigmodel', 'glm'], websiteUrl: 'https://open.bigmodel.cn', apiKeyUrl: 'https://www.bigmodel.cn/claude-code', apps: {
    claude: claude('https://open.bigmodel.cn/api/anthropic', 'glm-5.3'),
    chatgpt: codex('https://open.bigmodel.cn/api/v1', 'glm-5.3'), pi: pi('https://open.bigmodel.cn/api/coding/paas/v4', 'openai-completions', 'glm-5.3') } },
  { id: 'zai', name: 'Z.ai（GLM 国际版）', category: 'vendor', aliases: ['zhipu', '智谱', 'glm', '国际'], websiteUrl: 'https://z.ai', apiKeyUrl: 'https://z.ai/subscribe', apps: {
    claude: claude('https://api.z.ai/api/anthropic', 'glm-5.3'),
    chatgpt: codex('https://api.z.ai/api/v1', 'glm-5.3'), pi: pi('https://api.z.ai/api/coding/paas/v4', 'openai-completions', 'glm-5.3') } },
  { id: 'minimax', name: 'MiniMax', category: 'vendor', aliases: ['海螺'], websiteUrl: 'https://platform.minimax.cn', apiKeyUrl: 'https://platform.minimax.cn/subscribe/token-plan', apps: {
    claude: claude('https://api.minimax.cn/anthropic', 'MiniMax-M3[1M]'),
    chatgpt: codex('https://api.minimax.cn/v1', 'MiniMax-M3'), pi: pi('https://api.minimax.cn/v1', 'openai-completions', 'MiniMax-M3') } },
  { id: 'minimax-global', name: 'MiniMax Global', category: 'vendor', aliases: ['海螺', '国际'], websiteUrl: 'https://platform.minimax.io', apiKeyUrl: 'https://platform.minimax.io/subscribe/coding-plan', apps: {
    claude: claude('https://api.minimax.io/anthropic', 'MiniMax-M3[1M]'),
    chatgpt: codex('https://api.minimax.io/v1', 'MiniMax-M3'), pi: pi('https://api.minimax.io/v1', 'openai-completions', 'MiniMax-M3') } },
  { id: 'qwen', name: '通义千问（Qwen Cloud）', category: 'vendor', aliases: ['qwen', 'dashscope', '阿里云', '百炼'], websiteUrl: 'https://www.qwencloud.com', apiKeyUrl: 'https://home.qwencloud.com/api-keys', apps: {
    claude: claude('https://dashscope-intl.aliyuncs.com/apps/anthropic', 'qwen3.8-max', { small: 'qwen3.8-flash', sonnet: 'qwen3.7-plus' }),
    chatgpt: codex('https://dashscope-intl.aliyuncs.com/compatible-mode/v1', 'qwen3.8-max'),
    pi: pi('https://dashscope-intl.aliyuncs.com/compatible-mode/v1', 'openai-completions', 'qwen3.8-max') } },
  { id: 'doubao', name: '火山方舟（豆包）', category: 'vendor', aliases: ['volcengine', 'doubao', 'ark', '字节'], websiteUrl: 'https://www.volcengine.com/product/ark', apiKeyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey', apps: {
    claude: claude('https://ark.cn-beijing.volces.com/api/compatible', 'doubao-seed-2-1-pro-260628'),
    chatgpt: codex('https://ark.cn-beijing.volces.com/api/v3', 'doubao-seed-2-1-pro-260628'),
    pi: pi('https://ark.cn-beijing.volces.com/api/v3', 'openai-completions', 'doubao-seed-2-1-pro-260628') } },
  { id: 'volcengine-coding', name: '火山方舟 Coding Plan', category: 'vendor', aliases: ['volcengine', 'doubao', 'ark', '字节', 'coding plan'], websiteUrl: 'https://www.volcengine.com/activity/codingplan', apps: {
    claude: claude('https://ark.cn-beijing.volces.com/api/coding', 'ark-code-latest'),
    chatgpt: codex('https://ark.cn-beijing.volces.com/api/coding/v3', 'ark-code-latest'),
    pi: pi('https://ark.cn-beijing.volces.com/api/coding/v3', 'openai-completions', 'ark-code-latest') } },
  { id: 'mimo', name: '小米 MiMo', category: 'vendor', aliases: ['xiaomi', 'mimo'], websiteUrl: 'https://platform.xiaomimimo.com', apiKeyUrl: 'https://platform.xiaomimimo.com/#/console/api-keys', apps: {
    claude: claude('https://api.xiaomimimo.com/anthropic', 'mimo-v2.6-pro'),
    chatgpt: codex('https://api.xiaomimimo.com/v1', 'mimo-v2.6-pro'), pi: pi('https://api.xiaomimimo.com/v1', 'openai-completions', 'mimo-v2.6-pro') } },
  { id: 'qianfan-coding', name: '百度千帆 Coding Plan', category: 'vendor', aliases: ['baidu', 'qianfan', '百度', 'coding plan'], websiteUrl: 'https://cloud.baidu.com/product/qianfan_modelbuilder', apiKeyUrl: 'https://console.bce.baidu.com/qianfan/ais/console/applicationConsole/application', apps: {
    claude: claude('https://qianfan.baidubce.com/anthropic/coding', 'qianfan-code-latest') } },
  { id: 'openrouter', name: 'OpenRouter', category: 'aggregator', aliases: ['聚合'], websiteUrl: 'https://openrouter.ai', apiKeyUrl: 'https://openrouter.ai/keys', apps: {
    claude: claude('https://openrouter.ai/api', 'anthropic/claude-sonnet-5', { small: 'anthropic/claude-haiku-4.5', opus: 'anthropic/claude-opus-5' }),
    chatgpt: codex('https://openrouter.ai/api/v1'), pi: pi('https://openrouter.ai/api', 'anthropic-messages', 'anthropic/claude-sonnet-5') } },
  { id: 'siliconflow', name: '硅基流动', category: 'aggregator', aliases: ['siliconflow', '聚合'], websiteUrl: 'https://siliconflow.cn', apps: {
    claude: claude('https://api.siliconflow.cn', 'Pro/MiniMaxAI/MiniMax-M2.5') } }
];
// The only pages the desktop shell opens externally.
export const presetLinks = new Set(presets.flatMap(p => [p.websiteUrl, ...(p.apiKeyUrl ? [p.apiKeyUrl] : [])]));
export const presetsFor = (app: AppId) => presets.filter(p => p.apps[app]);
export function presetMatches(preset: Preset, query: string): boolean {
  const host = (url: string) => { try { return new URL(url).host.replace(/^(www|api|platform)\./, ''); } catch { return ''; } };
  const haystack = [preset.name, ...preset.aliases, host(preset.websiteUrl)].join(' ').toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every(word => haystack.includes(word));
}
