import { useEffect, useState } from 'react';
import type { AppId, Bridge, PublicProvider, Snapshot } from '../core/types';
import { Modal, errorText, initials, names, subtitles } from './common';
import { ProviderEditor } from './ProviderEditor';
declare global { interface Window { miswitch?: Bridge } }

const aliases = (p: PublicProvider) => ([['Haiku', p.smallFastModel], ['Sonnet', p.sonnetModel], ['Opus', p.opusModel], ['Fable', p.fableModel]] as const)
  .filter(([, model]) => model).map(([alias, model]) => `${alias} → ${model}`).join('，');
function ProviderCard({ p, selected, drift, edited, busy, onActivate, onEdit, onRemove }: { p: PublicProvider; selected: boolean; drift: boolean; edited: boolean; busy: boolean; onActivate(): void; onEdit(): void; onRemove(): void }) {
  const current = selected && !drift && !edited;
  return <article className={`provider-card ${selected ? 'selected' : ''}`}>
    <div className="card-top"><span className={`app-icon ${p.app}`}>{initials[p.app]}</span><span className={`badge ${current ? 'green' : ''}`}>{selected ? drift ? '管理字段已变更' : edited ? '已编辑，待重新写入' : '当前写入' : p.mode === 'api' ? 'API' : p.app === 'pi' ? '已有 Provider' : '官方登录'}</span></div>
    <h2>{p.name}</h2><p className="endpoint">{p.mode === 'api' ? p.baseUrl : p.app === 'pi' ? `沿用 Pi Provider：${p.loginProvider}` : '使用 CLI 已有登录凭据'}</p>
    <dl><div><dt>Model</dt><dd>{p.model}</dd></div>{aliases(p) ? <div><dt>别名映射</dt><dd>{aliases(p)}</dd></div> : null}{p.reasoningEffort ? <div><dt>推理强度</dt><dd>{p.reasoningEffort}</dd></div> : null}<div><dt>鉴权</dt><dd>{p.mode === 'login' ? '由 CLI 管理，未验证' : p.hasKey ? '••••••••' : '未设置'}</dd></div></dl>
    <p className="notes">{p.notes || '暂无备注'}</p>
    <div className="card-actions"><button className={current ? '' : 'primary'} disabled={busy} onClick={onActivate}>{selected && !drift ? '重新写入' : '启用配置'}</button><button disabled={busy} onClick={onEdit}>编辑</button><button className="danger-text" disabled={busy || selected} onClick={onRemove}>删除</button></div>
  </article>;
}
export function App() {
  const [app, setApp] = useState<AppId>('claude');
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  const [notice, setNotice] = useState('');
  const [editor, setEditor] = useState<{ provider?: PublicProvider }>();
  const [confirmation, setConfirmation] = useState<{ title: string; body: string; execute(): void }>();
  const bridge = window.miswitch;
  useEffect(() => {
    let mounted = true;
    // The first load also imports each CLI's current configuration once, so it appears as the first provider.
    if (bridge) void bridge.importLive().then(s => { if (mounted) setSnapshot(s); }).catch(e => { if (mounted) { setLoadFailed(true); setError(`读取失败：${errorText(e)}`); } });
    return () => { mounted = false; };
  }, [bridge]);
  const act = async (operation: () => Promise<Snapshot>, message: string | ((s: Snapshot) => string), closeEditor = false) => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { const next = await operation(); setSnapshot(next); setLoadFailed(false); setNotice(typeof message === 'string' ? message : message(next)); if (closeEditor) setEditor(undefined); setConfirmation(undefined); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  const diagnosis = snapshot?.diagnostics.find(d => d.app === app);
  const selected = snapshot?.active[app]?.providerId;
  const providers = snapshot?.providers.filter(p => p.app === app) ?? [];
  const backups = snapshot?.backups.filter(b => b.app === app) ?? [];
  const pending = snapshot?.pending ?? null;
  // Every write is refused by the main process while a conflicting journal exists; mirror that in the controls.
  const blocked = busy || !!pending;
  const loading = !!bridge && !snapshot && !loadFailed;
  const statusText = loading ? '正在读取本地配置…' : loadFailed ? '无法读取本地配置' : diagnosis?.state === 'written' ? (diagnosis.edited ? '已写入编辑前的配置' : diagnosis.reformatted ? '配置已写入（文件已被重排）' : '配置已写入')
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
      <section className="status-panel" aria-label="本地状态"><div><span className={`dot ${diagnosis?.state === 'drift' || diagnosis?.edited ? 'amber' : ''}`} /><strong>{statusText}</strong><span>下一次启动生效</span></div><p>{diagnosis?.paths.join(' · ') || '正在读取配置路径…'}</p><button disabled={!bridge || busy || loading} onClick={() => void act(() => bridge!.snapshot(), '本地状态已刷新')}>{busy ? '处理中…' : '刷新检测 ↻'}</button></section>
      <div className="section-heading"><h2>供应商配置 <span>{providers.length}</span></h2><span>切换前自动备份</span></div>
      <section className="provider-grid" aria-label="供应商列表">{providers.map(p => <ProviderCard key={p.id} p={p} selected={selected === p.id} drift={diagnosis?.state === 'drift'} edited={!!diagnosis?.edited} busy={blocked} onActivate={() => void act(() => bridge!.activate(p.id), `已写入「${p.name}」；请在目标 CLI 中验证并启动新会话。`)} onEdit={() => { setError(''); setEditor({ provider: p }); }} onRemove={() => setConfirmation({ title: '删除配置', body: `删除「${p.name}」？历史备份将保留。`, execute: () => void act(() => bridge!.remove(p.id), '配置已删除') })} />)}
      {loading ? <p className="loading" role="status">正在读取本地配置…</p> : loadFailed ? null : providers.length === 0 ? <div className="empty"><span>＋</span><h2>添加第一组配置</h2><p>官方 API、自定义网关或已有登录，随时切换。</p>{diagnosis?.initialized ? <button disabled={blocked} onClick={() => void act(() => bridge!.importLive(app), next => next.providers.some(p => p.app === app) ? '已从本机配置导入；目标文件未被修改。' : '没有导入任何配置，原因见上方提示。')}>从本机配置导入</button> : null}</div> : null}</section>
      <details className="diagnostics"><summary>本地诊断与注意事项</summary>{diagnosis?.warnings.map(w => <p key={w}>{w}</p>)}<p>未初始化时，启用 API 配置将创建所需目录。官方登录请先运行目标 CLI 的登录流程。</p></details>
      <section className="backup-panel"><div className="section-heading"><h2>历史备份 <span>{backups.length}</span></h2><span>每个应用保留最近 10 次</span></div>{backups.length === 0 ? <p className="hint">第一次切换后，原配置会出现在这里。</p> : backups.map(b => <div className="backup-row" key={b.id}><div><strong>{new Date(b.createdAt).toLocaleString()}</strong><small>{b.files.join(' · ')}</small></div><button disabled={blocked} onClick={() => setConfirmation({ title: '恢复历史备份', body: '恢复将覆盖当前应用配置，并先备份当前文件；恢复后重新检测状态。', execute: () => void act(() => bridge!.restore(b.id), '历史配置已恢复；当前标记已清除，请在目标 CLI 中验证。') })}>恢复</button></div>)}</section>
      <footer>MiSwitch · 本机明文存储 · Claude Code / Codex CLI / Pi Coding Agent</footer>
    </main>
    {editor ? <ProviderEditor key={editor.provider?.id ?? app} app={app} provider={editor.provider} busy={busy} error={error} listModels={request => bridge!.listModels(request)} configView={request => bridge!.configView(request)} parseConfig={request => bridge!.parseConfig(request)} onClose={() => { setEditor(undefined); setError(''); }} onSave={(input, config) => void act(() => bridge!.save(input, config), next => !input.id || input.id !== selected ? '配置已保存；点击启用配置后写入目标工具。'
      : next.diagnostics.find(d => d.app === input.app)?.edited ? '配置已保存；目标工具仍使用编辑前的设置，点击重新写入后生效。' : '配置已保存；写入目标工具的字段没有变化。', true)} /> : null}
    {confirmation ? <Modal title={confirmation.title} onClose={() => { if (!busy) { setConfirmation(undefined); setError(''); } }}><p>{confirmation.body}</p>{error ? <p role="alert" className="error">{error}</p> : null}<div className="dialog-actions"><button disabled={busy} onClick={() => { setConfirmation(undefined); setError(''); }}>取消</button><button disabled={busy} className="primary" onClick={confirmation.execute}>{busy ? '处理中…' : '确认'}</button></div></Modal> : null}
  </div>;
}
