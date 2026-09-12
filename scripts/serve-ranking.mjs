import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import worker from '../server/worker.js';
import { localDB } from '../server/local-db.mjs';

await mkdir('.wrangler', { recursive: true });
const env = {
  DB: localDB('.wrangler/local-ranking.sqlite'),
  ROUND_SECRET: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex'),
  ALLOWED_ORIGINS: 'http://127.0.0.1:4173,http://localhost:4173,http://127.0.0.1:4183',
  // Local fixture only. Production must provide real Cloudflare rate-limit bindings.
  WRITE_LIMITER: { limit: async () => ({ success: true }) },
  READ_LIMITER: { limit: async () => ({ success: true }) },
};
createServer(async (req, res) => {
  try {
    const request = new Request('http://127.0.0.1:8787' + req.url, {
      method: req.method, headers: { ...req.headers, 'CF-Connecting-IP': req.socket.remoteAddress },
      ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: req, duplex: 'half' }),
    });
    const response = await worker.fetch(request, env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch { res.writeHead(500).end(); }
}).listen(8787, '127.0.0.1', () => console.log('Local ranking API: http://127.0.0.1:8787 (test scores only)'));
