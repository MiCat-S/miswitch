import { useEffect, useState } from 'react';
import type { AppId, ConfigView, GlobalEdit } from '../core/types';
import { errorText, labels } from './common';

const apps: AppId[] = ['claude', 'chatgpt', 'pi'];
const owners: Record<AppId, string> = {
  claude: '地址、Key、模型与别名映射（model 和 env 中的 ANTHROPIC_* 等）',
  chatgpt: 'model、model_provider、上下文、推理强度与 [model_providers.custom]',
  pi: 'defaultProvider 与 defaultModel'
};

// Each CLI's global settings: its configuration file without the fields providers own. They apply to every
// provider and are written when saved; the provider fields stay as the file has them.
export function GlobalSettings({ app, onApp, busy, error, home, globalView, onSave }: {
  app: AppId; onApp(app: AppId): void; busy: boolean; error: string; home(path: string): string;
  globalView(app: AppId): Promise<ConfigView>; onSave(request: GlobalEdit): Promise<boolean>;
}) {
  const [view, setView] = useState<ConfigView | null>(null);
  const [text, setText] = useState('');
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const load = async () => {
    setMessage(null);
    const next = await globalView(app).catch(e => ({ name: '', path: '', format: 'json', error: errorText(e) }) as ConfigView);
    setView(next); setText(next.text ?? '');
  };
  useEffect(() => { setView(null); void load(); }, [app]);
  const dirty = view?.text !== undefined && text !== view.text;
  const format = () => {
    try { setText(JSON.stringify(JSON.parse(text || '{}'), null, 2) + '\n'); setMessage(null); }
    catch { setMessage({ text: 'JSON 格式错误，无法格式化', error: true }); }
  };
  const save = async () => {
    if (!view?.base || !await onSave({ app, text, base: view.base })) return;
    await load(); setMessage({ text: '已保存并写入本机文件，写入前已自动备份', error: false });
  };
  return <div className="page">
    <div className="page-bar"><h1>全局设置</h1><span className="grow" />
      <div className="segmented" role="tablist" aria-label="选择应用">
        {apps.map(id => <button key={id} role="tab" aria-selected={id === app} className={id === app ? 'on' : ''} disabled={busy} onClick={() => onApp(id)}>{labels[id]}</button>)}
      </div>
    </div>
    <div className="page-body">
      <section className="sec" aria-labelledby="global-file">
        <div className="sec-head">
          <h2 id="global-file">{view?.name || '…'}<span className="path mono" title={view?.path}>{view?.path ? home(view.path) : ''}</span></h2>
          <span className="grow" />
          <span className="actions">
            {view?.format === 'json' ? <button type="button" className="link" onClick={format} disabled={busy}>格式化</button> : null}
            <button type="button" className="link" onClick={() => void load()} disabled={busy}>重新读取</button>
          </span>
        </div>
        <div className="panel form">
          <p className="hint">这里的设置对 {labels[app]} 的所有供应商生效，保存时立即写入本机文件。供应商字段不在这里：{owners[app]}，它们由当前使用的供应商写入。{app === 'chatgpt' ? '保存会重新排版 config.toml，注释不会保留。' : ''}</p>
          {view?.error ? <p className="error" role="alert">{view.error}</p> : view ? <textarea className="config-editor" aria-label={`${view.name} 全局设置`} spellCheck={false} wrap="off"
            rows={Math.min(32, Math.max(14, text.split('\n').length + 2))} value={text} onChange={e => setText(e.target.value)} /> : <p className="hint">正在读取…</p>}
          {message ? <p className={message.error ? 'error' : 'hint ok'} role={message.error ? 'alert' : 'status'}>{message.text}</p> : null}
        </div>
      </section>
    </div>
    <div className="page-footer">
      {error ? <p role="alert" className="error">{error}</p> : null}
      <div className="footer-row">
      <span className="hint">{dirty ? '有未保存的修改' : '没有修改'}</span><span className="grow" />
      <button type="button" disabled={busy || !dirty} onClick={() => setText(view?.text ?? '')}>放弃修改</button>
      <button type="button" className="primary" disabled={busy || !dirty || !view?.base} onClick={() => void save()}>{busy ? '保存中…' : '保存'}</button>
      </div>
    </div>
  </div>;
}
