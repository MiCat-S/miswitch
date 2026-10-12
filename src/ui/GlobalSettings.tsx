import { useEffect, useRef, useState } from 'react';
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
  const [view, setView] = useState<(ConfigView & { app: AppId }) | null>(null);
  const [text, setText] = useState('');
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  // Reads are numbered: switching apps quickly must never let an older answer replace the newer one.
  const sequence = useRef(0);
  const load = async () => {
    const n = ++sequence.current;
    setMessage(null);
    const next = await globalView(app).catch(e => ({ name: '', path: '', format: 'json', error: errorText(e) }) as ConfigView);
    if (n !== sequence.current) return false;
    setView({ ...next, app }); setText(next.text ?? '');
    return true;
  };
  useEffect(() => { setView(null); setText(''); void load(); return () => { sequence.current++; }; }, [app]);
  const current = view?.app === app ? view : null;
  const dirty = current?.text !== undefined && text !== current.text;
  const format = () => {
    try { setText(JSON.stringify(JSON.parse(text || '{}'), null, 2) + '\n'); setMessage(null); }
    catch { setMessage({ text: 'JSON 格式错误，无法格式化', error: true }); }
  };
  const save = async () => {
    // The text belongs to the app it was read for; it is only saved there, and only while that app is selected.
    if (!current?.base || !await onSave({ app: current.app, text, base: current.base })) return;
    if (await load()) setMessage({ text: '已保存并写入本机文件，写入前已自动备份', error: false });
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
          <h2 id="global-file">{current?.name || '…'}<span className="path mono" title={current?.path}>{current?.path ? home(current.path) : ''}</span></h2>
          <span className="grow" />
          <span className="actions">
            {current?.format === 'json' ? <button type="button" className="link" onClick={format} disabled={busy}>格式化</button> : null}
            <button type="button" className="link" onClick={() => void load()} disabled={busy}>重新读取</button>
          </span>
        </div>
        <div className="panel form">
          <p className="hint">这里的设置对 {labels[app]} 的所有供应商生效，保存时立即写入本机文件。供应商字段不在这里：{owners[app]}，它们由当前使用的供应商写入。密钥、令牌等敏感值显示为占位文字，保留占位文字保存时会沿用原值。{app === 'chatgpt' ? '保存会重新排版 config.toml，注释不会保留。' : ''}</p>
          {current?.error ? <p className="error" role="alert">{current.error}</p> : current ? <textarea className="config-editor" aria-label={`${current.name} 全局设置`} spellCheck={false} wrap="off"
            rows={Math.min(32, Math.max(14, text.split('\n').length + 2))} value={text} onChange={e => setText(e.target.value)} /> : <p className="hint">正在读取…</p>}
          {message ? <p className={message.error ? 'error' : 'hint ok'} role={message.error ? 'alert' : 'status'}>{message.text}</p> : null}
        </div>
      </section>
    </div>
    <div className="page-footer">
      {error ? <p role="alert" className="error">{error}</p> : null}
      <div className="footer-row">
      <span className="hint">{dirty ? '有未保存的修改' : '没有修改'}</span><span className="grow" />
      <button type="button" disabled={busy || !dirty} onClick={() => setText(current?.text ?? '')}>放弃修改</button>
      <button type="button" className="primary" disabled={busy || !dirty || !current?.base} onClick={() => void save()}>{busy ? '保存中…' : '保存'}</button>
      </div>
    </div>
  </div>;
}
