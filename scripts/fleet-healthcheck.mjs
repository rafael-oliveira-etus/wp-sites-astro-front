#!/usr/bin/env node
/**
 * fleet-healthcheck.mjs — post-deploy smoke check for one site.
 *
 * Used by .github/workflows/deploy-fleet.yml between rings: after a site's
 * Worker is deployed, confirm its domain actually serves a 2xx (catches a
 * deploy that "succeeded" but throws at request time — build-green ≠ runtime
 * correct). Exits non-zero on failure so the ring rollout stops before the
 * next wave.
 *
 * Reads the domain from sites.manifest.json. Retries with backoff to absorb
 * edge-propagation delay right after deploy.
 *
 *   node scripts/fleet-healthcheck.mjs --tenant limitemais [--retries 5] [--path /]
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(resolve(SCRIPT_DIR, '..'), 'sites.manifest.json');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}

const tenant = arg('tenant');
const retries = Number(arg('retries', '5'));
const path = arg('path', '/');

if (!tenant) {
  process.stderr.write('--tenant <id> required\n');
  process.exit(2);
}

const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
const site = manifest.sites.find((s) => s.tenant === tenant);
if (!site) {
  process.stderr.write(`tenant "${tenant}" not in sites.manifest.json\n`);
  process.exit(2);
}

const url = `https://${site.domain}${path}`;

for (let attempt = 1; attempt <= retries; attempt++) {
  try {
    const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'fleet-healthcheck' } });
    if (res.ok) {
      process.stdout.write(`OK ${url} → ${res.status} (attempt ${attempt})\n`);
      process.exit(0);
    }
    process.stderr.write(`attempt ${attempt}/${retries}: ${url} → ${res.status}\n`);
  } catch (err) {
    process.stderr.write(`attempt ${attempt}/${retries}: ${url} → ${err.message}\n`);
  }
  if (attempt < retries) await sleep(attempt * 3000); // 3s, 6s, 9s, 12s
}

process.stderr.write(`HEALTHCHECK FAILED ${url} after ${retries} attempts\n`);
process.exit(1);
