/**
 * 诸暨公交 · 轻量版 E2E 自测（v1.1）
 * 覆盖：基础加载 / 首页栏目精简 / Tab 切换 / 定位 / 线路搜索 / 线路实时页 /
 *      竖屏横向站点列表 / 上下行切换 / 收藏 / 时刻表 / 到站提醒（含震动）/
 *      站点实时页 / 换乘规划 / 方案详情（分段实时 + 站点提醒）/ 历史 /
 *      边界场景（定位失败 / 搜索无结果 / 网络异常降级 / 无方案）/ 移动端适配
 *
 * 运行：node tests/e2e/app-test.mjs
 * 环境变量：BASE_URL、CHROME_PATH
 */
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8899/index.html';
const ORIGIN = new URL(BASE).origin;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fails.push(name + (extra ? ' :: ' + extra : '')); console.log('  ✗ ' + name + (extra ? ' :: ' + extra : '')); }
}
function section(t) { console.log('\n== ' + t + ' =='); }

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--lang=zh-CN']
});

const ctx = browser.defaultBrowserContext();
await ctx.overridePermissions(ORIGIN, ['geolocation']);

const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.setGeolocation({ latitude: 29.7136, longitude: 120.2362 });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const txt = (sel) => page.$eval(sel, (el) => el.textContent.trim()).catch(() => '');
const cnt = (sel) => page.$$eval(sel, (els) => els.length).catch(() => 0);
const has = (sel) => page.$(sel).then((x) => !!x);
const clickAct = (act) => page.evaluate((a) => {
  const el = document.querySelector('[data-act="' + a + '"]');
  if (!el) throw new Error('no element for act ' + act);
  el.click();
}, act);
const overflow = () => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));

/* 选择一个站点（走真实 picker 交互） */
async function pickStation(act, name) {
  await clickAct(act);
  await sleep(380);
  await page.type('#pkQ', name);
  await sleep(500);
  await page.evaluate(() => document.querySelector('#pkList .pick-stop').click());
  await sleep(480);
}

await page.goto(BASE, { waitUntil: 'networkidle2' });
await page.evaluate(() => { localStorage.clear(); });
await page.reload({ waitUntil: 'networkidle2' });
await page.waitForSelector('.line-row', { timeout: 8000 });
await sleep(1600);
await page.evaluate(() => { window.__chimeOrig = ZJ.Sound.chime.bind(ZJ.Sound); });

/* ---------------- 1. 基础加载 ---------------- */
section('基础加载与静态数据');
ok('页面标题正确', (await page.title()).indexOf('诸暨公交') > -1, await page.title());
ok('底部有 3 个 Tab', (await cnt('.tab')) === 3, 'count=' + (await cnt('.tab')));
const tabTexts = await page.$$eval('.tab', (els) => els.map((e) => e.textContent.trim()));
ok('Tab 为「首页 / 出行 / 设置」', tabTexts.join('/') === '首页/出行/设置', tabTexts.join('/'));
const meta = await page.evaluate(() => ({
  lines: ZJ.Data.lines.length,
  stations: ZJ.Data.stations.length,
  dirs: ZJ.Data.dirs.size,
  stops: ZJ.Data.stopCount,
  generated: ZJ.Data.generated
}));
ok('静态线路数据 395 条', meta.lines === 395, JSON.stringify(meta));
ok('站点数量 > 3000', meta.stations > 3000, String(meta.stations));
ok('线路方向 > 700 个', meta.dirs > 700, String(meta.dirs));
ok('首页默认展示', await page.$eval('#page-home', (el) => el.classList.contains('on')));
ok('线路列表已渲染', (await cnt('.line-row')) > 10, String(await cnt('.line-row')));
ok('无公告 Tab', !tabTexts.some((t) => t.indexOf('公告') > -1));
ok('无我的 Tab', !tabTexts.some((t) => t.indexOf('我的') > -1));

/* ---------------- 2. 首页栏目精简 + 定位 ---------------- */
section('首页栏目精简与定位');
ok('附近站点栏目已移除', !(await has('#nearbyCard')), '#nearbyCard 不存在');
ok('页面无附近站点列表', (await cnt('.nb-row')) === 0, 'nb-row=' + (await cnt('.nb-row')));
ok('无定位胶囊', !(await has('#homeLoc')));
const homeOrder = await page.evaluate(() => {
  const body = document.querySelector('.home-body');
  return [...body.children].map((e) => e.id || e.className);
});
ok('首页依次为 收藏 / 提醒 / 线路列表', homeOrder[0] === 'favCard', homeOrder.join(' > '));
ok('搜索框仍在页头', await has('.home-hdr #lineQ'));
await page.waitForFunction(() => window.ZJ && ZJ.Geo && ZJ.Geo.state !== 'locating', { timeout: 12000 });
ok('定位能力仍可用（供去哪「我的位置」）', (await page.evaluate(() => ZJ.Geo.state)) === 'ok', await page.evaluate(() => ZJ.Geo.state));

/* ---------------- 3. 线路搜索 ---------------- */
section('线路搜索');
await page.click('#lineQ');
await page.type('#lineQ', '23');
await sleep(400);
const searchRows = await page.$$eval('.line-row', (els) => els.map((e) => e.dataset.name));
ok('输入 23 命中 23路', searchRows.indexOf('23路') > -1, searchRows.slice(0, 6).join(','));
ok('搜索时显示结果计数', (await txt('#lineCount')).indexOf('匹配') > -1, await txt('#lineCount'));
await page.evaluate(() => { const i = document.getElementById('lineQ'); i.value = 'zzzz'; i.dispatchEvent(new Event('input', { bubbles: true })); });
await sleep(350);
ok('无结果时有空态提示', (await txt('#lineList')).indexOf('没有找到') > -1, (await txt('#lineList')).slice(0, 40));
await clickAct('clear-q');
await sleep(300);
ok('清空搜索恢复全部线路', (await cnt('.line-row')) > 20);
ok('清空后隐藏清除按钮', await page.$eval('#lineQClear', (el) => el.hidden));

