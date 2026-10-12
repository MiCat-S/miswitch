import { useRef, useState, type FormEvent } from 'react';
import { presetMatches, presetsFor, type Preset, type PresetCategory, type PresetFields } from '../core/presets';
import { reasoningEfforts, type AppId, type ModelList, type ModelListRequest, type ProviderInput, type PublicProvider } from '../core/types';
import { Modal, errorText, names } from './common';

const categories: [PresetCategory | 'all', string][] = [['all', '全部'], ['official', '官方'], ['vendor', '模型厂商'], ['aggregator', '聚合平台']];
const categoryNames: Record<PresetCategory, string> = { official: '官方', vendor: '模型厂商', aggregator: '聚合平台' };
const host = (url?: string) => { try { return url ? new URL(url).host : ''; } catch { return ''; } };
// Claude Code alias routes as the editor shows them; `smallFastModel` is also the background-task model.
const aliasFields: [keyof PresetFields & ('smallFastModel' | 'sonnetModel' | 'opusModel' | 'fableModel'), string][] = [
  ['smallFastModel', 'Haiku（小型／快速，后台任务）'], ['sonnetModel', 'Sonnet'], ['opusModel', 'Opus'], ['fableModel', 'Fable']
];
type Draft = PresetFields & { name?: string; notes?: string; hasKey?: boolean; loginProvider?: string };

function PresetPicker({ app, onPick }: { app: AppId; onPick(preset: Preset | null): void }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<PresetCategory | 'all'>('all');
  const list = presetsFor(app).filter(p => (category === 'all' || p.category === category) && presetMatches(p, query));
  return <div className="preset-picker">
    <input type="search" autoFocus aria-label="搜索预设" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索供应商，例如 DeepSeek、智谱、OpenRouter" />
    <div className="preset-tabs" role="group" aria-label="预设分类">
      {categories.map(([id, label]) => <button key={id} type="button" aria-pressed={category === id} className={category === id ? 'active' : ''} onClick={() => setCategory(id)}>{label}</button>)}
    </div>
    <ul className="preset-list" aria-label="预设列表">
      <li><button type="button" className="preset-row custom" onClick={() => onPick(null)}><strong>自定义配置</strong><small>从空白表单开始，自行填写端点与模型</small></button></li>
      {list.map(p => {
        const fields = p.apps[app]!;
        return <li key={p.id}><button type="button" className="preset-row" onClick={() => onPick(p)}>
          <strong>{p.name}</strong><small>{fields.mode === 'login' ? '使用 CLI 已有登录' : host(fields.baseUrl)} · {categoryNames[p.category]}</small>
        </button></li>;
      })}
    </ul>
    {list.length === 0 ? <p className="hint">没有匹配的预设，可以使用自定义配置。</p> : null}
    <p className="hint">预设的端点与模型来自 cc-switch 的公开预设（已移除推广参数），模型 ID 可能已过时，可在表单中获取最新模型列表。</p>
  </div>;
}

