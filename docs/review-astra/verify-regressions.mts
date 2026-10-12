// Deterministic filesystem scheduling, real 722c119 code for upgrade, all configuration in a temporary root.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Manager } from '../../src/core/manager.ts';
import { resolvePaths } from '../../src/core/paths.ts';
const root=await fs.realpath(await fs.mkdtemp(join(tmpdir(),'miswitch-astra-regression-')));
const paths=resolvePaths(join(root,'store'),join(root,'home'),{});
const input={app:'claude' as const,name:'A',mode:'api' as const,baseUrl:'https://synthetic.example',apiKey:'sk-regression-only',model:'a',protocol:'anthropic-messages' as const};
const originalLstat=fs.lstat;
try{
  const manager=new Manager(paths,{});const p=(await manager.save(input)).providers[0];await manager.activate(p.id);
  const before=await fs.readFile(paths.targets.claude[0],'utf8');let altered='';
  fs.lstat=(async(path:any,options:any)=>{
    const s=await originalLstat(path,options);
    if(!altered&&options?.bigint&&String(path).includes('/backups/')&&s.isFile()){
      const text=await fs.readFile(path,'utf8');
      if(JSON.parse(text).entries[0].before===before){altered=String(path);await fs.writeFile(path,'{synthetic-corruption');return originalLstat(path,options);}
    }
    return s;
  }) as typeof fs.lstat;syncBuiltinESMExports();
  const first=await manager.activate(p.id);fs.lstat=originalLstat;syncBuiltinESMExports();
  assert.ok(altered);assert.equal(first.warnings.length,1);assert.equal(first.backups.length,1);
  const q=(await manager.save({...input,name:'B',model:'b'})).providers[1];const s=await manager.activate(q.id);
  const backup=JSON.parse(await fs.readFile(join(paths.data,'backups',s.backups[0].id+'.json'),'utf8'));
  assert.equal(backup.entries[0].before,before);assert.deepEqual((await new Manager(paths,{}).snapshot()).backups,s.backups);
  console.log(JSON.stringify({name:'Sol-R1-rename-stat-interleaving',damagedBackupWarned:true,replacementBackupContainsBefore:true,coldWarmAgree:true}));
  // Import the historical implementation, never launch its desktop entry point.
  const old=join(root,'old');await fs.mkdir(old);await fs.writeFile(join(old,'package.json'),'{"type":"module"}');
  await fs.symlink(resolve('node_modules'),join(root,'node_modules'),'dir');
  for(const file of ['manager','adapters','files','paths','types','errors']) await fs.writeFile(join(old,file+'.ts'),execFileSync('git',['show',`722c119:src/core/${file}.ts`]));
  const OldManager=(await import(pathToFileURL(join(old,'manager.ts')).href)).Manager;
  const upgradePaths=resolvePaths(join(root,'upgrade-store'),join(root,'upgrade-home'),{});
  await fs.mkdir(dirname(upgradePaths.targets.claude[0]),{recursive:true});
  await fs.writeFile(upgradePaths.targets.claude[0],'{"env":{"ANTHROPIC_DEFAULT_FABLE_MODEL":"legacy-fable","ANTHROPIC_SMALL_FAST_MODEL":"legacy-small"}}');
  const legacy=new OldManager(upgradePaths,{});const a=(await legacy.save(input)).providers[0];await legacy.activate(a.id);
  const afterOld=await fs.readFile(upgradePaths.targets.claude[0],'utf8');
  const upgraded=new Manager(upgradePaths,{});const d=(await upgraded.snapshot()).diagnostics[0];
  assert.equal(d.state,'written');assert.equal(d.edited,false);assert.equal(await fs.readFile(upgradePaths.targets.claude[0],'utf8'),afterOld);
  console.log(JSON.stringify({name:'Sol-R4-real-722c119-upgrade',state:d.state,edited:d.edited,targetsUnchanged:true}));
  // New icon is correctly excluded from legacy definition, but old strict schema cannot read a new Hub that has icon.
  await upgraded.save({...input,id:a.id,icon:'kimi'});await assert.rejects(()=>legacy.snapshot());
  console.log(JSON.stringify({name:'downgrade-new-icon',old722c119Rejects:true,newHeadReads:(await upgraded.snapshot()).providers.length===1}));
}finally{fs.lstat=originalLstat;syncBuiltinESMExports();await fs.rm(root,{recursive:true,force:true});}
