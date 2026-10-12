import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { presetMatches, presetsFor, type Preset, type PresetFields } from '../core/presets';
import { reasoningEfforts, vendorIcons, type AppId, type ConfigDraft, type ConfigView, type ConfigViewRequest, type ModelList, type ModelListRequest, type ProviderIcon, type ProviderInput, type PublicProvider } from '../core/types';
import { Glyph, Mark, VendorTile, errorText, labels } from './common';
import { vendorMarks } from './marks';
import { autoIcon } from './vendor';

// Claude Code alias routes as the editor shows them; `smallFastModel` is also the background-task model.
const aliasFields: [keyof PresetFields & ('smallFastModel' | 'sonnetModel' | 'opusModel' | 'fableModel'), string][] = [
  ['smallFastModel', 'Haiku（后台任务）'], ['sonnetModel', 'Sonnet'], ['opusModel', 'Opus'], ['fableModel', 'Fable']
];
const draftFields = ['name', 'baseUrl', 'apiKey', 'claudeAuth', 'loginProvider', 'model', 'smallFastModel', 'sonnetModel', 'opusModel', 'fableModel', 'contextWindow', 'autoCompactTokenLimit', 'reasoningEffort'] as const;
// Fields a preset may set; applying one never touches the key or the notes the user already typed.
const presetInputs = ['baseUrl', 'protocol', 'claudeAuth', 'model', 'smallFastModel', 'sonnetModel', 'opusModel', 'fableModel', 'contextWindow', 'autoCompactTokenLimit', 'reasoningEffort', 'loginProvider'] as const;
const presetMark = (app: AppId, p: Preset) => {
  const f = p.apps[app];
  return autoIcon({ app, mode: f?.mode ?? 'api', baseUrl: f?.baseUrl ?? '', loginProvider: f?.loginProvider ?? 'anthropic' });
};

