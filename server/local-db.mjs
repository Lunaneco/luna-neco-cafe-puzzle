import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

// Local SQLite adapter for integration tests; production uses a Cloudflare D1 binding.
export function localDB(path = ':memory:') {
  const sqlite = new DatabaseSync(path);
  if (!sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'scores'").get()) {
    sqlite.exec(readFileSync(new URL('./migrations/0001_leaderboard.sql', import.meta.url), 'utf8'));
  }
  const prepare = (sql, params = []) => ({
    bind(...values) { return prepare(sql, values); },
    async all() { return { results: sqlite.prepare(sql).all(...params) }; },
    async first() { return sqlite.prepare(sql).get(...params) || null; },
    async run() { return sqlite.prepare(sql).run(...params); },
  });
  return { prepare, close: () => sqlite.close() };
}
