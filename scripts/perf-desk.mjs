#!/usr/bin/env node
/**
 * Performance of the writing desk (/write), on a phone and a laptop viewport.
 * Serves a web export (default `dist/`) or measures a URL, and drives the same steps
 * every time: load, idle, typing 25 characters, blur, a drawer out and in, a page turn
 * there and back, and (laptop) a loose sheet moved with Space + drag.
 *
 *   node scripts/perf-desk.mjs --label after [--dist dist | --url https://…] [--runs 3] [--vp phone|laptop] [--warm]
 *   node scripts/perf-desk.mjs --compare perf/desk-baseline.json perf/desk-after.json
 *
 * Writes perf/desk-<label>.json and prints a markdown table of the medians. Times come from
 * whatever GPU the browser has (headless Chromium in a container: software WebGL, so slow
 * in absolute terms); the counters (?perf=1, src/lib/perfCounters.ts) and the WebGL context
 * count don't depend on it. --warm loads the page once first, so caches (HTTP, IndexedDB) are
 * warm: a second visit.
 */
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { extname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');

const arg = (name, fallback) => (process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : fallback);
const flag = (name) => process.argv.includes(`--${name}`);

const VIEWPORTS = {
  laptop: { viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.wasm': 'application/wasm', '.ttf': 'font/ttf', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const TEXT = ' Ещё одна строчка письма.';

// ─── what each row of the table shows: [label, path in a run, unit] ───
const ROWS = [
  ['Text field ready', 'load.ready', 'ms'],
  ['Load settled (no long task for 3 s)', 'load.settled', 'ms'],
  ['Main thread blocked during load', 'load.blocked', 'ms'],
  ['WebGL contexts created during load', 'load.gl', ''],
  ['Live canvases', 'load.canvases', ''],
  ['JS / wasm / fonts (gzip)', 'load.kb', 'KB'],
  ['Desk pictures recorded at load', 'load.counters.recordDesk', ''],
  ['Desk items recorded at load', 'load.counters.recordItem', ''],
  ['Images baked at load', 'load.counters.rasterBake', ''],
  ['Typing 25 chars: blocked', 'typing.blocked', 'ms'],
  ['Typing: frames painted in 4 s', 'typing.frames', ''],
  ['Typing: worst frame', 'typing.max', 'ms'],
  ['Typing: key event p50 / max', 'typing.keys', 'ms'],
  ['Typing: handwriting layouts per key', 'typing.perKey.layoutHandwriting', ''],
  ['Typing: letter pictures recorded per key', 'typing.perKey.recordLetter', ''],
  ['Typing: DeskStack renders per key', 'typing.perKey.renderDeskStack', ''],
  ['Typing: WritingDesk renders per key', 'typing.perKey.renderWritingDesk', ''],
  ['Typing: DeskScene renders per key', 'typing.perKey.renderDeskScene', ''],
  ['Blur: blocked', 'blur.blocked', 'ms'],
  ['Blur: p95 frame', 'blur.p95', 'ms'],
  ['Drawer out + in: p95 frame', 'drawer.p95', 'ms'],
  ['Drawer: blocked', 'drawer.blocked', 'ms'],
  ['Page turn there + back: p95 frame', 'turn.p95', 'ms'],
  ['Page turn: blocked', 'turn.blocked', 'ms'],
  ['Loose sheet drag (laptop): p95 frame', 'drag.p95', 'ms'],
  ['Loose sheet drag: blocked', 'drag.blocked', 'ms'],
];

// ─── in the page ───
function instrument() {
  window.__gl = 0;
  window.__lt = [];
  window.__ev = [];
  for (const C of [globalThis.HTMLCanvasElement, globalThis.OffscreenCanvas].filter(Boolean)) {
    const get = C.prototype.getContext;
    C.prototype.getContext = function (type, ...rest) {
      if (/webgl/.test(type)) window.__gl++;
      return get.call(this, type, ...rest);
    };
  }
  new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push([e.startTime, e.duration]))).observe({ type: 'longtask', buffered: true });
  new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__ev.push([e.name, e.startTime, e.duration]))).observe({ type: 'event', durationThreshold: 16, buffered: true });
}
const frames = (page, ms) =>
  page.evaluate(
    (ms) =>
      new Promise((done) => {
        const f = [];
        let last = performance.now();
        const t0 = last;
        const step = (t) => {
          f.push(t - last);
          last = t;
          if (t - t0 < ms) requestAnimationFrame(step);
          else done(f);
        };
        requestAnimationFrame(step);
      }),
    ms,
  );
