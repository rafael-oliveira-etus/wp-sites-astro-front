#!/usr/bin/env node
// Extract per-site ad rules from a DXP wrapper bundle into raw JSON for review.
//
// The wrapper bundle (assets.etus.digital/dxp_bundles/wrapper-bundle-<slug>.min.js)
// embeds the WHOLE per-site ad config as `window.dxp_wrapper_config = {...}` on a
// single line. It's a JS object literal (not strict JSON: a leading
// `...window.dxp_wrapper_config` spread + a couple of unquoted keys), so we recover
// it by balanced-brace slicing the literal and eval'ing it in a `vm` sandbox with a
// `window` stub. The config is pure data (strings/arrays/numbers/bools/null), so the
// eval is deterministic and DOM-free.
//
// Usage:
//   node scripts/extract-ad-config.mjs <tenantId> [--slug <bundleSlug>] [--file <localBundle>]
//     <tenantId>      tenant dir under apps/frontend/tenants (e.g. limitemais)
//     --slug <s>      bundle slug if it differs from tenantId (default: tenantId)
//     --file <f>      read a local bundle file instead of fetching (offline)
//
// Output (under scripts/ad-config/):
//   <tenantId>.full.json  entire window.dxp_wrapper_config (nothing lost)
//   <tenantId>.ads.json   ad-serving-relevant subset, RAW (for pruning before mapping)
//
// This is the raw-extraction step only. Pruning + mapping into @etus/ads config is a
// separate step (after the raw output is reviewed).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { stringify as yamlStringify } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'ad-config');
const BUNDLE_BASE = 'https://assets.etus.digital/dxp_bundles';

// Pruned shape (the only rules we keep, per review): identity + adUnitSizes +
// customAdText + the resolved ad-unit list (names+types) + UTM targeting keys.
// Everything else (mapping selectors, adFlows, pricing, tracker, prebid, …) is
// dropped — preserved only in .full.json.

// GAM ad-unit name = prefix + mask. The wrapper's default (no customSlotIds.mask):
//   prefix "/[gam]/"  mask "[domain]_[device]_[position]"
//   -> "/[gam]/[domain]_[device]_[position]"  (placeholders substituted at runtime)
const NAME_TEMPLATE = '/[gam]/[domain]_[device]_[position]';

// GPT type per position: in-page banner vs out-of-page formats.
const POSITION_TYPE = {
  top: { type: 'banner' },
  content: { type: 'banner' },
  sidebar: { type: 'banner' },
  anchor: { type: 'anchor', gptFormat: 'BOTTOM_ANCHOR' },
  interstitial: { type: 'interstitial', gptFormat: 'INTERSTITIAL' },
  rewarded: { type: 'rewarded', gptFormat: 'REWARDED' },
};
const BANNER_POSITIONS = new Set(['top', 'content', 'sidebar']);

// UTM targeting keys to keep (utm_id added — not in the bundle's 17, requested).
const UTM_KEYS = ['utm_campaign', 'utm_content', 'utm_id', 'utm_medium', 'utm_source', 'utm_term'];

// Bundle code defaults (from defaultAdUnitSizes per position class) — used to fill
// device/position combos the per-site adInserter.adUnitSizes doesn't override (it
// only sets mob). anchor/interstitial are OOP (format-based) → no size array.
const BASE_DEFAULT = [[336, 280], [300, 250], [250, 250], [1, 1], 'fluid'];
const SIZE_DEFAULTS = {
  top: { desk: [[980, 120], [980, 90], [970, 280], [970, 250], [970, 90], [728, 90], [1, 1], 'fluid'], mob: BASE_DEFAULT },
  content: { desk: [[728, 90], [480, 320], ...BASE_DEFAULT], mob: BASE_DEFAULT },
  sidebar: { desk: [[300, 600], [160, 600], [120, 600], ...BASE_DEFAULT] },
};
function sizesFor(cfg, device, position) {
  return cfg.adInserter?.adUnitSizes?.[device]?.[position] ?? SIZE_DEFAULTS[position]?.[device] ?? null;
}

function resolveName(cfg, device, position, mask) {
  return (mask ? `/[gam]/${mask}` : NAME_TEMPLATE)
    .replace('[gam]', cfg.gam)
    .replace('[domain]', cfg.domainId)
    .replace('[device]', device)
    .replace('[position]', position);
}

// Enumerate the ad units the wrapper would define. Banner (position×device) combos
// come from adInserter.mapping (device ""→both mob+desk). OOP units (anchor/
// interstitial) come from their enable flags. removeAdPositions is NOT applied here
// (it was pruned) — this is the raw superset; prune devices later if needed.
function resolveAdUnits(cfg) {
  const ai = cfg.adInserter ?? {};
  const combos = new Map();
  for (const m of ai.mapping ?? []) {
    if (!BANNER_POSITIONS.has(m.position)) continue;
    const dev = m.targeting?.device;
    for (const d of dev ? [dev] : ['mob', 'desk']) combos.set(`${m.position}|${d}`, { position: m.position, device: d });
  }
  const units = [...combos.values()].map(({ position, device }) => ({
    name: resolveName(cfg, device, position),
    position, device, ...POSITION_TYPE[position],
    sizes: sizesFor(cfg, device, position), // config override else bundle code default
  }));
  if ((ai.anchorConfigs ?? ai.anchorConfig ?? [])[0]?.enabled) {
    for (const d of ['mob', 'desk']) units.push({ name: resolveName(cfg, d, 'anchor'), position: 'anchor', device: d, ...POSITION_TYPE.anchor, sizes: null });
  }
  if (ai.interstitialConfig?.enable) {
    for (const d of ['mob', 'desk']) units.push({ name: resolveName(cfg, d, 'interstitial'), position: 'interstitial', device: d, ...POSITION_TYPE.interstitial, sizes: null });
  }
  return units.sort((a, b) => a.name.localeCompare(b.name));
}