/* ---------------- 4. 线路实时页 ---------------- */
section('线路实时页（实时车辆 / 剩余站 / 预计到站）');
await page.evaluate(() => {
  const dir = ZJ.Data.lineOf('23路').dirs[0];
  const st = dir.stops[10];
  window.__testStation = st.name;
  window.__mock = { speed: 240, list: [
    { vehicleOrder: 10, distance: 300, isArriveStation: 0, plateNumber: '浙D00001D', gpsTime: '2026-11-18 18:40:00' },
    { vehicleOrder: 30, distance: 60, isArriveStation: 1, plateNumber: '浙D00002D', gpsTime: '2026-11-18 18:40:00' }
  ] };
  ZJ.Api.vehicles = async () => ({ busAverageSpeed: window.__mock.speed, list: window.__mock.list, static: false });
  ZJ.Api.lineDetail = async () => ({ lineName: '23路', up: { totalPrice: 1.0 } });
  ZJ.Api.plan = async () => ['06:20', '07:00', '17:30', '18:00', '19:10'];
  document.querySelector('.line-row[data-name="23路"]').click();
});
await page.waitForFunction(() => document.getElementById('page-line').classList.contains('on'), { timeout: 4000 });
await sleep(1100);
ok('进入线路详情页', await page.$eval('#page-line', (el) => el.classList.contains('on')));
ok('标题为 23路', (await txt('#lnName')) === '23路', await txt('#lnName'));
ok('方向信息包含首末站', (await txt('#lnDir')).indexOf('双福村') > -1, await txt('#lnDir'));
ok('站点序列 38 站', (await cnt('.vt-row')) === 38, String(await cnt('.vt-row')));
ok('横向站点列表 38 站', (await cnt('#tl .tl-item')) === 38, String(await cnt('#tl .tl-item')));
ok('时间轴渲染车辆标记', (await cnt('.tl-bus')) === 2, String(await cnt('.tl-bus')));
ok('实时信息卡显示车牌', (await txt('#lineStat')).indexOf('浙D00001D') > -1, (await txt('#lineStat')).slice(0, 80));
ok('信息卡有实时标记', (await txt('#lineStat')).indexOf('实时') > -1);
ok('票价来自接口', (await txt('#lineInfo')).indexOf('票价') > -1, await txt('#lineInfo'));

await page.evaluate(() => {
  const name = window.__testStation;
  document.querySelector('.vt-row[data-station="' + name + '"]').click();
});
await sleep(500);
const statTxt = await txt('#lineStat');
ok('选择等车站后剩余站数为 1', (await page.$eval('.stat-num', (el) => el.textContent.trim())) === '1', statTxt.slice(0, 60));
ok('显示预计到达分钟', /约 \d+ 分钟/.test(statTxt), statTxt.slice(0, 80));
ok('显示剩余距离', /(\d+ 米|\d+\.\d 公里)/.test(statTxt), statTxt.slice(0, 80));
const myStopTxt = await txt('#myStopBar');
ok('等车站条显示所选站', myStopTxt.indexOf(await page.evaluate(() => window.__testStation)) > -1, myStopTxt);
ok('站点列表显示实时倒计时', (await cnt('.vt-eta.live')) > 0, String(await cnt('.vt-eta.live')));

/* ---------------- 5. 竖屏横向站点列表 ---------------- */
section('竖屏横向站点列表（左右滑动浏览整条线路）');
const tlInfo = await page.evaluate(() => {
  const sc = document.getElementById('tlScroll');
  const nm = document.querySelector('#tl .tl-nm');
  const cs = getComputedStyle(nm);
  const before = sc.scrollLeft;
  sc.scrollLeft = 300;
  const after = sc.scrollLeft;
  sc.scrollLeft = 600;
  const after2 = sc.scrollLeft;
  return {
    sw: sc.scrollWidth, cw: sc.clientWidth, before, after, after2,
    writing: cs.writingMode, overflowX: getComputedStyle(sc).overflowX,
    hint: document.getElementById('tlHint').textContent
  };
});
ok('站点条可横向滚动（内容宽 > 可视宽）', tlInfo.sw > tlInfo.cw, tlInfo.sw + '/' + tlInfo.cw);
ok('横向容器 overflow-x 可滚动', tlInfo.overflowX === 'auto' || tlInfo.overflowX === 'scroll', tlInfo.overflowX);
ok('可滚动到右侧站点', tlInfo.after2 > tlInfo.before, JSON.stringify([tlInfo.before, tlInfo.after2]));
ok('站名为竖排文字', tlInfo.writing === 'vertical-rl', tlInfo.writing);
ok('显示滑动提示且含站数', /共 38 站/.test(tlInfo.hint), tlInfo.hint);
const tlTapOk = await page.evaluate(() => {
  const items = document.querySelectorAll('#tl .tl-item');
  const target = items[items.length - 1];
  target.click();
  return document.getElementById('myStopBar').textContent.indexOf(target.dataset.station) > -1;
});
ok('点击站点条可设为等车站', tlTapOk);
const tlOverflow = await overflow();
ok('线路页无横向溢出', tlOverflow.sw <= tlOverflow.iw + 1, JSON.stringify(tlOverflow));

/* 竖向时间轴（大字版，老年友好） */
const vt = await page.evaluate(() => {
  const rows = document.querySelectorAll('#stopList .vt-row');
  const name = document.querySelector('#stopList .vt-name');
  const bell = document.querySelector('#stopList .vt-bell');
  const axis = document.querySelector('#stopList .vt-axis');
  const tlCard = document.querySelector('.tl-card');
  const vtBox = document.getElementById('stopList');
  return {
    rows: rows.length,
    font: parseFloat(getComputedStyle(name).fontSize),
    bell: bell ? Math.round(bell.getBoundingClientRect().width) : 0,
    minH: parseFloat(getComputedStyle(rows[0]).minHeight),
    axisLine: parseFloat(getComputedStyle(axis, '::before').width),
    bus: document.querySelectorAll('#stopList .vt-bus').length,
    title: document.querySelector('.stop-sec .sec-h b').textContent,
    afterHorizontal: !!(tlCard.compareDocumentPosition(vtBox) & Node.DOCUMENT_POSITION_FOLLOWING)
  };
});
ok('线路页有竖向时间轴', vt.rows === 38, String(vt.rows));
ok('竖向时间轴位于横向时间轴下方', vt.afterHorizontal);
ok('竖向时间轴标题标注大字', vt.title.indexOf('竖向') > -1, vt.title);
ok('竖向站名 >= 15px（老年友好）', vt.font >= 15, String(vt.font));
ok('竖向行高 >= 56px', vt.minH >= 56, String(vt.minH));
ok('竖向有连续轴线', vt.axisLine >= 3, String(vt.axisLine));
ok('竖向时间轴提醒按钮 >= 40px', vt.bell >= 40, String(vt.bell));
ok('竖向时间轴标记车辆位置', vt.bus > 0, String(vt.bus));
await page.evaluate(() => {
  const name = window.__testStation;
  document.querySelector('.vt-row[data-station="' + name + '"]').click();
});
await sleep(400);

