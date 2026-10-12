// Launches an isolated minimal Electron package with the baseline package name; no product or CLI data read.
const fs=require('node:fs');const cp=require('node:child_process');const {join,resolve}=require('node:path');const {tmpdir}=require('node:os');
const root=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'miswitch-sol-high-path-')));
try {
 fs.writeFileSync(join(root,'package.json'),JSON.stringify({name:JSON.parse(fs.readFileSync('package.json','utf8')).name,main:'probe.cjs'}));
 fs.writeFileSync(join(root,'probe.cjs'),`const {app}=require('electron');const {join}=require('node:path');const assert=require('node:assert/strict');app.setPath('appData',__dirname);const old=app.getPath('userData');assert.ok(old.startsWith(__dirname));const next=join(app.getPath('appData'),'MiSwitch');console.log(JSON.stringify({appName:app.getName(),oldFolder:old.slice(__dirname.length+1),newFolder:next.slice(__dirname.length+1),sameSpelling:old===next}));app.exit(0);`);
 process.stdout.write(cp.execFileSync(resolve('node_modules/.bin/electron'),[root],{encoding:'utf8',env:{...process.env,MISWITCH_SANDBOX_ROOT:root}}));
} finally {fs.rmSync(root,{recursive:true,force:true});}
