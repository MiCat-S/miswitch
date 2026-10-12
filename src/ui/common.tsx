import { useEffect, useRef, type ReactNode } from 'react';
import type { AppId } from '../core/types';

export const names: Record<AppId, string> = { claude: 'Claude', chatgpt: 'ChatGPT', pi: 'Pi' };
export const subtitles: Record<AppId, string> = { claude: 'Claude Code', chatgpt: 'OpenAI Codex CLI', pi: 'Pi Coding Agent' };
// The main process only rejects with static messages (publicError); Electron prefixes them with the channel name.
export const errorText = (e: unknown) => e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : '操作失败';

// `sheet` is the full-height panel that slides in from the right; its children lay out their own scrolling body.
export function Modal({ title, onClose, children, sheet = false }: { title: string; onClose(): void; children: ReactNode; sheet?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  // showModal() focuses the first control (the close button); move focus to the field the dialog is about.
  useEffect(() => { ref.current?.showModal(); ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus(); }, []);
  return <dialog ref={ref} className={sheet ? 'sheet' : undefined} onCancel={event => { event.preventDefault(); onClose(); }} aria-labelledby="modal-title">
    <div className="dialog-head"><h2 id="modal-title">{title}</h2><button className="icon-button" aria-label="关闭弹窗" onClick={onClose}>×</button></div>{children}
  </dialog>;
}