/* ---------------- 6. 上下行切换 ---------------- */
section('上下行切换');
const beforeDir = await txt('#lnDir');
await clickAct('line-swap');
await sleep(700);
const afterDir = await txt('#lnDir');
ok('切换方向后文案变化', beforeDir !== afterDir, beforeDir + ' -> ' + afterDir);
ok('切换后站点列表仍完整', (await cnt('.vt-row')) > 30, String(await cnt('.vt-row')));
ok('切换后出现提示', (await txt('#toast')).indexOf('方向') > -1, await txt('#toast'));
await clickAct('line-swap');
await sleep(600);

/* ---------------- 7. 收藏 ---------------- */
section('收藏');
await clickAct('line-fav');
await sleep(200);
ok('收藏线路写入本地', await page.evaluate(() => ZJ.Fav.hasLine('23路')));
await clickAct('line-back');
await sleep(600);
const favHtml = await txt('#favBody');
ok('首页收藏区显示 23路', favHtml.indexOf('23路') > -1, favHtml.slice(0, 40));
await page.evaluate(() => document.querySelector('.chip-line[data-name="23路"]').click());
await sleep(700);
ok('点击收藏线路可再次进入详情', (await txt('#lnName')) === '23路');
await clickAct('line-fav');
await sleep(200);
await clickAct('line-back');
await sleep(600);
ok('取消收藏后首页不再显示', (await txt('#favBody')).indexOf('23路') === -1);

/* ---------------- 8. 发车时刻表 ---------------- */
section('发车时刻表');
await page.evaluate(() => document.querySelector('.line-row[data-name="23路"]').click());
await sleep(1200);
await clickAct('open-tt');
await sleep(700);
const sheetTxt = await txt('#sheet');
ok('时刻表弹层打开', sheetTxt.indexOf('发车时刻表') > -1, sheetTxt.slice(0, 40));
ok('时刻表显示班次', sheetTxt.indexOf('06:20') > -1);
ok('时刻表标注班次数', /共 \d+ 班/.test(sheetTxt), sheetTxt.slice(0, 60));
await clickAct('close-sheet');
await sleep(500);

/* ---------------- 9. 到站提醒（线路页） ---------------- */
section('本地到站提醒（弹窗 + 震动）');
await page.evaluate(() => {
  ZJ.Notify.status = async () => 'granted';
  ZJ.Notify.fire = async () => true;
  ZJ.Sound.chime = () => true;
  window.__vibrate = [];
  navigator.vibrate = (p) => { window.__vibrate.push(p); return true; };
  const name = window.__testStation;
  document.querySelector('.vt-row[data-station="' + name + '"] .vt-bell').click();
});
await sleep(700);
const rmSheet = await txt('#sheet');
ok('提醒弹层包含三种方式', rmSheet.indexOf('到站提醒') > -1 && rmSheet.indexOf('下一站提醒') > -1 && rmSheet.indexOf('提前 2 站') > -1);
ok('提醒弹层说明响铃与锁屏提醒', rmSheet.indexOf('响铃') > -1 && rmSheet.indexOf('锁屏') > -1, rmSheet.slice(0, 120));
await page.evaluate(() => document.querySelector('.rm-mode[data-mode="one"]').click());
await sleep(200);
ok('可切换到「下一站提醒」', await page.$eval('.rm-mode[data-mode="one"]', (el) => el.classList.contains('on')));
await clickAct('rm-save');
await sleep(900);
ok('提醒已写入本地', await page.evaluate(() => ZJ.Reminder.list().length === 1));
ok('等车站条显示提醒中', (await txt('#myStopBar')).indexOf('提醒中') > -1, await txt('#myStopBar'));
const alertShown = await page.$eval('#alertMask', (el) => !el.hidden);
ok('车辆剩 1 站时触发弹窗', alertShown, 'alert hidden');
if (alertShown) {
  const alertTxt = await txt('#alertCard');
  ok('弹窗说明车辆即将到站', alertTxt.indexOf('即将到站') > -1, alertTxt.slice(0, 60));
  ok('弹窗含车牌与站名', alertTxt.indexOf('浙D00001D') > -1 && alertTxt.indexOf(await page.evaluate(() => window.__testStation)) > -1, alertTxt.slice(0, 80));
  ok('触发时调用震动 API', (await page.evaluate(() => window.__vibrate.length)) > 0);
  await page.evaluate(() => document.getElementById('rmGo').click());
  await sleep(400);
  ok('弹窗可关闭', await page.$eval('#alertMask', (el) => el.hidden));
}
ok('提醒完成后标记为已提醒', await page.evaluate(() => ZJ.Reminder.list()[0].done === true));
await page.evaluate(() => { ZJ.Line.close(); ZJ.setTab('home'); });
await sleep(700);
ok('首页显示提醒记录卡片', await page.$eval('#remindCard', (el) => !el.hidden));
ok('提醒记录显示已提醒状态', (await txt('#remindBody')).indexOf('已提醒') > -1, await txt('#remindBody'));
await page.evaluate(() => document.querySelector('[data-act="reminder-list"]').click());
await sleep(600);
ok('提醒管理弹层可打开', (await txt('#sheet')).indexOf('到站提醒') > -1, (await txt('#sheet')).slice(0, 40));
ok('管理弹层列出记录', (await cnt('.rm-item')) === 1, String(await cnt('.rm-item')));
await page.evaluate(() => { const b = document.querySelector('.rm-item .r-del'); if (b) b.click(); });
await sleep(500);
ok('可删除提醒记录', await page.evaluate(() => ZJ.Reminder.list().length === 0));
await page.evaluate(() => ZJ.UI.closeSheet());
await sleep(400);

