import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8899/index.html';
const OUT = process.env.SHOT_DIR || 'assets/screenshots';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--lang=zh-CN'] });
const ctx = browser.defaultBrowserContext();
await ctx.overridePermissions('http://127.0.0.1:8899', ['geolocation']);
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.setGeolocation({ latitude: 29.7136, longitude: 120.2362 });
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

async function pick(act, kw) {
  await page.evaluate((a) => document.querySelector('[data-act="' + a + '"]').click(), act);
  await sleep(380);
  await page.type('#pkQ', kw);
  await sleep(500);
  await page.evaluate(() => document.querySelector('#pkList .pick-stop').click());
  await sleep(520);
}

await page.goto(BASE, { waitUntil: 'networkidle2' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle2' });
await sleep(2200);
await page.screenshot({ path: `${OUT}/01-home.png` });

/* 线路实时：等车站第 11 站，最近车辆第 12 站，剩 1 站 */
await page.evaluate(() => {
  const dir = ZJ.Data.lineOf('23路').dirs[0];
  const st = dir.stops[10];
  window.__st = st.name;
  const v = (order, distance, arrived, plate) => ({ vehicleOrder: order, distance, isArriveStation: arrived ? 1 : 0, plateNumber: plate, gpsTime: '2026-11-18 20:20:00' });
  ZJ.Api.vehicles = async () => ({ busAverageSpeed: 240, list: [v(12, 380, 0, '浙D08578D'), v(26, 60, 1, '浙D06666D')], startTime: '', static: false });
  ZJ.Api.lineDetail = async () => ({ lineName: '23路', up: { totalPrice: 1.0 } });
  ZJ.Api.plan = async () => ['06:20', '06:37', '07:00', '07:25', '08:05', '17:30', '18:00'];
  window.__vibrate = [];
  navigator.vibrate = (p) => { window.__vibrate.push(p); return true; };
  ZJ.Notify.status = async () => 'granted';
  ZJ.Notify.fire = async () => true;
  ZJ.Line.open('23路', 'up', st.name);
});
await sleep(1500);
await page.screenshot({ path: `${OUT}/02-line-live.png` });

await page.evaluate(() => { document.querySelector('#page-line').scrollTop = 700; });
await sleep(600);
await page.screenshot({ path: `${OUT}/03-line-vertical.png` });

/* 提醒弹层 + 触发弹窗 */
await page.evaluate(() => { document.querySelector('#page-line').scrollTop = 0; });
await sleep(300);
await page.evaluate(() => document.querySelector('[data-act="line-remind"]').click());
await sleep(800);
await page.screenshot({ path: `${OUT}/04-alert-sheet.png` });
await page.evaluate(() => document.querySelector('.rm-mode[data-mode="one"]').click());
await sleep(200);
await page.evaluate(() => document.querySelector('[data-act="rm-save"]').click());
await sleep(1500);
await page.screenshot({ path: `${OUT}/05-alert.png` });
await page.evaluate(() => { const b = document.getElementById('rmGo'); if (b) b.click(); });

/* 站点页 */
await page.evaluate(() => { ZJ.Line.close(); });
await page.waitForFunction(() => !document.querySelector('.fullpage.on'));
await sleep(400);
await page.evaluate(() => ZJ.Station.open('火车站'));
await sleep(3200);
await page.screenshot({ path: `${OUT}/06-station.png` });

/* 出行：站名搜索弹层 */
await page.evaluate(() => { ZJ.Station.close(); ZJ.setTab('go'); });
await page.waitForFunction(() => !document.querySelector('.fullpage.on'));
await sleep(600);
await page.evaluate(() => document.querySelector('[data-act="pick-from"]').click());
await sleep(400);
await page.type('#pkQ', '火车站');
await sleep(520);
await page.screenshot({ path: `${OUT}/07-picker.png` });
await page.evaluate(() => document.querySelector('#pkList .pick-stop').click());
await sleep(600);
await pick('pick-to', '草塔停车场');
await sleep(1600);
await page.screenshot({ path: `${OUT}/08-go-result.png` });

/* 方案详情：定向 mock 出真实“还有 N 站” */
await page.evaluate(() => {
  ZJ.Api.vehicles = async (dirId) => {
    const legs = (ZJ.Plan.state().plan || {}).legs || [];
    const leg = legs.find((l) => l.dir.id === dirId);
    const order = leg ? Math.max(1, leg.fromOrder - 4) : 1;
    return { busAverageSpeed: 240, list: [{ vehicleOrder: order, distance: 380, isArriveStation: 0, plateNumber: '浙D08578D' }], static: false };
  };
  document.querySelector('.res-card').click();
});
await sleep(1800);
await page.screenshot({ path: `${OUT}/09-plan-live.png` });
await page.evaluate(() => { document.querySelector('#page-plan').scrollTop = 560; });
await sleep(600);
await page.screenshot({ path: `${OUT}/10-plan-flow.png` });

/* 换乘方案的流程图（两段 + 换乘站） */
const hasTransfer = await page.evaluate(async () => {
  const st = ZJ.Data.stations.filter((s) => s.entries.length <= 2);
  let pair = null;
  for (let i = 0; i < st.length && !pair; i++) {
    for (let j = 0; j < st.length; j++) {
      if (i === j) continue;
      const a = st[i], b = st[j];
      const direct = a.entries.some((x) => b.entries.some((y) => x.dir === y.dir && y.order > x.order));
      if (!direct) { pair = [a.name, b.name]; break; }
    }
  }
  if (!pair) return false;
  ZJ.Plan.close();
  await new Promise((r) => setTimeout(r, 300));
  ZJ.Go.setEnds(pair[0], pair[1]);
  document.querySelector('[data-act="plan"]').click();
  await new Promise((r) => setTimeout(r, 1600));
  const card = document.querySelector('.res-card');
  if (!card) return false;
  card.click();
  return true;
});
await sleep(1900);
if (hasTransfer) await page.screenshot({ path: `${OUT}/15-plan-transfer.png` });

/* 设置页 */
await page.evaluate(() => { ZJ.Plan.close(); ZJ.setTab('settings'); });
await page.waitForFunction(() => !document.querySelector('.fullpage.on'));
await sleep(800);
await page.screenshot({ path: `${OUT}/11-settings.png` });

/* 主题切换（天空蓝） */
await page.evaluate(() => document.querySelectorAll('.theme-dot')[1].click());
await sleep(2300);
await page.evaluate(() => { document.querySelector('#page-settings').scrollTop = 0; });
await page.screenshot({ path: `${OUT}/12-settings-theme.png` });
await page.evaluate(() => document.querySelectorAll('.theme-dot')[0].click());
await sleep(300);

/* 通知权限提示 */
await page.evaluate(() => { ZJ.Notify.status = async () => 'prompt'; ZJ.Settings.render(); });
await sleep(2200);
await page.evaluate(() => document.getElementById('btnReqNotify').click());
await sleep(600);
await page.screenshot({ path: `${OUT}/13-perm-alert.png` });
await page.evaluate(() => document.querySelector('[data-act="permalert-close"]').click());
await sleep(400);

/* 首页提醒卡片 */
await page.evaluate(() => { ZJ.setTab('home'); });
await sleep(700);
await page.screenshot({ path: `${OUT}/14-home-remind.png` });

console.log('shots done →', OUT);
await browser.close();
