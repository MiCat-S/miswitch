// Offline: read exact tarballs already present in npm's local cache; no network, no installation.
const fs=require('node:fs');const path=require('node:path');const cp=require('node:child_process');const crypto=require('node:crypto');const assert=require('node:assert/strict');
const globalRoot=cp.execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim();
const cache=path.join(cp.execFileSync('npm',['config','get','cache'],{encoding:'utf8'}).trim(),'_cacache');
const cacache=require(path.join(globalRoot,'npm/node_modules/cacache'));
const notices=fs.readFileSync('THIRD_PARTY_NOTICES.md','utf8');
const norm=s=>s.replace(/\s+/g,' ').trim();
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
(async()=>{
for(const [pkg,version,basename] of [['@fontsource-variable/source-serif-4','5.3.1','source-serif-4'],['@lobehub/icons-static-svg','1.95.1','icons-static-svg'],['lucide-static','1.55.0','lucide-static']]){
  const key=`make-fetch-happen:request-cache:https://registry.npmjs.org/${pkg}/-/${basename}-${version}.tgz`;
  const entry=await cacache.get(cache,key);const tar=entry.data;
  const files=cp.execFileSync('tar',['-tzf','-'],{input:tar,encoding:'utf8'}).trim().split('\n');
  const license=files.find(p=>/\/LICENSE(?:\.txt|\.md)?$/i.test(p));
  const licenseText=license?cp.execFileSync('tar',['-xOzf','-',license],{input:tar,encoding:'utf8'}):'';
  const metadata=JSON.parse(cp.execFileSync('tar',['-xOzf','-','package/package.json'],{input:tar,encoding:'utf8'}));
  const info={package:pkg,version,license,declaredLicense:metadata.license,licenseIncludedIgnoringWhitespace:license?norm(notices).includes(norm(licenseText)):null,licenseStart:licenseText.slice(0,550),copyrightLines:licenseText.split('\n').filter(x=>/Copyright/.test(x))};
  if(pkg.startsWith('@fontsource')){
    const font=cp.execFileSync('tar',['-xOzf','-','package/files/source-serif-4-latin-opsz-normal.woff2'],{input:tar});
    const actual=fs.readFileSync('src/ui/fonts/source-serif-4-latin-opsz-normal.woff2');
    assert.equal(sha(actual),sha(font));info.fontSHA256=sha(actual);info.fontBytes=actual.length;info.fontUnmodified=true;
  }
  console.log(JSON.stringify(info));
}
const declared=JSON.parse(fs.readFileSync('package-lock.json'));const installed=JSON.parse(fs.readFileSync('node_modules/.package-lock.json'));
const mismatches=Object.entries(installed.packages).filter(([p,x])=>declared.packages[p]?.version!==x.version).map(([p])=>p);
assert.deepEqual(mismatches,[]);console.log(JSON.stringify({installedLockfileVersionsMatch:true,packages:Object.keys(installed.packages).length}));
const marks=fs.readFileSync('src/ui/marks.ts','utf8');
assert.ok(!/\bstyle\s*=|<script\b|\bon[a-z]+\s*=|(?:href|src)\s*=/i.test(marks));
console.log(JSON.stringify({marksNoInlineStyleScriptEventsOrHref:true}));
})().catch(e=>{console.error(e);process.exitCode=1;});
