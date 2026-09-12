import { readFile } from 'node:fs/promises';

export function checkRankingDeploy(config) {
  const fail = message => { throw Error(message); };
  const db = config.d1_databases?.find(binding => binding.binding === 'DB');
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(db?.database_id || '')) fail('Set the real D1 database ID before deploying.');
  if (config.vars?.ALLOWED_ORIGINS !== 'https://lunaneco.github.io') fail('Production origin must be the published game origin.');
  if (Object.keys(config.vars).some(key => /secret|token|key|password/i.test(key))) fail('Store credentials in Worker Secrets, never vars.');
  for (const [name, max] of [['WRITE_LIMITER', 30], ['READ_LIMITER', 120]]) {
    const binding = config.ratelimits?.find(binding => binding.name === name);
    if (!binding || binding.simple?.period !== 60 || !Number.isInteger(binding.simple.limit) ||
        binding.simple.limit < 1 || binding.simple.limit > max) fail('Missing or unsafe rate limit: ' + name);
  }
  if (new Set(config.ratelimits.map(binding => binding.namespace_id)).size !== config.ratelimits.length) fail('Read and write limits must use separate namespaces.');
  if (config.preview_urls !== false) fail('Public preview URLs must be disabled.');
  if (config.observability?.logs?.invocation_logs !== false || config.observability?.redact_query_string !== true ||
      config.observability?.traces?.enabled !== false) fail('Log privacy settings are required.');
}

if (process.argv[1] && new URL(process.argv[1], 'file:').href === import.meta.url) {
  try {
    checkRankingDeploy(JSON.parse(await readFile(new URL('../server/wrangler.jsonc', import.meta.url), 'utf8')));
    console.log('Ranking deployment configuration passed security checks.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
