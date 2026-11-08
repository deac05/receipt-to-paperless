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
  let response; for(let i=0;i<50;i++){try{response=await fetch(url);break;}catch{await delay(50);}}
  assert.equal(response.status,401);
  response=await fetch(url,{headers:{authorization:'Basic '+Buffer.from('wrong:test-password').toString('base64')}}); assert.equal(response.status,401);
  const auth='Basic '+Buffer.from('user:test-password').toString('base64');
  response=await fetch(url,{headers:{authorization:auth}}); assert.equal(response.status,200); assert.match(await response.text(),/Capture your receipt/);
  const form=new FormData(); form.set('document',new Blob(['receipt'],{type:'image/jpeg'}),'receipt.jpg'); form.set('title','Lunch');
  response=await fetch(url+'/upload',{method:'POST',headers:{authorization:auth},body:form}); assert.equal(response.status,403);
  response=await fetch(url+'/upload',{method:'POST',headers:{authorization:auth,'x-receipt-upload':'1'},body:form}); assert.equal(response.status,202); assert.equal((await response.json()).task,'task-123');
  assert.equal(received.url,'/paperless/api/documents/post_document/'); assert.equal(received.auth,'Token test-token'); assert.match(received.body,/receipt.jpg/); assert.match(received.body,/Lunch/);
});

test('connects through the app and retains the connection after restart', async t => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir=await mkdtemp(join(tmpdir(),'receipt-test-'));
  let uploads=0;
  const mock=http.createServer(async(req,res)=>{
    if(req.headers.authorization !== 'Token correct-token') {res.writeHead(401); return res.end();}
    if(req.method==='POST') {uploads++; for await (const c of req) {} res.writeHead(200); return res.end('"queued"');}
    res.writeHead(200,{'content-type':'application/json'}); res.end('{"results":[]}');
  });
  mock.listen(0,'127.0.0.1'); await once(mock,'listening');
  const probe=http.createServer(); probe.listen(0,'127.0.0.1'); await once(probe,'listening'); const port=probe.address().port; await new Promise(r=>probe.close(r));
  const env={...process.env,APP_PASSWORD:'test',APP_USERNAME:'user',APP_DATA_DIR:dir,PORT:String(port)}; delete env.PAPERLESS_URL; delete env.PAPERLESS_TOKEN;
  let app; t.after(async()=>{if(app && app.exitCode===null) app.kill(); mock.close(); await rm(dir,{recursive:true,force:true});});
  const url=`http://127.0.0.1:${port}`, auth='Basic '+Buffer.from('user:test').toString('base64');
  async function start(){app=spawn(process.execPath,['server.js'],{env}); for(let i=0;i<50;i++){try{return await fetch(url+'/connection',{headers:{authorization:auth}});}catch{await delay(50);}} throw new Error('app did not start');}
  let response=await start(); assert.equal((await response.json()).connected,false);
  const headers={authorization:auth,'content-type':'application/json','x-receipt-upload':'1'};
  const settings={url:`http://127.0.0.1:${mock.address().port}/`,token:'wrong'};
  response=await fetch(url+'/connection',{method:'POST',headers,body:JSON.stringify(settings)}); assert.equal(response.status,400);
  settings.token='correct-token'; response=await fetch(url+'/connection',{method:'POST',headers,body:JSON.stringify(settings)}); assert.equal(response.status,200); assert.doesNotMatch(await response.text(),/correct-token/);
  app.kill(); await once(app,'exit'); response=await start(); const state=await response.json(); assert.equal(state.connected,true); assert.equal(state.url,settings.url); assert.doesNotMatch(JSON.stringify(state),/correct-token/);
  const form=new FormData(); form.set('document',new Blob(['receipt']),'receipt.jpg');
  response=await fetch(url+'/upload',{method:'POST',headers:{authorization:auth,'x-receipt-upload':'1'},body:form}); assert.equal(response.status,202); assert.equal(uploads,1);
});
