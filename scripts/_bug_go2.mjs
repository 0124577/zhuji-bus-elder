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
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));

await page.goto(BASE, { waitUntil: 'networkidle2' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle2' });
await sleep(1200);

/* 有车场景：把实时车辆 mock 成距上车站 3 站 */
await page.evaluate(() => {
  ZJ.Api.vehicles = async (dirId) => {
    const d = ZJ.Data.dirs.get(dirId) || { stops: [] };
    return { busAverageSpeed: 240, list: [{ vehicleOrder: 6, distance: 420, isArriveStation: 0, plateNumber: '浙D08578D' }], static: false };
  };
  ZJ.setTab('go');
  ZJ.Go.setEnds('火车站', '草塔停车场');
  document.querySelector('[data-act="plan"]').click();
});
await sleep(1800);
await page.screenshot({ path: 'C:/work/bus/_tmp/go-live.png' });
const liveTxt = await page.evaluate(() => [...document.querySelectorAll('.res-live')].map((e) => e.innerText.replace(/\s+/g, ' ')));
console.log('live rows:', JSON.stringify(liveTxt, null, 1));

/* 320 宽溢出检查 */
await page.setViewport({ width: 320, height: 720, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await sleep(600);
const ov320 = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
console.log('320px overflow:', JSON.stringify(ov320));
await page.screenshot({ path: 'C:/work/bus/_tmp/go-320.png' });
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await sleep(400);

/* 换乘方案列表 */
await page.evaluate(async () => {
  const st = ZJ.Data.stations.filter((s) => s.entries.length <= 2);
  let pair = null;
  for (let i = 0; i < st.length && !pair; i++) {
    for (let j = 0; j < st.length; j++) {
      if (i === j) continue;
      const a = st[i], c = st[j];
      const direct = a.entries.some((x) => c.entries.some((y) => x.dir === y.dir && y.order > x.order));
      if (!direct) { pair = [a.name, c.name]; break; }
    }
  }
  ZJ.Go.setEnds(pair[0], pair[1]);
  document.querySelector('[data-act="plan"]').click();
  window.__pair = pair;
});
await sleep(2000);
await page.screenshot({ path: 'C:/work/bus/_tmp/go-transfer.png' });
const tf = await page.evaluate(() => ({
  pair: window.__pair,
  cards: [...document.querySelectorAll('.res-card')].map((c) => c.innerText.replace(/\s+/g, ' ').slice(0, 90))
}));
console.log('transfer:', JSON.stringify(tf, null, 1));

/* 进入详情 -> 返回 -> 再进入 */
await page.evaluate(() => document.querySelector('.res-card').click());
await sleep(1800);
await page.screenshot({ path: 'C:/work/bus/_tmp/go-detail.png' });
const det = await page.evaluate(() => ({
  hero: (document.querySelector('.pl-hero') || { innerText: '' }).innerText.replace(/\s+/g, ' '),
  chips: [...document.querySelectorAll('.pl-chips .chip')].map((c) => c.textContent),
  overflow: { sw: document.querySelector('#page-plan').scrollWidth, cw: document.querySelector('#page-plan').clientWidth },
  segs: document.querySelectorAll('.fl-seg').length,
  bells: document.querySelectorAll('.fl-bell').length
}));
console.log('detail:', JSON.stringify(det, null, 1));
await page.evaluate(() => document.querySelector('[data-act="plan-back"]').click());
await sleep(700);
const back = await page.evaluate(() => ({
  goOn: document.getElementById('page-go').classList.contains('on'),
  planOn: document.getElementById('page-plan').classList.contains('on'),
  cards: document.querySelectorAll('.res-card').length
}));
console.log('back:', JSON.stringify(back));
await page.evaluate(() => document.querySelector('.res-card').click());
await sleep(1500);
console.log('reopen detail:', JSON.stringify(await page.evaluate(() => ({ segs: document.querySelectorAll('.fl-seg').length, hero: (document.querySelector('.pl-hero') || { innerText: '' }).innerText.replace(/\s+/g, ' ') }))));

console.log('errors:', errs.join(' | ') || '(none)');
await b.close();
