import '../src/round.js';

const encoder = new TextEncoder();
const MAX_AGE = 24 * 60 * 60 * 1000;
const encode = value => btoa(String.fromCharCode(...value)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const decode = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
async function signingKey(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function issueRound(secret, now) {
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  const body = { id: crypto.randomUUID(), seed, issued: now, version: 1 };
  const payload = encode(encoder.encode(JSON.stringify(body)));
  const signature = await crypto.subtle.sign('HMAC', await signingKey(secret), encoder.encode(payload));
  return { seed, token: payload + '.' + encode(new Uint8Array(signature)) };
}
async function verifyToken(token, secret, now) {
  try {
    if (typeof token !== 'string' || token.length > 600) throw Error();
    const parts = token.split('.');
    if (parts.length !== 2 || !await crypto.subtle.verify('HMAC', await signingKey(secret), decode(parts[1]), encoder.encode(parts[0]))) throw Error();
    const round = JSON.parse(new TextDecoder().decode(decode(parts[0])));
    if (round.version !== 1 || now < round.issued || now - round.issued > MAX_AGE) throw Error();
    return round;
  } catch { throw Object.assign(Error('invalid_round'), { status: 400 }); }
}
function validateName(value) {
  if (typeof value !== 'string') throw Object.assign(Error('invalid_name'), { status: 400 });
  const name = value.normalize('NFKC').replace(/[\p{Cc}\p{Cf}]/gu, '').trim();
  if (!name || [...name].length > 10) throw Object.assign(Error('invalid_name'), { status: 400 });
  return name;
}
async function ranking(db, id) {
  const { results } = await db.prepare('SELECT round_id AS id, name, score FROM scores ORDER BY score DESC, created_at ASC, round_id ASC LIMIT 100').all();
  let entry = null;
  if (id) {
    entry = await db.prepare(`SELECT s.round_id AS id, s.name, s.score,
      (SELECT count(*) + 1 FROM scores o WHERE o.score > s.score OR
       (o.score = s.score AND (o.created_at < s.created_at OR (o.created_at = s.created_at AND o.round_id < s.round_id)))) AS rank
      FROM scores s WHERE s.round_id = ?`).bind(id).first();
  }
  return { entries: results.map((e, i) => ({ ...e, rank: i + 1 })), entry };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const corsOrigin = allowed.includes(origin) ? origin : null;
    const headers = {
      'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin',
      ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
    };
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
    if (origin && !corsOrigin) return json({ error: 'origin_denied' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: {
      ...headers, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600',
    } });
    try {
      const path = new URL(request.url).pathname;
      if (!env.DB || !env.ROUND_SECRET) return json({ error: 'unavailable' }, 503);
      if (path === '/api/leaderboard' && request.method === 'GET') return json(await ranking(env.DB));
      if (request.method !== 'POST' || !['/api/rounds', '/api/scores'].includes(path)) return json({ error: 'not_found' }, 404);
      // CORS is not authentication. Per-IP limits also apply to non-browser clients.
      if (env.WRITE_LIMITER) {
        const key = request.headers.get('CF-Connecting-IP') || 'unknown';
        if (!(await env.WRITE_LIMITER.limit({ key })).success) return json({ error: 'rate_limited' }, 429);
      }
      if (path === '/api/rounds') return json(await issueRound(env.ROUND_SECRET, Date.now()), 201);
      if (!request.headers.get('Content-Type')?.startsWith('application/json')) return json({ error: 'invalid_request' }, 415);
      if (Number(request.headers.get('Content-Length')) > 200000) return json({ error: 'too_large' }, 413);
      const reader = request.body?.getReader();
      if (!reader) return json({ error: 'invalid_request' }, 400);
      let bytes = 0, text = ''; const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 200000) { await reader.cancel(); return json({ error: 'too_large' }, 413); }
        text += decoder.decode(value, { stream: true });
      }
      let body;
      try { body = JSON.parse(text + decoder.decode()); } catch { return json({ error: 'invalid_request' }, 400); }
      if (!body || typeof body !== 'object') return json({ error: 'invalid_request' }, 400);
      const round = await verifyToken(body.token, env.ROUND_SECRET, Date.now());
      const name = validateName(body.name);
      let verified;
      try { verified = globalThis.LunaRound.replay(round.seed, body.actions, body.elapsed); }
      catch { return json({ error: 'invalid_score' }, 400); }
      if (!verified.ended || verified.score <= 0 || verified.score !== body.score || body.elapsed > Date.now() - round.issued + 2000) return json({ error: 'invalid_score' }, 400);
      // A signed round can be inserted only once, including concurrent retries.
      await env.DB.prepare('INSERT INTO scores(round_id, name, score, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(round_id) DO NOTHING')
        .bind(round.id, name, verified.score, Date.now()).run();
      return json(await ranking(env.DB, round.id));
    } catch (error) {
      if (error.status) return json({ error: error.message }, error.status);
      console.error('Leaderboard request failed');
      return json({ error: 'unavailable' }, 503);
    }
  },
};
