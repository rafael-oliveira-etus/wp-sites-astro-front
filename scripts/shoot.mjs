// Visual validation: screenshot key routes at desktop + mobile viewports.
// Usage: node scripts/shoot.mjs [baseUrl]   (default http://localhost:4321)
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:4321';
const OUT = 'screenshots';
mkdirSync(OUT, { recursive: true });

const ROUTES = [
  { name: 'home', path: '/' },
  { name: 'post', path: '/cartao-de-credito-para-mei-opcoes-e-beneficios/' },
];

const VIEWPORTS = [
  { name: 'desktop', opts: { viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 } },
  { name: 'mobile', opts: { ...devices['iPhone 13'] } },
];

const browser = await chromium.launch();
const results = [];
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext(vp.opts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  for (const r of ROUTES) {
    const url = BASE + r.path;
    let status = 'ok';
    try {
      const resp = await page.goto(url, { waitUntil: 'load', timeout: 90000 });
      status = resp ? resp.status() : 'no-response';
      await page.waitForTimeout(2500); // let remote images/fonts settle
    } catch (e) {
      status = 'NAV-ERROR: ' + e.message;
    }
    // Scroll through to trigger lazy-loaded remote images, then settle.
    try {
      await page.evaluate(async () => {
        const step = Math.floor(window.innerHeight * 0.8);
        for (let y = 0; y < document.body.scrollHeight; y += step) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 250));
        }
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(1500);
    } catch {}
    const file = `${OUT}/${r.name}-${vp.name}.png`;
    let shot = 'full';
    try {
      await page.screenshot({ path: file, fullPage: true, animations: 'disabled', timeout: 120000 });
    } catch (e) {
      shot = 'viewport-fallback';
      await page.screenshot({ path: file, fullPage: false, animations: 'disabled', timeout: 60000 });
    }
    results.push({ route: r.name, vp: vp.name, status, shot, file, errors: errors.length });
  }
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(results, null, 2));
