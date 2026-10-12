import { z } from 'zod';

// Messages carried by PublicError are static strings written in this code base.
// They never embed file contents, parser output or user input, so the desktop
// layer can forward them to the renderer verbatim.
export class PublicError extends Error {
  readonly isPublic = true;
  constructor(message: string) { super(message); this.name = 'PublicError'; }
}
export const GENERIC_MESSAGE = '操作失败：请检查配置格式、目录权限及字段内容；未完成的切换会恢复或保留恢复日志';
export const INVALID_INPUT_MESSAGE = '输入内容无效，请检查各字段的格式与长度';
export const PENDING_MESSAGE = '存在未完成的切换日志，且目标文件已被外部修改；请先在界面处理待决日志';

export function publicError(error: unknown): string {
  if (error instanceof PublicError) return error.message;
  if (error instanceof z.ZodError) {
    // Only `custom` issues come from our own superRefine and carry static text.
    // Built-in issue messages are replaced because some variants echo input.
    const custom = [...new Set(error.issues.filter(issue => issue.code === 'custom').map(issue => issue.message))];
    return custom.length ? custom.join('；') : INVALID_INPUT_MESSAGE;
  }
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'EACCES' || code === 'EPERM') return '没有配置文件的写入权限，请检查目录权限';
  if (code === 'ELOCKED') return '配置正在被另一进程使用，请稍后重试';
  return GENERIC_MESSAGE;
}
