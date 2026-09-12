import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkRankingDeploy } from '../scripts/check-ranking-deploy.mjs';

const config = JSON.parse(readFileSync(new URL('../server/wrangler.jsonc', import.meta.url), 'utf8'));
function ready() {
  const copy = structuredClone(config);
  copy.d1_databases[0].database_id = '12345678-1234-1234-1234-123456789abc';
  return copy;
}

test('deployment guard accepts the prepared security configuration', () => {
  assert.doesNotThrow(() => checkRankingDeploy(ready()));
});

test('deployment guard prevents publishing placeholder databases or unsafe overrides', () => {
  for (const alter of [
    c => { c.d1_databases[0].database_id = 'REPLACE_WITH_DATABASE_ID'; },
    c => { c.vars.ALLOWED_ORIGINS = '*'; },
    c => { c.vars.ROUND_SECRET = 'do-not-publish-a-key'; },
    c => { c.ratelimits = []; },
    c => { c.ratelimits[0].simple.limit = 10000; },
    c => { c.ratelimits[1].namespace_id = c.ratelimits[0].namespace_id; },
    c => { c.preview_urls = true; },
    c => { c.observability.logs.invocation_logs = true; },
    c => { c.observability.redact_query_string = false; },
    c => { c.observability.traces.enabled = true; },
  ]) {
    const copy = ready(); alter(copy);
    assert.throws(() => checkRankingDeploy(copy));
  }
});
