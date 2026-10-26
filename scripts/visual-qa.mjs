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
  // half fold (top half down) · quarter fold (then the right half over the left; 0.5 = the half fold)
  ...[0.3, 0.6, 1].map((t) => ({ name: `foldhalf-${t}`, path: `/lab/fold?seed=1407&fold=half&t=${t}` })),
  ...[0.65, 0.8, 1].map((t) => ({ name: `foldquarter-${t}`, path: `/lab/fold?seed=1407&fold=quarter&t=${t}` })),
  // insert 0–.3 · close .3–.5 · pour .5–.7 · press .7–1
  ...[0.15, 0.3, 0.4, 0.6, 0.7, 0.8, 0.86, 1].map((t) => ({ name: `envelope-${t}`, path: `/lab/envelope?seed=1407&t=${t}` })),
  // orient 0–.15 · insert .15–.85 (seal snag ~.45) · drop .85–1
  ...[0, 0.08, 0.15, 0.3, 0.5, 0.7, 0.86, 1].map((t) => ({ name: `post-${t}`, path: `/lab/post?seed=1407&t=${t}` })),
  ...[0, 0.15, 0.5, 1].map((t) => ({ name: `post-fr-${t}`, path: `/lab/post?seed=1407&country=fr&t=${t}` })),
  // envelopes sized for the fold: C5 (half fold) turns to the RU slot like a DL; C6 (in four) goes in long edge first
  ...[0, 0.15, 0.5].map((t) => ({ name: `postc5-${t}`, path: `/lab/post?seed=1407&fold=half&t=${t}` })),
  ...[0, 0.15, 0.5].map((t) => ({ name: `postc6-${t}`, path: `/lab/post?seed=1407&fold=quarter&t=${t}` })),
  ...[0, 0.18, 0.25, 0.6, 0.72].map((t) => ({ name: `mbc5-${t}`, path: `/lab/mailbox?seed=1407&fold=half&waiting=2&t=${t}` })),
  ...[0.18, 0.25, 0.6, 0.72].map((t) => ({ name: `mbc6-${t}`, path: `/lab/mailbox?seed=1407&fold=quarter&waiting=2&t=${t}` })),
  // door 0–.1 · take .1–.25 · flip .25–.32 · slit .32–.5 · pull .5–.7 · unfold .7–1
  ...[0, 0.05, 0.1, 0.18, 0.25, 0.29, 0.41, 0.5, 0.6, 0.7, 0.85, 1].map((t) => ({ name: `mailbox-${t}`, path: `/lab/mailbox?seed=1407&t=${t}` })),
  // opened by breaking the seal: strain · just snapped (crumbs) · crumbs landing · flap half open · open · pulling
  ...[0.345, 0.365, 0.38, 0.42, 0.5, 0.6].map((t) => ({ name: `seal-${t}`, path: `/lab/mailbox?seed=1407&open=seal&t=${t}` })),
  // FR mailbox (letters from Russia) · RU mailbox with three letters · an empty box
  { name: 'mbfr-5-closed', path: '/lab/mailbox?seed=1407&country=fr&waiting=5&t=0' },
  { name: 'mbfr-5-open', path: '/lab/mailbox?seed=1407&country=fr&waiting=5&t=0.1' },
  { name: 'mbfr-front', path: '/lab/mailbox?seed=1407&country=fr&t=0.25' },
  { name: 'mbru-3-closed', path: '/lab/mailbox?seed=1407&waiting=3&t=0' },
  { name: 'mbru-3-out', path: '/lab/mailbox?seed=1407&waiting=3&t=0.18' },
  { name: 'mbru-front', path: '/lab/mailbox?seed=1407&t=0.25' },
  { name: 'mb-empty', path: '/lab/mailbox?seed=1407&waiting=0' },
  // tracking Lille → Minsk: day 1 (FR scans) · day 6 (silence after Roissy) · day 15 (Minsk) · delivered · express · sender in French
  ...[1, 6, 15, 30].map((d) => ({ name: `track-day${d}`, path: `/lab/track?seed=1407&day=${d}` })),
  { name: 'track-express', path: '/lab/track?seed=1407&tier=express&day=1' },
  { name: 'track-fr', path: '/lab/track?seed=1407&viewer=sender&day=15' },
  // flexible wax: no transit crack · bending · peeled off whole, film left behind
  ...[0.3, 0.345, 0.42, 0.5].map((t) => ({ name: `flex-${t}`, path: `/lab/mailbox?seed=1407&open=seal&wax=flexible&t=${t}` })),
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
