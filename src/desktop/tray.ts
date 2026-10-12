import { Menu, Notification, Tray, nativeImage, type MenuItemConstructorOptions, type NativeImage } from 'electron';
import { deflateSync } from 'node:zlib';
import { publicError } from '../core/errors';
import type { Manager } from '../core/manager';
import type { AppId, Snapshot } from '../core/types';

const apps: [AppId, string][] = [['claude', 'Claude Code'], ['chatgpt', 'Codex'], ['pi', 'Pi']];

// PNG encoding for the one icon the menu bar needs, so the bundle carries no image files.
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (bytes: Buffer) => { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
// The app mark as a 16 pt template image (32 px at 2x): three rails, one per CLI, each with its knob at the provider
// in use. Knobs are separated from their rail by a small gap so they read at menu bar size.
function railsIcon(): NativeImage {
  const size = 32;
  const rails = [7, 16, 25];
  const knobs: [number, number][] = [[11, 7], [22, 16], [15, 25]];
  const onRail = (x: number, y: number) => rails.some(r => { const cx = Math.min(Math.max(x, 5), 27); return (x - cx) ** 2 + (y - r) ** 2 <= 1.3 ** 2; });
  const near = (x: number, y: number, radius: number) => knobs.some(([kx, ky]) => (x - kx) ** 2 + (y - ky) ** 2 <= radius ** 2);
  const rows: Buffer[] = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      const px = x + .5, py = y + .5;
      if (near(px, py, 3.6) || (onRail(px, py) && !near(px, py, 5.4))) row[1 + x * 4 + 3] = 255;
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
  const image = nativeImage.createFromBuffer(png, { scaleFactor: 2 });
  image.setTemplateImage(true);
  return image;
}

// The menu bar switcher: every app's providers as a radio group, so switching needs no window.
export function createTray(manager: Manager, actions: { open(): void; changed(): void }) {
  const tray = new Tray(railsIcon());
  tray.setToolTip('Mi-Switch');
  const notify = (title: string, body: string) => { if (Notification.isSupported()) new Notification({ title, body }).show(); };
  const switchTo = async (id: string, name: string) => {
    try { await manager.activate(id); notify('Mi-Switch', `已切换到「${name}」，新会话生效`); }
    catch (error) { notify('Mi-Switch 切换失败', publicError(error)); }
    await refresh(); actions.changed();
  };
  const refresh = async () => {
    let snapshot: Snapshot | null = null;
    try { snapshot = await manager.snapshot(); } catch { /* shown as unavailable below */ }
    const items: MenuItemConstructorOptions[] = [];
    for (const [app, label] of apps) {
      items.push({ label, enabled: false });
      const providers = snapshot?.providers.filter(p => p.app === app) ?? [];
      if (!snapshot) items.push({ label: '无法读取配置', enabled: false });
      else if (!providers.length) items.push({ label: '还没有配置', enabled: false });
      for (const p of providers) {
        items.push({ label: p.name, type: 'radio', checked: snapshot!.active[app]?.providerId === p.id, enabled: !snapshot!.pending, click: () => void switchTo(p.id, p.name) });
      }
      items.push({ type: 'separator' });
    }
    if (snapshot?.pending) items.push({ label: '有未完成的切换，请在窗口中处理', enabled: false }, { type: 'separator' });
    items.push({ label: '打开 Mi-Switch', click: actions.open }, { label: '退出 Mi-Switch', role: 'quit' });
    tray.setContextMenu(Menu.buildFromTemplate(items));
  };
  void refresh();
  return { refresh };
}