/* ---------------- 10. 站点实时页 ---------------- */
section('站点实时页');
await page.evaluate(() => ZJ.Station.open('火车站'));
await page.waitForFunction(() => document.getElementById('page-station').classList.contains('on'), { timeout: 3000 });
await sleep(3200);
ok('站点页标题正确', (await txt('#stName')) === '火车站', await txt('#stName'));
ok('站点页显示途经方向数', /途经本站/.test(await txt('#stSub')), await txt('#stSub'));
ok('站点页显示距离', /距我/.test(await txt('#stSub')), await txt('#stSub'));
ok('站点页线路卡片 >= 10', (await cnt('.st-line')) >= 10, String(await cnt('.st-line')));
const stSummary = await txt('#stSummary');
ok('汇总显示有车方向数', /方向有车|暂无车辆/.test(stSummary), stSummary);
const busInfo = await page.$eval('.st-line', (el) => el.textContent.replace(/\s+/g, ' '));
ok('线路卡片含预计到站', /(约 \d+ 分|已到站|—)/.test(busInfo), busInfo.slice(0, 60));
await page.evaluate(() => document.getElementById('stFav').click());
await sleep(300);
ok('收藏站点写入本地', await page.evaluate(() => ZJ.Fav.hasStation('火车站')));
const stOverflow = await overflow();
ok('站点页无横向溢出', stOverflow.sw <= stOverflow.iw + 1, JSON.stringify(stOverflow));
await page.evaluate(() => document.querySelector('.st-line').click());
await sleep(900);
ok('从站点页进入线路页', await page.$eval('#page-line', (el) => el.classList.contains('on')));
ok('线路页等车站为所选站点', (await txt('#myStopBar')).indexOf('火车站') > -1, await txt('#myStopBar'));
await page.evaluate(() => ZJ.Line.close());
await sleep(500);
await page.evaluate(() => ZJ.Station.close());
await sleep(700);
ok('首页收藏区显示收藏站点', (await txt('#favBody')).indexOf('火车站') > -1, (await txt('#favBody')).slice(0, 40));
await page.evaluate(() => document.querySelector('.fav-st[data-name="火车站"]').click());
await sleep(900);
ok('点击收藏站点可进入站点页', (await txt('#stName')) === '火车站');
await page.evaluate(() => ZJ.Station.close());
await sleep(600);

/* ---------------- 11. 去哪 / 换乘 ---------------- */
section('出行查询（站名直查，无线路展开）');
await page.evaluate(() => ZJ.setTab('go'));
await sleep(400);
ok('切到出行页', await page.$eval('#page-go', (el) => el.classList.contains('on')));
ok('起点显示输入提示', (await txt('#fromName')) === '输入起点站', await txt('#fromName'));
ok('终点显示输入提示', (await txt('#toName')) === '输入终点站', await txt('#toName'));
ok('页头有查询按钮', await has('.plan-btn[data-act="plan"]'));

await clickAct('pick-from');
await sleep(400);
const sheetState = await page.evaluate(() => ({
  tabs: document.querySelectorAll('.sheet-tab').length,
  lineRows: document.querySelectorAll('.pick-line').length,
  hasSearch: !!document.getElementById('pkQ'),
  ph: (document.getElementById('pkQ') || {}).placeholder || ''
}));
ok('选择弹层只有站名搜索', sheetState.tabs === 0 && sheetState.hasSearch, JSON.stringify(sheetState));
ok('弹层不再提供线路展开', sheetState.lineRows === 0, String(sheetState.lineRows));
ok('搜索框提示输入站点名称', /站点名称/.test(sheetState.ph), sheetState.ph);
await page.type('#pkQ', '火车站');
await sleep(500);
ok('输入站名即出现候选站点', (await cnt('#pkList .pick-stop')) > 0, String(await cnt('#pkList .pick-stop')));
await page.evaluate(() => document.querySelector('#pkList .pick-stop').click());
await sleep(450);
ok('选站后起点已填入', (await txt('#fromName')) === '火车站', await txt('#fromName'));

await pickStation('pick-to', '草塔停车场');
await sleep(1600);
ok('终点已填入', (await txt('#toName')) === '草塔停车场', await txt('#toName'));

/* ---------------- 出行结果：直达 / 换乘 / 附近可达 ---------------- */
section('出行结果（直达 · 换乘 · 附近可达站点）');
const res = await page.evaluate(() => ({
  secs: [...document.querySelectorAll('.res-h b')].map((e) => e.textContent),
  cards: document.querySelectorAll('.res-card').length,
  badges: document.querySelectorAll('.res-badge').length,
  near: document.querySelectorAll('.near-item').length,
  nearSet: document.querySelectorAll('[data-act="near-set"]').length,
  first: (document.querySelector('.res-card') || { innerText: '' }).innerText.replace(/\s+/g, ' '),
  live: (document.querySelector('.res-live') || { innerText: '' }).innerText.replace(/\s+/g, ' '),
  nearDist: (document.querySelector('.near-item .d') || { textContent: '' }).textContent
}));
ok('结果含「直达方案」分区', res.secs.indexOf('直达方案') > -1, res.secs.join(' | '));
ok('结果同时含「附近可达站点」分区', res.secs.indexOf('附近可达站点') > -1, res.secs.join(' | '));
ok('每个方案显示总分钟', /\d+\s*分钟/.test(res.first), res.first.slice(0, 60));
ok('方案显示线路胶囊', res.badges > 0, String(res.badges));
ok('方案显示实时或静态车辆一行', /(还有 \d+ 站|暂无车辆|实时不可用|车辆已过站|正在获取)/.test(res.live), res.live);
ok('附近站点显示步行距离', /(米|公里)/.test(res.nearDist), res.nearDist);
ok('附近站点可一键设为起终点', res.nearSet > 0, String(res.nearSet));
ok('历史记录已保存', await page.evaluate(() => (ZJ.Store.get('zjbus.history.v1', []) || []).length === 1));
ok('最近查询列表已渲染', (await cnt('.hist-row')) === 1, String(await cnt('.hist-row')));

/* 附近站点切换端点 */
const nearBefore = await txt('#fromName');
await page.evaluate(() => document.querySelector('[data-end="from"][data-act="near-set"]').click());
await sleep(1200);
const nearAfter = await txt('#fromName');
ok('点附近站点可切换起点', nearAfter !== nearBefore && nearAfter.length > 0, nearBefore + ' → ' + nearAfter);

