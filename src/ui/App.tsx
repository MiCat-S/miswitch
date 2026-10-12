import { useEffect, useRef, useState } from 'react';
import { SAVED_NOT_APPLIED } from '../core/errors';
import type { AppId, BackupInfo, Bridge, Diagnosis, ProviderInput, PublicProvider, Snapshot } from '../core/types';
import { GlobalSettings } from './GlobalSettings';
import { Glyph, Mark, Modal, ProviderTile, appHues, errorText, labels, subtitles } from './common';
import { appMarks } from './marks';
import { ProviderEditor } from './ProviderEditor';
declare global { interface Window { miswitch?: Bridge } }

type Page = 'providers' | 'backups' | 'global';
type Filter = 'all' | 'api' | 'login';
type Tone = 'ok' | 'warn' | 'idle';
const apps: AppId[] = ['claude', 'chatgpt', 'pi'];
const loginLabel = (app: AppId) => app === 'pi' ? '已有 Provider' : '官方登录';
const tokens = (n: number) => n >= 1e6 && n % 1e5 === 0 ? `${n / 1e6}M` : n >= 1e3 && n % 1e3 === 0 ? `${n / 1e3}K` : n.toLocaleString();
const endpoint = (p: PublicProvider) => p.mode === 'api' ? p.baseUrl.replace(/^https?:\/\//, '') : p.app === 'pi' ? `沿用 Pi Provider：${p.loginProvider}` : `使用 ${labels[p.app]} 自己的登录`;
const aliases = (p: PublicProvider) => ([['Haiku', p.smallFastModel], ['Sonnet', p.sonnetModel], ['Opus', p.opusModel], ['Fable', p.fableModel]] as const)
  .filter(([, model]) => model).map(([alias, model]) => `${alias} ${model}`);
const extras = (p: PublicProvider) => [p.contextWindow ? `上下文 ${tokens(p.contextWindow)}` : '', p.reasoningEffort ? `推理 ${p.reasoningEffort}` : ''].filter(Boolean);
const AppTile = ({ app }: { app: AppId }) => <Mark className={`tile s22 hue ${appHues[app]}`} svg={appMarks[app]} />;

// The state of the file an app's provider was written to, in words a user acts on.
function liveStatus(d: Diagnosis | undefined, active: boolean): { tone: Tone; text: string } {
  if (!d) return { tone: 'idle', text: '正在读取…' };
  if (!active || d.state === 'none') return { tone: 'idle', text: d.initialized ? '配置文件不是由 Mi-Switch 写入的' : '还没有配置文件' };
  if (d.state === 'drift') return { tone: 'warn', text: '配置文件被其他程序改过' };
  if (d.edited) return { tone: 'warn', text: '配置文件仍是编辑前的版本' };
  return { tone: 'ok', text: d.reformatted ? '已写入，新会话生效（文件被 CLI 重新排版过，设置未变）' : '已写入，新会话生效' };
}

function Summary({ app, provider, diagnosis, home, blocked, onEdit, onReapply }: {
  app: AppId; provider?: PublicProvider; diagnosis?: Diagnosis; home(path: string): string; blocked: boolean; onEdit(): void; onReapply(): void;
}) {
  const status = liveStatus(diagnosis, !!provider);
  const files = diagnosis?.paths.map(home).join('\n');
  const routes = provider ? aliases(provider) : [];
  return <section className="sec" aria-labelledby="summary-title">
    <div className="sec-head"><h2 id="summary-title">正在使用</h2></div>
    <div className={`panel summary ${provider ? 'hero' : ''}`}>
      {provider ? <ProviderTile p={provider} /> : <Mark className="tile s40 placeholder" svg={appMarks[app]} />}
      <div className="summary-name">
        <h3>{provider?.name ?? (diagnosis?.initialized ? '未由 Mi-Switch 管理' : '还没有使用任何供应商')}</h3>
        <p className={`state ${status.tone}`}><span className="dot" aria-hidden="true" />{status.text}</p>
      </div>
      {provider ? <div className="summary-actions">
        {status.tone === 'warn' ? <button className="primary" disabled={blocked} onClick={onReapply}>重新应用</button> : null}
        <button disabled={blocked} onClick={onEdit}>编辑…</button>
      </div> : <span />}
      {provider && diagnosis?.state === 'drift' ? <p className="hint">「{provider.name}」写入的地址、Key 或模型被改过。重新应用会写回这些字段，写入前自动备份；其他设置不受影响。</p> : null}
      {provider && diagnosis?.state !== 'drift' && diagnosis?.edited ? <p className="hint">上次保存后没有写入成功。重新应用会把现在的设置写入配置文件。</p> : null}
      {!provider && diagnosis ? <p className="hint">{diagnosis.initialized ? '在下方选一个供应商点 ▶ 使用，Mi-Switch 会先备份原文件再写入。' : '添加供应商并使用后，会自动创建所需的配置文件。'}</p> : null}
      <dl>
        {provider ? <>
          <dt>端点</dt><dd className={provider.mode === 'api' ? 'mono' : undefined}>{provider.mode === 'api' ? provider.baseUrl : endpoint(provider)}</dd>
          <dt>模型</dt><dd><span className="mono">{provider.model}</span>{extras(provider).length ? ` · ${extras(provider).join(' · ')}` : ''}</dd>
          {routes.length ? <><dt>别名</dt><dd className="mono">{routes.join(' · ')}</dd></> : null}
          {provider.mode === 'api' ? <><dt>密钥</dt><dd>{provider.hasKey ? '已保存（不在界面中显示）' : '未保存'}</dd></> : null}
        </> : null}
        {files ? <><dt>文件</dt><dd className="mono files">{files}</dd></> : null}
      </dl>
    </div>
  </section>;
}

function ProviderCard({ p, inUse, tone, blocked, onUse, onEdit }: { p: PublicProvider; inUse: boolean; tone: Tone; blocked: boolean; onUse(): void; onEdit(): void }) {
  const routes = aliases(p);
  const meta = [...extras(p), routes.length ? `${routes.length} 个别名` : ''].filter(Boolean).join(' · ');
  return <li className={`panel card ${inUse ? `in-use ${tone}` : ''}`}>
    <ProviderTile p={p} />
    <div className="card-main">
      <h3>{p.name}{p.notes ? <span className="pill" title={p.notes}>{p.notes.split('\n')[0]}</span> : null}{p.mode === 'login' ? <span className="pill">{loginLabel(p.app)}</span> : null}</h3>
      <p className={`sub ${p.mode === 'api' ? 'mono' : ''}`} title={p.mode === 'api' ? p.baseUrl : undefined}>{endpoint(p)}</p>
    </div>
    <div className="card-model">
      <span className="mono">{p.model}</span>
      {meta ? <small title={routes.join('\n') || undefined}>{meta}</small> : null}
    </div>
    <div className="card-actions">
      {inUse ? <span className={`using ${tone}`}><span className="dot" aria-hidden="true" />使用中</span>
        : <button className="play" disabled={blocked} aria-label={`使用「${p.name}」`} title="使用（新会话生效）" onClick={onUse}><Glyph name="play" /></button>}
      <button className="icon-button" disabled={blocked} aria-label={`编辑「${p.name}」`} title="编辑" onClick={onEdit}><Glyph name="pencil" /></button>
    </div>
  </li>;
}

function Backups({ backups, blocked, onRestore }: { backups: BackupInfo[]; blocked: boolean; onRestore(b: BackupInfo): void }) {
  const [filter, setFilter] = useState<AppId | 'all'>('all');
  const shown = backups.filter(b => filter === 'all' || b.app === filter);
  const count = (id: AppId) => backups.filter(b => b.app === id).length;
  return <div className="page">
    <div className="page-bar"><h1>历史备份</h1></div>
    <div className="page-body">
      <section className="sec" aria-labelledby="backups-title">
        <div className="sec-head"><h2 id="backups-title">全部备份</h2>
          <div className="chips" role="group" aria-label="按应用筛选">
            <button className={`chip ${filter === 'all' ? 'on' : ''}`} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>全部 {backups.length}</button>
            {apps.map(id => <button key={id} className={`chip ${filter === id ? 'on' : ''}`} aria-pressed={filter === id} onClick={() => setFilter(id)}>{labels[id]} {count(id)}</button>)}
          </div>
        </div>
        {shown.length ? <ul className="panel rows" aria-label="备份列表">{shown.map(b => <li className="backup-row" key={b.id}>
          <AppTile app={b.app} />
          <div className="backup-text"><strong>{new Date(b.createdAt).toLocaleString()}</strong><small>{labels[b.app]} · <span className="mono">{b.files.join('、')}</span></small></div>
          <button disabled={blocked} onClick={() => onRestore(b)}>恢复</button>
        </li>)}</ul> : <div className="panel empty"><h3>还没有备份</h3><p className="hint">第一次切换供应商后，切换前的原文件会出现在这里。</p></div>}
        <p className="hint">切换供应商、保存全局设置和恢复备份之前，原文件都会自动备份。每个应用保留最近 10 次。</p>
      </section>
    </div>
  </div>;
}

export function App() {
  const [app, setApp] = useState<AppId>('claude');
  const [page, setPage] = useState<Page>('providers');
  const [filter, setFilter] = useState<Filter>('all');
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  const [notice, setNotice] = useState('');
  const [editor, setEditor] = useState<{ provider?: PublicProvider }>();
  const [confirmation, setConfirmation] = useState<{ title: string; body: string; action: string; danger?: boolean; execute(): void }>();
  const bridge = window.miswitch;
  // Background refreshes are numbered so an older answer never replaces the result of a later action.
  const sequence = useRef(0);
  const busyRef = useRef(false);
  const refresh = () => {
    if (!bridge || busyRef.current) return;
    const n = ++sequence.current;
    void bridge.snapshot().then(s => { if (n === sequence.current) { setSnapshot(s); setLoadFailed(false); } }).catch(() => undefined);
  };
  useEffect(() => {
    if (!bridge) return;
    let mounted = true;
    // The first load also imports each CLI's current configuration once, so it appears as the first provider.
    void bridge.importLive().then(s => { if (mounted) setSnapshot(s); }).catch(e => { if (mounted) { setLoadFailed(true); setError(`读取失败：${errorText(e)}`); } });
    // Coming back to the window, or a switch from the menu bar, re-reads the files.
    window.addEventListener('focus', refresh);
    const off = bridge.onChanged(refresh);
    return () => { mounted = false; window.removeEventListener('focus', refresh); off(); };
  }, [bridge]);
  // Notices confirm a finished action; they leave on their own and never push the content around.
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 5000); return () => clearTimeout(timer); }, [notice]);
  const act = async (operation: () => Promise<Snapshot>, message: string, done?: () => void) => {
    if (busyRef.current) return false;
    busyRef.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const next = await operation();
      sequence.current++; setSnapshot(next); setLoadFailed(false); setConfirmation(undefined);
      if (message) setNotice(message);
      done?.();
      return true;
    } catch (e) {
      const text = errorText(e);
      setError(text);
      // The provider was stored even though writing it failed; leave the editor so it is not saved twice.
      if (text.startsWith(SAVED_NOT_APPLIED)) { setEditor(undefined); busyRef.current = false; refresh(); }
      return false;
    } finally { busyRef.current = false; setBusy(false); }
  };

  const diagnosis = snapshot?.diagnostics.find(d => d.app === app);
  const selected = snapshot?.active[app]?.providerId;
  const providers = snapshot?.providers.filter(p => p.app === app) ?? [];
  const current = providers.find(p => p.id === selected);
  const pending = snapshot?.pending ?? null;
  // Every write is refused by the main process while a conflicting journal exists; mirror that in the controls.
  const blocked = busy || !!pending || !bridge;
  const loading = !!bridge && !snapshot && !loadFailed;
  const home = (path: string) => snapshot?.home && path.startsWith(`${snapshot.home}/`) ? `~${path.slice(snapshot.home.length)}` : path;
  const tone = liveStatus(diagnosis, !!current).tone;
  const counts = { all: providers.length, api: providers.filter(p => p.mode === 'api').length, login: providers.filter(p => p.mode === 'login').length };
  // The filter only applies while both kinds exist; otherwise every provider shows.
  const shown = counts.api && counts.login ? providers.filter(p => filter === 'all' || p.mode === filter) : providers;
  const go = (next: Page, id: AppId = app) => { setPage(next); setApp(id); setError(''); if (id !== app) setFilter('all'); };
  const use = (p: PublicProvider) => void act(() => bridge!.activate(p.id), `已切换到「${p.name}」，新会话生效`);
  const edit = (provider?: PublicProvider) => { setError(''); setEditor({ provider }); };
  const save = (input: ProviderInput, { activate }: { activate: boolean }) => {
    const applies = activate || (!!input.id && input.id === selected);
    void act(() => bridge!.save(input, { activate }), applies ? `已保存「${input.name}」并写入配置文件，新会话生效` : `已保存「${input.name}」，点 ▶ 使用后才会写入配置文件`, () => setEditor(undefined));
  };
  const navLocked = busy || !!editor || !!confirmation;
  const navStatus = (id: AppId) => {
    const d = snapshot?.diagnostics.find(x => x.app === id);
    const name = snapshot?.providers.find(p => p.id === snapshot.active[id]?.providerId)?.name;
    const status = liveStatus(d, !!name);
    return { tone: status.tone, text: !snapshot ? '…' : name ?? (d?.initialized ? '未由 Mi-Switch 管理' : '还没有配置文件') };
  };

  const banners = <>
    {!bridge ? <div className="banner" role="status">这是浏览器预览。运行 npm run dev 打开桌面应用后，才能管理本机配置文件。</div> : null}
    {pending ? <section className="banner warn pending" role="alert" aria-label="未完成的切换">
      <strong><Glyph name="triangle-alert" />上次切换没有完成{pending.app ? `（${labels[pending.app]}）` : ''}，所有写入已暂停</strong>
      <p>{pending.valid ? '以下文件在那之后被其他程序修改。为避免覆盖这些修改，Mi-Switch 不会自动回退。' : '切换日志 pending.json 无法解析，无法自动回退；切换前的备份仍在“历史备份”中。'}</p>
      {pending.conflicts.length ? <ul className="mono">{pending.conflicts.map(path => <li key={path}>{home(path)}</li>)}</ul> : null}
      <button disabled={busy} onClick={() => setConfirmation({ title: '放弃未完成的切换', action: '放弃并回退',
        body: '将删除切换日志，并回退仍是 Mi-Switch 写入内容的文件；被其他程序改过的文件保持原样。之后可以从历史备份恢复，或重新使用供应商。',
        execute: () => void act(() => bridge!.resolveJournal(pending.id), '已放弃未完成的切换，请检查各应用的状态') })}>核对后放弃并回退…</button>
    </section> : null}
    {snapshot?.warnings.map(w => <div className="banner" key={w} role="status">{w}</div>)}
  </>;

  let content;
  if (page === 'backups') content = <Backups backups={snapshot?.backups ?? []} blocked={blocked}
    onRestore={b => setConfirmation({ title: '恢复备份', action: '恢复',
      body: `把 ${labels[b.app]} 的 ${b.files.join('、')} 恢复到 ${new Date(b.createdAt).toLocaleString()} 之前的内容？恢复前会先备份现在的文件，恢复后“使用中”标记会清除。`,
      execute: () => void act(() => bridge!.restore(b.id), `已恢复 ${labels[b.app]} 的备份，请在 CLI 中开新会话验证`) })} />;
  else if (page === 'global') content = <GlobalSettings app={app} onApp={id => go('global', id)} busy={busy} error={error} home={home}
    globalView={id => bridge ? bridge.globalView(id) : Promise.reject(new Error('浏览器预览无法读取本机文件'))}
    onSave={request => act(() => bridge!.saveGlobal(request), '')} />;
  else if (editor) content = <ProviderEditor key={editor.provider?.id ?? `new-${app}`} app={app} provider={editor.provider} inUse={!!editor.provider && editor.provider.id === selected}
    busy={busy} error={error} onCancel={() => { setEditor(undefined); setError(''); }} onSave={save}
    onRemove={() => { const p = editor.provider!; setConfirmation({ title: '删除供应商', action: '删除', danger: true, body: `删除「${p.name}」？这只删除 Mi-Switch 中保存的供应商，不改动任何配置文件；历史备份会保留。`,
      execute: () => void act(() => bridge!.remove(p.id), `已删除「${p.name}」`, () => setEditor(undefined)) }); }}
    listModels={request => bridge!.listModels(request)} configView={request => bridge!.configView(request)} />;
  else content = <div className="page">
    <div className="page-bar">
      <h1>{labels[app]}</h1><span className="bar-sub">供应商</span><span className="grow" />
      <button className="icon-button" aria-label="重新检测本机配置文件" title="重新检测本机配置文件" disabled={!bridge || busy || loading}
        onClick={() => void act(() => bridge!.snapshot(), '已重新检测本机配置文件')}><Glyph name="rotate-cw" /></button>
      <button className="primary" disabled={blocked || !snapshot} onClick={() => edit()}><Glyph name="plus" />添加供应商</button>
    </div>
    <div className="page-body">
      {error && !confirmation ? <div className="banner error" role="alert">{error}</div> : null}
      {loading ? <p className="hint" role="status">正在读取本机配置文件…</p> : loadFailed ? null : <>
        <Summary app={app} provider={current} diagnosis={diagnosis} home={home} blocked={blocked} onEdit={() => edit(current)} onReapply={() => current && use(current)} />
        <section className="sec" aria-labelledby="list-title">
          <div className="sec-head">
            <h2 id="list-title">全部供应商</h2>
            {counts.api && counts.login ? <div className="chips" role="group" aria-label="按类型筛选">
              {(['all', 'api', 'login'] as const).map(f => <button key={f} className={`chip ${filter === f ? 'on' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f === 'all' ? '全部' : f === 'api' ? 'API' : loginLabel(app)} {counts[f]}</button>)}
            </div> : null}
            <span className="grow" />
            {providers.length ? <span className="hint">点 <Glyph name="play" /> 切换，新会话生效</span> : null}
          </div>
          {providers.length ? <ul className="cards" aria-label="供应商列表">
            {shown.map(p => <ProviderCard key={p.id} p={p} inUse={p.id === selected} tone={tone} blocked={blocked} onUse={() => use(p)} onEdit={() => edit(p)} />)}
          </ul> : <div className="panel empty">
            <h3>还没有 {labels[app]} 的供应商</h3>
            <p className="hint">添加官方 API、自定义网关或已有登录，之后点一下就能切换。</p>
            <div className="empty-actions">
              <button className="primary" disabled={blocked} onClick={() => edit()}><Glyph name="plus" />添加供应商</button>
              {diagnosis?.initialized ? <button disabled={blocked} onClick={() => void act(() => bridge!.importLive(app), '已从本机配置文件导入；配置文件没有被修改')}>从本机配置文件导入</button> : null}
            </div>
          </div>}
        </section>
        {diagnosis?.warnings.length ? <details className="notes">
          <summary>注意事项 <span className="count">{diagnosis.warnings.length}</span></summary>
          <ul>{diagnosis.warnings.map(w => <li key={w}>{w}</li>)}</ul>
        </details> : null}
      </>}
    </div>
  </div>;

  return <div className="layout">
    <aside className="sidebar">
      <div className="brand">Mi-Switch</div>
      <nav aria-label="导航" title={editor ? '请先保存或取消编辑' : undefined}>
        <p className="nav-group">命令行工具</p>
        {apps.map(id => {
          const status = navStatus(id);
          const on = page === 'providers' && id === app;
          return <button key={id} className={`nav-item ${on ? 'on' : ''}`} aria-current={on ? 'page' : undefined} disabled={navLocked} onClick={() => go('providers', id)} title={subtitles[id]}>
            <AppTile app={id} />
            <span className="nav-text"><span>{labels[id]}</span><small className={status.tone}>{status.tone === 'warn' ? <Glyph name="triangle-alert" /> : null}{status.text}</small></span>
          </button>;
        })}
        <p className="nav-group">工具</p>
        <button className={`nav-item one ${page === 'backups' ? 'on' : ''}`} aria-current={page === 'backups' ? 'page' : undefined} disabled={navLocked} onClick={() => go('backups')}>
          <span className="tile s22 hue sky"><Glyph name="history" /></span><span className="nav-text"><span>历史备份</span></span><span className="count">{snapshot?.backups.length ?? 0}</span>
        </button>
        <button className={`nav-item one ${page === 'global' ? 'on' : ''}`} aria-current={page === 'global' ? 'page' : undefined} disabled={navLocked} onClick={() => go('global')}>
          <span className="tile s22 hue stone"><Glyph name="settings" /></span><span className="nav-text"><span>全局设置</span></span>
        </button>
      </nav>
      <p className="sidebar-foot">数据仅保存在本机</p>
    </aside>
    <main>
      {banners}
      {content}
    </main>
    <div className="toast-region" role="status" aria-live="polite">{notice ? <p className="toast">{notice}</p> : null}</div>
    {confirmation ? <Modal title={confirmation.title} onClose={() => { if (!busy) { setConfirmation(undefined); setError(''); } }}>
      <p>{confirmation.body}</p>
      {error ? <p role="alert" className="error">{error}</p> : null}
      <div className="dialog-actions">
        <button disabled={busy} onClick={() => { setConfirmation(undefined); setError(''); }} data-autofocus>取消</button>
        <button disabled={busy} className={confirmation.danger ? 'danger solid' : 'primary'} onClick={confirmation.execute}>{busy ? '处理中…' : confirmation.action}</button>
      </div>
    </Modal> : null}
  </div>;
}
