// 线上部署校验：加载 GitHub Pages，检查资源、Tab、实时页与报错
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.argv[2] || 'https://0124577.github.io/zhuji-bus-easy/';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

const errors = [];
const failed = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('requestfailed', (r) => failed.push(r.url() + ' ' + r.failure()?.errorText));
page.on('response', (r) => { if (r.status() >= 400) failed.push(r.url() + ' HTTP ' + r.status()); });

const out = [];
const ok = (n, c, extra = '') => out.push(`${c ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });

ok('页面标题', (await page.title()).includes('诸暨'), await page.title());

const stat = await page.evaluate(() => ({
  hasZJ: typeof window.ZJ === 'object',
  lines: (window.ZJ?.Data?.lines || []).length,
  dirs: [...(window.ZJ?.Data?.dirs?.keys?.() || [])].length,
  stations: (window.ZJ?.Data?.stations || []).length,
  tabs: [...document.querySelectorAll('.tabbar .tab')].map((e) => e.textContent.trim()),
  apiMode: window.ZJ?.Api?.mode,
  mapRefs: /amap|AMap|BMap|mapbox|leaflet|qq\.map/i.test(document.documentElement.outerHTML),
}));
ok('运行环境存在 ZJ', stat.hasZJ);
ok('静态数据加载', stat.lines > 300 && stat.stations > 2000, `${stat.lines} 线/${stat.dirs} 向/${stat.stations} 站`);
ok('Tab 为 首页/出行/设置', stat.tabs.join('/') === '首页/出行/设置', stat.tabs.join(' | '));
ok('无地图 SDK 引用', !stat.mapRefs);

// 切到「出行」
await page.evaluate(() => window.ZJ.setTab('go'));
await new Promise((r) => setTimeout(r, 400));
const goState = await page.evaluate(() => ({
  on: !!document.querySelector('#page-go')?.classList.contains('on'),
  title: document.querySelector('#page-go h1')?.textContent.trim(),
  queryBtn: !!document.querySelector('[data-act="plan"]')
}));
ok('切到「出行」', goState.on && goState.title === '出行', JSON.stringify(goState));

// 设置页：主题 / 开关 / 轮询 / 权限状态
await page.evaluate(() => window.ZJ.setTab('settings'));
await new Promise((r) => setTimeout(r, 700));
const setState = await page.evaluate(() => ({
  on: !!document.querySelector('#page-settings')?.classList.contains('on'),
  themes: document.querySelectorAll('.theme-dot').length,
  switches: document.querySelectorAll('.switch').length,
  poll: document.querySelectorAll('#pollSeg .seg-b').length,
  perm: (document.getElementById('permBadge') || {}).textContent,
  ver: (document.getElementById('verTxt') || {}).textContent
}));
ok('设置页可打开且项目齐全', setState.on && setState.themes === 4 && setState.switches === 2 && setState.poll === 4, JSON.stringify(setState));
ok('设置页展示通知权限状态', ['已开启', '未开启', '已关闭', '不支持'].indexOf(setState.perm) > -1, setState.perm);
await page.evaluate(() => window.ZJ.setTab('home'));
await new Promise((r) => setTimeout(r, 300));

// 打开一条线路（静态数据第一条）
const lineName = await page.evaluate(() => {
  window.ZJ.setTab('home');
  const ln = window.ZJ.Data.lines[0];
  window.ZJ.Line.open(ln.name);
  return ln.name;
});
await new Promise((r) => setTimeout(r, 2500));
const lineState = await page.evaluate(() => {
  const scroll = document.querySelector('#tlScroll');
  return {
    open: document.querySelector('#page-line')?.classList.contains('on'),
    name: document.querySelector('.line-title')?.textContent?.trim(),
    vtRows: document.querySelectorAll('.vt-row').length,
    tlNodes: document.querySelectorAll('.tl-item').length,
    hScroll: scroll ? getComputedStyle(scroll).overflowX : '',
    scrollable: scroll ? scroll.scrollWidth > scroll.clientWidth : false,
    mode: document.querySelector('.data-mode')?.textContent?.trim() || window.ZJ.Api.mode,
    nearby: document.querySelectorAll('#nearbyCard,.nb-row').length,
  };
});
ok('线路详情打开', !!lineState.open && lineState.vtRows > 3, `${lineName} / 竖向 ${lineState.vtRows} 行 / ${lineState.mode}`);
ok('横向时间轴可左右滚动', lineState.hScroll === 'auto' && lineState.scrollable, `${lineState.tlNodes} 节点`);
ok('首页已无附近站点栏目', lineState.nearby === 0);

// 确认线上已部署「还要 N 站」高亮条版本
const deploy = await page.evaluate(async () => {
  const txt = async (u) => (await fetch(u, { cache: 'no-store' })).text();
  const [js, css, go, settings, theme] = await Promise.all([
    txt('js/plan.js'), txt('css/app.css'), txt('js/go.js'), txt('js/settings.js'), txt('css/theme.css')
  ]);
  return {
    js: js.indexOf('到目的地还有') > -1,
    css: css.indexOf('.pl-hl') > -1,
    hero: go.indexOf('plan-hero') > -1,
    settings: settings.length > 500,
    theme: theme.indexOf('data-theme="sky"') > -1
  };
});
ok('线上已部署方案详情大字条（JS）', deploy.js);
ok('线上已部署方案详情大字条（CSS）', deploy.css);
ok('线上已部署出行页「到目的地还有 N 站」', deploy.hero);
ok('线上已部署设置页脚本', deploy.settings);
ok('线上已部署主题色切换', deploy.theme);

const shotDir = 'C:/work/bus/_tmp/shots';
await page.screenshot({ path: `${shotDir}/live-line.png` });
await page.evaluate(() => window.ZJ.Line.close());
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: `${shotDir}/live-home.png` });

ok('无控制台报错', errors.length === 0, errors.slice(0, 3).join(' || '));
ok('无失败请求', failed.length === 0, failed.slice(0, 3).join(' || '));

console.log(out.join('\n'));
const fails = out.filter((l) => l.startsWith('FAIL')).length;
console.log(`\n合计 ${out.length} 项，失败 ${fails} 项`);
await browser.close();
process.exit(fails ? 1 : 0);
