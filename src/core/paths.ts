import { homedir } from 'node:os';
import { isAbsolute, join, normalize } from 'node:path';
import type { AppId } from './types';
import { PublicError } from './errors';

// The data folder earlier versions used: packaged builds `MiSwitch`, development builds the package name `miswitch`.
// On a case-sensitive volume they differ; the one that already holds a Hub wins, `MiSwitch` first. Nothing is moved.
export function dataFolder(appData: string, hasHub: (path: string) => boolean): string {
  return join(appData, ['MiSwitch', 'miswitch'].find(name => hasHub(join(appData, name, 'store', 'hub.json'))) ?? 'MiSwitch');
}
// `piModelStore`: the pi-custom-providers model cache. Only read, for model suggestions; never a target.
export type Paths = { data: string; targets: Record<AppId, string[]>; home: string; piModelStore: string };
// Only the main process constructs these paths; IPC never accepts a filesystem path.
export function resolvePaths(data: string, home = homedir(), env = process.env): Paths {
  const dir = (override: string | undefined, fallback: string) => {
    const path = override ? override.replace(/^~(?=[/\\]|$)/, home) : fallback;
    if (!isAbsolute(path)) throw new PublicError('配置目录覆盖必须使用绝对路径');
    return normalize(path);
  };
  const claude = dir(env.CLAUDE_CONFIG_DIR, join(home, '.claude'));
  const codex = dir(env.CODEX_HOME, join(home, '.codex'));
  const pi = dir(env.PI_CODING_AGENT_DIR, join(home, '.pi', 'agent'));
  return { data, home, piModelStore: join(pi, 'models-store.json'), targets: {
    claude: [join(claude, 'settings.json')],
    // auth.json is locked, backed up and verified but never rewritten by the adapter.
    chatgpt: [join(codex, 'config.toml'), join(codex, 'auth.json')],
    // custom-providers.json is the pi-custom-providers extension's relay list; it was added after the first three.
    pi: [join(pi, 'models.json'), join(pi, 'auth.json'), join(pi, 'settings.json'), join(pi, 'custom-providers.json')]
  } };
}
