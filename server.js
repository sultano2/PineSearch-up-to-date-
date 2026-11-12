import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { getYelpDetails, loadSource } from './api.js';

const files = {
  '/': ['index.html', 'text/html'],
  '/index.html': ['index.html', 'text/html'],
  '/styles.css': ['styles.css', 'text/css'],
  '/app.js': ['app.js', 'text/javascript'],
  '/places.js': ['places.js', 'text/javascript'],
  '/sample-places.json': ['sample-places.json', 'application/json']
};

for (const name of ['portland-head-light', 'old-port', 'eastern-promenade', 'portland-observatory',
  'bug-light', 'peaks-island', 'spring-point', 'portland-museum', 'willard-beach', 'back-cove']) {
  files[`/photos/${name}.jpg`] = [`photos/${name}.jpg`, 'image/jpeg'];
}

export function makeServer(loader = loadSource, liveReload = false) {
  return createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.method !== 'GET') {
      response.writeHead(405, { Allow: 'GET' });
      response.end('Method not allowed');
      return;
    }
    try {
      const url = new URL(request.url, 'http://localhost');
      if (liveReload && url.pathname === '/dev/reload') {
        const watcher = watch(new URL('./public/', import.meta.url), { recursive: true }, () => {
          response.write('data: reload\n\n');
        });
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
        response.write(': connected\n\n');
        watcher.on('error', () => response.end());
        response.on('close', () => watcher.close());
        return;
      }
      if (url.pathname === '/api/places') {
        const source = url.searchParams.get('source');
        if (!['osm', 'yelp', 'events', 'museum'].includes(source)) {
          response.writeHead(400);
          response.end('Unknown source');
          return;
        }
        const data = await loader(source);
        response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify(data));
        return;
      }
      if (url.pathname === '/api/yelp-details') {
        const id = url.searchParams.get('id') || '';
        if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) {
          response.writeHead(400);
          response.end('Invalid Yelp business ID');
          return;
        }
        const details = await getYelpDetails(id);
        response.writeHead(details ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify(details));
        return;
      }
      const file = files[url.pathname];
      if (!file) {
        response.writeHead(404);
        response.end('Not found');
        return;
      }
      const content = await readFile(new URL(`./public/${file[0]}`, import.meta.url));
      const contentType = file[1] === 'image/jpeg' ? file[1] : `${file[1]}; charset=utf-8`;
      response.writeHead(200, { 'Content-Type': contentType });
      if (liveReload && file[0] === 'index.html') {
        const script = '<script>new EventSource("/dev/reload").onmessage = () => setTimeout(() => location.reload(), 150);</script>';
        response.end(content.toString().replace('</body>', `${script}</body>`));
      } else {
        response.end(content);
      }
    } catch {
      response.writeHead(500);
      response.end('Unable to load this resource');
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  makeServer(loadSource, process.argv.includes('--dev')).listen(port, '127.0.0.1', () => {
    console.log(`PineSearch is running at http://localhost:${port}`);
  });
}
