// Reads only the newly built workspace artifact, never /Applications.
const asar=require('@electron/asar'); const fs=require('node:fs');
const archive='release/mac-arm64/Mi-Switch.app/Contents/Resources/app.asar';
const files=asar.listPackage(archive);
const notices=files.filter(p=>/THIRD_PARTY|lobehub|lucide|cc-switch|fontsource|source-serif.*LICENSE/i.test(p));
console.log(JSON.stringify({archive,entries:files.length,assetNotices:notices,rootFiles:files.filter(p=>p.split('/').length===2)}));
const bundle=asar.extractFile(archive,'dist/assets/'+files.find(p=>/^\/dist\/assets\/index-.*\.js$/.test(p)).split('/').at(-1)).toString();
console.log(JSON.stringify({svgEmbedded:bundle.includes('<svg'),lobeCopyrightPresent:bundle.includes('Copyright (c) 2023 LobeHub'),lucideCopyrightPresent:bundle.includes('Copyright (c) 2026 Lucide'),ccSwitchCopyrightPresent:bundle.includes('Jason Young'),resources:fs.readdirSync('release/mac-arm64/Mi-Switch.app/Contents/Resources').filter(p=>/license|notice/i.test(p))}));
