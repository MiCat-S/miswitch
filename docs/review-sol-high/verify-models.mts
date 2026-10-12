// Synthetic keys; localhost only. Timeout check takes ~10 seconds. No external redirects are followed.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fetchModelList } from '../../src/core/models.ts';
import { publicError } from '../../src/core/errors.ts';
const requests:string[]=[];let redirected=false;
const server=createServer((req,res)=>{
  requests.push(req.url!);
  if(req.url==='/sink'){redirected=true;return res.end('{}');}
  if(req.url?.startsWith('/redirect')){res.writeHead(302,{location:'/sink'});return res.end('synthetic-secret-in-error');}
  if(req.url?.startsWith('/large-length')){res.writeHead(200,{'content-length':5*1024*1024});return res.end();}
  if(req.url?.startsWith('/large-stream')){res.writeHead(200);return res.end(' '.repeat(4*1024*1024+1));}
  if(req.url?.startsWith('/timeout'))return;
  res.writeHead(403);res.end('synthetic-secret-in-error');
});
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${(server.address() as any).port}`;
const request=(suffix:string)=>fetchModelList({app:'claude',baseUrl:base+suffix,apiKey:'sk-synthetic',protocol:'anthropic-messages',claudeAuth:'api-key'});
try{
  for(const suffix of ['/redirect/v1','/large-length/v1','/large-stream/v1','/forbidden/v1']){
    let error='';try{await request(suffix);}catch(e){error=publicError(e);}
    assert.ok(error);assert.ok(!error.includes('synthetic-secret'));console.log(JSON.stringify({suffix,error}));
  }
  assert.equal(redirected,false);
  const start=Date.now();await assert.rejects(()=>request('/timeout/v1'));const elapsed=Date.now()-start;
  assert.ok(elapsed>=9500&&elapsed<15000);console.log(JSON.stringify({timeoutMs:elapsed,redirectFollowed:redirected,requests}));
}finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
