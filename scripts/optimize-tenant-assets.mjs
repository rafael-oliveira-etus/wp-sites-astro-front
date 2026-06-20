#!/usr/bin/env node
// Generates optimized image assets per tenant.
//
// For each tenant in `tenants/<id>/public/`:
//   - SVGs:        minified in place (svgo)
//   - logo.svg:    used as-is (no derivatives needed; vector)
//   - logo.png:    raster source — generates logo.webp + logo.avif siblings
//   - favicon-source.png: 173x173 (or any sq) — generates favicon.svg-equivalent? no, uses logo.svg/png
//   - apple-touch-icon.png: 180x180, derived from logo.svg or favicon-source.png
//   - og-default.svg → og-default.png + og-default.webp (1200x630)

import { readdirSync, readFileSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { optimize as svgoOptimize } from 'svgo';

const TENANTS_DIR = resolve(process.cwd(), 'tenants');
const tenantId = process.argv[2];
const tenants = tenantId
  ? [tenantId]
  : readdirSync(TENANTS_DIR).filter((d) =>
      statSync(join(TENANTS_DIR, d)).isDirectory(),
    );

function minifySvg(path) {
  const raw = readFileSync(path, 'utf8');
  const result = svgoOptimize(raw, {
    multipass: true,
    plugins: [
      { name: 'preset-default' },
      'removeDimensions',
    ],
  });
  if (result.data && result.data.length < raw.length) {
    writeFileSync(path, result.data);
    return raw.length - result.data.length;
  }
  return 0;
}

for (const id of tenants) {
  const pub = join(TENANTS_DIR, id, 'public');
  if (!existsSync(pub)) continue;

  // 1) Minify all SVGs in tenant public dir
  for (const f of readdirSync(pub)) {
    if (f.endsWith('.svg')) {
      const saved = minifySvg(join(pub, f));
      if (saved) console.log(`[${id}] svgo ${f} (-${saved} bytes)`);
    }
  }

  const logoSvg = join(pub, 'logo.svg');
  const logoPng = join(pub, 'logo.png');
  const ogSvg = join(pub, 'og-default.svg');
  const faviconSource = join(pub, 'favicon-source.png');

  // 2) PNG logo: generate WebP + AVIF derivatives
  if (existsSync(logoPng)) {
    const buf = readFileSync(logoPng);
    await sharp(buf)
      .webp({ quality: 92, effort: 6 })
      .toFile(join(pub, 'logo.webp'));
    console.log(`[${id}] logo.webp`);
    await sharp(buf)
      .avif({ quality: 70, effort: 7 })
      .toFile(join(pub, 'logo.avif'));
    console.log(`[${id}] logo.avif`);
  }

  // 3) apple-touch-icon.png 180x180
  // Source priority: favicon-source.png > logo.svg > logo.png
  const appleSource = existsSync(faviconSource)
    ? faviconSource
    : existsSync(logoSvg)
      ? logoSvg
      : existsSync(logoPng)
        ? logoPng
        : null;
  if (appleSource) {
    const opts = appleSource.endsWith('.svg') ? { density: 384 } : {};
    await sharp(appleSource, opts)
      .resize(180, 180, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .png({ compressionLevel: 9, palette: true })
      .toFile(join(pub, 'apple-touch-icon.png'));
    console.log(`[${id}] apple-touch-icon.png (180x180)`);
  }

  // 4) Favicon SVG: create from favicon-source.png if no favicon.svg present, else leave alone.
  // (We prefer SVG favicon for modern browsers; if tenant only has raster, generate a 32x32 PNG fallback.)
  if (!existsSync(join(pub, 'favicon.svg')) && existsSync(faviconSource)) {
    await sharp(faviconSource)
      .resize(32, 32, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toFile(join(pub, 'favicon-32.png'));
    console.log(`[${id}] favicon-32.png (no favicon.svg present)`);
  }

  // 5) OG image PNG + WebP from SVG source
  if (existsSync(ogSvg)) {
    const buf = await sharp(ogSvg, { density: 200 })
      .resize(1200, 630, { fit: 'cover' })
      .toBuffer();
    await sharp(buf)
      .png({ compressionLevel: 9, palette: true })
      .toFile(join(pub, 'og-default.png'));
    console.log(`[${id}] og-default.png (1200x630)`);
    await sharp(buf)
      .webp({ quality: 82, effort: 6 })
      .toFile(join(pub, 'og-default.webp'));
    console.log(`[${id}] og-default.webp (1200x630)`);
  }
}
