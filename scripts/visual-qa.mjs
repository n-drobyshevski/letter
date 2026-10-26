#!/usr/bin/env node
/**
 * Visual QA: serves the web export (`npm run export:web`) and screenshots each
 * lab screen at fixed seeds / fold progress, on a phone and a laptop viewport.
 * Output: qa-screens/<name>.png — review against .claude/skills/paper-realism.
 *
 *   node scripts/visual-qa.mjs [--only fold]
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

// Playwright is pre-installed globally in CI/cloud containers; locally: npm i -D playwright.
const { chromium } = createRequire(import.meta.url)('playwright');

const DIST = resolve('dist');
const OUT = resolve('qa-screens');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.wasm': 'application/wasm', '.ttf': 'font/ttf', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

const SHOTS = [
  { name: 'home', path: '/' },
  { name: 'jitter-grid', path: '/lab/jitter?seed=20261026&paper=grid' },
  { name: 'jitter-cotton-marck', path: '/lab/jitter?seed=99&paper=cotton&font=marckScript&ink=violet' },
  { name: 'typing', path: '/lab/typing?seed=7' },
  ...[0, 0.25, 0.5, 0.75, 1].map((t) => ({ name: `fold-${t}`, path: `/lab/fold?seed=1407&t=${t}` })),
];
const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844, deviceScaleFactor: 2 },
  { name: 'laptop', width: 1280, height: 860, deviceScaleFactor: 1 },
];

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  let file = join(DIST, decodeURIComponent(url.pathname));
  try {
    const body = await readFile(file).catch(async () => readFile((file = join(DIST, 'index.html'))));
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(0);
const base = `http://localhost:${server.address().port}`;

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const errors = [];
for (const vp of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.deviceScaleFactor });
  page.on('pageerror', (e) => errors.push(`${vp.name}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${vp.name} console: ${m.text()}`));
  for (const shot of SHOTS.filter((s) => !only || s.name.startsWith(only))) {
    await page.goto(base + shot.path, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    const file = join(OUT, `${shot.name}.${vp.name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log('shot', file);
  }
  await page.close();
}
await browser.close();
server.close();
if (errors.length) {
  console.error('\nPage errors:\n' + errors.join('\n'));
  process.exitCode = 1;
}