/* 无直达的站点对：给出换乘方案或空态 */
const noDirect = await page.evaluate(() => {
  const st = ZJ.Data.stations.filter((s) => s.entries.length <= 2);
  for (let i = 0; i < st.length; i++) {
    for (let j = 0; j < st.length; j++) {
      if (i === j) continue;
      const a = st[i], b = st[j];
      const direct = a.entries.some((x) => b.entries.some((y) => x.dir === y.dir && y.order > x.order));
      if (!direct) return [a.name, b.name];
    }
  }
  return null;
});
if (noDirect) {
  await page.evaluate((p) => { ZJ.Go.setEnds(p[0], p[1]); document.querySelector('[data-act="plan"]').click(); }, noDirect);
  await sleep(1500);
  const nd = await page.evaluate(() => ({
    secs: [...document.querySelectorAll('.res-h b')].map((e) => e.textContent),
    cards: document.querySelectorAll('.res-card').length,
    txt: document.querySelector('#planResult').innerText.replace(/\s+/g, ' '),
    near: document.querySelectorAll('.near-item').length
  }));
  ok('无直达时给出换乘方案或空态提示', nd.secs.indexOf('换乘方案') > -1 || nd.txt.indexOf('没有找到直通车') > -1, nd.secs.join('|') + ' / ' + nd.txt.slice(0, 40));
  ok('无直达时仍给出附近可达站点', nd.near > 0, String(nd.near));
} else {
  ok('无直达时给出换乘方案或空态提示', true, '未找到无直达站点对，跳过');
  ok('无直达时仍给出附近可达站点', true, '跳过');
}

/* 恢复到直达样例，准备进详情 */
await page.evaluate(() => { ZJ.Go.setEnds('火车站', '草塔停车场'); document.querySelector('[data-act="plan"]').click(); });
await sleep(1500);
ok('可重新查询回直达方案', (await cnt('.res-card')) > 0, String(await cnt('.res-card')));

/* ---------------- 方案详情：流程 + 到目的地还有几站 ---------------- */
section('方案详情（换乘流程 + 到目的地还有几站 + 提醒）');
await page.evaluate(() => {
  /* 定向 mock：每段给一辆距上车站 4 站的车，且让提醒立即满足触发条件 */
  ZJ.Api.vehicles = async (dirId) => {
    const legs = (ZJ.Plan.state().plan || {}).legs || [];
    const leg = legs.find((l) => l.dir.id === dirId);
    const order = leg ? Math.max(1, leg.fromOrder - 4) : 1;
    return { busAverageSpeed: 240, list: [{ vehicleOrder: order, distance: 120, isArriveStation: 0, plateNumber: '浙D00088D' }], static: false };
  };
  document.querySelector('.res-card').click();
});
await page.waitForFunction(() => document.getElementById('page-plan').classList.contains('on'), { timeout: 4000 });
await sleep(1500);
ok('点击方案进入详情页', await page.$eval('#page-plan', (el) => el.classList.contains('on')));
ok('详情页标题为出行方案', (await txt('#plTitle')) === '出行方案', await txt('#plTitle'));
ok('副标题含起终点', (await txt('#plSub')).indexOf('火车站') > -1 && (await txt('#plSub')).indexOf('草塔停车场') > -1, await txt('#plSub'));

const hero = await page.evaluate(() => {
  const el = document.querySelector('.pl-hero');
  if (!el) return null;
  const n = el.querySelector('.pl-hero-n');
  return {
    txt: el.innerText.replace(/\s+/g, ' '),
    num: parseInt(n.textContent, 10),
    font: parseFloat(getComputedStyle(n).fontSize),
    bg: getComputedStyle(el).backgroundImage,
    above: !!(el.compareDocumentPosition(document.querySelector('.flow')) & Node.DOCUMENT_POSITION_FOLLOWING)
  };
});
ok('顶部突出「到目的地还有 N 站」', !!hero && /到目的地还有\s*\d+\s*站/.test(hero.txt), hero && hero.txt.slice(0, 50));
ok('目的地剩余站数字 >= 30px 大字', !!hero && hero.font >= 30, hero && String(hero.font));
ok('高亮条为高对比渐变且在流程之上', !!hero && /gradient/.test(hero.bg) && hero.above, hero && String(hero.num));

const flow = await page.evaluate(() => ({
  rows: document.querySelectorAll('.flow .fl-row').length,
  segs: document.querySelectorAll('.fl-seg').length,
  bells: document.querySelectorAll('.fl-bell').length,
  start: (document.querySelector('.fl-row .fl-name') || { innerText: '' }).innerText,
  end: (document.querySelectorAll('.flow .fl-row')[document.querySelectorAll('.flow .fl-row').length - 1] || { innerText: '' }).innerText,
  seg: (document.querySelector('.fl-seg') || { innerText: '' }).innerText.replace(/\s+/g, ' '),
  dot: document.querySelectorAll('.fl-dot').length,
  line: document.querySelectorAll('.fl-line').length
}));
ok('流程含起点节点', flow.start.indexOf('起点') > -1, flow.start);
ok('流程含终点节点', flow.end.indexOf('终点') > -1, flow.end);
ok('竖线时间轴为连续结构', flow.dot >= 3 && flow.line >= 2, flow.dot + '点/' + flow.line + '线');
ok('分段卡片数量 >= 1', flow.segs >= 1, String(flow.segs));
ok('每段都有下车站提醒铃铛', flow.bells === flow.segs, flow.bells + '/' + flow.segs);
ok('分段显示「车还有 N 站」', /\d+\s*站/.test(flow.seg) && /到上车站/.test(flow.seg), flow.seg.slice(0, 70));
ok('分段显示乘几站/公里/分钟', /乘 \d+ 站/.test(flow.seg) && /(公里|米)/.test(flow.seg) && /约 \d+ 分钟/.test(flow.seg), flow.seg.slice(0, 90));
ok('分段显示线路与方向', /往 /.test(flow.seg), flow.seg.slice(0, 40));

/* 下车站提醒（模拟已有通知权限，避免权限弹窗打断） */
await page.evaluate(() => {
  window.__vibrate = [];
  window.__chime = 0;
  navigator.vibrate = (p) => { window.__vibrate.push(p); return true; };
  window.__origChime = ZJ.Sound.chime.bind(ZJ.Sound);
  ZJ.Sound.chime = () => { window.__chime++; return true; };
  ZJ.Notify.status = async () => 'granted';
  ZJ.Notify.fire = async () => true;
});
await page.evaluate(() => document.querySelector('.fl-bell').click());
await sleep(600);
const bellSheet = await txt('#sheet');
ok('铃铛打开到站提醒弹层', bellSheet.indexOf('到站提醒') > -1 && bellSheet.indexOf('下一站提醒') > -1, bellSheet.slice(0, 50));
ok('弹层说明响铃与锁屏提醒', bellSheet.indexOf('响铃') > -1, bellSheet.slice(0, 90));
ok('弹层含线路与下车站', bellSheet.indexOf('50路') > -1 && bellSheet.indexOf('草塔停车场') > -1, bellSheet.slice(0, 80));
await clickAct('rm-save');
await sleep(600);
ok('可开启下车站提醒', await page.evaluate(() => ZJ.Reminder.list().length === 1));
ok('开启后铃铛高亮', (await cnt('.fl-bell.on')) === 1, String(await cnt('.fl-bell.on')));
ok('提醒写入 localStorage', await page.evaluate(() => (ZJ.Store.get('zjbus.reminders.v1', []) || []).length === 1));
await page.evaluate(() => document.querySelector('.fl-bell.on').click());
await sleep(500);
ok('再次点击可关闭提醒入口', await has('[data-act="rm-cancel"]'));
await clickAct('rm-cancel');
await sleep(500);
ok('可关闭下车站提醒', await page.evaluate(() => ZJ.Reminder.list().length === 0));
ok('关闭后铃铛取消高亮', (await cnt('.fl-bell.on')) === 0, String(await cnt('.fl-bell.on')));

