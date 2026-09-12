'use strict';

// Shared by the browser and score verifier. Cosmetic effects use separate randomness.
globalThis.LunaRound = Object.freeze({
  random(seed) {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6D2B79F5) | 0;
      let n = Math.imul(state ^ state >>> 15, 1 | state);
      n ^= n + Math.imul(n ^ n >>> 7, 61 | n);
      return ((n ^ n >>> 14) >>> 0) / 4294967296;
    };
  },
  replay(seed, actions, elapsed) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff ||
        !Array.isArray(actions) || actions.length > 10000 ||
        !Number.isSafeInteger(elapsed) || elapsed < 0 || elapsed > 3600000) throw Error('invalid_round');
    const random = this.random(seed);
    const grid = Array.from({ length: 8 }, () => Array.from({ length: 13 }, () => Math.floor(random() * 5)));
    let score = 0, deadline = 60000, multiplierUntil = 0, previousTime = -1, ended = false;
    const hasMoves = () => grid.some((col, c) => col.some((v, r) =>
      v >= 5 || (c < 7 && grid[c + 1][r] === v) || (r < 12 && col[r + 1] === v)));
    for (const action of actions) {
      if (!Array.isArray(action) || action.length !== 3) throw Error('invalid_move');
      const [c, r, time] = action;
      if (![c, r, time].every(Number.isSafeInteger) || c < 0 || c > 7 || r < 0 || r > 12 ||
          time < 0 || time < previousTime || time > elapsed || time >= deadline || ended) throw Error('invalid_move');
      previousTime = time;
      const type = grid[c][r];
      let changed = false;
      if (type >= 5) {
        grid[c][r] = null;
        changed = true;
        if (type === 5) deadline += 10000;
        if (type === 6) multiplierUntil = time + 20000;
        if (type === 7) {
          const types = [...new Set(grid.flat().filter(v => v !== null && v < 5 && v !== 1))];
          if (types.length) {
            const target = types[Math.floor(random() * types.length)];
            grid.forEach(col => col.forEach((v, y) => { if (v === target) col[y] = 1; }));
          }
        }
      } else {
        const connected = [], visited = new Set();
        const visit = (x, y) => {
          const key = x * 13 + y;
          if (x < 0 || x > 7 || y < 0 || y > 12 || visited.has(key) || grid[x][y] !== type) return;
          visited.add(key); connected.push([x, y]);
          visit(x + 1, y); visit(x - 1, y); visit(x, y + 1); visit(x, y - 1);
        };
        visit(c, r);
        if (connected.length >= 2) {
          changed = true;
          score += connected.length ** 2 * 10 * (time < multiplierUntil ? 2 : 1);
          const special = connected.length >= 10 ? (type === 4 ? 5 : type === 3 ? 6 : 7) : null;
          connected.forEach(([x, y], i) => { grid[x][y] = i === 0 ? special : null; });
        }
      }
      if (changed) {
        for (let c = 0; c < 8; c++) {
          const column = grid[c].filter(v => v !== null);
          while (column.length < 13) column.unshift(Math.floor(random() * 5));
          grid[c] = column;
        }
        ended = !hasMoves();
      }
    }
    return { score, grid, deadline, ended: ended || elapsed >= deadline };
  },
});
