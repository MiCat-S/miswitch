const {app}=require('electron');
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
const project=path.resolve(__dirname,'../..');
const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'miswitch-review-ui-')));
const out='/tmp/miswitch-review-evidence';fs.mkdirSync(out,{recursive:true});
process.env.MISWITCH_SANDBOX_ROOT=root;
const timer=setTimeout(()=>{console.error('review timeout');app.exit(1)},60000);
app.on('browser-window-created',(_,win)=>{win.webContents.once('did-finish-load',async()=>{
try{
 const run=code=>win.webContents.executeJavaScript(code);
 await run(`(async()=>{const tick=()=>new Promise(r=>requestAnimationFrame(r));for(let i=0;i<200;i++){if(document.querySelector('header button')&&!document.querySelector('header button').disabled)return;await tick()}throw Error('load timeout')})()`);
 await run(`(async()=>{await window.miswitch.save({app:'claude',name:'A'.repeat(100),mode:'api',baseUrl:'https://example.test',apiKey:'test-only',model:'model'.repeat(40),protocol:'anthropic-messages',notes:'X'.repeat(2000)});document.querySelector('.status-panel button').click();})()`);
 await run(`(async()=>{for(let i=0;i<200;i++){if(document.querySelector('.provider-card')&&!document.querySelector('header button').disabled)return;await new Promise(r=>requestAnimationFrame(r))}throw Error('refresh timeout')})()`);
 win.setSize(840,600);await new Promise(r=>setTimeout(r,200));
 const normal=await run(`(()=>{const card=document.querySelector('.provider-card');const name=card.querySelector('h2');const notes=card.querySelector('.notes');return {viewport:innerWidth,document:document.documentElement.scrollWidth,card:card.clientWidth,cardScroll:card.scrollWidth,name:name.clientWidth,nameScroll:name.scrollWidth,notes:notes.clientWidth,notesScroll:notes.scrollWidth}})()`);
 fs.writeFileSync(path.join(out,'long-text-840.png'),(await win.webContents.capturePage()).toPNG());
 win.webContents.setZoomFactor(2);await new Promise(r=>setTimeout(r,200));
 const zoom=await run(`({viewport:innerWidth,document:document.documentElement.scrollWidth,mainRight:document.querySelector('main').getBoundingClientRect().right})`);
 fs.writeFileSync(path.join(out,'zoom-200.png'),(await win.webContents.capturePage()).toPNG());
 win.webContents.setZoomFactor(1);win.setSize(1140,820);await new Promise(r=>setTimeout(r,200));
 await run(`document.querySelector('.card-actions button:nth-child(2)').click()`);
 await run(`(async()=>{while(!document.querySelector('dialog[open]'))await new Promise(r=>requestAnimationFrame(r));const n=document.querySelector('input[name=name]');n.value='Unsaved edited name';document.querySelector('input[name=baseUrl]').value='https://unsaved.test';document.querySelector('input[name=apiKey]').value='unsaved-test-key';const s=document.querySelector('select');s.value='login';s.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>requestAnimationFrame(r));s.value='api';s.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>requestAnimationFrame(r));})()`);
 const modelToggle=await run(`({name:document.querySelector('input[name=name]').value,url:document.querySelector('input[name=baseUrl]').value,keyLength:document.querySelector('input[name=apiKey]').value.length})`);
 await run(`document.querySelector('dialog[open] .dialog-actions button').click()`);
 await run(`(async()=>{const p=(await window.miswitch.snapshot()).providers[0];await window.miswitch.save({id:p.id,app:'claude',name:'Short',mode:'api',baseUrl:'https://example.test',model:'model',protocol:'anthropic-messages'});document.querySelector('.status-panel button').click();})()`);
 await run(`(async()=>{for(let i=0;i<200;i++){if(document.querySelector('.provider-card h2')?.textContent==='Short'&&!document.querySelector('header button').disabled)return;await new Promise(r=>requestAnimationFrame(r))}throw Error('refresh timeout')})()`);
 win.setSize(840,600);win.webContents.setZoomFactor(2);await new Promise(r=>setTimeout(r,200));
 const zoomShort=await run(`({viewport:innerWidth,document:document.documentElement.scrollWidth,cardWidth:document.querySelector('.provider-card').clientWidth,mainWidth:document.querySelector('main').clientWidth,mainContent:document.querySelector('main').clientWidth-48})`);
 fs.writeFileSync(path.join(out,'zoom-200-short.png'),(await win.webContents.capturePage()).toPNG());
 console.log(JSON.stringify({normal,zoom,zoomShort,modelToggle,evidence:out}));
 clearTimeout(timer);win.destroy();fs.rmSync(root,{recursive:true,force:true});app.exit(0);
}catch(e){console.error(e.message);clearTimeout(timer);app.exit(1)}
})});require(project+'/dist-desktop/main.cjs');
