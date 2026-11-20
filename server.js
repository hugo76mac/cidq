import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 3000);
const configuredBase = (process.env.BASE_PATH || '/').replace(/\/+$/, '') || '';
const maxBodySize = 128 * 1024;
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

function withoutBase(pathname) {
  return configuredBase && pathname.startsWith(configuredBase) ? pathname.slice(configuredBase.length) || '/' : pathname;
}

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': types['.json'], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(body));
}

function body(request) {
  return new Promise((resolve, reject) => {
    let value = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      value += chunk;
      if (value.length > maxBodySize) {
        reject(new Error('payload_too_large'));
        request.destroy();
      }
    });
    request.on('end', () => {
      try { resolve(JSON.parse(value || '{}')); } catch { reject(new Error('invalid_json')); }
    });
    request.on('error', reject);
  });
}

async function file(response, pathname) {
  const wanted = pathname === '/' ? '/index.html' : pathname;
  const safePath = normalize(wanted).replace(/^(\.\.(\/|\\|$))+/, '');
  try {
    const filePath = join(root, safePath);
    const content = await readFile(filePath);
    const isJpeg = content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff;
    const contentType = isJpeg ? 'image/jpeg' : types[extname(filePath).toLowerCase()] || 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': contentType.startsWith('text/') ? 'no-cache' : 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
    response.end(content);
  } catch {
    if (pathname !== '/') return file(response, '/');
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Page introuvable');
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  let pathname;
  try {
    pathname = withoutBase(decodeURIComponent(url.pathname));
  } catch {
    json(response, 400, { ok: false, error: 'Chemin de requête invalide.' });
    return;
  }

  if (request.method === 'POST' && pathname === '/api/devis') {
    try {
      const data = await body(request);
      const required = ['nom', 'telephone', 'email', 'prestation', 'message'];
      if (required.some((field) => !String(data[field] || '').trim())) {
        json(response, 400, { ok: false, error: 'Veuillez compléter les champs obligatoires.' });
        return;
      }
      console.info(`[devis] ${new Date().toISOString()} — ${String(data.nom).slice(0, 80)} — ${String(data.prestation).slice(0, 80)}`);
      json(response, 200, { ok: true, message: 'Votre demande a bien été transmise.' });
    } catch (error) {
      json(response, error.message === 'payload_too_large' ? 413 : 400, { ok: false, error: 'La demande n’a pas pu être traitée.' });
    }
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    json(response, 405, { ok: false, error: 'Méthode non autorisée.' });
    return;
  }
  await file(response, pathname);
});

server.listen(port, '0.0.0.0', () => console.info(`Carrosserie Industrielle du Quesnay — serveur sur le port ${port}`));