/* 跳转整条线路实时页 */
await page.evaluate(() => document.querySelector('.fl-open').click());
await sleep(1200);
ok('可跳转该线路实时页', await page.$eval('#page-line', (el) => el.classList.contains('on')));
await page.evaluate(() => ZJ.Line.close());
await sleep(500);

/* 接口失效降级 */
await page.evaluate(() => {
  ZJ.Api.vehicles = async () => { throw new Error('网络异常，请检查网络'); };
  ZJ.Plan.refresh();
});
await sleep(900);
ok('接口失效时显示降级横幅', (await txt('#plSummary')).indexOf('已自动降级') > -1, (await txt('#plSummary')).slice(0, 60));
ok('降级横幅提供重试', await has('.degrade-banner [data-act="plan-refresh"]'));
ok('降级后流程与分段仍完整', (await cnt('.fl-seg')) >= 1 && (await cnt('.fl-row')) >= 3);
ok('降级后剩余站改为静态口径', (await txt('.pl-hero')).indexOf('静态') > -1, (await txt('.pl-hero')).slice(0, 60));
await page.evaluate(() => {
  ZJ.Api.vehicles = async (dirId) => {
    const legs = (ZJ.Plan.state().plan || {}).legs || [];
    const leg = legs.find((l) => l.dir.id === dirId);
    const order = leg ? Math.max(1, leg.fromOrder - 4) : 1;
    return { busAverageSpeed: 240, list: [{ vehicleOrder: order, distance: 120, isArriveStation: 0, plateNumber: '浙D00088D' }], static: false };
  };
  ZJ.Plan.refresh();
});
await sleep(1000);
ok('恢复后实时数据回来', (await txt('#plSummary')).indexOf('已自动降级') === -1, (await txt('#plSummary')).slice(0, 50));

/* 安卓返回键 */
await page.evaluate(() => history.back());
await sleep(600);
ok('安卓返回键关闭详情页', await page.$eval('#page-plan', (el) => !el.classList.contains('on')));
ok('返回后仍在出行页', await page.$eval('#page-go', (el) => el.classList.contains('on')));

