import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const base = process.env.PAPERLESS_URL;
const token = process.env.PAPERLESS_TOKEN;
const password = process.env.APP_PASSWORD;
const username = process.env.APP_USERNAME;
if (!base || !token || !password) throw new Error('Set PAPERLESS_URL, PAPERLESS_TOKEN and APP_PASSWORD before starting.');
const paperless = new URL(base.endsWith('/') ? base : base + '/');
if (!['http:', 'https:'].includes(paperless.protocol) || paperless.username || paperless.password || paperless.search || paperless.hash) throw new Error('Invalid PAPERLESS_URL');
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
  if (req.method !== 'POST' || path !== '/upload') {res.writeHead(404); return res.end('Not found');}
  // Browsers cannot set this header from a cross-origin HTML form.
  if (req.headers['x-receipt-upload'] !== '1' || !req.headers['content-type']?.startsWith('multipart/form-data;')) {res.writeHead(403); return res.end('Invalid request');}
  if (Number(req.headers['content-length']) > maxBytes) {res.writeHead(413); return res.end('Receipt is too large (20 MB maximum).');}
  let size=0; const chunks=[];
  try {
    for await (const chunk of req) {size+=chunk.length; if(size>maxBytes) {res.writeHead(413); res.end('Receipt is too large (20 MB maximum).'); return;} chunks.push(chunk);}
    const response=await fetch(new URL('api/documents/post_document/',paperless),{method:'POST',headers:{Authorization:`Token ${token}`,'Content-Type':req.headers['content-type']},body:Buffer.concat(chunks),redirect:'manual',signal:AbortSignal.timeout(30000)});
    if (!response.ok) {res.writeHead(502); return res.end(`Paperless rejected the upload (HTTP ${response.status}). Check your token and Paperless settings.`);}
    const result=await response.text(); res.writeHead(202,{'Content-Type':'application/json'}); res.end(JSON.stringify({task:result.replace(/^"|"$/g,'')}));
  } catch {if (!res.headersSent) {res.writeHead(502); res.end('Could not reach Paperless. Check the server connection.');}}
});
server.listen(Number(process.env.PORT || 3000),process.env.HOST || '127.0.0.1',()=>console.log(`Receipt to Paperless listening on ${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 3000}`));
