#!/usr/bin/env node
/**
 * gen-wrangler.mjs — stamp a site's identity onto the built Worker config so each
 * site deploys as its OWN isolated Worker (own name + own routes + own SESSION KV,
 * nothing shared). Source of truth: sites.manifest.json.
 *
 * HOW DEPLOY ACTUALLY RESOLVES (important):
 *   `@astrojs/cloudflare` builds the Worker and writes a RESOLVED wrangler config
 *   to dist/server/wrangler.json (with `main: entry.mjs`, `assets: ../client` —
 *   paths relative to dist/server/). It also writes .wrangler/deploy/config.json
 *   which REDIRECTS `wrangler deploy` to that resolved file. A hand-written config
 *   elsewhere fails ("entry-point file … was not found") because `main`/`assets`
 *   only resolve from dist/server/. So instead of emitting a fresh config, we PATCH
 *   the adapter's resolved config in place with the three per-site fields, and let
 *   the redirect carry the rest. wrangler.jsonc stays the single shared base.
 *
 * Deploy a site (build is per-tenant; dist is overwritten each build, so patching
 * in place is safe — one tenant in flight at a time):
 *   TENANT_ID=<id> pnpm --filter frontend build
 *   node scripts/gen-wrangler.mjs --tenant <id> --strict
 *   pnpm exec wrangler deploy            # follows .wrangler/deploy → patched config
 *
 * Modes:
 *   --tenant <id> [--strict] [--dist <path>]
 *       Patch dist/server/wrangler.json (or --dist) IN PLACE: name ← worker,
 *       routes ← apex + www on the site's zone, kv_namespaces ← [SESSION:<id>].
 *       --strict fails if the site's KV id is still a REPLACE_ placeholder.
 *   --rings
 *       Print {"<ring>":["tenant", …]} (JSON) for the CI ring matrix.
 *   --check [--strict]
 *       Validate the manifest without a build (unique tenant/worker/domain; under
 *       --strict no placeholder KV ids). Non-zero exit on any problem.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url)); // apps/frontend/scripts
const FRONTEND_DIR = resolve(SCRIPT_DIR, '..');
const MANIFEST_PATH = join(FRONTEND_DIR, 'sites.manifest.json');
const DEFAULT_DIST_CONFIG = join(FRONTEND_DIR, 'dist/server/wrangler.json');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

const isPlaceholderKv = (id) => !id || /^REPLACE_/.test(id);

async function loadManifest() {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  if (!Array.isArray(manifest.sites)) throw new Error('sites.manifest.json must have { sites: [] }');
  return manifest;
}

function findSite(manifest, tenant) {
  const site = manifest.sites.find((s) => s.tenant === tenant);
  if (!site) {
    const known = manifest.sites.map((s) => s.tenant).join(', ');
    throw new Error(`tenant "${tenant}" not in sites.manifest.json (have: ${known})`);
  }
  return site;
}

function routesFor(site) {
  return [
    { pattern: `${site.domain}/*`, zone_name: site.zone },
    { pattern: `www.${site.domain}/*`, zone_name: site.zone },
  ];
}

async function patchDistConfig(site, distPath) {
  if (!existsSync(distPath)) {
    throw new Error(`built config not found at ${distPath} — run \`TENANT_ID=${site.tenant} astro build\` first`);
  }
  const cfg = JSON.parse(await readFile(distPath, 'utf8'));
  cfg.name = site.worker;
  cfg.routes = routesFor(site);
  cfg.kv_namespaces = [{ binding: 'SESSION', id: site.kvSessionId }];
  // Fleet deploys are live production sites. middleware.ts reads
  // `env.ENVIRONMENT ?? 'development'` and, when not 'production', stamps
  // `X-Robots-Tag: noindex, nofollow` on every response (and runs in ad-test mode,
  // skips the device-keyed edge cache). Without this var the whole live fleet was
  // served noindex. Set it here so every deployed Worker is production.
  cfg.vars = { ...(cfg.vars ?? {}), ENVIRONMENT: 'production' };
  await writeFile(distPath, JSON.stringify(cfg));
  return cfg;
}

function validateManifest(manifest, strict) {
  const problems = [];
  const seen = { tenant: new Set(), worker: new Set(), domain: new Set() };
  for (const s of manifest.sites) {
    for (const k of ['tenant', 'worker', 'domain', 'zone']) {
      if (!s[k]) problems.push(`site missing "${k}": ${JSON.stringify(s)}`);
    }
    for (const k of ['tenant', 'worker', 'domain']) {
      if (s[k] && seen[k].has(s[k])) problems.push(`duplicate ${k}: ${s[k]}`);
      if (s[k]) seen[k].add(s[k]);
    }
    if (strict && isPlaceholderKv(s.kvSessionId)) problems.push(`${s.tenant}: SESSION KV id is still a REPLACE_ placeholder`);
  }
  return problems;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = await loadManifest();
  const strict = !!args.strict;

  if (args.rings) {
    const rings = {};
    for (const s of manifest.sites) (rings[String(s.ring ?? 0)] ||= []).push(s.tenant);
    process.stdout.write(`${JSON.stringify(rings)}\n`);
    return;
  }

  if (args.check) {
    const problems = validateManifest(manifest, strict);
    if (problems.length) {
      process.stderr.write(`sites.manifest.json problems:\n - ${problems.join('\n - ')}\n`);
      process.exit(1);
    }
    process.stderr.write(`sites.manifest.json OK (${manifest.sites.length} site(s))\n`);
    return;
  }

  if (typeof args.tenant === 'string') {
    const site = findSite(manifest, args.tenant);
    if (isPlaceholderKv(site.kvSessionId)) {
      const msg = `SESSION KV id for "${site.tenant}" is still a REPLACE_ placeholder`;
      if (strict) throw new Error(msg);
      process.stderr.write(`WARN: ${msg}\n`);
    }
    const distPath = typeof args.dist === 'string' ? resolve(FRONTEND_DIR, args.dist) : DEFAULT_DIST_CONFIG;
    const cfg = await patchDistConfig(site, distPath);
    process.stderr.write(`Patched ${distPath}\n  name=${cfg.name}\n  routes=${cfg.routes.map((r) => r.pattern).join(', ')}\n  SESSION=${cfg.kv_namespaces[0].id}\n  ENVIRONMENT=${cfg.vars.ENVIRONMENT}\n`);
    return;
  }

  process.stderr.write(
    'Usage:\n' +
      '  gen-wrangler.mjs --tenant <id> [--strict] [--dist <path>]   (patch built config)\n' +
      '  gen-wrangler.mjs --rings                                    (ring→tenants JSON)\n' +
      '  gen-wrangler.mjs --check [--strict]                         (validate manifest)\n',
  );
  process.exit(2);
}

main().catch((err) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});
