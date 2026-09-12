import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import worker from '../server/worker.js';
import { localDB } from '../server/local-db.mjs';

await mkdir('.wrangler', { recursive: true });
const env = {
  DB: localDB('.wrangler/local-ranking.sqlite'),
  ROUND_SECRET: crypto.randomUUID(),
  ALLOWED_ORIGINS: 'http://127.0.0.1:4173,http://localhost:4173,http://127.0.0.1:4183',
};
createServer(async (req, res) => {
  try {
    const request = new Request('http://127.0.0.1:8787' + req.url, {
      method: req.method, headers: req.headers,
      ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: req, duplex: 'half' }),
    });
    const response = await worker.fetch(request, env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch { res.writeHead(500).end(); }
}).listen(8787, '127.0.0.1', () => console.log('Local ranking API: http://127.0.0.1:8787 (test scores only)'));
