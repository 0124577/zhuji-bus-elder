import puppeteer from 'puppeteer-core';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://127.0.0.1:8899/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--lang=zh-CN'] });
const ctx = b.defaultBrowserContext();
await ctx.overridePermissions('http://127.0.0.1:8899', ['geolocation']);
const page = await b.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.setGeolocation({ latitude: 29.7136, longitude: 120.2362 });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));

const dump = async (tag) => {
  const s = await page.evaluate(() => ({
    from: (document.getElementById('fromName') || {}).textContent,
    to: (document.getElementById('toName') || {}).textContent,
    resTxt: (document.getElementById('planResult').innerText || '').replace(/\s+/g, ' ').slice(0, 150),
    cards: document.querySelectorAll('.res-card').length,
    errCards: document.querySelectorAll('.res-live.err').length,
    banner: document.querySelectorAll('#page-go .degrade-banner').length,
    hist: document.querySelectorAll('.hist-row').length,
    state: (() => { const g = ZJ.Go.state(); return { plans: g.plans.length, loading: g.loading, tip: g.tip }; })()
  }));
  console.log('\n### ' + tag + '\n' + JSON.stringify(s, null, 1));
  return s;
};

await page.goto(BASE, { waitUntil: 'networkidle2' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle2' });
await sleep(1200);
await page.evaluate(() => ZJ.setTab('go'));
await sleep(500);
await dump('S1 空态');
await page.screenshot({ path: 'C:/work/bus/_tmp/go-s1-empty.png' });

const pickOne = async (act, name) => {
  await page.evaluate((a) => document.querySelector('[data-act="' + a + '"]').click(), act);
  await sleep(380);
  await page.type('#pkQ', name);
  await sleep(480);
  await page.evaluate(() => document.querySelector('#pkList .pick-stop').click());
  await sleep(1200);
};

await pickOne('pick-from', '火车站');
await dump('S2 只选起点');
await pickOne('pick-to', '草塔停车场');
await dump('S3 结果');
await page.screenshot({ path: 'C:/work/bus/_tmp/go-s3-result.png' });

/* 选与起点相同的终点 */
await page.evaluate(() => document.querySelector('[data-act="pick-to"]').click());
await sleep(380);
await page.type('#pkQ', '火车站');
await sleep(480);
await page.evaluate(() => document.querySelector('#pkList .pick-stop').click());
await sleep(800);
const same = await dump('S4 终点选成与起点相同');
await page.screenshot({ path: 'C:/work/bus/_tmp/go-s4-same.png' });

/* 交换起终点 */
await page.evaluate(() => document.querySelector('[data-act="swap-stops"]').click());
await sleep(1500);
await dump('S5 交换后');

/* 实时接口全挂 */
await page.evaluate(() => {
  window.__vehOrig = ZJ.Api.vehicles;
  ZJ.Api.vehicles = async () => { throw new Error('网络异常，请检查网络'); };
  document.querySelector('[data-act="plan"]').click();
});
await sleep(1800);
await dump('S6 实时接口失效');
await page.screenshot({ path: 'C:/work/bus/_tmp/go-s6-degraded.png' });

/* 点重试 + 恢复接口 */
await page.evaluate(() => { ZJ.Api.vehicles = window.__vehOrig; ZJ.Api.resetHealth(); });
await sleep(200);
await page.evaluate(() => { const b = document.querySelector('[data-act="go-refresh"]'); if (b) b.click(); });
await sleep(1800);
await dump('S7 重试后');
await page.screenshot({ path: 'C:/work/bus/_tmp/go-s7-retry.png' });

/* 清空历史 */
await page.evaluate(() => document.querySelector('[data-act="clear-hist"]').click());
await sleep(500);
await dump('S8 清空历史');

console.log('\n### console errors\n' + (errs.join('\n') || '(none)'));
await b.close();
