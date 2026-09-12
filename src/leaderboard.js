'use strict';

globalThis.LunaLeaderboard = class {
  constructor(base = globalThis.LUNA_RANKING_API) { this.base = (base || '').replace(/\/$/, ''); }
  async request(path, body) {
    if (!this.base) throw Error('unavailable');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(this.base + path, {
        method: body ? 'POST' : 'GET', signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error',
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'unavailable');
      return data;
    } finally { clearTimeout(timeout); }
  }
  async begin() {
    const data = await this.request('/api/rounds', {});
    if (typeof data.token !== 'string' || !Number.isInteger(data.seed) || data.seed < 0 || data.seed > 0xffffffff) throw Error('unavailable');
    return data;
  }
  async list() { return this.validate(await this.request('/api/leaderboard')); }
  async submit(round) { return this.validate(await this.request('/api/scores', round), true); }
  validate(data, requireEntry = false) {
    const valid = e => e && typeof e.id === 'string' && typeof e.name === 'string' && [...e.name].length <= 10 &&
      Number.isSafeInteger(e.score) && e.score > 0 && Number.isSafeInteger(e.rank) && e.rank > 0;
    if (!data || !Array.isArray(data.entries) || data.entries.length > 100 || !data.entries.every(valid) ||
        (data.entry && !valid(data.entry)) || (requireEntry && !data.entry)) throw Error('unavailable');
    return data;
  }
};
