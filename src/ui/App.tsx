import { useEffect, useState } from 'react';
import type { AppId, Bridge, Diagnosis, PublicProvider, Snapshot } from '../core/types';
import { Modal, errorText, names, subtitles } from './common';
import { ProviderEditor } from './ProviderEditor';
declare global { interface Window { miswitch?: Bridge } }

const apps: AppId[] = ['claude', 'chatgpt', 'pi'];
const aliases = (p: PublicProvider) => ([['Haiku', p.smallFastModel], ['Sonnet', p.sonnetModel], ['Opus', p.opusModel], ['Fable', p.fableModel]] as const)
  .filter(([, model]) => model).map(([alias, model]) => `${alias}：${model}`).join('\n');
const endpoint = (p: PublicProvider) => p.mode === 'api' ? p.baseUrl.replace(/^https?:\/\//, '') : p.app === 'pi' ? `沿用 Pi Provider：${p.loginProvider}` : '使用 CLI 已有登录';
const kind = (p: PublicProvider) => p.mode === 'api' ? 'API' : p.app === 'pi' ? '已有 Provider' : '官方登录';
// One word for the state of the provider an app currently points at: live, waiting for a rewrite, or changed outside.
type Live = 'live' | 'edited' | 'drift';
const liveState = (d?: Diagnosis): Live | null => !d || d.state === 'none' ? null : d.state === 'drift' ? 'drift' : d.edited ? 'edited' : 'live';
const liveText: Record<Live, string> = { live: '当前写入', edited: '已编辑，待重新写入', drift: '管理字段已变更' };

function ProviderRow({ p, live, busy, onActivate, onEdit, onRemove }: { p: PublicProvider; live: Live | null; busy: boolean; onActivate(): void; onEdit(): void; onRemove(): void }) {
  const routes = aliases(p);
  return <li className={`provider-row ${live ? `active ${live}` : ''}`}>
    <span className="lamp" aria-hidden="true" />
    <div className="row-name">
      <h2>{p.name}</h2>
      {p.notes ? <p className="notes">{p.notes}</p> : null}
    </div>
    <p className="row-endpoint" title={p.mode === 'api' ? p.baseUrl : undefined}>{endpoint(p)}</p>
    <p className="row-model" title={routes || undefined}>{p.model}{routes ? <span className="routes">+{routes.split('\n').length} 个别名</span> : null}{p.reasoningEffort ? <span className="routes">推理 {p.reasoningEffort}</span> : null}</p>
    <span className={`badge ${live === 'live' ? 'green' : live ? 'amber' : ''}`}>{live ? liveText[live] : kind(p)}</span>
    <div className="card-actions">
      <button className={live === 'live' ? '' : 'primary'} disabled={busy} onClick={onActivate}>{live && live !== 'drift' ? '重新写入' : '启用'}</button>
      <button disabled={busy} onClick={onEdit}>编辑</button>
      <button className="danger-text" disabled={busy || !!live} title={live ? '当前写入的配置需先切换到另一组才能删除' : undefined} onClick={onRemove}>删除</button>
    </div>
  </li>;
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
  // Notices confirm a finished action; they leave on their own and never push the content around.
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 5000); return () => clearTimeout(timer); }, [notice]);
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
  const home = (path: string) => snapshot?.home && path.startsWith(`${snapshot.home}/`) ? `~${path.slice(snapshot.home.length)}` : path;
  const live = liveState(diagnosis);
  const statusText = loading ? '正在读取本地配置…' : loadFailed ? '无法读取本地配置' : diagnosis?.state === 'written' ? (diagnosis.edited ? '已写入编辑前的配置' : diagnosis.reformatted ? '配置已写入（文件已被 CLI 重排）' : '配置已写入')
    : diagnosis?.state === 'drift' ? '管理字段已被外部修改' : diagnosis?.initialized ? '检测到本地配置，尚未由 MiSwitch 写入' : '尚未检测到配置文件';
  const navStatus = (id: AppId) => {
    const d = snapshot?.diagnostics.find(x => x.app === id);
    const state = liveState(d);
    const name = snapshot?.providers.find(p => p.id === snapshot.active[id]?.providerId)?.name;
    return { state, text: !snapshot ? '…' : state && name ? name : d?.initialized ? '未由 MiSwitch 写入' : '没有配置文件' };
  };
  return <div className="layout">
    <aside>
      <div className="brand"><span className="brand-mark" aria-hidden="true"><span /></span>MiSwitch</div>
      <nav aria-label="应用选择">{apps.map(id => {
        const status = navStatus(id);
        return <button key={id} aria-current={id === app ? 'page' : undefined} className={id === app ? 'nav-active' : ''} disabled={busy || !!editor || !!confirmation} onClick={() => { setApp(id); setError(''); setNotice(''); }}>
          <span className="nav-app">{subtitles[id]}</span>
          <span className={`nav-status ${status.state ?? 'idle'}`}><span className="lamp" aria-hidden="true" />{status.text}</span>
        </button>;
      })}</nav>
    </aside>
    <main>
      <header>
        <div><h1>{subtitles[app]}</h1></div>
        <button className="primary" disabled={!bridge || blocked || !snapshot} onClick={() => { setError(''); setEditor({}); }}>＋ 添加配置</button>
      </header>
      <section className="status-panel" aria-label="本地状态">
        <p className={`status-line ${live === 'drift' || live === 'edited' ? 'attention' : live ? 'live' : ''}`}><span className="lamp" aria-hidden="true" /><strong>{statusText}</strong>{live ? <span>新会话生效</span> : null}</p>
        <ul className="paths">{diagnosis?.paths.map(path => <li key={path} title={path}>{home(path)}</li>) ?? <li>正在读取配置路径…</li>}</ul>
        <button className="link-button" disabled={!bridge || busy || loading} onClick={() => void act(() => bridge!.snapshot(), '本地状态已刷新')}>{busy ? '处理中…' : '刷新检测'}</button>
      </section>
      {!bridge ? <div className="alert">这是浏览器预览。运行 npm run dev 打开桌面应用后，可管理本机配置。</div> : null}
      {pending ? <section className="error alert pending" role="alert" aria-label="待决日志">
        <strong>存在未完成的切换日志{pending.app ? `（${names[pending.app]}）` : ''}</strong>
        <p>{pending.valid ? '上次切换未完成，且以下文件之后被其他程序修改。为避免覆盖外部修改，所有写入操作已暂停。' : 'pending.json 无法解析，无法自动回退。切换前的备份仍在历史备份中。'}</p>
        {pending.conflicts.length ? <ul>{pending.conflicts.map(path => <li key={path}>{home(path)}</li>)}</ul> : null}
        <p>处理方式：核对以上文件内容后放弃日志。放弃时只回退仍为本工具写入内容的文件，外部修改一律保留；之后可从历史备份恢复或重新启用配置。</p>
        <button disabled={busy} onClick={() => setConfirmation({ title: '放弃待决日志', body: '将删除 pending.json，并回退仍为本工具写入内容的文件；被外部修改的文件保持原样。', execute: () => void act(() => bridge!.resolveJournal(pending.id), '待决日志已处理；请重新检查各应用状态。') })}>放弃日志并回退本工具的写入</button>
      </section> : null}
      {snapshot?.warnings.map(w => <div className="alert" key={w} role="status">{w}</div>)}
      {error && !editor && !confirmation ? <div className="error alert" role="alert">{error}</div> : null}
      <div className="section-heading"><h2>供应商 <span>{providers.length}</span></h2><span>切换前自动备份</span></div>
      <ul className="provider-list" aria-label="供应商列表">
        {providers.map(p => <ProviderRow key={p.id} p={p} live={selected === p.id ? live : null} busy={blocked}
          onActivate={() => void act(() => bridge!.activate(p.id), `已写入「${p.name}」；请在目标 CLI 中启动新会话验证。`)}
          onEdit={() => { setError(''); setEditor({ provider: p }); }}
          onRemove={() => setConfirmation({ title: '删除配置', body: `删除「${p.name}」？历史备份会保留。`, execute: () => void act(() => bridge!.remove(p.id), '配置已删除') })} />)}
        {loading ? <li className="list-note" role="status">正在读取本地配置…</li> : loadFailed ? null : providers.length === 0 ? <li className="empty">
          <h2>还没有 {subtitles[app]} 的配置</h2>
          <p>添加官方 API、自定义网关或已有登录，之后一键切换。</p>
          <div className="empty-actions">
            <button className="primary" disabled={blocked || !bridge} onClick={() => { setError(''); setEditor({}); }}>添加配置</button>
            {diagnosis?.initialized ? <button disabled={blocked} onClick={() => void act(() => bridge!.importLive(app), next => next.providers.some(p => p.app === app) ? '已从本机配置导入；目标文件未被修改。' : '没有导入任何配置，原因见上方提示。')}>从本机配置导入</button> : null}
          </div>
        </li> : null}
      </ul>
      <details className="fold">
        <summary>历史备份 <span>{backups.length}</span><small>每个应用保留最近 10 次</small></summary>
        {backups.length === 0 ? <p className="hint">第一次切换后，切换前的原配置会出现在这里。</p> : <ul className="backup-list">{backups.map(b => <li className="backup-row" key={b.id}>
          <div><strong>{new Date(b.createdAt).toLocaleString()}</strong><small>{b.files.join('、')}</small></div>
          <button disabled={blocked} onClick={() => setConfirmation({ title: '恢复历史备份', body: '恢复会覆盖当前应用的配置文件，覆盖前先备份当前文件；恢复后当前写入标记会清除。', execute: () => void act(() => bridge!.restore(b.id), '历史配置已恢复；请在目标 CLI 中验证。') })}>恢复</button>
        </li>)}</ul>}
      </details>
      <details className="fold">
        <summary>诊断与注意事项</summary>
        <div className="diagnostics">{diagnosis?.warnings.map(w => <p key={w}>{w}</p>)}<p>未初始化时，启用 API 配置会创建所需目录。官方登录请先运行目标 CLI 的登录流程。</p></div>
      </details>
    </main>
    <div className="toast-region" role="status" aria-live="polite">{notice ? <p className="toast">{notice}</p> : null}</div>
    {editor ? <ProviderEditor key={editor.provider?.id ?? app} app={app} provider={editor.provider} busy={busy} error={error} listModels={request => bridge!.listModels(request)} configView={request => bridge!.configView(request)} parseConfig={request => bridge!.parseConfig(request)} onClose={() => { setEditor(undefined); setError(''); }} onSave={(input, config) => void act(() => bridge!.save(input, config), next => !input.id || input.id !== selected ? '配置已保存；点击启用后写入目标工具。'
      : next.diagnostics.find(d => d.app === input.app)?.edited ? '配置已保存；目标工具仍使用编辑前的设置，点击重新写入后生效。' : '配置已保存；写入目标工具的字段没有变化。', true)} /> : null}
    {confirmation ? <Modal title={confirmation.title} onClose={() => { if (!busy) { setConfirmation(undefined); setError(''); } }}><p>{confirmation.body}</p>{error ? <p role="alert" className="error">{error}</p> : null}<div className="dialog-actions"><button disabled={busy} onClick={() => { setConfirmation(undefined); setError(''); }}>取消</button><button disabled={busy} className="primary" onClick={confirmation.execute}>{busy ? '处理中…' : '确认'}</button></div></Modal> : null}
  </div>;
}
