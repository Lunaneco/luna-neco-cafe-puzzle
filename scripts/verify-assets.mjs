import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('docs/asset-manifest.json', root), 'utf8'));
for (const asset of manifest) {
  assert.ok(!asset.error, `${asset.path}: incomplete migration`);
  const data = await readFile(new URL(asset.path, root));
  assert.equal(data.length, asset.bytes, `${asset.path}: size changed`);
  assert.equal(createHash('sha256').update(data).digest('hex'), asset.sha256, `${asset.path}: hash changed`);
}
for (const file of ['index.html', 'src/game.js', 'src/styles.css']) {
  const text = await readFile(new URL(file, root), 'utf8');
  assert.doesNotMatch(text, /https?:\/\/|DreamCoreSDK|postMessage\(|fetch\(|XMLHttpRequest/, `${file}: external runtime dependency`);
  for (const match of text.matchAll(/(?:\.\/|\.\.\/)(?:assets|src|vendor)\/[\w./-]+/g)) {
    const url = file.endsWith('.css') ? new URL(match[0], new URL(file, root)) : new URL(match[0], root);
    await access(url);
  }
}
console.log(`Verified ${manifest.length} bundled files and all runtime paths.`);