const stat = (f) => {
  const s = [...f].sort((a, b) => a - b);
  const q = (x) => Math.round(s[Math.min(s.length - 1, Math.floor(s.length * x))] ?? 0);
  return { frames: f.length, p50: q(0.5), p95: q(0.95), max: q(1), over50: f.filter((x) => x > 50).length };
};
const now = (page) => page.evaluate(() => performance.now());
const blockedSince = (page, t) => page.evaluate((t) => Math.round(window.__lt.filter(([s]) => s >= t).reduce((a, [, d]) => a + d, 0)), t);
const counters = (page) => page.evaluate(() => ({ ...(window.__perfCounters ?? {}) }));
const diff = (a, b) => Object.fromEntries(Object.keys(b).map((k) => [k, (b[k] ?? 0) - (a[k] ?? 0)]));

async function run(base, vpName, warm) {
  const browser = await chromium.launch();
  const context = await browser.newContext(VIEWPORTS[vpName]);
  const vp = VIEWPORTS[vpName];
  const url = `${base}/write?perf=1&seed=7`;
  if (warm) {
    const p = await context.newPage();
    await p.goto(url, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('textarea', { timeout: 180000 });
    await p.waitForTimeout(8000);
    await p.close();
  }
  const page = await context.newPage();
  await page.addInitScript(instrument);
  const bytes = { js: 0, wasm: 0, ttf: 0 };
  page.on('response', async (r) => {
    try {
      const k = { '.js': 'js', '.wasm': 'wasm', '.ttf': 'ttf' }[extname(new URL(r.url()).pathname)];
      if (k && r.status() === 200) bytes[k] += gzipSync(await r.body()).length;
    } catch {}
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const tap = async (box) => {
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    if (vp.hasTouch) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
  };

  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('textarea', { timeout: 180000 });
  const ready = Date.now() - t0;
  let seen = -1;
  while (Date.now() - t0 < 180000) {
    const n = await page.evaluate(() => window.__lt.length);
    if (n === seen) break;
    seen = n;
    await page.waitForTimeout(3000);
  }
  // Long-task times are from the navigation's start, like `ready`.
  const lastTask = await page.evaluate(() => window.__lt.reduce((m, [s, d]) => Math.max(m, s + d), 0));
  const load = {
    ready,
    settled: Math.round(Math.max(ready, lastTask)),
    blocked: await blockedSince(page, 0),
    gl: await page.evaluate(() => window.__gl),
    canvases: await page.evaluate(() => document.querySelectorAll('canvas').length),
    kb: { js: Math.round(bytes.js / 1024), wasm: Math.round(bytes.wasm / 1024), ttf: Math.round(bytes.ttf / 1024) },
    counters: await counters(page),
  };
  const idle = stat(await frames(page, 1500));

  // typing
  await page.locator('textarea').first().click();
  await page.waitForTimeout(1500);
  let t = await now(page);
  let c0 = await counters(page);
  await page.evaluate(() => (window.__ev = []));
  const typed = frames(page, 4000);
  for (const ch of TEXT) {
    await page.keyboard.type(ch);
    await page.waitForTimeout(80);
  }
  const tf = stat(await typed);
  await page.waitForTimeout(1500);
  const keyEvents = await page.evaluate(() => window.__ev.filter(([n]) => /key|input/.test(n)).map(([, , d]) => Math.round(d)).sort((a, b) => a - b));
  const perKeyRaw = diff(c0, await counters(page));
  const typing = {
    blocked: await blockedSince(page, t),
    frames: tf.frames,
    max: tf.max,
    keys: { p50: keyEvents[Math.floor(keyEvents.length / 2)] ?? 0, max: keyEvents.at(-1) ?? 0, slow: keyEvents.length },
    perKey: Object.fromEntries(Object.entries(perKeyRaw).map(([k, v]) => [k, Math.round((v / TEXT.length) * 100) / 100])),
  };

  // blur (the ink comes back, bakes after the pause)
  t = await now(page);
  await page.mouse.click(4, 4);
  const blurF = stat(await frames(page, 2500));
  const blur = { blocked: await blockedSince(page, t), p95: blurF.p95, max: blurF.max };
  await page.waitForTimeout(1500);

  // a drawer out and back in
  const front = await page.getByText(/^(Бумага|Papier)$/).first().boundingBox();
  t = await now(page);
  const df = frames(page, 4000);
  await tap(front);
  await page.waitForTimeout(1800);
  if (vp.hasTouch) await tap(front);
  else await page.keyboard.press('Escape');
  const drawerF = stat(await df);
  const drawer = { blocked: await blockedSince(page, t), p95: drawerF.p95, max: drawerF.max, over50: drawerF.over50 };
  await page.waitForTimeout(1500);

  // a page turn there and back (the sheet is two-sided by default)
  let turn = null;
  const over = page.getByRole('button', { name: 'Перевернуть' }).first();
  if (await over.count()) {
    t = await now(page);
    const tfr = frames(page, 4500);
    await tap(await over.boundingBox());
    await page.waitForTimeout(2000);
    const back = page.getByRole('button', { name: 'На лицевую' }).first();
    if (await back.count()) await tap(await back.boundingBox());
    const turnF = stat(await tfr);
    turn = { blocked: await blockedSince(page, t), p95: turnF.p95, max: turnF.max, over50: turnF.over50 };
    await page.waitForTimeout(1500);
  }

  // laptop: a loose sheet moved with Space + drag
  let drag = null;
  if (!vp.hasTouch) {
    const sheet = await page.locator('textarea').first().boundingBox();
    if (sheet) {
      const x = sheet.x + sheet.width / 2;
      const y = sheet.y + sheet.height * 0.6;
      t = await now(page);
      const fr = frames(page, 2500);
      await page.keyboard.down('Space');
      await page.mouse.move(x, y);
      await page.mouse.down();
      for (let i = 1; i <= 40; i++) await page.mouse.move(x - i * 3, y - i * 1.5);
      await page.mouse.up();
      await page.keyboard.up('Space');
      const dragF = stat(await fr);
      drag = { blocked: await blockedSince(page, t), p95: dragF.p95, max: dragF.max, over50: dragF.over50 };
    }
  }

  await browser.close();
  return { load, idle, typing, blur, drawer, turn, drag, errors };
}

// ─── table ───
const get = (o, path) => path.split('.').reduce((v, k) => (v == null ? v : v[k]), o);
const median = (xs) => {
  const s = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
};
/** The median of every number in a set of runs, keeping the shape of a run. */
function medianRun(runs) {
  const walk = (path) => {
    const v = get(runs[0], path);
    if (v && typeof v === 'object' && !Array.isArray(v)) return Object.fromEntries(Object.keys(v).map((k) => [k, walk(path ? `${path}.${k}` : k)]));
    return typeof v === 'number' ? median(runs.map((r) => get(r, path))) : v;
  };
  return Object.fromEntries(Object.keys(runs[0]).map((k) => [k, walk(k)]));
}
const show = (v, unit) => {
  if (v == null) return '—';
  if (typeof v === 'object') {
    if ('js' in v) return `${v.js} / ${v.wasm} / ${v.ttf} KB`;
    if ('p50' in v) return `${v.p50} / ${v.max} ms`;
  }
  return unit === 'ms' && v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v}${unit && unit !== 'KB' ? ' ' + unit : ''}`;
};
function table(result) {
  const vps = Object.keys(result.median);
  const lines = [`| ${result.label} (${result.commit}) | ${vps.join(' | ')} |`, `|---|${vps.map(() => '---').join('|')}|`];
  for (const [label, path, unit] of ROWS) lines.push(`| ${label} | ${vps.map((vp) => show(get(result.median[vp], path), unit)).join(' | ')} |`);
  return lines.join('\n');
}
function compare(a, b) {
  const vps = Object.keys(b.median).filter((vp) => a.median[vp]);
  const head = vps.flatMap((vp) => [`${vp}: ${a.label}`, `${vp}: ${b.label}`]);
  const lines = [`| Metric | ${head.join(' | ')} |`, `|---|${head.map(() => '---').join('|')}|`];
  for (const [label, path, unit] of ROWS) {
    const cells = vps.flatMap((vp) => [show(get(a.median[vp], path), unit), show(get(b.median[vp], path), unit)]);
    if (cells.every((c) => c === '—')) continue;
    lines.push(`| ${label} | ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
}

// ─── main ───
if (flag('compare')) {
  const [fa, fb] = process.argv.slice(process.argv.indexOf('--compare') + 1);
  const a = JSON.parse(await readFile(fa, 'utf8'));
  const b = JSON.parse(await readFile(fb, 'utf8'));
  console.log(compare(a, b));
  process.exit(0);
}

const label = arg('label', 'run');
const runs = Number(arg('runs', 3));
const only = arg('vp');
const warm = flag('warm');
let base = arg('url');
let server = null;
if (!base) {
  const dist = resolve(arg('dist', 'dist'));
  server = createServer(async (req, res) => {
    let file = join(dist, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    try {
      const body = await readFile(file).catch(() => readFile((file = join(dist, 'index.html'))));
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  }).listen(0);
  base = `http://localhost:${server.address().port}`;
}
const result = { label, commit: execSync('git rev-parse --short HEAD').toString().trim(), date: new Date().toISOString(), target: arg('url') ?? arg('dist', 'dist'), warm, runs: {}, median: {} };
for (const vp of Object.keys(VIEWPORTS).filter((v) => !only || v === only)) {
  result.runs[vp] = [];
  for (let i = 0; i < runs; i++) {
    const r = await run(base, vp, warm);
    result.runs[vp].push(r);
    console.error(`${vp} run ${i + 1}/${runs}: ready ${r.load.ready} ms, typing blocked ${r.typing.blocked} ms${r.errors.length ? `, ${r.errors.length} page errors` : ''}`);
  }
  result.median[vp] = medianRun(result.runs[vp]);
}
server?.close();
await mkdir('perf', { recursive: true });
await writeFile(`perf/desk-${label}.json`, JSON.stringify(result, null, 1));
console.log(table(result));
