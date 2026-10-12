import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { AppId, Bridge, ProviderInput, PublicProvider, Snapshot } from '../core/types';
declare global { interface Window { miswitch?: Bridge } }
const names: Record<AppId, string> = { claude: 'Claude', chatgpt: 'ChatGPT', pi: 'Pi' };
const subtitles: Record<AppId, string> = { claude: 'Claude Code', chatgpt: 'OpenAI Codex CLI', pi: 'Pi Coding Agent' };
const initials: Record<AppId, string> = { claude: 'C', chatgpt: '◎', pi: 'π' };

function Modal({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} onCancel={event => { event.preventDefault(); onClose(); }} aria-labelledby="modal-title">
    <div className="dialog-head"><h2 id="modal-title">{title}</h2><button className="icon-button" aria-label="关闭弹窗" onClick={onClose}>×</button></div>{children}
  </dialog>;
}
function ProviderEditor({ app, provider, busy, error, onClose, onSave }: { app: AppId; provider?: PublicProvider; busy: boolean; error: string; onClose(): void; onSave(input: ProviderInput): void }) {
  const [mode, setMode] = useState<'api' | 'login'>(provider?.mode ?? 'api');
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onSave({ id: provider?.id, app, name: String(data.get('name')), mode,
      baseUrl: String(data.get('baseUrl') ?? ''), model: String(data.get('model')),
      protocol: String(data.get('protocol') ?? (app === 'claude' ? 'anthropic-messages' : 'openai-responses')) as ProviderInput['protocol'],
      claudeAuth: String(data.get('claudeAuth') ?? 'api-key') as 'api-key' | 'bearer',
      loginProvider: String(data.get('loginProvider') ?? 'anthropic'),
      notes: String(data.get('notes')), apiKey: String(data.get('apiKey') ?? '') || undefined,
      contextWindow: Number(data.get('contextWindow')) || undefined, autoCompactTokenLimit: Number(data.get('autoCompactTokenLimit')) || undefined });
  };
  return <Modal title={`${provider ? '编辑' : '添加'} ${names[app]} 配置`} onClose={() => { if (!busy) onClose(); }}>
    <form onSubmit={submit}><fieldset disabled={busy}>
      <label>配置名称<input name="name" autoFocus required maxLength={100} defaultValue={provider?.name} placeholder="例如：官方直连 / 工作网关" /></label>
      <label>连接方式<select value={mode} onChange={e => setMode(e.target.value as 'api' | 'login')}><option value="api">API Key / 自定义端点</option><option value="login">使用已有官方登录</option></select></label>
      {mode === 'api' ? <>
        <label>Base URL<input name="baseUrl" type="url" required defaultValue={provider?.baseUrl || (app === 'claude' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1')} placeholder="https://… ；仅本机地址可用 http://" /></label>
        <label>API Key<input name="apiKey" type="password" autoComplete="new-password" required={!provider?.hasKey} placeholder={provider?.hasKey ? '已保存；留空保留原密钥' : '输入 API Key'} /></label>
        <label>API 协议<select name="protocol" defaultValue={provider?.protocol ?? (app === 'claude' ? 'anthropic-messages' : 'openai-responses')}>
          {app !== 'chatgpt' ? <option value="anthropic-messages">Anthropic Messages</option> : null}
          {app !== 'claude' ? <option value="openai-responses">OpenAI Responses</option> : null}
          {app === 'pi' ? <option value="openai-completions">OpenAI Chat Completions</option> : null}
        </select></label>
        {app === 'claude' ? <label>鉴权头<select name="claudeAuth" defaultValue={provider?.claudeAuth}><option value="api-key">X-Api-Key（官方 API）</option><option value="bearer">Authorization: Bearer（网关）</option></select></label> : null}
        {app === 'pi' ? <p className="hint">Pi 使用 Anthropic Messages 时会自行追加 /v1/messages，Base URL 请不要带 /v1；OpenAI 协议则需要带 /v1。</p> : null}
      </> : <p className="hint">保留现有登录凭据。请先在目标 CLI 中登录，再用该配置恢复官方路由。</p>}
      {mode === 'login' && app === 'pi' ? <label>已登录的 Pi Provider ID<input name="loginProvider" required defaultValue={provider?.loginProvider ?? 'anthropic'} placeholder="与 pi /login 保存的 Provider ID 相同" /></label> : null}
      <label>默认 Model<input name="model" required maxLength={200} defaultValue={provider?.model} placeholder="输入供应商支持的精确模型 ID" /></label>
      {app === 'chatgpt' ? <div className="pair">
        <label>上下文窗口（可选）<input name="contextWindow" type="number" min={1} step={1} defaultValue={provider?.contextWindow} placeholder="model_context_window，如 1000000" /></label>
        <label>自动压缩阈值（可选）<input name="autoCompactTokenLimit" type="number" min={1} step={1} defaultValue={provider?.autoCompactTokenLimit} placeholder="model_auto_compact_token_limit" /></label>
      </div> : null}
      <label>备注<textarea name="notes" rows={2} maxLength={2000} defaultValue={provider?.notes} /></label>
      <p className="hint">数据仅保存在本机，使用明文文件。请勿把配置目录加入版本控制或公开同步。</p>
      {error ? <p role="alert" className="error">{error}</p> : null}
      <div className="dialog-actions"><button type="button" onClick={onClose}>取消</button><button className="primary" type="submit">{busy ? '保存中…' : '保存配置'}</button></div>
    </fieldset></form>
  </Modal>;
}
function ProviderCard({ p, selected, drift, busy, onActivate, onEdit, onRemove }: { p: PublicProvider; selected: boolean; drift: boolean; busy: boolean; onActivate(): void; onEdit(): void; onRemove(): void }) {
  return <article className={`provider-card ${selected ? 'selected' : ''}`}>
    <div className="card-top"><span className={`app-icon ${p.app}`}>{initials[p.app]}</span><span className={`badge ${selected && !drift ? 'green' : ''}`}>{selected ? drift ? '管理字段已变更' : '当前写入' : p.mode === 'login' ? '官方登录' : 'API'}</span></div>
    <h2>{p.name}</h2><p className="endpoint">{p.mode === 'login' ? '使用 CLI 已有登录凭据' : p.baseUrl}</p>
    <dl><div><dt>Model</dt><dd>{p.model}</dd></div><div><dt>鉴权</dt><dd>{p.mode === 'login' ? '已有 OAuth' : p.hasKey ? '••••••••' : '未设置'}</dd></div></dl>
    <p className="notes">{p.notes || '暂无备注'}</p>
    <div className="card-actions"><button className={selected && !drift ? '' : 'primary'} disabled={busy} onClick={onActivate}>{selected && !drift ? '重新写入' : '启用配置'}</button><button disabled={busy} onClick={onEdit}>编辑</button><button className="danger-text" disabled={busy || selected} onClick={onRemove}>删除</button></div>
  </article>;
}
export function App() {
  const [app, setApp] = useState<AppId>('claude');
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editor, setEditor] = useState<{ provider?: PublicProvider }>();
  const [confirmation, setConfirmation] = useState<{ title: string; body: string; execute(): void }>();
  const bridge = window.miswitch;
  useEffect(() => {
    let mounted = true;
    if (bridge) void bridge.snapshot().then(s => { if (mounted) setSnapshot(s); }).catch(() => { if (mounted) setError('读取失败，请检查本机配置文件与目录权限。'); });
    return () => { mounted = false; };
  }, [bridge]);
  const act = async (operation: () => Promise<Snapshot>, message: string, closeEditor = false) => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { setSnapshot(await operation()); setNotice(message); if (closeEditor) setEditor(undefined); setConfirmation(undefined); }
    catch (e) { setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : '操作失败'); }
    finally { setBusy(false); }
  };
  const diagnosis = snapshot?.diagnostics.find(d => d.app === app);
  const selected = snapshot?.active[app]?.providerId;
  const providers = snapshot?.providers.filter(p => p.app === app) ?? [];
  const backups = snapshot?.backups.filter(b => b.app === app) ?? [];
  const pending = snapshot?.pending ?? null;
  // Every write is refused by the main process while a conflicting journal exists; mirror that in the controls.
  const blocked = busy || !!pending;
  const statusText = diagnosis?.state === 'written' ? (diagnosis.reformatted ? '配置已写入（文件已被重排）' : '配置已写入')
    : diagnosis?.state === 'drift' ? '管理字段已被外部修改' : diagnosis?.initialized ? '检测到本地配置' : '尚未检测到配置文件';
  return <div className="layout">
    <aside><div className="brand"><span>M</span>MiSwitch</div><p className="sidebar-label">WORKSPACE</p><nav aria-label="应用选择">{(['claude', 'chatgpt', 'pi'] as AppId[]).map(id => <button key={id} aria-current={id === app ? 'page' : undefined} className={id === app ? 'nav-active' : ''} disabled={busy || !!editor || !!confirmation} onClick={() => { setApp(id); setError(''); setNotice(''); }}><span className={`app-icon small ${id}`}>{initials[id]}</span><span>{names[id]}<small>{subtitles[id]}</small></span></button>)}</nav><div className="local-only"><span className="dot" /> 本地配置管理<small>三个应用 · 一个入口</small></div></aside>
    <main><header><div><p className="eyebrow">PROVIDER HUB</p><h1>{names[app]} 配置</h1><p className="subtitle">为 {subtitles[app]} 管理供应商与默认模型</p></div><button className="primary" disabled={!bridge || blocked || !snapshot} onClick={() => { setError(''); setEditor({}); }}>＋ 添加配置</button></header>
      {!bridge ? <div className="alert">这是浏览器预览。运行 npm run dev 打开桌面应用后，可管理本机配置。</div> : null}
      {pending ? <section className="error alert pending" role="alert" aria-label="待决日志">
        <strong>存在未完成的切换日志{pending.app ? `（${names[pending.app]}）` : ''}</strong>
        <p>{pending.valid ? '上次切换未完成，且以下文件之后被其他程序修改。为避免覆盖外部修改，所有写入操作已暂停。' : 'pending.json 无法解析，无法自动回退。切换前的备份仍在历史备份中。'}</p>
        {pending.conflicts.length ? <ul>{pending.conflicts.map(path => <li key={path}>{path}</li>)}</ul> : null}
        <p>处理方式：核对以上文件内容后放弃日志。放弃时只回退仍为本工具写入内容的文件，外部修改一律保留；之后可从历史备份恢复或重新启用配置。</p>
        <button disabled={busy} onClick={() => setConfirmation({ title: '放弃待决日志', body: '将删除 pending.json，并回退仍为本工具写入内容的文件；被外部修改的文件保持原样。', execute: () => void act(() => bridge!.resolveJournal(pending.id), '待决日志已处理；请重新检查各应用状态。') })}>放弃日志并回退本工具的写入</button>
      </section> : null}
      {snapshot?.warnings.map(w => <div className="alert" key={w} role="status">{w}</div>)}
      {notice ? <div className="success" role="status">✓ {notice}</div> : null}
      {error && !editor && !confirmation ? <div className="error alert" role="alert">{error}</div> : null}
      <section className="status-panel" aria-label="本地状态"><div><span className={`dot ${diagnosis?.state === 'drift' ? 'amber' : ''}`} /><strong>{statusText}</strong><span>下一次启动生效</span></div><p>{diagnosis?.paths.join(' · ') || '正在读取配置路径…'}</p><button disabled={!bridge || busy} onClick={() => void act(() => bridge!.snapshot(), '本地状态已刷新')}>刷新检测 ↻</button></section>
      <div className="section-heading"><h2>供应商配置 <span>{providers.length}</span></h2><span>切换前自动备份</span></div>
      <section className="provider-grid" aria-label="供应商列表">{providers.map(p => <ProviderCard key={p.id} p={p} selected={selected === p.id} drift={diagnosis?.state === 'drift'} busy={blocked} onActivate={() => void act(() => bridge!.activate(p.id), `已写入「${p.name}」；请在目标 CLI 中验证并启动新会话。`)} onEdit={() => { setError(''); setEditor({ provider: p }); }} onRemove={() => setConfirmation({ title: '删除配置', body: `删除「${p.name}」？历史备份将保留。`, execute: () => void act(() => bridge!.remove(p.id), '配置已删除') })} />)}
      {providers.length === 0 ? <div className="empty"><span>＋</span><h2>添加第一组配置</h2><p>官方 API、自定义网关或已有登录，随时切换。</p></div> : null}</section>
      <details className="diagnostics"><summary>本地诊断与注意事项</summary>{diagnosis?.warnings.map(w => <p key={w}>{w}</p>)}<p>未初始化时，启用 API 配置将创建所需目录。官方登录请先运行目标 CLI 的登录流程。</p></details>
      <section className="backup-panel"><div className="section-heading"><h2>历史备份 <span>{backups.length}</span></h2><span>每个应用保留最近 10 次</span></div>{backups.length === 0 ? <p className="hint">第一次切换后，原配置会出现在这里。</p> : backups.map(b => <div className="backup-row" key={b.id}><div><strong>{new Date(b.createdAt).toLocaleString()}</strong><small>{b.files.join(' · ')}</small></div><button disabled={blocked} onClick={() => setConfirmation({ title: '恢复历史备份', body: '恢复将覆盖当前应用配置，并先备份当前文件；恢复后重新检测状态。', execute: () => void act(() => bridge!.restore(b.id), '历史配置已恢复；当前标记已清除，请在目标 CLI 中验证。') })}>恢复</button></div>)}</section>
      <footer>MiSwitch · 本机明文存储 · Claude Code / Codex CLI / Pi Coding Agent</footer>
    </main>
    {editor ? <ProviderEditor key={editor.provider?.id ?? app} app={app} provider={editor.provider} busy={busy} error={error} onClose={() => { setEditor(undefined); setError(''); }} onSave={input => void act(() => bridge!.save(input), '配置已保存；点击启用配置后写入目标工具。', true)} /> : null}
    {confirmation ? <Modal title={confirmation.title} onClose={() => { if (!busy) { setConfirmation(undefined); setError(''); } }}><p>{confirmation.body}</p>{error ? <p role="alert" className="error">{error}</p> : null}<div className="dialog-actions"><button disabled={busy} onClick={() => { setConfirmation(undefined); setError(''); }}>取消</button><button disabled={busy} className="primary" onClick={confirmation.execute}>{busy ? '处理中…' : '确认'}</button></div></Modal> : null}
  </div>;
}
