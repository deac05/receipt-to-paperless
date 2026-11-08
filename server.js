import http from 'node:http';
import { readFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const password = process.env.APP_PASSWORD;
const username = process.env.APP_USERNAME;
if (!password) throw new Error('Set APP_PASSWORD before starting.');
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
const files = {'/': ['index.html','text/html; charset=utf-8'], '/app.js':['app.js','text/javascript; charset=utf-8'], '/crop.js':['crop.js','text/javascript; charset=utf-8'], '/style.css':['style.css','text/css; charset=utf-8'], '/icon.svg':['icon.svg','image/svg+xml']};
function authorised(header) {
  if (!header?.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString();
  const supplied = Buffer.from(decoded.slice(decoded.indexOf(':') + 1));
  const expected = Buffer.from(password);
  const separator = decoded.indexOf(':');
  return separator !== -1 && (!username || decoded.slice(0, separator) === username) && supplied.length === expected.length && timingSafeEqual(supplied, expected);
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
  if (!authorised(req.headers.authorization)) {res.writeHead(401, {'WWW-Authenticate':'Basic realm="Receipt to Paperless", charset="UTF-8"'}); return res.end('Sign in required');}
  const path = new URL(req.url, 'http://localhost').pathname;
  if (req.method === 'GET' && files[path]) {
    const [name,type] = files[path];
    try {const data = await readFile(fileURLToPath(new URL('./public/'+name, import.meta.url))); res.writeHead(200,{'Content-Type':type}); return res.end(data);} catch {res.writeHead(500); return res.end('Unable to load app');}
  }
  if (req.method === 'GET' && path === '/connection') return json(res,200,{connected:!!connection,url:connection?.url || ''});
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
