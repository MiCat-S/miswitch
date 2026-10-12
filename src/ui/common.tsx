import { useEffect, useRef, type ReactNode } from 'react';
import type { AppId, ProviderInput, PublicProvider, VendorIcon } from '../core/types';
import { glyphs, vendorMarks, type GlyphName } from './marks';
import { initial, letterHue, providerMark } from './vendor';

export const names: Record<AppId, string> = { claude: 'Claude', chatgpt: 'ChatGPT', pi: 'Pi' };
export const labels: Record<AppId, string> = { claude: 'Claude Code', chatgpt: 'Codex', pi: 'Pi' };
export const subtitles: Record<AppId, string> = { claude: 'Claude Code', chatgpt: 'OpenAI Codex CLI', pi: 'Pi Coding Agent' };
// The sidebar tile colour of each CLI, from the muted companion hues.
export const appHues: Record<AppId, string> = { claude: 'clay', chatgpt: 'graphite', pi: 'plum' };
// The main process only rejects with static messages (publicError); Electron prefixes them with the channel name.
export const errorText = (e: unknown) => e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : '操作失败';

// The SVG strings are constants generated into marks.ts, never user or file content.
export function Glyph({ name }: { name: GlyphName }) {
  return <span className="glyph" dangerouslySetInnerHTML={{ __html: glyphs[name] }} />;
}
export function Mark({ svg, className }: { svg: string; className: string }) {
  return <span className={className} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />;
}
export function VendorTile({ icon, name, size }: { icon: VendorIcon | null; name: string; size: 36 | 40 }) {
  return icon ? <Mark className={`tile s${size}`} svg={vendorMarks[icon].svg} />
    : <span className={`tile s${size} letter ${letterHue(name)}`} aria-hidden="true">{initial(name)}</span>;
}
export const ProviderTile = ({ p, size = 40 }: { p: Pick<PublicProvider | ProviderInput, 'app' | 'mode' | 'baseUrl' | 'loginProvider' | 'icon' | 'name'>; size?: 36 | 40 }) =>
  <VendorTile icon={providerMark({ ...p, baseUrl: p.baseUrl ?? '', loginProvider: p.loginProvider ?? 'anthropic', mode: p.mode })} name={p.name} size={size} />;

export function Modal({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  // showModal() focuses the first control (the close button); move focus to the field the dialog is about.
  useEffect(() => { ref.current?.showModal(); ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus(); }, []);
  return <dialog ref={ref} onCancel={event => { event.preventDefault(); onClose(); }} aria-labelledby="modal-title">
    <div className="dialog-head"><h2 id="modal-title">{title}</h2><button className="icon-button" aria-label="关闭弹窗" onClick={onClose}><Glyph name="x" /></button></div>{children}
  </dialog>;
}
