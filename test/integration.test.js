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
