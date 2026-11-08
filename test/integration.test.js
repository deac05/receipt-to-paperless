import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

test('authenticates and forwards a receipt to Paperless', async t => {
  let received;
  const mock=http.createServer(async(req,res)=>{const chunks=[]; for await (const c of req) chunks.push(c); received={url:req.url, auth:req.headers.authorization, body:Buffer.concat(chunks).toString()}; res.writeHead(200,{'content-type':'application/json'});res.end('"task-123"');});
  mock.listen(0,'127.0.0.1'); await once(mock,'listening');
  const probe=http.createServer(); probe.listen(0,'127.0.0.1'); await once(probe,'listening'); const port=probe.address().port; await new Promise(r=>probe.close(r));
  const app=spawn(process.execPath,['server.js'],{env:{...process.env,PAPERLESS_URL:`http://127.0.0.1:${mock.address().port}/paperless/`,PAPERLESS_TOKEN:'test-token',APP_USERNAME:'user',APP_PASSWORD:'test-password',PORT:String(port)}});
  t.after(()=>{app.kill(); mock.close();});
  const url=`http://127.0.0.1:${port}`;
  let response; for(let i=0;i<50;i++){try{response=await fetch(url,{redirect:'manual'});break;}catch{await delay(50);}}
  assert.equal(response.status,303); assert.equal(response.headers.get('location'),'/login');
  response=await fetch(url+'/auth/login',{method:'POST',headers:{'content-type':'application/json','x-receipt-upload':'1'},body:JSON.stringify({username:'wrong',password:'test-password'})}); assert.equal(response.status,401);
  response=await fetch(url+'/auth/login',{method:'POST',headers:{'content-type':'application/json','x-receipt-upload':'1'},body:JSON.stringify({username:'user',password:'test-password'})}); assert.equal(response.status,200);
  const auth=response.headers.get('set-cookie').split(';')[0];
  response=await fetch(url,{headers:{cookie:auth}}); assert.equal(response.status,200); assert.match(await response.text(),/Capture your receipt/);
  const form=new FormData(); form.set('document',new Blob(['receipt'],{type:'image/jpeg'}),'receipt.jpg'); form.set('title','Lunch');
  response=await fetch(url+'/upload',{method:'POST',headers:{cookie:auth},body:form}); assert.equal(response.status,403);
  response=await fetch(url+'/upload',{method:'POST',headers:{cookie:auth,'x-receipt-upload':'1'},body:form}); assert.equal(response.status,202); assert.equal((await response.json()).task,'task-123');
  assert.equal(received.url,'/paperless/api/documents/post_document/'); assert.equal(received.auth,'Token test-token'); assert.match(received.body,/receipt.jpg/); assert.match(received.body,/Lunch/);
});

test('connects through the app and retains the connection after restart', async t => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir=await mkdtemp(join(tmpdir(),'receipt-test-'));
  let uploads=0, uploadedBody="";
  const mock=http.createServer(async(req,res)=>{
    if(req.headers.authorization !== 'Token correct-token') {res.writeHead(401); return res.end();}
    if(req.method==='POST') {uploads++; const chunks=[]; for await (const c of req) chunks.push(c); uploadedBody=Buffer.concat(chunks).toString(); res.writeHead(200); return res.end('"queued"');}
    if(req.url.startsWith('/api/tags/')) {const page=new URL(req.url,'http://localhost').searchParams.get('page'); res.writeHead(200,{'content-type':'application/json'}); return res.end(JSON.stringify(page==='1'?{results:[{id:3,name:'Business'}],next:'next'}:{results:[{id:7,name:'Food'}],next:null}));}
    res.writeHead(200,{'content-type':'application/json'}); res.end('{"results":[]}');
  });
  mock.listen(0,'127.0.0.1'); await once(mock,'listening');
  const probe=http.createServer(); probe.listen(0,'127.0.0.1'); await once(probe,'listening'); const port=probe.address().port; await new Promise(r=>probe.close(r));
  const env={...process.env,APP_PASSWORD:'test',APP_USERNAME:'user',APP_DATA_DIR:dir,PORT:String(port)}; delete env.PAPERLESS_URL; delete env.PAPERLESS_TOKEN;
  let app; t.after(async()=>{if(app && app.exitCode===null) app.kill(); mock.close(); await rm(dir,{recursive:true,force:true});});
  const url=`http://127.0.0.1:${port}`; let auth;
  async function start(){app=spawn(process.execPath,['server.js'],{env}); for(let i=0;i<50;i++){try{const login=await fetch(url+'/auth/login',{method:'POST',headers:{'content-type':'application/json','x-receipt-upload':'1'},body:JSON.stringify({username:'user',password:'test'})});auth=login.headers.get('set-cookie').split(';')[0];return await fetch(url+'/connection',{headers:{cookie:auth}});}catch{await delay(50);}} throw new Error('app did not start');}
  let response=await start(); assert.equal((await response.json()).connected,false);
  const headers={cookie:auth,'content-type':'application/json','x-receipt-upload':'1'};
  const settings={url:`http://127.0.0.1:${mock.address().port}/`,token:'wrong'};
  response=await fetch(url+'/connection',{method:'POST',headers,body:JSON.stringify(settings)}); assert.equal(response.status,400);
  settings.token='correct-token'; response=await fetch(url+'/connection',{method:'POST',headers,body:JSON.stringify(settings)}); assert.equal(response.status,200); assert.doesNotMatch(await response.text(),/correct-token/);
  app.kill(); await once(app,'exit'); response=await start(); headers.cookie=auth; const state=await response.json(); assert.equal(state.connected,true); assert.equal(state.url,settings.url); assert.doesNotMatch(JSON.stringify(state),/correct-token/);
  response=await fetch(url+'/tags',{headers:{cookie:auth}}); assert.deepEqual((await response.json()).tags,[{id:3,name:'Business'},{id:7,name:'Food'}]);
  const form=new FormData(); form.set('document',new Blob(['receipt']),'receipt.jpg'); form.append('tags','3'); form.append('tags','7');
  response=await fetch(url+'/upload',{method:'POST',headers:{cookie:auth,'x-receipt-upload':'1'},body:form}); assert.equal(response.status,202); assert.equal(uploads,1); assert.match(uploadedBody,/name="tags"\r\n\r\n3/); assert.match(uploadedBody,/name="tags"\r\n\r\n7/);
});

test('authentication can be explicitly disabled', async t => {
  const probe=http.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
  const env={...process.env,APP_AUTH_DISABLED:'true',PORT:String(port)};delete env.APP_PASSWORD;
  const app=spawn(process.execPath,['server.js'],{env});t.after(()=>app.kill());
  let response;for(let i=0;i<50;i++){try{response=await fetch(`http://127.0.0.1:${port}/auth/status`);break;}catch{await delay(50);}}
  assert.deepEqual(await response.json(),{required:false,authenticated:true});
  response=await fetch(`http://127.0.0.1:${port}/`);assert.equal(response.status,200);
});
