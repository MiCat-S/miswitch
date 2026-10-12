import { vendorIcons, type PublicProvider, type VendorIcon } from '../core/types';

// Base URL hosts of the built-in presets and the vendors' own API domains. A host matches its domain and subdomains.
const hosts: [string, VendorIcon][] = [
  ['anthropic.com', 'anthropic'], ['openai.com', 'openai'], ['chatgpt.com', 'openai'], ['deepseek.com', 'deepseek'],
  ['kimi.com', 'kimi'], ['kimi.ai', 'kimi'], ['moonshot.cn', 'kimi'], ['moonshot.ai', 'kimi'],
  ['bigmodel.cn', 'zhipu'], ['z.ai', 'zai'], ['minimax.cn', 'minimax'], ['minimax.io', 'minimax'], ['minimaxi.com', 'minimax'],
  ['aliyuncs.com', 'qwen'], ['qwencloud.com', 'qwen'], ['volces.com', 'volcengine'], ['volcengine.com', 'volcengine'],
  ['xiaomimimo.com', 'mimo'], ['baidubce.com', 'qianfan'], ['openrouter.ai', 'openrouter'], ['siliconflow.cn', 'siliconflow'], ['siliconflow.com', 'siliconflow']
];
// A Map, so a provider ID such as `__proto__` or `constructor` finds nothing instead of an inherited property.
const loginMarks = new Map<string, VendorIcon>([['claude', 'claude'], ['chatgpt', 'openai'], ['anthropic', 'claude'], ['openai', 'openai']]);

// What `icon` left unset resolves to: the vendor behind the Base URL, the CLI's own vendor for an official login,
// or null for the letter avatar.
export function autoIcon(p: Pick<PublicProvider, 'app' | 'mode' | 'baseUrl' | 'loginProvider'>): VendorIcon | null {
  if (p.mode === 'login') return loginMarks.get(p.app === 'pi' ? p.loginProvider : p.app) ?? null;
  let host: string;
  // `api.deepseek.com.` is the same host written with the DNS root.
  try { host = new URL(p.baseUrl).hostname.toLowerCase().replace(/\.$/, ''); } catch { return null; }
  return hosts.find(([domain]) => host === domain || host.endsWith(`.${domain}`))?.[1] ?? null;
}
export function providerMark(p: Pick<PublicProvider, 'app' | 'mode' | 'baseUrl' | 'loginProvider' | 'icon'>): VendorIcon | null {
  if (p.icon === 'letter') return null;
  // Only a known vendor id is drawn; anything else in the Hub falls back to the initial.
  return p.icon && (vendorIcons as readonly string[]).includes(p.icon) ? p.icon : autoIcon(p);
}
// Letter avatars take one of the muted companion hues, chosen by name so a provider keeps its colour.
export const letterHues = ['sky', 'mineral', 'plum', 'clay', 'stone'] as const;
export const letterHue = (name: string) => letterHues[[...name].reduce((h, c) => (h * 31 + c.codePointAt(0)!) >>> 0, 7) % letterHues.length];
export const initial = (name: string) => ([...name.trim()][0] ?? '?').toUpperCase();
