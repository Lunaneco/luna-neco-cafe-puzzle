import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../server/worker.js';
import { localDB } from '../server/local-db.mjs';
import '../src/leaderboard.js';

function service(t) {
  const db = localDB(); t.after(() => db.close());
  const env = { DB: db, ROUND_SECRET: 'test-secret-only', ALLOWED_ORIGINS: 'https://lunaneco.github.io' };
  const call = (path, body, origin = env.ALLOWED_ORIGINS) => worker.fetch(new Request('https://ranking.test/api/' + path, {
    method: body ? 'POST' : 'GET', headers: { 'Origin': origin, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), env);
  return { env, call };
}
async function completedRound(t, api) {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const round = await (await api.call('rounds', {})).json();
  const initial = LunaRound.replay(round.seed, [], 0).grid;
  const actions = [];
  for (let c = 0; c < 8 && !actions.length; c++) for (let r = 0; r < 12; r++) {
    if (initial[c][r] === initial[c][r + 1]) { actions.push([c, r, 1000]); break; }
  }
  const verified = LunaRound.replay(round.seed, actions, 60000);
  assert.ok(verified.score > 0);
  now += 60010;
  return { token: round.token, name: '全国の猫', actions, elapsed: 60000, score: verified.score };
}

test('shared storage survives separate clients and retry inserts a round only once', async t => {
  const api = service(t), body = await completedRound(t, api);
  const responses = await Promise.all([api.call('scores', body), api.call('scores', { ...body, name: '変更名' })]);
  assert.deepEqual(responses.map(r => r.status), [200, 200]);
  const saved = await responses[0].json();
  assert.equal(saved.entry.rank, 1);
  const anotherBrowser = await (await api.call('leaderboard')).json();
  assert.equal(anotherBrowser.entries.length, 1);
  assert.equal(anotherBrowser.entries[0].name, '全国の猫');
  assert.equal(anotherBrowser.entries[0].score, body.score);
});

test('server rejects edited score, forged seed/token, premature finish, expired token and invalid moves', async t => {
  const api = service(t), body = await completedRound(t, api);
  for (const changed of [
    { ...body, score: body.score + 100 }, { ...body, token: 'forged.signature' },
    { ...body, elapsed: 1000 }, { ...body, actions: [[8, 0, 1000]] },
    { ...body, actions: [[0, 0, 60000]] }, { ...body, actions: [[0, 0, -1]] },
    { ...body, elapsed: 90000 }, { ...body, name: '01234567890' },
  ]) assert.equal((await api.call('scores', changed)).status, 400);
  t.mock.method(Date, 'now', () => 9e15);
  assert.equal((await api.call('scores', body)).status, 400);
  assert.equal((await (await api.call('leaderboard')).json()).entries.length, 0);
});

test('ranking returns top 100 and reports a submitted entry outside that range', async t => {
  const api = service(t), body = await completedRound(t, api);
  for (let i = 0; i < 105; i++) await api.env.DB.prepare('INSERT INTO scores VALUES (?, ?, ?, ?)').bind('fixture-' + i, 'テスト', 1000000 + i, i).run();
  const data = await (await api.call('scores', body)).json();
  assert.equal(data.entries.length, 100);
  assert.equal(data.entries[0].score, 1000104);
  assert.equal(data.entry.rank, 106);
});

test('ties have stable distinct ranks and names are stored as normalized text', async t => {
  const api = service(t), body = await completedRound(t, api);
  await api.env.DB.prepare('INSERT INTO scores VALUES (?, ?, ?, ?)').bind('older', '先の猫', body.score, 1).run();
  const data = await (await api.call('scores', { ...body, name: ' Ａ猫\u0000 ' })).json();
  assert.equal(data.entry.name, 'A猫');
  assert.equal(data.entry.rank, 2);
});

test('CORS allows only configured game origins and request limits are enforced', async t => {
  const api = service(t);
  const good = await api.call('leaderboard');
  assert.equal(good.headers.get('Access-Control-Allow-Origin'), 'https://lunaneco.github.io');
  const bad = await api.call('rounds', {}, 'https://unknown.test');
  assert.equal(bad.status, 403);
  assert.equal(bad.headers.get('Access-Control-Allow-Origin'), null);
  api.env.WRITE_LIMITER = { limit: async () => ({ success: false }) };
  assert.equal((await api.call('rounds', {})).status, 429);
});

test('oversized and invalid JSON requests cannot reach score storage', async t => {
  const api = service(t);
  for (const [body, status] of [['{', 400], ['null', 400], ['x'.repeat(200001), 413]]) {
    const response = await worker.fetch(new Request('https://ranking.test/api/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }), api.env);
    assert.equal(response.status, status);
  }
});

test('client rejects malformed rankings instead of treating them as real records', () => {
  const client = new LunaLeaderboard('https://ranking.test');
  for (const data of [{}, { entries: [{ name: '猫', score: -1 }] }, { entries: 'wrong' }]) assert.throws(() => client.validate(data));
  assert.throws(() => client.validate({ entries: [] }, true));
});
