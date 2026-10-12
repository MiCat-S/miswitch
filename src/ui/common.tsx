import { useEffect, useRef, type ReactNode } from 'react';
import type { AppId } from '../core/types';

export const names: Record<AppId, string> = { claude: 'Claude', chatgpt: 'ChatGPT', pi: 'Pi' };
export const subtitles: Record<AppId, string> = { claude: 'Claude Code', chatgpt: 'OpenAI Codex CLI', pi: 'Pi Coding Agent' };
export const initials: Record<AppId, string> = { claude: 'C', chatgpt: '◎', pi: 'π' };
// The main process only rejects with static messages (publicError); Electron prefixes them with the channel name.
export const errorText = (e: unknown) => e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : '操作失败';

export function Modal({ title, onClose, children, wide = false }: { title: string; onClose(): void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className={wide ? 'wide' : undefined} onCancel={event => { event.preventDefault(); onClose(); }} aria-labelledby="modal-title">
    <div className="dialog-head"><h2 id="modal-title">{title}</h2><button className="icon-button" aria-label="关闭弹窗" onClick={onClose}>×</button></div>{children}
  </dialog>;
}
