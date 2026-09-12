import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import './verify-assets.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = new URL('../dist/', import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const path of ['index.html', 'src', 'assets', 'vendor', '.nojekyll']) {
  await cp(root + path, new URL(path, output), { recursive: true });
}
console.log('Built dist/ — bundled assets and shared ranking client ready.');