export function ProviderEditor({ app, provider, inUse, busy, error, onCancel, onSave, onRemove, listModels, configView }: {
  app: AppId; provider?: PublicProvider; inUse: boolean; busy: boolean; error: string;
  onCancel(): void; onSave(input: ProviderInput, options: { activate: boolean }): void; onRemove(): void;
  listModels(request: ModelListRequest): Promise<ModelList>; configView(request: ConfigViewRequest): Promise<ConfigView>;
}) {
  const [mode, setMode] = useState<'api' | 'login'>(provider?.mode ?? 'api');
  const [preset, setPreset] = useState<Preset | null>(null);
  const [query, setQuery] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<string[] | null>(null);
  const [modelFilter, setModelFilter] = useState('');
  const [modelStatus, setModelStatus] = useState<{ text: string; error: boolean } | null>(null);
  const [fetching, setFetching] = useState(false);
  const [preview, setPreview] = useState<ConfigView | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [icon, setIcon] = useState<ProviderIcon | ''>(provider?.icon ?? '');
  const [pickerOpen, setPickerOpen] = useState(false);
  // The fields the icon depends on, mirrored from the uncontrolled inputs as they change.
  const [look, setLook] = useState({ name: provider?.name ?? '', baseUrl: provider?.baseUrl || (app === 'claude' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'), loginProvider: provider?.loginProvider ?? 'anthropic' });
  const form = useRef<HTMLFormElement>(null);
  const activateNext = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const field = (name: string) => form.current?.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
  const presets = presetsFor(app).filter(p => presetMatches(p, query));
  const auto = autoIcon({ app, mode, baseUrl: look.baseUrl, loginProvider: look.loginProvider });
  const shownIcon = icon === 'letter' ? null : icon || auto;

  const readDraft = (): ConfigDraft => {
    if (!form.current) return { mode };
    const data = new FormData(form.current);
    return { mode, ...Object.fromEntries(draftFields.filter(name => data.has(name)).map(name => [name, String(data.get(name))])) } as ConfigDraft;
  };
  const refreshPreview = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => setPreview(await configView({ app, draft: readDraft(), providerId: provider?.id }).catch(e => ({ name: '', path: '', format: 'json', error: errorText(e) }) as ConfigView)), 300);
  };
  const changed = () => {
    setLook({ name: field('name')?.value ?? '', baseUrl: field('baseUrl')?.value ?? '', loginProvider: field('loginProvider')?.value ?? 'anthropic' });
    if (previewOpen) refreshPreview();
  };
  useEffect(() => { if (previewOpen) refreshPreview(); return () => clearTimeout(timer.current); }, [previewOpen, mode]);

  // A preset fills the endpoint and models in place; the key and notes already typed stay.
  const applyPreset = (next: Preset | null) => {
    const fields = next?.apps[app];
    const name = field('name');
    if (name && (!name.value || name.value === preset?.name)) name.value = next?.name ?? '';
    if (fields) {
      setMode(fields.mode ?? 'api');
      for (const key of presetInputs) { const input = field(key); if (input) input.value = String(fields[key] ?? (key === 'protocol' ? input.value : '')); }
    }
    setPreset(next); setModels(null); setModelStatus(null);
    changed();
  };
  const fetchModels = async () => {
    setFetching(true); setModelStatus(null);
    try {
      const result = await listModels({ app, baseUrl: field('baseUrl')?.value ?? '', apiKey: field('apiKey')?.value || undefined, providerId: provider?.id,
        protocol: (field('protocol')?.value ?? 'anthropic-messages') as ModelListRequest['protocol'], claudeAuth: (field('claudeAuth')?.value ?? 'api-key') as 'api-key' | 'bearer' });
      setModels(result.models); setModelFilter('');
      setModelStatus({ text: `共 ${result.models.length} 个模型，点一个填入“默认 Model”`, error: false });
    } catch (e) { setModels(null); setModelStatus({ text: errorText(e), error: true }); }
    finally { setFetching(false); }
  };
  const pickModel = (id: string) => { const input = field('model'); if (input) input.value = id; setModels(null); setModelStatus({ text: `已填入 ${id}`, error: false }); if (previewOpen) refreshPreview(); };
  const fillAliases = () => { const model = field('model')?.value ?? ''; for (const [name] of aliasFields) { const input = field(name); if (input) input.value = model; } if (previewOpen) refreshPreview(); };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? '').trim() || undefined;
    onSave({ id: provider?.id, app, name: String(data.get('name')), mode,
      baseUrl: String(data.get('baseUrl') ?? ''), model: String(data.get('model')),
      protocol: String(data.get('protocol') ?? (app === 'claude' ? 'anthropic-messages' : 'openai-responses')) as ProviderInput['protocol'],
      claudeAuth: String(data.get('claudeAuth') ?? 'api-key') as 'api-key' | 'bearer',
      loginProvider: String(data.get('loginProvider') ?? 'anthropic'),
      notes: String(data.get('notes')), apiKey: String(data.get('apiKey') ?? '') || undefined, icon: icon || undefined,
      smallFastModel: text('smallFastModel'), sonnetModel: text('sonnetModel'), opusModel: text('opusModel'), fableModel: text('fableModel'),
      reasoningEffort: text('reasoningEffort') as ProviderInput['reasoningEffort'],
      contextWindow: Number(data.get('contextWindow')) || undefined, autoCompactTokenLimit: Number(data.get('autoCompactTokenLimit')) || undefined },
      { activate: activateNext.current });
  };
  const keyLink = preset?.apiKeyUrl ?? preset?.websiteUrl;
  const shownModels = (models ?? []).filter(id => id.toLowerCase().includes(modelFilter.toLowerCase())).slice(0, 300);
  const iconText = icon === 'letter' ? '使用名称首字' : icon ? `已选「${vendorMarks[icon].label}」` : auto ? `自动：识别为「${vendorMarks[auto].label}」` : '自动：未识别，使用名称首字';
  const option = (value: ProviderIcon | '', label: string, tile: ReactNode) =>
    <button type="button" key={value || 'auto'} className={`icon-option ${icon === value ? 'on' : ''}`} aria-pressed={icon === value} onClick={() => setIcon(value)}>{tile}<span>{label}</span></button>;

  return <form ref={form} className="page editor" onSubmit={submit} onChange={changed} aria-labelledby="editor-title">
    <div className="page-bar">
      <button type="button" className="back" onClick={onCancel} disabled={busy}><Glyph name="chevron-left" />供应商</button>
      <span className="vsep" aria-hidden="true" />
      <h1 id="editor-title">{provider ? `编辑「${provider.name}」` : `添加 ${labels[app]} 供应商`}</h1>
    </div>
    <fieldset className="page-body" disabled={busy}>
      {!provider ? <section className="sec presets" aria-labelledby="presets-title">
        <div className="sec-head"><h2 id="presets-title">从预设开始</h2>
          <div className="search"><Glyph name="search" /><input type="search" className="preset-search" aria-label="搜索预设" placeholder="搜索，例如 DeepSeek、智谱" value={query} onChange={e => setQuery(e.target.value)} /></div></div>
        <div className="panel form">
          <div className="chips preset-chips" role="group" aria-label="预设">
            <button type="button" className={`chip ${preset === null ? 'on' : ''}`} aria-pressed={preset === null} onClick={() => applyPreset(null)}>自定义</button>
            {presets.map(p => { const mark = presetMark(app, p); return <button type="button" key={p.id} className={`chip ${mark ? 'with-mark' : ''} ${preset?.id === p.id ? 'on' : ''}`} aria-pressed={preset?.id === p.id} onClick={() => applyPreset(p)}>
              {mark ? <Mark className="glyph" svg={vendorMarks[mark].svg} /> : null}{p.name}</button>; })}
          </div>
          <p className="hint">{preset ? <>已填入 {preset.name} 的端点与模型，只需填写 API Key。<a href={preset.websiteUrl} target="_blank" rel="noreferrer">官网 ↗</a></> : '选一个预设会自动填入端点和模型；已输入的 Key 和备注会保留。'}</p>
        </div>
      </section> : null}

      <section className="sec" aria-labelledby="basic-title">
        <div className="sec-head"><h2 id="basic-title">基本</h2></div>
        <div className="panel form">
          <div className="icon-row">
            <VendorTile icon={shownIcon} name={look.name || '?'} size={40} />
            <div><b>图标</b><small>{iconText}</small></div>
            <button type="button" aria-expanded={pickerOpen} onClick={() => setPickerOpen(!pickerOpen)}>{pickerOpen ? '收起' : '更换…'}</button>
          </div>
          {pickerOpen ? <div className="icon-picker" role="group" aria-label="选择图标">
            {option('', '自动', <VendorTile icon={auto} name={look.name || '?'} size={36} />)}
            {vendorIcons.map(id => option(id, vendorMarks[id].label, <VendorTile icon={id} name="" size={36} />))}
            {option('letter', '名称首字', <VendorTile icon={null} name={look.name || '?'} size={36} />)}
          </div> : null}
          <div className="pair">
            <label>名称<input name="name" required maxLength={100} defaultValue={provider?.name} placeholder="例如：工作网关" data-autofocus autoFocus={!!provider} /></label>
            <label>连接方式<select value={mode} onChange={e => setMode(e.target.value as 'api' | 'login')}><option value="api">API Key</option><option value="login">{app === 'pi' ? '沿用 Pi 已有的 Provider' : '官方登录'}</option></select></label>
          </div>
          <label>备注<input name="notes" maxLength={2000} defaultValue={provider?.notes} placeholder="可选" /></label>
        </div>
      </section>

      <section className="sec" aria-labelledby="connection-title">
        <div className="sec-head"><h2 id="connection-title">连接</h2></div>
        <div className="panel form">
          {/* API fields stay mounted in login mode so a draft survives switching back; a disabled fieldset is left out of the form data. */}
          <fieldset hidden={mode !== 'api'} disabled={mode !== 'api'} aria-hidden={mode !== 'api'}>
            <label>Base URL<input name="baseUrl" type="url" required className="mono" defaultValue={provider?.baseUrl || (app === 'claude' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1')} placeholder="https://…" /></label>
            <div className="field">
              <div className="field-head"><label htmlFor="api-key">API Key</label>{keyLink ? <a href={keyLink} target="_blank" rel="noreferrer">获取 API Key ↗</a> : null}</div>
              <div className="key-input">
                <input id="api-key" name="apiKey" className="mono" type={showKey ? 'text' : 'password'} autoComplete="new-password" spellCheck={false} required={!provider?.hasKey} placeholder={provider?.hasKey ? '已保存，留空则不变' : '粘贴 API Key'} />
                <button type="button" className="icon-button" aria-label={showKey ? '隐藏密钥' : '显示密钥'} aria-pressed={showKey} onClick={() => setShowKey(!showKey)}><Glyph name={showKey ? 'eye-off' : 'eye'} /></button>
              </div>
            </div>
            <div className={app === 'chatgpt' ? undefined : 'pair'}>
              <label>协议<select name="protocol" defaultValue={provider?.protocol ?? (app === 'claude' ? 'anthropic-messages' : 'openai-responses')}>
                {app !== 'chatgpt' ? <option value="anthropic-messages">Anthropic Messages</option> : null}
                {app !== 'claude' ? <option value="openai-responses">OpenAI Responses</option> : null}
                {app === 'pi' ? <option value="openai-completions">OpenAI Chat Completions</option> : null}
              </select></label>
              {app === 'claude' ? <label>鉴权方式<select name="claudeAuth" defaultValue={provider?.claudeAuth}><option value="api-key">X-Api-Key（官方 API）</option><option value="bearer">Bearer Token（网关）</option></select></label> : null}
            </div>
            {app === 'pi' ? <p className="hint">Anthropic 协议的 Base URL 不带 /v1（Pi 会自行追加）；OpenAI 协议需要带 /v1。</p> : null}
          </fieldset>
          {mode === 'login' && app === 'pi' ? <label>Pi Provider ID<input name="loginProvider" className="mono" required defaultValue={provider?.loginProvider ?? 'anthropic'} placeholder="/login 保存的，或 models.json 中定义的 ID" /></label> : null}
          {mode === 'login' ? <p className="hint">{app === 'pi' ? '只切换 Pi 的默认 Provider 和模型，不改动它本身的定义与凭据。' : '使用目标 CLI 自己的登录。请先在 CLI 中登录。'}</p> : null}
        </div>
      </section>

      <section className="sec" aria-labelledby="model-title">
        <div className="sec-head"><h2 id="model-title">模型</h2></div>
        <div className="panel form">
          <div className="field">
            <div className="field-head"><label htmlFor="model">默认 Model</label>
              {mode === 'api' ? <button type="button" className="link" disabled={fetching || busy} onClick={() => void fetchModels()}>{fetching ? '获取中…' : '从供应商获取'}</button> : null}</div>
            <input id="model" name="model" className="mono" required maxLength={200} defaultValue={provider?.model} placeholder="供应商支持的模型 ID" />
            {modelStatus ? <p className={modelStatus.error ? 'error' : 'hint'} role={modelStatus.error ? 'alert' : 'status'}>{modelStatus.text}</p> : null}
            {models ? <div className="model-picker">
              <input type="search" aria-label="筛选模型" placeholder={`筛选 ${models.length} 个模型`} value={modelFilter} onChange={e => setModelFilter(e.target.value)} />
              <ul>{shownModels.map(id => <li key={id}><button type="button" className="mono" onClick={() => pickModel(id)}>{id}</button></li>)}</ul>
            </div> : null}
          </div>
          {app === 'claude' ? <fieldset hidden={mode !== 'api'} disabled={mode !== 'api'} aria-hidden={mode !== 'api'} className="aliases">
            <div className="field-head"><legend>别名映射（可选）</legend><button type="button" className="link" onClick={fillAliases}>全部用默认 Model</button></div>
            <div className="pair">{aliasFields.map(([name, label]) => <label key={name}>{label}<input name={name} className="mono" maxLength={200} defaultValue={provider?.[name]} placeholder="留空用官方默认" /></label>)}</div>
            <p className="hint">网关没有 Anthropic 的模型 ID 时，至少填 Haiku，否则 Claude Code 的后台任务会失败。</p>
          </fieldset> : null}
          {app === 'chatgpt' ? <div className="pair">
            <label>上下文窗口<input name="contextWindow" className="mono" type="number" min={1} step={1} defaultValue={provider?.contextWindow} placeholder="可选，如 1000000" /></label>
            <label>自动压缩阈值<input name="autoCompactTokenLimit" className="mono" type="number" min={1} step={1} defaultValue={provider?.autoCompactTokenLimit} placeholder="可选，如 900000" /></label>
            <label>推理强度<select name="reasoningEffort" defaultValue={provider?.reasoningEffort ?? ''}><option value="">不设置</option>{reasoningEfforts.map(level => <option key={level} value={level}>{level}</option>)}</select></label>
          </div> : null}
        </div>
      </section>

      <details className="panel preview" open={previewOpen} onToggle={e => setPreviewOpen((e.target as HTMLDetailsElement).open)}>
        <summary>使用后的配置文件预览 <span className="mono">{preview?.name || (app === 'chatgpt' ? 'config.toml' : 'settings.json')}</span></summary>
        <p className="hint">只读预览：切换到这个供应商后文件会是这样。其余全局设置请在侧栏“全局设置”中修改。</p>
        {preview?.error ? <p className="error" role="alert">{preview.error}</p> : <pre className="config-preview">{preview?.text ?? '正在生成…'}</pre>}
      </details>
    </fieldset>
    <div className="page-footer">
      {error ? <p role="alert" className="error">{error}</p> : null}
      <div className="footer-row">
        {provider ? <button type="button" className="danger" disabled={busy || inUse} title={inUse ? '正在使用的供应商需先切换到其他供应商才能删除' : undefined} onClick={onRemove}><Glyph name="trash-2" />删除供应商</button> : null}
        <span className="grow" />
        <button type="button" onClick={onCancel} disabled={busy}>取消</button>
        {inUse ? <button className="primary" type="submit" disabled={busy} onClick={() => { activateNext.current = false; }}>{busy ? '保存中…' : '保存并应用'}</button> : <>
          <button type="submit" disabled={busy} onClick={() => { activateNext.current = false; }}>{busy ? '保存中…' : '保存'}</button>
          <button className="primary" type="submit" disabled={busy} onClick={() => { activateNext.current = true; }}>保存并使用</button>
        </>}
      </div>
    </div>
  </form>;
}