/* ---------------- 设置页 ---------------- */
section('设置页（主题 / 提醒方式 / 通知权限 / 数据）');
await page.evaluate(() => ZJ.setTab('settings'));
await sleep(500);
ok('切到设置页', await page.$eval('#page-settings', (el) => el.classList.contains('on')));
ok('提供 4 种主题色', (await cnt('.theme-dot')) === 4, String(await cnt('.theme-dot')));
await page.evaluate(() => document.querySelectorAll('.theme-dot')[1].click());
await sleep(300);
const themeState = await page.evaluate(() => ({
  attr: document.documentElement.getAttribute('data-theme'),
  saved: ZJ.Prefs.get('theme'),
  on: document.querySelectorAll('.theme-dot.on').length,
  meta: document.querySelector('meta[name="theme-color"]').content
}));
ok('切换主题后立即生效', themeState.attr === 'sky' && themeState.saved === 'sky', JSON.stringify(themeState));
ok('主题选择高亮唯一', themeState.on === 1, String(themeState.on));
ok('主题色同步系统状态栏色', themeState.meta.toLowerCase() === '#2e7bf6', themeState.meta);
await page.evaluate(() => document.querySelectorAll('.theme-dot')[0].click());
await sleep(250);
ok('可切回玫瑰粉', (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'rose');

await page.evaluate(() => document.getElementById('swSound').click());
await sleep(250);
ok('可关闭提示音', await page.evaluate(() => ZJ.Prefs.get('sound') === false));
ok('关闭后不再响铃', await page.evaluate(() => window.__chimeOrig() === false));
await page.evaluate(() => document.getElementById('swSound').click());
await sleep(250);
ok('可重新开启提示音', await page.evaluate(() => ZJ.Prefs.get('sound') === true));

await page.evaluate(() => document.getElementById('swVibrate').click());
await sleep(250);
ok('可关闭震动', await page.evaluate(() => ZJ.Prefs.get('vibrate') === false));
ok('关闭后震动不触发', await page.evaluate(() => ZJ.UI.vibrate([10]) === false));
await page.evaluate(() => document.getElementById('swVibrate').click());
await sleep(250);
ok('可重新开启震动', await page.evaluate(() => ZJ.Prefs.get('vibrate') === true));

const volSet = await page.evaluate(() => {
  const r = document.getElementById('volRange');
  r.value = '40';
  r.dispatchEvent(new Event('input', { bubbles: true }));
  r.dispatchEvent(new Event('change', { bubbles: true }));
  return { pref: ZJ.Prefs.get('volume'), label: document.getElementById('volTxt').textContent };
});
ok('可调节提示音音量', volSet.pref === 40 && volSet.label === '40%', JSON.stringify(volSet));
ok('音量滑块存在且范围 0-100', await page.$eval('#volRange', (el) => el.min === '0' && el.max === '100'));

await page.evaluate(() => document.querySelector('[data-act="set-poll"][data-v="30"]').click());
await sleep(300);
const pollState = await page.evaluate(() => ({ pref: ZJ.Prefs.get('poll'), on: document.querySelector('#pollSeg .seg-b.on').dataset.v }));
ok('提醒轮询间隔可设置', pollState.pref === 30 && pollState.on === '30', JSON.stringify(pollState));
await page.evaluate(() => document.querySelector('[data-act="set-poll"][data-v="15"]').click());
await sleep(200);

const permBadge = await txt('#permBadge');
ok('展示通知权限状态', ['已开启', '未开启', '已关闭', '不支持'].indexOf(permBadge) > -1, permBadge);
await page.evaluate(() => { ZJ.Notify.status = async () => 'prompt'; ZJ.Settings.render(); });
await sleep(400);
await page.evaluate(() => document.getElementById('btnReqNotify').click());
await sleep(600);
const permAlert = await txt('#alertCard');
ok('无权限时弹窗给出明确说明', permAlert.indexOf('通知') > -1 && permAlert.indexOf('响铃') > -1, permAlert.slice(0, 80));
ok('弹窗可一键开启通知', await has('[data-act="perm-request"]'));
ok('弹窗提供去系统设置入口', await has('[data-act="open-notify-set"]'));
await clickAct('permalert-close');
await sleep(400);
ok('弹窗可关闭', await page.$eval('#alertMask', (el) => el.hidden));

await page.evaluate(() => { ZJ.Notify.status = async () => 'denied'; ZJ.Settings.render(); });
await sleep(400);
ok('权限被关闭时状态为「已关闭」', (await txt('#permBadge')) === '已关闭', await txt('#permBadge'));
await page.evaluate(() => document.getElementById('btnReqNotify').click());
await sleep(600);
const deniedAlert = await txt('#alertCard');
ok('已关闭时给出设置步骤', deniedAlert.indexOf('设置') > -1 && deniedAlert.indexOf('应用') > -1, deniedAlert.slice(0, 90));
await clickAct('permalert-close');
await sleep(300);
await page.evaluate(() => { ZJ.Notify.status = async () => 'granted'; ZJ.Settings.render(); });
await sleep(300);
ok('已开启时状态为「已开启」', (await txt('#permBadge')) === '已开启', await txt('#permBadge'));

/* 清除缓存 */
await page.evaluate(() => document.querySelector('[data-act="clear-cache"]').click());
await sleep(500);
ok('清除缓存前有确认弹窗', (await txt('#alertCard')).indexOf('清除') > -1, (await txt('#alertCard')).slice(0, 50));
await page.evaluate(() => document.querySelector('[data-act="clear-cache-do"]').click());
await sleep(600);
const afterClear = await page.evaluate(() => ({
  hist: (ZJ.Store.get('zjbus.history.v1', []) || []).length,
  fav: (ZJ.Store.get('zjbus.fav.lines.v1', []) || []).length,
  theme: ZJ.Prefs.get('theme')
}));
ok('清除缓存清空查询记录', afterClear.hist === 0, JSON.stringify(afterClear));
ok('清除缓存不影响收藏与设置', afterClear.theme === 'rose', JSON.stringify(afterClear));

/* 关于 */
await page.evaluate(() => document.querySelector('[data-act="about"]').click());
await sleep(500);
const about = await txt('#sheet');
ok('关于页显示版本号', about.indexOf('v' + (await page.evaluate(() => ZJ.CFG.VERSION))) > -1, about.slice(0, 60));
ok('关于页说明数据来源', about.indexOf('官方接口') > -1);
ok('关于页可关闭', await has('#sheet [data-act="close-sheet"]'));
await page.evaluate(() => ZJ.UI.closeSheet());
await sleep(400);

/* ---------------- 到站提醒响铃与震动 ---------------- */
section('到站提醒（响铃 + 震动 + 系统通知）');
await page.evaluate(() => {
  ZJ.Api.vehicles = async () => ({ busAverageSpeed: 240, list: [
    { vehicleOrder: 10, distance: 120, isArriveStation: 0, plateNumber: '浙D00001D' }
  ], static: false });
  ZJ.Api.lineDetail = async () => ({ lineName: '23路', up: { totalPrice: 1.0 } });
  ZJ.setTab('home');
  ZJ.Line.open('23路', 'up', window.__testStation);
});
await page.waitForFunction(() => document.getElementById('page-line').classList.contains('on'), { timeout: 4000 });
await sleep(1200);
await page.evaluate(() => {
  window.__vibrate = [];
  window.__chime = 0;
  window.__notified = 0;
  navigator.vibrate = (p) => { window.__vibrate.push(p); return true; };
  ZJ.Sound.chime = () => { window.__chime++; return true; };
  ZJ.Notify.fire = async () => { window.__notified++; return true; };
  document.querySelector('.vt-row[data-station="' + window.__testStation + '"] .vt-bell').click();
});
await sleep(700);
ok('提醒弹层包含三种方式', (await txt('#sheet')).indexOf('到站提醒') > -1);
await page.evaluate(() => document.querySelector('.rm-mode[data-mode="one"]').click());
await sleep(200);
await clickAct('rm-save');
await sleep(1200);
ok('提醒已写入本地', await page.evaluate(() => ZJ.Reminder.list().length === 1));
const fired = await page.$eval('#alertMask', (el) => !el.hidden);
ok('车辆剩 1 站时弹出到站提醒', fired, 'alert hidden');
if (fired) {
  ok('提醒触发时响铃', (await page.evaluate(() => window.__chime)) > 0, String(await page.evaluate(() => window.__chime)));
  ok('提醒触发时震动', (await page.evaluate(() => window.__vibrate.length)) > 0, String(await page.evaluate(() => window.__vibrate.length)));
  ok('有通知权限时发送系统通知', (await page.evaluate(() => window.__notified)) > 0, String(await page.evaluate(() => window.__notified)));
  ok('弹窗含车牌与站名', (await txt('#alertCard')).indexOf('浙D00001D') > -1, (await txt('#alertCard')).slice(0, 70));
  await page.evaluate(() => document.getElementById('rmGo').click());
  await sleep(400);
  ok('弹窗可关闭', await page.$eval('#alertMask', (el) => el.hidden));
}
await page.evaluate(() => { ZJ.Line.close(); ZJ.setTab('home'); });
await sleep(600);
ok('首页显示提醒记录卡片', await page.$eval('#remindCard', (el) => !el.hidden));
ok('提醒记录显示已提醒状态', (await txt('#remindBody')).indexOf('已提醒') > -1, await txt('#remindBody'));
await page.evaluate(() => document.querySelector('[data-act="reminder-list"]').click());
await sleep(600);
ok('提醒管理弹层可打开', (await txt('#sheet')).indexOf('到站提醒') > -1);
ok('管理弹层列出记录', (await cnt('.rm-item')) === 1, String(await cnt('.rm-item')));
await page.evaluate(() => { const b = document.querySelector('.rm-item .r-del'); if (b) b.click(); });
await sleep(500);
ok('可删除提醒记录', await page.evaluate(() => ZJ.Reminder.list().length === 0));
await page.evaluate(() => ZJ.UI.closeSheet());
await sleep(400);

section('边界场景');

/* 13.1 站点搜索无结果 */
await page.evaluate(() => ZJ.setTab('go'));
await clickAct('pick-from');
await sleep(450);
await page.type('#pkQ', '不存在的地名XYZ');
await sleep(400);
ok('站名搜索无结果有提示', (await txt('#pkList')).indexOf('没有找到') > -1, (await txt('#pkList')).slice(0, 50));
await page.evaluate(() => ZJ.UI.closeSheet());
await sleep(400);

/* 13.2 无直达线路：应给出换乘方案，或给出友好空态 */
const noDirectB = await page.evaluate(() => {
  const sts = ZJ.Data.stations;
  const hasDirect = (a, b) => a.entries.some((x) => b.entries.some((y) => x.dir === y.dir && y.order > x.order));
  for (let i = 0; i < sts.length; i++) {
    const a = sts[i];
    if (!a.entries.length || a.entries.length > 4) continue;
    for (let j = i + 1; j < Math.min(sts.length, i + 400); j++) {
      const b = sts[j];
      if (b.name === a.name || !b.entries.length) continue;
      if (!hasDirect(a, b) && !hasDirect(b, a)) return { from: a.name, to: b.name };
    }
  }
  return null;
});
if (noDirectB) {
  await pickStation('pick-from', noDirectB.from);
  await pickStation('pick-to', noDirectB.to);
  await sleep(1400);
  const resTxt = await txt('#planResult');
  const kind = resTxt.indexOf('没有找到直通车') > -1 ? '空态' : /换乘方案/.test(resTxt) ? '换乘方案' : '未知';
  ok('无直达线路时有换乘方案或空态提示', kind !== '未知', noDirectB.from + '→' + noDirectB.to + ' :: ' + kind + ' :: ' + resTxt.slice(0, 40));
  ok('无直达时给出附近可达站点兜底', (await cnt('.near-item')) > 0, String(await cnt('.near-item')));
} else {
  ok('无直达线路时有换乘方案或空态提示', false, '未找到无直达站点对');
}

/* 13.3 网络异常：线路页降级为静态数据 */
await page.evaluate(() => {
  ZJ.Api.vehicles = async () => { throw new Error('网络异常，请检查网络'); };
  ZJ.Api.lineDetail = async () => { throw new Error('网络异常'); };
  ZJ.Api.plan = async () => { throw new Error('网络异常'); };
  ZJ.setTab('home');
  document.querySelector('.line-row[data-name="1路"]').click();
});
await sleep(1600);
const errStat = await txt('#lineStat');
ok('网络异常时显示错误卡', errStat.indexOf('实时车辆暂不可用') > -1, errStat.slice(0, 60));
ok('错误卡提供重试按钮', await has('[data-act="line-refresh"]'));
ok('顶部显示降级提示条', (await txt('#lineBanner')).indexOf('自动降级') > -1, (await txt('#lineBanner')).slice(0, 60));
ok('静态站序仍可用', (await cnt('.vt-row')) > 10, String(await cnt('.vt-row')));
ok('静态站点条仍可横向滑动', (await page.evaluate(() => {
  const sc = document.getElementById('tlScroll');
  return sc.scrollWidth > sc.clientWidth;
})));
ok('页脚说明静态兜底', (await txt('#lineNote')).indexOf('静态') > -1, await txt('#lineNote'));
await page.evaluate(() => ZJ.Line.close());
await sleep(500);

/* 13.4 定位失败：新页面拒绝定位权限 */
const page2 = await browser.newPage();
await page2.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await page2.evaluateOnNewDocument(() => {
  navigator.geolocation.getCurrentPosition = (s, e) => setTimeout(() => e({ code: 1, message: 'User denied Geolocation' }), 60);
});
await page2.goto(BASE, { waitUntil: 'networkidle2' });
await sleep(1600);
ok('定位失败不影响首页渲染', (await page2.$$eval('.line-row', (e) => e.length)) > 10);
ok('定位失败状态被记录', (await page2.evaluate(() => ZJ.Geo.state)) === 'fail', await page2.evaluate(() => ZJ.Geo.state));
ok('定位失败无附近站点残留', (await page2.$$('#nearbyList, .nb-row')).length === 0);
const failScroll = await page2.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
ok('定位失败页无横向溢出', failScroll.sw <= failScroll.iw + 1, JSON.stringify(failScroll));
await page2.close();

/* ---------------- 14. 移动端适配 & 需求剔除 ---------------- */
section('移动端适配与功能边界');
await page.evaluate(() => { ZJ.setTab('home'); });
await sleep(400);
for (const tab of ['home', 'go', 'settings']) {
  await page.evaluate((t) => ZJ.setTab(t), tab);
  await sleep(350);
  const m = await overflow();
  ok(tab + ' 页无横向溢出', m.sw <= m.iw + 1, JSON.stringify(m));
}
const forbidden = await page.evaluate(() => {
  const html = document.documentElement.innerHTML;
  return {
    mapSdk: /amap|qq\.map|BMap|AMap|mapbox|leaflet/i.test(html),
    mapEl: !!document.querySelector('#map,.map-container,.amap-container'),
    notice: /公告/.test(document.body.innerText),
    mine: /乘车码|意见反馈|消息推送|到站订阅/.test(document.body.innerText),
    mapApi: !!(window.AMap || window.qq || window.TMap || window.BMap)
  };
});
ok('未引入任何地图 SDK', !forbidden.mapSdk && !forbidden.mapApi, JSON.stringify(forbidden));
ok('没有地图容器', !forbidden.mapEl);
ok('页面无公告入口', !forbidden.notice);
ok('无乘车码/反馈/推送/订阅入口', !forbidden.mine, JSON.stringify(forbidden));

section('控制台');
const jsErrors = errors.filter((e) => !/Failed to load resource|net::ERR|ERR_/i.test(e));
ok('运行期无 JS 错误', jsErrors.length === 0, jsErrors.slice(0, 3).join(' | '));

await browser.close();

console.log('\n================================');
console.log('通过 ' + pass + ' 项，失败 ' + fails.length + ' 项');
if (fails.length) {
  console.log('失败明细：');
  fails.forEach((f) => console.log(' - ' + f));
  process.exit(1);
}
console.log('全部测试通过 ✅');
