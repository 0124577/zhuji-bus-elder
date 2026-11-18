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
await sleep(1400);
await page.evaluate(() => ZJ.setTab('go'));
await sleep(500);

/* 1. 我的位置 */
await page.evaluate(() => document.querySelector('[data-act="pick-my"]').click());
await sleep(900);
const nearState = await page.evaluate(() => ({
  items: document.querySelectorAll('.near-item').length,
  lab: (document.querySelector('.near-grp .lab') || { innerText: '' }).innerText,
  from: document.getElementById('fromName').textContent
}));
console.log('pick-my:', JSON.stringify(nearState));
await page.screenshot({ path: 'C:/work/bus/_tmp/go-myloc.png' });
if (nearState.items) {
  await page.evaluate(() => document.querySelector('.near-item').click());
  await sleep(700);
  console.log('after pick near:', await page.evaluate(() => document.getElementById('fromName').textContent));
}

/* 2. 历史点击重查 */
await page.evaluate(() => document.querySelector('[data-act="pick-to"]').click());
await sleep(350);
await page.type('#pkQ', '草塔停车场');
await sleep(450);
await page.evaluate(() => document.querySelector('#pkList .pick-stop').click());
await sleep(1600);
const h1 = await page.evaluate(() => document.querySelectorAll('.hist-row').length);
await page.evaluate(() => ZJ.setTab('home'));
await sleep(400);
await page.evaluate(() => ZJ.setTab('go'));
await sleep(600);
await page.evaluate(() => document.querySelector('[data-act="pick-to"]').click());
await sleep(350);
await page.type('#pkQ', '客运中心');
await sleep(450);
await page.evaluate(() => document.querySelector('#pkList .pick-stop').click());
await sleep(1600);
const h2 = await page.evaluate(() => [...document.querySelectorAll('.hist-row')].map((r) => r.innerText.replace(/\s+/g, ' ')));
await page.evaluate(() => document.querySelectorAll('.hist-row')[1].click());
await sleep(1500);
const afterHist = await page.evaluate(() => ({
  from: document.getElementById('fromName').textContent,
  to: document.getElementById('toName').textContent,
  cards: document.querySelectorAll('.res-card').length,
  histTop: (document.querySelector('.hist-row') || { innerText: '' }).innerText.replace(/\s+/g, ' ')
}));
console.log('hist before:', h1, '\nhist rows:', JSON.stringify(h2, null, 1), '\nafter click 2nd:', JSON.stringify(afterHist));

/* 3. 历史删除与空态 */
await page.evaluate(() => document.querySelectorAll('[data-act="hist-del"]')[0].click());
await sleep(400);
console.log('after del:', await page.evaluate(() => document.querySelectorAll('.hist-row').length));
await page.evaluate(() => document.querySelector('[data-act="clear-hist"]').click());
await sleep(400);
console.log('after clear:', await page.evaluate(() => ({
  rows: document.querySelectorAll('.hist-row').length,
  empty: (document.querySelector('#histList').innerText || '').replace(/\s+/g, ' ').slice(0, 40)
})));

/* 4. 定位被拒时「我的位置」 */
await page.evaluate(() => {
  navigator.geolocation.getCurrentPosition = (ok, fail) => fail && fail({ code: 1, message: 'User denied Geolocation' });
  ZJ.Geo.state = 'fail';
  ZJ.Geo.lat = 0; ZJ.Geo.lng = 0;
  document.querySelector('[data-act="pick-my"]').click();
});
await sleep(900);
console.log('geo denied:', await page.evaluate(() => ({
  items: document.querySelectorAll('.near-item').length,
  empty: (document.querySelector('#pkList') ? document.querySelector('#pkList').innerText : '').replace(/\s+/g, ' ').slice(0, 60)
})));
await page.screenshot({ path: 'C:/work/bus/_tmp/go-geodeny.png' });

console.log('errors:', errs.join(' | ') || '(none)');
await b.close();
