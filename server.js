import http from 'node:http';
import { readFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { timingSafeEqual, randomUUID, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const password = process.env.APP_PASSWORD;
const username = process.env.APP_USERNAME;
const authDisabled = process.env.APP_AUTH_DISABLED === 'true';
if (!authDisabled && !password) throw new Error('Set APP_PASSWORD or explicitly set APP_AUTH_DISABLED=true.');
const dataDir = process.env.APP_DATA_DIR || './data';
const configPath = join(dataDir, 'paperless.json');
function validateConnection(base, token) {
  if (typeof base !== 'string' || typeof token !== 'string' || !token.trim() || token.length > 4096 || /[\r\n]/.test(token)) throw new Error('Enter a Paperless URL and API token.');
  const url = new URL(base.endsWith('/') ? base : base + '/');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Enter a valid HTTP or HTTPS Paperless URL.');
  return {url: url.href, token: token.trim()};
}
let connection = null;
try {
  const saved = JSON.parse(await readFile(configPath, 'utf8'));
  connection = validateConnection(saved.url, saved.token);
} catch (error) {
  if (error.code !== 'ENOENT') throw new Error('Unable to read saved Paperless connection.');
  if (process.env.PAPERLESS_URL && process.env.PAPERLESS_TOKEN) connection = validateConnection(process.env.PAPERLESS_URL, process.env.PAPERLESS_TOKEN);
}
const maxBytes = 20 * 1024 * 1024;
const files = {'/': ['index.html','text/html; charset=utf-8'], '/login': ['login.html','text/html; charset=utf-8'], '/login.js':['login.js','text/javascript; charset=utf-8'], '/app.js':['app.js','text/javascript; charset=utf-8'], '/crop.js':['crop.js','text/javascript; charset=utf-8'], '/style.css':['style.css','text/css; charset=utf-8'], '/icon.svg':['icon.svg','image/svg+xml'], '/icon-192.png':['icon-192.png','image/png'], '/icon-512.png':['icon-512.png','image/png'], '/manifest.webmanifest':['manifest.webmanifest','application/manifest+json']};
const publicFiles=new Set(['/login','/login.js','/style.css','/icon.svg','/icon-192.png','/icon-512.png','/manifest.webmanifest']);
const sessions=new Map(), sessionLifetime=24*60*60*1000;
function sessionId(req) {return (req.headers.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith('receipt_session='))?.slice('receipt_session='.length);}
function authorised(req) {
  if(authDisabled)return true;
  const id=sessionId(req), expiry=sessions.get(id);
  if(!expiry)return false;
  if(expiry<Date.now()){sessions.delete(id);return false;}
  return true;
}
function sameSecret(a,b) {const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length && timingSafeEqual(x,y);}
function cookie(req,id,maxAge){
  const secure=req.socket.encrypted || req.headers['x-forwarded-proto']==='https';
  return `receipt_session=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure?'; Secure':''}`;
}
async function body(req, limit) {
  if (Number(req.headers['content-length']) > limit) throw new Error('too large');
  let size=0; const chunks=[];
  for await (const chunk of req) {size+=chunk.length; if (size>limit) throw new Error('too large'); chunks.push(chunk);}
  return Buffer.concat(chunks);
}
function json(res, status, value) {res.writeHead(status, {'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(value));}
const server = http.createServer(async (req,res) => {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' blob:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  const path = new URL(req.url, 'http://localhost').pathname;
  if(req.method==='GET' && path==='/auth/status')return json(res,200,{required:!authDisabled,authenticated:authorised(req)});
  if(req.method==='POST' && path==='/auth/login') {
    if(req.headers['x-receipt-upload']!=='1' || !req.headers['content-type']?.startsWith('application/json'))return json(res,403,{error:'Invalid request.'});
    if(authDisabled)return json(res,200,{authenticated:true});
    let input;try{input=JSON.parse((await body(req,8192)).toString('utf8'));}catch{return json(res,400,{error:'Invalid sign-in request.'});}
    if(typeof input.username!=='string'||typeof input.password!=='string'||(username && !sameSecret(input.username,username))||!sameSecret(input.password,password))return json(res,401,{error:'Incorrect username or password.'});
    for(const [id,expiry] of sessions)if(expiry<Date.now())sessions.delete(id);
    if(sessions.size>=1000)sessions.delete(sessions.keys().next().value);
    const id=randomBytes(32).toString('hex');sessions.set(id,Date.now()+sessionLifetime);res.setHeader('Set-Cookie',cookie(req,id,sessionLifetime/1000));return json(res,200,{authenticated:true});
  }
  if(req.method==='POST' && path==='/auth/logout'){
    if(req.headers['x-receipt-upload']!=='1')return json(res,403,{error:'Invalid request.'});
    sessions.delete(sessionId(req));res.setHeader('Set-Cookie',cookie(req,'',0));return json(res,200,{authenticated:false});
  }
  if (!authorised(req) && !(req.method==='GET' && publicFiles.has(path))) {
    if(req.method==='GET' && path==='/'){res.writeHead(303,{Location:'/login'});return res.end();}
    return json(res,401,{error:'Sign in required.'});
  }
  if (req.method === 'GET' && files[path]) {
    const [name,type] = files[path];
    try {const data = await readFile(fileURLToPath(new URL('./public/'+name, import.meta.url))); res.writeHead(200,{'Content-Type':type}); return res.end(data);} catch {res.writeHead(500); return res.end('Unable to load app');}
  }
  if (req.method === 'GET' && path === '/connection') return json(res,200,{connected:!!connection,url:connection?.url || ''});
  if (req.method === 'GET' && path === '/tags') {
    if (!connection) return json(res,400,{error:'Connect Paperless in settings first.'});
    const target=connection, tags=[];
    try {
      for (let page=1;page<=100;page++) {
        const url=new URL('api/tags/',target.url);
        url.searchParams.set('page',String(page)); url.searchParams.set('page_size','100');
        const response=await fetch(url,{headers:{Authorization:`Token ${target.token}`},redirect:'manual',signal:AbortSignal.timeout(12000)});
        if(!response.ok) throw new Error('Paperless rejected the request');
        const result=await response.json();
        if(!Array.isArray(result.results)) throw new Error('Invalid response');
        for(const tag of result.results) if(Number.isSafeInteger(tag.id) && typeof tag.name==='string') tags.push({id:tag.id,name:tag.name});
        if(!result.next) return json(res,200,{tags});
      }
      throw new Error('Too many pages');
    } catch {return json(res,502,{error:'Could not load Paperless tags. Please try again.'});}
  }
  if (req.method === 'POST' && path === '/connection') {
    if (req.headers['x-receipt-upload'] !== '1' || !req.headers['content-type']?.startsWith('application/json')) return json(res,403,{error:'Invalid request.'});
    let candidate;
    try {const input=JSON.parse((await body(req, 8192)).toString('utf8')); candidate=validateConnection(input.url,input.token);}
    catch {return json(res,400,{error:'Enter a valid Paperless URL and API token.'});}
    try {
      const check=await fetch(new URL('api/documents/?page_size=1',candidate.url),{headers:{Authorization:`Token ${candidate.token}`},redirect:'manual',signal:AbortSignal.timeout(12000)});
      if (!check.ok) return json(res,400,{error:`Paperless could not verify the connection (HTTP ${check.status}). Check the URL and token.`});
      await check.body?.cancel();
    } catch {return json(res,400,{error:'Could not reach Paperless. Check the URL and network connection.'});}
    let temp;
    try {
      await mkdir(dataDir,{recursive:true,mode:0o700});
      temp=join(dataDir,`.paperless-${randomUUID()}.tmp`);
      await writeFile(temp,JSON.stringify(candidate),{mode:0o600,flag:'wx'});
      await rename(temp,configPath);
      connection=candidate;
      return json(res,200,{connected:true,url:candidate.url});
    } catch {if(temp) await unlink(temp).catch(()=>{}); return json(res,500,{error:'Could not save the connection. Check the app data directory permissions.'});}
  }
  if (req.method !== 'POST' || path !== '/upload') {res.writeHead(404); return res.end('Not found');}
  if (req.headers['x-receipt-upload'] !== '1' || !req.headers['content-type']?.startsWith('multipart/form-data;')) {res.writeHead(403); return res.end('Invalid request');}
  if (!connection) {res.writeHead(400); return res.end('Connect Paperless in settings first.');}
  let payload;
  try {payload=await body(req,maxBytes);} catch {res.writeHead(413); return res.end('Receipt is too large (20 MB maximum).');}
  const target=connection;
  try {
    const response=await fetch(new URL('api/documents/post_document/',target.url),{method:'POST',headers:{Authorization:`Token ${target.token}`,'Content-Type':req.headers['content-type']},body:payload,redirect:'manual',signal:AbortSignal.timeout(30000)});
    if (!response.ok) {res.writeHead(502); return res.end(`Paperless rejected the upload (HTTP ${response.status}). Check your token and Paperless settings.`);}
    const result=await response.text(); res.writeHead(202,{'Content-Type':'application/json'}); res.end(JSON.stringify({task:result.replace(/^"|"$/g,'')}));
  } catch {if (!res.headersSent) {res.writeHead(502); res.end('Could not reach Paperless. Check the server connection.');}}
});
server.listen(Number(process.env.PORT || 3000),process.env.HOST || '127.0.0.1',()=>console.log(`Receipt to Paperless listening on ${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 3000}`));
