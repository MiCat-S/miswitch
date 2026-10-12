import { useEffect, useRef, useState, type FormEvent } from 'react';
import { presetMatches, presetsFor, type Preset, type PresetCategory, type PresetFields } from '../core/presets';
import { reasoningEfforts, type AppId, type ConfigDraft, type ConfigEdit, type ConfigFields, type ConfigParseRequest, type ConfigView, type ConfigViewRequest, type ModelList, type ModelListRequest, type ProviderInput, type PublicProvider } from '../core/types';
import { Modal, errorText, names } from './common';

const categories: [PresetCategory | 'all', string][] = [['all', '全部'], ['official', '官方'], ['vendor', '模型厂商'], ['aggregator', '聚合平台']];
const host = (url?: string) => { try { return url ? new URL(url).host : ''; } catch { return ''; } };
// Claude Code alias routes as the editor shows them; `smallFastModel` is also the background-task model.
const aliasFields: [keyof PresetFields & ('smallFastModel' | 'sonnetModel' | 'opusModel' | 'fableModel'), string][] = [
  ['smallFastModel', 'Haiku（小型／快速，后台任务）'], ['sonnetModel', 'Sonnet'], ['opusModel', 'Opus'], ['fableModel', 'Fable']
];
type Draft = PresetFields & { name?: string; notes?: string; hasKey?: boolean; loginProvider?: string };
const configHints: Record<AppId, string> = {
  claude: '地址、Key、模型与别名映射随供应商切换写入；其余内容是 Claude Code 的全局设置，保存时立即写入本机 settings.json（写入前自动备份），对所有供应商生效。',
  chatgpt: '地址、Key、模型、上下文与推理强度随供应商切换写入；其余内容是 Codex 的全局设置，保存时立即写入本机 config.toml（写入前自动备份），对所有供应商生效。保存会重新排版 config.toml，注释不会保留；auth.json 由 Codex 登录管理，不在此编辑。',
  pi: 'defaultProvider 与 defaultModel 随供应商切换写入；其余内容是 Pi 的全局设置，保存时立即写入本机 settings.json（写入前自动备份），对所有供应商生效。'
};
const draftFields = ['name', 'baseUrl', 'apiKey', 'claudeAuth', 'loginProvider', 'model', 'smallFastModel', 'sonnetModel', 'opusModel', 'fableModel', 'contextWindow', 'autoCompactTokenLimit', 'reasoningEffort'] as const;

function PresetPicker({ app, onPick }: { app: AppId; onPick(preset: Preset | null): void }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<PresetCategory | 'all'>('all');
  const list = presetsFor(app).filter(p => (category === 'all' || p.category === category) && presetMatches(p, query));
  return <div className="preset-picker">
    <input type="search" autoFocus data-autofocus aria-label="搜索预设" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索供应商，例如 DeepSeek、智谱、OpenRouter" />
    <div className="preset-tabs" role="group" aria-label="预设分类">
      {categories.map(([id, label]) => <button key={id} type="button" aria-pressed={category === id} className={category === id ? 'active' : ''} onClick={() => setCategory(id)}>{label}</button>)}
    </div>
    <ul className="preset-list" aria-label="预设列表">
      <li><button type="button" className="preset-row custom" onClick={() => onPick(null)}><strong>自定义配置</strong><small>从空白表单开始，自行填写端点与模型</small></button></li>
      {list.map(p => {
        const fields = p.apps[app]!;
        return <li key={p.id}><button type="button" className="preset-row" onClick={() => onPick(p)}>
          <strong>{p.name}</strong><small>{fields.mode === 'login' ? '使用 CLI 已有登录' : host(fields.baseUrl)}</small>
        </button></li>;
      })}
    </ul>
    {list.length === 0 ? <p className="hint">没有匹配的预设，可以使用自定义配置。</p> : null}
    <p className="hint">预设的端点与模型来自 cc-switch 的公开预设（已移除推广参数），模型 ID 可能已过时，可在表单中获取最新模型列表。</p>
  </div>;
}

