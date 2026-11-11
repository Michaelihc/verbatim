// Browser regression checks. Install Playwright and Chromium first, then run:
// node tools/test-lap-reload.mjs [path/to/playwright/index.mjs]
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, extname } from 'node:path';

const { chromium } = await import(process.argv[2] ? pathToFileURL(resolve(process.argv[2])).href : 'playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    const file = resolve(root, `.${path === '/' ? '/index.html' : path}`);
    const types = { '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.html': 'text/html' };
    res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const route = '/#/play?pack=9702-definitions&unit=quantum-physics&mode=train';
  const checkpoint = () => page.evaluate(() => JSON.parse(sessionStorage.getItem('verbatim:play-session:v1')));
  const totals = () => page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('verbatim:v1'));
    return { xp: s.xp, items: s.totals.items, laps: s.totals.laps, history: s.history.length };
  });
  const ready = () => page.waitForSelector('.card-term');
  const reload = async () => { await page.reload(); await page.waitForSelector('.card'); };
  const complete = async () => {
    const text = await page.locator('#answer .ch').allTextContents();
    await page.locator('.type-input').fill(text.join(''));
    await page.waitForSelector('.result');
  };
  const next = async () => { await page.locator('#next').click(); };
  await page.goto(origin);
  await page.waitForSelector('.hero');
  await page.evaluate(async () => {
    const { state, save } = await import('/js/store.js');
    Object.assign(state.settings, { autoAdvance: false, sound: false, warmup: false, drills: false });
    save();
  });
  await page.goto(origin + route);
  await ready();
  await complete(); await next();
  await complete();
  const saved = await checkpoint();
  const before = await totals();
  await reload(); // A completed result advances once, even before pressing Next.
  await ready();
  assert.equal((await checkpoint()).pos, 2);
  assert.deepEqual(await totals(), before);
  assert.equal(await page.locator('.lap-count').textContent(), `2/${saved.order.length}`);
  assert.equal(await page.locator('.lap-dots .r-perfect').count(), 2);

  const term = await page.locator('.card-term').textContent();
  await page.locator('.type-input').fill('unfinished');
  await reload(); await ready();
  assert.equal(await page.locator('.card-term').textContent(), term);
  assert.equal(await page.locator('.type-input').inputValue(), '');
  assert.deepEqual((await checkpoint()).order, saved.order);
  assert.deepEqual(await totals(), before);

  while ((await checkpoint()).pos < saved.order.length - 1) { await complete(); await next(); }
  await complete();
  const lastTotals = await totals();
  await reload(); // Last completed card becomes the lap summary.
  await page.waitForSelector('.lap-card');
  assert.equal((await totals()).laps, lastTotals.laps + 1);
  const lapTotals = await totals();
  await reload();
  await page.waitForSelector('.lap-card');
  assert.deepEqual(await totals(), lapTotals);
  await page.locator('#again').click(); await ready();
  await complete(); await next();
  const lap2 = await checkpoint();
  assert.equal(lap2.lap, 2);
  await reload(); await ready();
  assert.deepEqual(await checkpoint(), lap2);

  // Leaving is still an explicit end to the session; another chapter starts fresh.
  await page.locator('[aria-label="Leave"]').click();
  await page.waitForSelector('.hero');
  await page.goto(origin + route); await ready();
  assert.equal((await checkpoint()).pos, 0);
  assert.equal((await checkpoint()).lap, 1);
  await complete(); await next();
  await page.goto(origin + route.replace('quantum-physics', 'waves')); await ready();
  assert.equal((await checkpoint()).pos, 0);

  // Random order and an explicit starting answer survive reload too.
  await page.goto(origin + route.replace('quantum-physics', '*')); await ready();
  await complete(); await next();
  const random = await checkpoint();
  await reload(); await ready();
  assert.deepEqual(await checkpoint(), random);
  const chosenId = saved.order.at(-1).split('/')[1];
  await page.goto(origin + route + `&item=${chosenId}`); await ready();
  const chosen = await checkpoint();
  assert.equal(chosen.order[0], saved.order.at(-1));
  await complete(); await next();
  await reload(); await ready();
  assert.deepEqual((await checkpoint()).order, chosen.order);
  assert.equal((await checkpoint()).pos, 1);

  // A stale checkpoint after a content update cannot resume against changed answers.
  await page.evaluate(() => {
    const key = 'verbatim:play-session:v1';
    const s = JSON.parse(sessionStorage.getItem(key));
    s.content = 'outdated';
    sessionStorage.setItem(key, JSON.stringify(s));
  });
  await reload(); await ready();
  assert.equal((await checkpoint()).pos, 0);
  const otherTab = await context.newPage();
  await otherTab.goto(origin + route); await otherTab.waitForSelector('.card-term');
  assert.equal(await otherTab.evaluate(() => JSON.parse(sessionStorage.getItem('verbatim:play-session:v1')).pos), 0);
  await otherTab.close();
  assert.deepEqual(errors, []);
  console.log('Lap reload checks passed: partial card, results, summary, next lap, exit, scope, random order and chosen start.');
} finally {
  await browser.close();
  await new Promise(r => server.close(r));
}
