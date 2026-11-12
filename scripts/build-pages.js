import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { loadSource } from '../api.js';

const sources = ['osm', 'museum'];
const data = await Promise.all(sources.map(source => loadSource(source, {})));

if (data[0].status !== 'live' || !data[0].places.length) {
  throw new Error('osm could not refresh. Keeping the previous deployment.');
}

await cp('public', 'site', { recursive: true });
await mkdir('site/data', { recursive: true });
const html = await readFile('site/index.html', 'utf8');
await writeFile('site/index.html', html.replace('<html lang="en">', '<html lang="en" data-pages>'));

for (const [index, source] of sources.entries()) {
  await writeFile(`site/data/${source}.json`, JSON.stringify(data[index]));
  console.log(`${source}: ${data[index].places.length} places`);
}
