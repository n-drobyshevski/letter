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
  // several sheets, both sides: a notebook verso (margin on the left, the front showing through) · sheet 2 · halfway over · cotton
  { name: 'desk-verso', path: '/lab/typing?seed=7&sheets=2&face=1' },
  { name: 'desk-sheet2', path: '/lab/typing?seed=7&sheets=3&face=2' },
  { name: 'desk-turn-0.5', path: '/lab/typing?seed=7&sheets=2&turn=0.42' },
  // taken by the top of the right edge and pulled up-left: the axis leans, the sheet travels with the hand
  ...[0.3, 0.7].map((turn) => ({ name: `desk-turn-tilt-${turn}`, path: `/lab/typing?seed=7&sheets=2&turn=${turn}&tilt=-0.4` })),
  // Ctrl + drag straight down on the laptop's loose desk: top over bottom, spinning upright as it turns.
  ...[0.15, 0.3, 0.5, 0.7, 0.85].map((turn) => ({ name: `desk-turn-vertical-${turn}`, path: `/lab/typing?seed=7&sheets=2&turn=${turn}&tilt=1.57` })),
  { name: 'desk-cotton-verso', path: '/lab/typing?seed=7&paper=cotton&sheets=3&face=5' },
  // the whole journey, one frame per step (later steps start with a sample letter)
  { name: 'journey-write', path: '/lab/journey' },
  { name: 'journey-fold', path: '/lab/journey?step=fold' },
  { name: 'journey-envelope-c5', path: '/lab/journey?step=envelope&fold=half' },
  // the flap shut, the wax poured: the die tray under the envelope, the swallow picked
  { name: 'journey-envelope-dies', path: '/lab/journey?step=envelope&fold=half&t=0.65&die=swallow' },
  { name: 'journey-post-c6', path: '/lab/journey?step=post&fold=quarter' },
  { name: 'journey-receive-c5', path: '/lab/journey?step=receive&fold=half' },
  ...[0, 0.25, 0.5, 0.75, 1].map((t) => ({ name: `fold-${t}`, path: `/lab/fold?seed=1407&t=${t}` })),
  // half fold (top half down) · quarter fold (then the right half over the left; 0.5 = the half fold)
  ...[0.3, 0.6, 1].map((t) => ({ name: `foldhalf-${t}`, path: `/lab/fold?seed=1407&fold=half&t=${t}` })),
  ...[0.65, 0.8, 1].map((t) => ({ name: `foldquarter-${t}`, path: `/lab/fold?seed=1407&fold=quarter&t=${t}` })),
  // a stack of three sheets folded together: the last sheet's back outside, the others as edges
  ...[0.5, 1].map((t) => ({ name: `foldmulti-${t}`, path: `/lab/fold?seed=1407&paper=grid&sheets=3&t=${t}` })),
  { name: 'foldmulti-half-1', path: '/lab/fold?seed=1407&paper=grid&sheets=3&fold=half&t=1' },
  // the envelope bulging with the sheet count (cotton, in three): letter in · sealed, for 2 and 4 sheets
  ...[0.3, 0.86].map((t) => ({ name: `envmulti-${t}`, path: `/lab/envelope?seed=1407&sheets=4&t=${t}` })),
  { name: 'envbulge-2', path: '/lab/envelope?seed=1407&sheets=2&t=1' },
  { name: 'envbulge-4', path: '/lab/envelope?seed=1407&sheets=4&t=1' },
  { name: 'postbulge-4', path: '/lab/post?seed=1407&sheets=4&t=0' },
  { name: 'postbulge-c6-2', path: '/lab/post?seed=1407&fold=quarter&sheets=2&t=0.15' },
  // insert 0–.3 · close .3–.5 · pour .5–.7 · press .7–1
  ...[0.15, 0.3, 0.4, 0.6, 0.7, 0.8, 0.86, 1].map((t) => ({ name: `envelope-${t}`, path: `/lab/envelope?seed=1407&t=${t}` })),
  // free placement: wax off the tip on the left V edge, a lily die turned and pressed beside it ·
  // a die hanging off the puddle (cut-off imprint) · pressed late (shallow) · the die tray
  { name: 'envelope-offtip-0.86', path: '/lab/envelope?seed=1407&t=0.86&sx=0.3&sy=0.32&kx=0.31&ky=0.33&rot=0.4&die=lily' },
  { name: 'envelope-overhang-1', path: '/lab/envelope?seed=1407&t=1&sx=0.5&sy=0.526&kx=0.585&ky=0.526&die=moon' },
  { name: 'envelope-late-1', path: '/lab/envelope?seed=1407&t=1&depth=0.4&die=cornflower' },
  { name: 'envelope-wax-0.65', path: '/lab/envelope?seed=1407&t=0.65&die=swallow' },
  // orient 0–.15 · insert .15–.85 (seal snag ~.45) · drop .85–1
  ...[0, 0.08, 0.15, 0.3, 0.5, 0.7, 0.86, 1].map((t) => ({ name: `post-${t}`, path: `/lab/post?seed=1407&t=${t}` })),
  ...[0, 0.15, 0.5, 1].map((t) => ({ name: `post-fr-${t}`, path: `/lab/post?seed=1407&country=fr&t=${t}` })),
  // the off-tip seal catches the lip somewhere else (RU: short edge first, FR: long edge first)
  { name: 'post-offtip-0.5', path: '/lab/post?seed=1407&t=0.5&sx=0.3&sy=0.32&kx=0.31&ky=0.33&rot=0.4&die=lily' },
  { name: 'post-fr-offtip-0.5', path: '/lab/post?seed=1407&country=fr&t=0.5&sx=0.3&sy=0.32&kx=0.31&ky=0.33&rot=0.4&die=lily' },
  // envelopes sized for the fold: C5 (half fold) turns to the RU slot like a DL; C6 (in four) goes in long edge first
  ...[0, 0.15, 0.5].map((t) => ({ name: `postc5-${t}`, path: `/lab/post?seed=1407&fold=half&t=${t}` })),
  ...[0, 0.15, 0.5].map((t) => ({ name: `postc6-${t}`, path: `/lab/post?seed=1407&fold=quarter&t=${t}` })),
  ...[0, 0.18, 0.25, 0.6, 0.72].map((t) => ({ name: `mbc5-${t}`, path: `/lab/mailbox?seed=1407&fold=half&waiting=2&t=${t}` })),
  ...[0.18, 0.25, 0.6, 0.72].map((t) => ({ name: `mbc6-${t}`, path: `/lab/mailbox?seed=1407&fold=quarter&waiting=2&t=${t}` })),
  // door 0–.1 · take .1–.25 · flip .25–.32 · slit .32–.5 · pull .5–.7 · unfold .7–1
  ...[0, 0.05, 0.1, 0.18, 0.25, 0.29, 0.41, 0.5, 0.6, 0.7, 0.85, 1].map((t) => ({ name: `mailbox-${t}`, path: `/lab/mailbox?seed=1407&t=${t}` })),
  // opened by breaking the seal: strain · just snapped (crumbs) · crumbs landing · flap half open · open · pulling
  ...[0.345, 0.365, 0.38, 0.42, 0.5, 0.6].map((t) => ({ name: `seal-${t}`, path: `/lab/mailbox?seed=1407&open=seal&t=${t}` })),
  // a seal on the left V edge breaks along that edge only · on the body or deep on the flap it
  // holds nothing (decoration): the knife opens it and the seal stays whole
  ...[0.365, 0.42].map((t) => ({ name: `seal-left-${t}`, path: `/lab/mailbox?seed=1407&open=seal&hold=left&t=${t}` })),
  { name: 'seal-body-0.41', path: '/lab/mailbox?seed=1407&open=seal&hold=body&t=0.41' },
  { name: 'seal-flaponly-0.41', path: '/lab/mailbox?seed=1407&open=seal&hold=flap&t=0.41' },
  // reading a letter of three sheets: front · turning over · its back · sliding off to sheet 2 · sheet 3 · its back
  ...[0, 0.35, 1, 1.3, 3, 4].map((turn) => ({ name: `read-${turn}`, path: `/lab/mailbox?seed=1407&sheets=3&t=1.01&turn=${turn}` })),
  // taken high and pulled up-left: the turn leans; a read sheet pushed up-left slides off that way
  ...[0.3, 0.7, 1.3].map((turn) => ({ name: `read-tilt-${turn}`, path: `/lab/mailbox?seed=1407&sheets=3&t=1.01&turn=${turn}&tilt=-0.4` })),
  { name: 'read-fr-quarter', path: '/lab/mailbox?seed=1407&country=fr&sheets=2&fold=quarter&t=1.01&turn=1' },
  { name: 'mbmulti-0.6', path: '/lab/mailbox?seed=1407&sheets=3&t=0.6' },
  // a four-sheet letter in her hands: address side · seal side (bulging) · the bulge gone once it is out
  ...[0.25, 0.32, 0.7].map((t) => ({ name: `mbbulge-${t}`, path: `/lab/mailbox?seed=1407&sheets=4&t=${t}` })),
  { name: 'journey-receive-2sheets', path: '/lab/journey?step=receive&sheets=2' },
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
  { name: 'flex-left-0.42', path: '/lab/mailbox?seed=1407&open=seal&wax=flexible&hold=left&t=0.42' },
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