export function ProviderEditor({ app, provider, busy, error, onClose, onSave, listModels, configView, parseConfig }: {
  app: AppId; provider?: PublicProvider; busy: boolean; error: string; onClose(): void; onSave(input: ProviderInput, config?: ConfigEdit): void;
  listModels(request: ModelListRequest): Promise<ModelList>; configView(request: ConfigViewRequest): Promise<ConfigView>; parseConfig(request: ConfigParseRequest): Promise<ConfigFields>;
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
  // The configuration file: the text is the source of truth for global settings, and stays in sync with the
  // form for provider fields. `synced` is the last text the form was updated from (or composed to).
  const [config, setConfig] = useState<ConfigView | null>(null);
  const [configText, setConfigText] = useState('');
  const [configError, setConfigError] = useState('');
  const textRef = useRef('');
  const synced = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const setText = (value: string, fromForm = false) => { textRef.current = value; setConfigText(value); if (fromForm) synced.current = value; };
  const readDraft = (): ConfigDraft => {
    if (!form.current) return { mode };
    const data = new FormData(form.current);
    const value = (name: string) => data.has(name) ? String(data.get(name)) : undefined;
    return { mode, ...Object.fromEntries(draftFields.map(name => [name, value(name)]).filter(([, v]) => v !== undefined)) } as ConfigDraft;
  };
  const loadConfig = async () => {
    setConfigError('');
    const view = await configView({ app, draft: readDraft(), providerId: provider?.id }).catch(e => ({ error: errorText(e) }) as ConfigView);
    if (view.error || view.text === undefined) { setConfig(null); setConfigError(view.error ?? '无法读取配置文件'); return; }
    setConfig(view); setText(view.text, true);
  };
  const recompose = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (!config) return;
      const sent = textRef.current;
      const view = await configView({ app, draft: readDraft(), providerId: provider?.id, text: sent }).catch(e => ({ error: errorText(e) }) as ConfigView);
      if (textRef.current !== sent) return; // the user typed in the file meanwhile; their text wins
      if (view.error || view.text === undefined) { setConfigError(view.error ?? '无法更新配置文件'); return; }
      setConfigError(''); setText(view.text, true);
    }, 350);
  };
  const syncFromText = async () => {
    const current = textRef.current;
    if (!config || current === synced.current) return;
    const result = await parseConfig({ app, text: current }).catch(e => ({ error: errorText(e) }) as ConfigFields);
    synced.current = current;
    if (result.error || !result.fields) { setConfigError(result.error ?? ''); return; }
    setConfigError('');
    for (const [name, value] of Object.entries(result.fields)) {
      if (value === undefined) continue;
      if (name === 'mode') setMode(value as 'api' | 'login');
      else { const input = field(name); if (input) input.value = value; }
    }
  };
  const formatConfig = () => {
    try { setText(JSON.stringify(JSON.parse(textRef.current), null, 2) + '\n'); setConfigError(''); }
    catch { setConfigError('JSON 格式错误，无法格式化'); }
  };
  useEffect(() => { if (stage === 'form') void loadConfig(); return () => clearTimeout(timer.current); }, [stage, preset]);
  useEffect(() => { if (config) recompose(); }, [mode]);
  const pick = (next: Preset | null) => {
    setPreset(next); setMode(next?.apps[app]?.mode ?? 'api'); setModels([]); setModelStatus(null); setShowKey(false); setConfig(null); setStage('form');
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const element = event.currentTarget;
    await syncFromText();
    const data = new FormData(element);
    const text = (name: string) => String(data.get(name) ?? '').trim() || undefined;
    onSave({ id: provider?.id, app, name: String(data.get('name')), mode,
      baseUrl: String(data.get('baseUrl') ?? ''), model: String(data.get('model')),
      protocol: String(data.get('protocol') ?? (app === 'claude' ? 'anthropic-messages' : 'openai-responses')) as ProviderInput['protocol'],
      claudeAuth: String(data.get('claudeAuth') ?? 'api-key') as 'api-key' | 'bearer',
      loginProvider: String(data.get('loginProvider') ?? 'anthropic'),
      notes: String(data.get('notes')), apiKey: String(data.get('apiKey') ?? '') || undefined,
      smallFastModel: text('smallFastModel'), sonnetModel: text('sonnetModel'), opusModel: text('opusModel'), fableModel: text('fableModel'),
      reasoningEffort: text('reasoningEffort') as ProviderInput['reasoningEffort'],
      contextWindow: Number(data.get('contextWindow')) || undefined, autoCompactTokenLimit: Number(data.get('autoCompactTokenLimit')) || undefined },
      config?.base ? { text: textRef.current, base: config.base } : undefined);
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

  const title = `${provider ? '编辑' : '添加'} ${names[app]} 配置`;
  if (stage === 'pick') return <Modal sheet title={title} onClose={() => { if (!busy) onClose(); }}><div className="sheet-body"><PresetPicker app={app} onPick={pick} /></div></Modal>;
  return <Modal sheet title={title} onClose={() => { if (!busy) onClose(); }}>
    {/* Remounted per preset: the fields are uncontrolled and take their defaults from the draft. */}
    <form ref={form} key={preset?.id ?? 'custom'} className="sheet-form" onSubmit={event => void submit(event)} onChange={event => { if ((event.target as HTMLElement).id !== 'config-text') recompose(); }}><fieldset className="sheet-fieldset" disabled={busy}>
      <div className="sheet-body">
        {!provider ? <div className="preset-bar">
          <span>{preset ? <>预设：<strong>{preset.name}</strong></> : '自定义配置'}</span>
          {preset ? <a href={preset.websiteUrl} target="_blank" rel="noreferrer">官网 ↗</a> : null}
          <button type="button" disabled={busy} onClick={() => setStage('pick')}>{preset ? '更换预设' : '选择预设'}</button>
        </div> : null}
        <section className="form-section" aria-labelledby="section-basic">
          <h3 id="section-basic">基本</h3>
          <label>配置名称<input name="name" autoFocus data-autofocus required maxLength={100} defaultValue={draft?.name} placeholder="例如：官方直连、工作网关" /></label>
          <label>备注<textarea name="notes" rows={2} maxLength={2000} defaultValue={draft?.notes} placeholder="可选，例如用途或额度" /></label>
        </section>
        <section className="form-section" aria-labelledby="section-connection">
          <h3 id="section-connection">连接</h3>
          <label>连接方式<select value={mode} onChange={e => setMode(e.target.value as 'api' | 'login')}><option value="api">API Key 与自定义端点</option><option value="login">{app === 'pi' ? '沿用 Pi 已有的 Provider' : '使用已有官方登录'}</option></select></label>
          {/* API fields stay mounted while in login mode so an unsaved draft survives switching back.
              A disabled fieldset is excluded from validation and FormData, so login saves carry no key. */}
          <fieldset hidden={mode !== 'api'} disabled={mode !== 'api'} aria-hidden={mode !== 'api'}>
            <label>Base URL<input name="baseUrl" type="url" required className="mono" defaultValue={draft?.baseUrl || (app === 'claude' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1')} placeholder="https://…（仅本机地址可用 http://）" /></label>
            <div className="field">
              <div className="field-head"><label htmlFor="api-key">API Key</label>{keyLink ? <a href={keyLink} target="_blank" rel="noreferrer">获取 API Key ↗</a> : null}</div>
              <div className="key-input">
                <input id="api-key" name="apiKey" className="mono" type={showKey ? 'text' : 'password'} autoComplete="new-password" spellCheck={false} required={!draft?.hasKey} placeholder={draft?.hasKey ? '已保存；留空保留原密钥' : '输入 API Key'} />
                <button type="button" aria-pressed={showKey} aria-label={showKey ? '隐藏 API Key' : '显示 API Key'} onClick={() => setShowKey(!showKey)}>{showKey ? '隐藏' : '显示'}</button>
              </div>
            </div>
            <div className={app === 'claude' ? 'pair' : undefined}>
              <label>API 协议<select name="protocol" defaultValue={draft?.protocol ?? (app === 'claude' ? 'anthropic-messages' : 'openai-responses')}>
                {app !== 'chatgpt' ? <option value="anthropic-messages">Anthropic Messages</option> : null}
                {app !== 'claude' ? <option value="openai-responses">OpenAI Responses</option> : null}
                {app === 'pi' ? <option value="openai-completions">OpenAI Chat Completions</option> : null}
              </select></label>
              {app === 'claude' ? <label>鉴权头<select name="claudeAuth" defaultValue={draft?.claudeAuth}><option value="api-key">X-Api-Key（官方 API）</option><option value="bearer">Authorization: Bearer（网关）</option></select></label> : null}
            </div>
            {app === 'pi' ? <p className="hint">Pi 使用 Anthropic Messages 时会自行追加 /v1/messages，Base URL 不要带 /v1；OpenAI 协议则需要带 /v1。</p> : null}
          </fieldset>
          {mode === 'login' && app === 'pi' ? <label>Pi Provider ID<input name="loginProvider" className="mono" required defaultValue={draft?.loginProvider ?? 'anthropic'} placeholder="pi /login 保存的，或 models.json 中定义的 Provider ID" /></label> : null}
          {mode === 'login' ? <p className="hint">{app === 'pi' ? '只切换 Pi 的默认 Provider 与模型，不改动该 Provider 本身（/login 保存的登录、auth.json 中的密钥或 models.json 中的定义）。' : '保留现有登录凭据。请先在目标 CLI 中登录，再用这组配置恢复官方路由。'}保存此模式后，已保存的 API Key 会被移除。</p> : null}
        </section>
        <section className="form-section" aria-labelledby="section-model">
          <h3 id="section-model">模型</h3>
          <div className="field">
            <div className="field-head"><label htmlFor="model">默认 Model</label>
              {mode === 'api' ? <button type="button" className="link-button" disabled={fetching || busy} onClick={() => void fetchModels()}>{fetching ? '获取中…' : '获取模型列表'}</button> : null}</div>
            <input id="model" name="model" className="mono" required maxLength={200} list="model-options" defaultValue={draft?.model} placeholder="供应商支持的精确模型 ID" />
            {modelStatus ? <p className={modelStatus.error ? 'error' : 'hint'} role={modelStatus.error ? 'alert' : 'status'}>{modelStatus.text}</p> : null}
          </div>
          <datalist id="model-options">{models.map(id => <option key={id} value={id} />)}</datalist>
          {app === 'claude' ? <fieldset hidden={mode !== 'api'} disabled={mode !== 'api'} aria-hidden={mode !== 'api'} className="aliases">
            <div className="field-head"><legend>别名映射（可选）</legend><button type="button" className="link-button" onClick={fillAliases}>全部填为默认 Model</button></div>
            <div className="pair">{aliasFields.map(([name, label]) => <label key={name}>{label}<input name={name} className="mono" maxLength={200} list="model-options" defaultValue={draft?.[name]} placeholder="留空则使用官方默认" /></label>)}</div>
            <p className="hint">Claude Code 的 haiku、sonnet、opus、fable 别名与后台任务会请求这些模型。网关没有 Anthropic 的默认模型 ID 时，至少填写 Haiku。</p>
          </fieldset> : null}
          {app === 'chatgpt' ? <>
            <div className="pair">
              <label>上下文窗口（可选）<input name="contextWindow" className="mono" type="number" min={1} step={1} defaultValue={draft?.contextWindow} placeholder="如 1000000" /></label>
              <label>自动压缩阈值（可选）<input name="autoCompactTokenLimit" className="mono" type="number" min={1} step={1} defaultValue={draft?.autoCompactTokenLimit} placeholder="如 900000" /></label>
            </div>
            <label>推理强度（可选）<select name="reasoningEffort" defaultValue={draft?.reasoningEffort ?? ''}>
              <option value="">不设置（保留 Codex 当前值）</option>{reasoningEfforts.map(level => <option key={level} value={level}>{level}</option>)}
            </select></label>
          </> : null}
        </section>
        <section className="form-section config-file" aria-labelledby="config-title">
          <div className="field-head">
            <h3 id="config-title">配置文件 <span className="file-name">{config?.name ?? (app === 'chatgpt' ? 'config.toml' : 'settings.json')}</span></h3>
            <span className="config-actions">
              {config?.format === 'json' ? <button type="button" className="link-button" onClick={formatConfig}>格式化</button> : null}
              <button type="button" className="link-button" onClick={() => void loadConfig()} title="放弃此处对全局设置的修改，重新读取本机文件">重新读取</button>
            </span>
          </div>
          <p className="hint" id="config-hint">{configHints[app]}</p>
          {config ? <>
            <textarea id="config-text" className="config-editor" aria-labelledby="config-title" spellCheck={false} wrap="off" rows={Math.min(30, Math.max(12, configText.split('\n').length + 1))}
              value={configText} onChange={e => setText(e.target.value)} onBlur={() => void syncFromText()} aria-describedby="config-hint" />
            <small className="config-path">{config.path}</small>
          </> : null}
          {configError ? <p className="error" role="alert">{configError}</p> : null}
        </section>
      </div>
      <div className="sheet-footer">
        {error ? <p role="alert" className="error">{error}</p> : null}
        <div className="dialog-actions"><small>数据以明文保存在本机</small><button type="button" onClick={onClose}>取消</button><button className="primary" type="submit">{busy ? '保存中…' : '保存配置'}</button></div>
      </div>
    </fieldset></form>
  </Modal>;
}