// Map a resolved ad unit → the tenant `ads.placements[]` entry (@etus/ads
// AdPlacement). adUnit drops the network prefix (engine prepends /{networkCode}/).
// Tablet folds into desk (only mob/desk units exist). OOP (anchor/interstitial)
// carry no sizes/reserve. sizes is a single-breakpoint SizeMap {0: [...]} — device
// gating (server-render per CF-Device-Type) already picks the right unit, so no GPT
// sizeMapping breakpoints are needed.
const TYPE_MAP = {
  top: { type: 'top-banner', position: 'before-content' },
  content: { type: 'in-content', position: 'after-paragraph' },
  sidebar: { type: 'sidebar', position: 'siderail-right' },
  anchor: { type: 'anchor', position: 'anchor' },
  interstitial: { type: 'interstitial', position: 'interstitial' },
};
const DEVICE_MAP = { mob: ['mobile'], desk: ['desktop', 'tablet'] };

function maxReserve(sizes) {
  const hs = (sizes ?? []).filter((s) => Array.isArray(s)).map((s) => s[1]);
  return hs.length ? Math.max(...hs) : undefined;
}

function buildAdsBlock(cfg) {
  const placements = resolveAdUnits(cfg).map((u) => {
    const t = TYPE_MAP[u.position];
    const p = {
      id: `${u.position}-${u.device}`,
      type: t.type,
      enabled: true,
      adUnit: u.name.replace(`/${cfg.gam}/`, ''),
      position: t.position,
      devices: DEVICE_MAP[u.device],
    };
    if (u.sizes) {
      p.sizes = { 0: u.sizes };
      const r = maxReserve(u.sizes);
      if (r) p.reserve = { 0: r };
    }
    return p;
  });
  return {
    networkCode: cfg.gam,
    mcmManagerPubId: cfg.propertyCode,
    urlTargetingKeys: UTM_KEYS, // GAM page targeting forwarded from these URL params
    placements,
  };
}

function buildPruned(cfg) {
  return {
    gam: cfg.gam,
    propertyCode: cfg.propertyCode,
    domainId: cfg.domainId,
    adUnitSizes: cfg.adInserter?.adUnitSizes ?? {},
    customAdText: cfg.adInserter?.customAdText ?? [], // [] → wrapper locale default (ADVERTISEMENT/PUBLICIDAD/PUBLICIDADE)
    customTargeting: UTM_KEYS,
    adUnits: resolveAdUnits(cfg),
  };
}

function extractConfig(src) {
  const mi = src.indexOf('dxp_wrapper_config = {');
  if (mi < 0) throw new Error('marker `dxp_wrapper_config = {` not found in bundle');
  const start = src.indexOf('{', mi);
  let depth = 0, end = -1, inStr = false, q = '', esc = false;
  for (let j = start; j < src.length; j++) {
    const c = src[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === q) inStr = false;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = true; q = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = j; break; } }
  }
  if (end < 0) throw new Error('unbalanced object literal for dxp_wrapper_config');
  const sandbox = { window: { dxp_wrapper_config: {} } };
  vm.createContext(sandbox);
  return vm.runInContext('(' + src.slice(start, end + 1) + ')', sandbox, { timeout: 3000 });
}

async function getBundle({ slug, file }) {
  if (file) return readFileSync(file, 'utf8');
  const url = `${BUNDLE_BASE}/wrapper-bundle-${slug}.min.js`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${url} -> HTTP ${r.status}`);
  return await r.text();
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

const tenant = process.argv[2];
if (!tenant || tenant.startsWith('--')) {
  console.error('usage: node scripts/extract-ad-config.mjs <tenantId> [--slug <s>] [--file <f>]');
  process.exit(1);
}
const slug = arg('--slug') ?? tenant;
const file = arg('--file');

const src = await getBundle({ slug, file });
const cfg = extractConfig(src);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, `${tenant}.full.json`), JSON.stringify(cfg, null, 2));
const pruned = buildPruned(cfg);
writeFileSync(join(OUT_DIR, `${tenant}.pruned.json`), JSON.stringify(pruned, null, 2));
const adsBlock = buildAdsBlock(cfg);
writeFileSync(join(OUT_DIR, `${tenant}.ads-block.json`), JSON.stringify(adsBlock, null, 2));
// YAML form of the `ads:` block, ready to merge into tenant.yaml (the bake target).
writeFileSync(
  join(OUT_DIR, `${tenant}.ads-block.yaml`),
  // aliasDuplicateObjects:false → spell every size array out (no &anchor/*alias),
  // so the merged tenant.yaml stays readable + safe to hand-edit.
  yamlStringify({ ads: adsBlock }, { lineWidth: 0, aliasDuplicateObjects: false }),
);

console.log(`tenant=${tenant} slug=${slug}`);
console.log(`gam=${pruned.gam}  pub=${pruned.propertyCode}  domainId=${pruned.domainId}`);
console.log(`adUnitSizes=${JSON.stringify(pruned.adUnitSizes)}`);
console.log(`customAdText=${JSON.stringify(pruned.customAdText)}  customTargeting=${pruned.customTargeting.join(',')}`);
console.log(`adUnits (${pruned.adUnits.length}):`);
for (const u of pruned.adUnits) console.log(`  ${u.name}  [${u.type}${u.gptFormat ? ':' + u.gptFormat : ''}]  sizes=${JSON.stringify(u.sizes)}`);
console.log(`-> ${OUT_DIR}/${tenant}.{full,pruned}.json`);