export function ProviderEditor({ app, provider, busy, error, onClose, onSave, listModels }: {
  app: AppId; provider?: PublicProvider; busy: boolean; error: string; onClose(): void; onSave(input: ProviderInput): void; listModels(request: ModelListRequest): Promise<ModelList>;
}) {
  const [stage, setStage] = useState<'pick' | 'form'>(provider ? 'form' : 'pick');
  const [preset, setPreset] = useState<Preset | null>(null);
  const draft: Draft | undefined = provider ?? (preset ? { name: preset.name, ...preset.apps[app] } : undefined);
  const [mode, setMode] = useState<'api' | 'login'>(draft?.mode ?? 'api');
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [modelStatus, setModelStatus] = useState<{ text: string; error: boolean } | null>(null);
  const [fetching, setFetching] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const field = (name: string) => form.current?.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
  const pick = (next: Preset | null) => {
    setPreset(next); setMode(next?.apps[app]?.mode ?? 'api'); setModels([]); setModelStatus(null); setShowKey(false); setStage('form');
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? '').trim() || undefined;
    onSave({ id: provider?.id, app, name: String(data.get('name')), mode,
      baseUrl: String(data.get('baseUrl') ?? ''), model: String(data.get('model')),
      protocol: String(data.get('protocol') ?? (app === 'claude' ? 'anthropic-messages' : 'openai-responses')) as ProviderInput['protocol'],
      claudeAuth: String(data.get('claudeAuth') ?? 'api-key') as 'api-key' | 'bearer',
      loginProvider: String(data.get('loginProvider') ?? 'anthropic'),
      notes: String(data.get('notes')), apiKey: String(data.get('apiKey') ?? '') || undefined,
      smallFastModel: text('smallFastModel'), sonnetModel: text('sonnetModel'), opusModel: text('opusModel'), fableModel: text('fableModel'),
      reasoningEffort: text('reasoningEffort') as ProviderInput['reasoningEffort'],
      contextWindow: Number(data.get('contextWindow')) || undefined, autoCompactTokenLimit: Number(data.get('autoCompactTokenLimit')) || undefined });
  };
  const fetchModels = async () => {
    setFetching(true); setModelStatus(null);
    try {
      const result = await listModels({ app, baseUrl: field('baseUrl')?.value ?? '', apiKey: field('apiKey')?.value || undefined, providerId: provider?.id,
        protocol: (field('protocol')?.value ?? 'anthropic-messages') as ModelListRequest['protocol'], claudeAuth: (field('claudeAuth')?.value ?? 'api-key') as 'api-key' | 'bearer' });
      setModels(result.models);
      setModelStatus({ text: `已获取 ${result.models.length} 个模型（${result.url}），可在模型输入框中下拉选择或输入筛选。`, error: false });
    } catch (e) { setModels([]); setModelStatus({ text: errorText(e), error: true }); }
    finally { setFetching(false); }
  };
  const fillAliases = () => { const model = field('model')?.value ?? ''; for (const [name] of aliasFields) { const input = field(name); if (input) input.value = model; } };
  const keyLink = preset?.apiKeyUrl ?? preset?.websiteUrl;

  if (stage === 'pick') return <Modal wide title={`添加 ${names[app]} 配置`} onClose={() => { if (!busy) onClose(); }}><PresetPicker app={app} onPick={pick} /></Modal>;
  return <Modal wide title={`${provider ? '编辑' : '添加'} ${names[app]} 配置`} onClose={() => { if (!busy) onClose(); }}>
    {!provider ? <div className="preset-bar">
      <span>{preset ? <>预设：<strong>{preset.name}</strong></> : '自定义配置'}</span>
      {preset ? <a href={preset.websiteUrl} target="_blank" rel="noreferrer">官网 ↗</a> : null}
      <button type="button" disabled={busy} onClick={() => setStage('pick')}>{preset ? '更换预设' : '选择预设'}</button>
    </div> : null}
    {/* Remounted per preset: the fields are uncontrolled and take their defaults from the draft. */}
    <form ref={form} key={preset?.id ?? 'custom'} onSubmit={submit}><fieldset disabled={busy}>
      <label>配置名称<input name="name" autoFocus required maxLength={100} defaultValue={draft?.name} placeholder="例如：官方直连 / 工作网关" /></label>
      <label>连接方式<select value={mode} onChange={e => setMode(e.target.value as 'api' | 'login')}><option value="api">API Key / 自定义端点</option><option value="login">{app === 'pi' ? '沿用 Pi 已有的 Provider' : '使用已有官方登录'}</option></select></label>
      {/* API fields stay mounted while in login mode so an unsaved draft survives switching back.
          A disabled fieldset is excluded from validation and FormData, so login saves carry no key. */}
      <fieldset hidden={mode !== 'api'} disabled={mode !== 'api'} aria-hidden={mode !== 'api'}>
        <label>Base URL<input name="baseUrl" type="url" required defaultValue={draft?.baseUrl || (app === 'claude' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1')} placeholder="https://… ；仅本机地址可用 http://" /></label>
        <div className="field">
          <div className="field-head"><label htmlFor="api-key">API Key</label>{keyLink ? <a href={keyLink} target="_blank" rel="noreferrer">获取 API Key ↗</a> : null}</div>
          <div className="key-input">
            <input id="api-key" name="apiKey" type={showKey ? 'text' : 'password'} autoComplete="new-password" spellCheck={false} required={!draft?.hasKey} placeholder={draft?.hasKey ? '已保存；留空保留原密钥' : '输入 API Key'} />
            <button type="button" aria-pressed={showKey} aria-label={showKey ? '隐藏 API Key' : '显示 API Key'} onClick={() => setShowKey(!showKey)}>{showKey ? '隐藏' : '显示'}</button>
          </div>
        </div>
        <label>API 协议<select name="protocol" defaultValue={draft?.protocol ?? (app === 'claude' ? 'anthropic-messages' : 'openai-responses')}>
          {app !== 'chatgpt' ? <option value="anthropic-messages">Anthropic Messages</option> : null}
          {app !== 'claude' ? <option value="openai-responses">OpenAI Responses</option> : null}
          {app === 'pi' ? <option value="openai-completions">OpenAI Chat Completions</option> : null}
        </select></label>
        {app === 'claude' ? <label>鉴权头<select name="claudeAuth" defaultValue={draft?.claudeAuth}><option value="api-key">X-Api-Key（官方 API）</option><option value="bearer">Authorization: Bearer（网关）</option></select></label> : null}
        {app === 'pi' ? <p className="hint">Pi 使用 Anthropic Messages 时会自行追加 /v1/messages，Base URL 请不要带 /v1；OpenAI 协议则需要带 /v1。</p> : null}
      </fieldset>
      {mode === 'login' ? <p className="hint">{app === 'pi' ? '只切换 Pi 的默认 Provider 与模型，不改动该 Provider 本身（/login 保存的登录、auth.json 中的密钥或 models.json 中的定义）。' : '保留现有登录凭据。请先在目标 CLI 中登录，再用该配置恢复官方路由。'}保存此模式后，已保存的 API Key 会被移除。</p> : null}
      {mode === 'login' && app === 'pi' ? <label>Pi Provider ID<input name="loginProvider" required defaultValue={draft?.loginProvider ?? 'anthropic'} placeholder="pi /login 保存的，或 models.json 中定义的 Provider ID" /></label> : null}
      <div className="field">
        <div className="field-head"><label htmlFor="model">默认 Model</label>
          {mode === 'api' ? <button type="button" className="link-button" disabled={fetching || busy} onClick={() => void fetchModels()}>{fetching ? '获取中…' : '获取模型列表'}</button> : null}</div>
        <input id="model" name="model" required maxLength={200} list="model-options" defaultValue={draft?.model} placeholder="输入供应商支持的精确模型 ID" />
        {modelStatus ? <p className={modelStatus.error ? 'error' : 'hint'} role={modelStatus.error ? 'alert' : 'status'}>{modelStatus.text}</p> : null}
      </div>
      <datalist id="model-options">{models.map(id => <option key={id} value={id} />)}</datalist>
      {app === 'claude' ? <fieldset hidden={mode !== 'api'} disabled={mode !== 'api'} aria-hidden={mode !== 'api'} className="aliases">
        <div className="field-head"><legend>模型别名映射（可选）</legend><button type="button" className="link-button" onClick={fillAliases}>全部填为默认 Model</button></div>
        <div className="pair">{aliasFields.map(([name, label]) => <label key={name}>{label}<input name={name} maxLength={200} list="model-options" defaultValue={draft?.[name]} placeholder="留空则使用官方默认" /></label>)}</div>
        <p className="hint">Claude Code 的 haiku／sonnet／opus／fable 别名与后台任务会请求这些模型。网关没有 Anthropic 的默认模型 ID 时，至少填写 Haiku。</p>
      </fieldset> : null}
      {app === 'chatgpt' ? <>
        <div className="pair">
          <label>上下文窗口（可选）<input name="contextWindow" type="number" min={1} step={1} defaultValue={draft?.contextWindow} placeholder="model_context_window，如 1000000" /></label>
          <label>自动压缩阈值（可选）<input name="autoCompactTokenLimit" type="number" min={1} step={1} defaultValue={draft?.autoCompactTokenLimit} placeholder="model_auto_compact_token_limit" /></label>
        </div>
        <label>推理强度（可选）<select name="reasoningEffort" defaultValue={draft?.reasoningEffort ?? ''}>
          <option value="">不设置（保留 Codex 当前值）</option>{reasoningEfforts.map(level => <option key={level} value={level}>{level}</option>)}
        </select></label>
      </> : null}
      <label>备注<textarea name="notes" rows={2} maxLength={2000} defaultValue={draft?.notes} /></label>
      <p className="hint">数据仅保存在本机，使用明文文件。请勿把配置目录加入版本控制或公开同步。</p>
      {error ? <p role="alert" className="error">{error}</p> : null}
      <div className="dialog-actions"><button type="button" onClick={onClose}>取消</button><button className="primary" type="submit">{busy ? '保存中…' : '保存配置'}</button></div>
    </fieldset></form>
  </Modal>;
}
