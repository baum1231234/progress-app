import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

const outputRoot = resolve(process.argv[2] ?? 'dist');
// Same sub path as the Expo export, e.g. "/progress-web" on GitHub Pages; empty when served from "/".
const basePath = (process.env.PROGRESS_BASE_URL ?? '').replace(/\/$/, '');

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    // .git, .github und .nojekyll gehören nicht zur App (im Pages-Repo läuft das Skript im Repo-Ordner selbst).
    if (entry.name.startsWith('.')) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(path));
    else if (entry.isFile() && entry.name !== 'service-worker.js') files.push(path);
  }
  return files;
}

const files = await collectFiles(outputRoot);
const assets = (await Promise.all(files.map(async (path) => ({
  path,
  url: `${basePath}/${relative(outputRoot, path).split(sep).join('/')}`,
  size: (await stat(path)).size,
})))).sort((left, right) => left.url.localeCompare(right.url));

if (!assets.some(({ url }) => url === `${basePath}/index.html`)) {
  throw new Error('Der Expo-Export enthält keine index.html.');
}

const fingerprint = createHash('sha256');
for (const asset of assets) {
  fingerprint.update(asset.url).update('\0').update(await readFile(asset.path)).update('\0');
}
const version = fingerprint.digest('hex').slice(0, 16);
const source = `const CACHE = ${JSON.stringify(`progress-${version}`)};
const INDEX = ${JSON.stringify(`${basePath}/index.html`)};
const PRECACHE = ${JSON.stringify(assets.map(({ url }) => url))};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key.startsWith('progress-') && key !== CACHE).map((key) => caches.delete(key)))));
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/v1/')) return;

  const store = (response) => {
    if (response.ok) event.waitUntil(caches.open(CACHE).then((cache) => cache.put(event.request, response.clone())));
    return response;
  };

  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request)
      .then(store)
      .catch(async () => {
        const cache = await caches.open(CACHE);
        return (await cache.match(event.request)) ?? cache.match(INDEX);
      }));
    return;
  }

  event.respondWith(caches.open(CACHE).then(async (cache) =>
    (await cache.match(event.request)) ?? fetch(event.request).then(store)));
});
`;

await writeFile(join(outputRoot, 'service-worker.js'), source, 'utf8');
console.log(`Offline-Cache ${version}: ${assets.length} Dateien.`);
