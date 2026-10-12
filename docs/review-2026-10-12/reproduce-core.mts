import { Manager } from '../../src/core/manager.ts';
import { resolvePaths } from '../../src/core/paths.ts';
import { hash } from '../../src/core/files.ts';
import { mkdtemp, realpath, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
const root=await realpath(await mkdtemp(join(tmpdir(),'miswitch-review-core-')));
const results=[];
const input=(app:any,name:string)=>({app,name,mode:'api' as const,baseUrl:'https://example.test/v1',apiKey:'test-only',model:'test-model',protocol:app==='claude'?'anthropic-messages' as const:'openai-responses' as const});
try {
 const paths=resolvePaths(join(root,'large-data'),join(root,'large-home'),{}); const m=new Manager(paths,{});
 await mkdir(dirname(paths.targets.claude[0]),{recursive:true});
 await writeFile(paths.targets.claude[0],JSON.stringify({unrelated:'x'.repeat(Math.ceil(4.2*1024*1024))}));
 const saved=await m.save(input('claude','Large'));const applied=await m.activate(saved.providers[0].id);
 const filename=(await readdir(join(paths.data,'backups')))[0];const backupRaw=await readFile(join(paths.data,'backups',filename),'utf8');const b=JSON.parse(backupRaw);
 results.push({case:'large-generated-backup',bytes:Buffer.byteLength(backupRaw),visibleBackups:applied.backups.length,warnings:applied.warnings});
 const journal={version:1,id:randomUUID(),app:'claude',createdAt:new Date().toISOString(),entries:b.entries};const raw=JSON.stringify(journal);
 await writeFile(join(paths.data,'pending.json'),raw);
 try { await m.snapshot(); results.push({case:'large-journal',snapshot:'success'}); }catch(e:any){results.push({case:'large-journal',snapshot:'rejected',error:e.message});}
 try { await m.resolveJournal(hash(raw)); results.push({case:'large-journal-resolve',result:'success'}); }catch(e:any){results.push({case:'large-journal-resolve',result:'rejected',error:e.message});}
 const p2=resolvePaths(join(root,'partial-data'),join(root,'partial-home'),{});const m2=new Manager(p2,{});
 const s1=await m2.save(input('pi','A'));const a=s1.providers[0];await m2.activate(a.id);
 const s2=await m2.save(input('pi','B'));const bProvider=s2.providers.find(p=>p.name==='B')!;const switched=await m2.activate(bProvider.id);
 const latest=switched.backups[0]; const file=join(p2.data,'backups',latest.id+'.json');const broken=JSON.parse(await readFile(file,'utf8')); broken.entries=broken.entries.slice(0,1);await writeFile(file,JSON.stringify(broken));
 const listed=await m2.snapshot();await m2.restore(latest.id);
 const models=JSON.parse(await readFile(p2.targets.pi[0],'utf8'));const settings=JSON.parse(await readFile(p2.targets.pi[2],'utf8'));
 results.push({case:'incomplete-backup',accepted:listed.backups.some(x=>x.id===latest.id),defaultProvider:settings.defaultProvider,providerExists:!!models.providers[settings.defaultProvider]});
 const p3=resolvePaths(join(root,'legacy-data'),join(root,'legacy-home'),{});const m3=new Manager(p3,{});const s3=await m3.save(input('claude','Legacy'));await m3.activate(s3.providers[0].id);const hubfile=join(p3.data,'hub.json');const hub=JSON.parse(await readFile(hubfile,'utf8'));delete hub.active.claude.fingerprint;await writeFile(hubfile,JSON.stringify(hub));results.push({case:'legacy-no-fingerprint',state:(await m3.snapshot()).diagnostics[0].state});
 const p4=resolvePaths(join(root,'read-only-data'),join(root,'read-only-home'),{});const m4=new Manager(p4,{});const s4=await m4.save(input('claude','Read only'));
 await mkdir(dirname(p4.targets.claude[0]),{recursive:true});await writeFile(p4.targets.claude[0],'{}');
 const {chmod,stat}=await import('node:fs/promises');await chmod(p4.targets.claude[0],0o400);
 try {await m4.activate(s4.providers[0].id);results.push({case:'read-only-target',result:'overwritten',mode:(await stat(p4.targets.claude[0])).mode&0o777});}catch(e:any){results.push({case:'read-only-target',result:'rejected',error:e.message});}
 const p5=resolvePaths(join(root,'expansion-data'),join(root,'expansion-home'),{});const m5=new Manager(p5,{});await mkdir(dirname(p5.targets.claude[0]),{recursive:true});const compact=JSON.stringify({unrelated:Array(1_000_000).fill('x')});await writeFile(p5.targets.claude[0],compact);const s5=await m5.save(input('claude','Expansion'));
 try{await m5.activate(s5.providers[0].id);results.push({case:'serialization-expansion',result:'success'});}catch(e:any){let next='';try{await m5.snapshot();next='success';}catch(err:any){next=err.message;}results.push({case:'serialization-expansion',inputBytes:Buffer.byteLength(compact),outputBytes:(await stat(p5.targets.claude[0])).size,activationError:e.message,snapshot:next});}
 console.log(JSON.stringify(results,null,2));
} finally {await rm(root,{recursive:true,force:true});}
