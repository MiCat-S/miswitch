import { build } from 'esbuild';
await build({ entryPoints: ['src/desktop/main.ts', 'src/desktop/preload.ts'], outdir: 'dist-desktop', outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], sourcemap: false });
