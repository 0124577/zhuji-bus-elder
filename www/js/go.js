/* 去哪：直达优先 / 最少换乘 / 历史记录（全部本地静态数据计算） */
(function () {
  const ZJ = window.ZJ;
  const $ = ZJ.$;
  const Data = ZJ.Data;
  const HIST_KEY = 'zjbus.history.v1';

  const G = { from: '', to: '', plans: [], idx: 0, computing: false, tip: '' };

  /* ---------- 历史 ---------- */
  function history() { return ZJ.Store.get(HIST_KEY, []); }
  function pushHistory(from, to) {
    const list = history().filter((h) => !(h.from === from && h.to === to));
    list.unshift({ from: from, to: to, ts: Date.now() });
    ZJ.Store.set(HIST_KEY, list.slice(0, 20));
  }
  function fmtWhen(ts) {
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    return (sameDay ? '今天 ' : (d.getMonth() + 1) + '/' + d.getDate() + ' ') + ZJ.pad(d.getHours()) + ':' + ZJ.pad(d.getMinutes());
  }

  function renderHistory() {
    const list = history();
    if (!list.length) {
      $('histList').innerHTML = '<div class="empty-block">还没有搜索记录<br>查询一次换乘方案就会自动保存</div>';
      return;
    }
    $('histList').innerHTML = list.map((h, i) =>
      '<div class="hist-row" data-act="hist-open" data-i="' + i + '">' +
      '<div class="hist-main"><b>' + ZJ.esc(h.from) + ' → ' + ZJ.esc(h.to) + '</b><span>' + fmtWhen(h.ts) + '</span></div>' +
      '<button class="hist-del" data-act="hist-del" data-i="' + i + '"><svg class="ico"><use href="#i-trash"/></svg></button>' +
      '</div>').join('');
  }

  /* ---------- 选择器 ---------- */
  function renderSelectors() {
    const fc = $('fromName'), tc = $('toName');
    fc.textContent = G.from || '选择起点站';
    tc.textContent = G.to || '选择终点站';
    fc.classList.toggle('ph', !G.from);
    tc.classList.toggle('ph', !G.to);
  }

  /* ---------- 方案计算 ---------- */
  function makeLeg(dir, fromOrder, toOrder) {
    return {
      line: dir.line,
      dir: dir,
      fromOrder: fromOrder,
      toOrder: toOrder,
      from: dir.stops[fromOrder - 1].name,
      to: dir.stops[toOrder - 1].name,
      stops: toOrder - fromOrder,
      meters: Math.max(0, dir.stops[toOrder - 1].cum - dir.stops[fromOrder - 1].cum),
      minutes: Data.rideMinutes(dir, fromOrder, toOrder),
      key: dir.id + ':' + fromOrder + '-' + toOrder
    };
  }
  function buildPlan(legs) {
    const transfers = Math.max(0, legs.length - 1);
    const ride = legs.reduce((s, l) => s + l.minutes, 0);
    const total = ride + transfers * 5;
    const meters = legs.reduce((s, l) => s + l.meters, 0);
    const stops = legs.reduce((s, l) => s + l.stops, 0);
    return { legs: legs, transfers: transfers, total: total, ride: ride, meters: meters, stops: stops, key: legs.map((l) => l.key).join('>') };
  }
  function dedupe(list) {
    const map = new Map();
    list.forEach((p) => {
      const old = map.get(p.key);
      if (!old || p.total < old.total) map.set(p.key, p);
    });
    return [...map.values()].sort((a, b) => a.transfers - b.transfers || a.total - b.total).slice(0, 6);
  }

  function findDirect(from, to) {
    const out = [];
    const a = Data.stationMap.get(from), b = Data.stationMap.get(to);
    if (!a || !b) return out;
    a.entries.forEach((x) => b.entries.forEach((y) => {
      if (x.dir === y.dir && y.order > x.order) out.push(buildPlan([makeLeg(x.dir, x.order, y.order)]));
    }));
    return dedupe(out);
  }

  function endReach(to) {
    const map = new Map();
    const best = new Map();
    const t = Data.stationMap.get(to);
    if (!t) return { map: map, best: best };
    t.entries.forEach((e) => {
      const d = e.dir;
      for (let o = 1; o < e.order; o++) {
        if (!map.has(d.id)) map.set(d.id, new Map());
        const m = Data.rideMinutes(d, o, e.order);
        const old = map.get(d.id).get(o);
        if (!old || m < old.minutes) map.get(d.id).set(o, { entry: e, minutes: m });
      }
    });
    map.forEach((orders, dirId) => {
      const d = Data.dirs.get(dirId);
      orders.forEach((v, order) => {
        const name = d.stops[order - 1].name;
        const old = best.get(name);
        if (!old || v.minutes < old.minutes) best.set(name, { dir: d, boardOrder: order, entry: v.entry, minutes: v.minutes });
      });
    });
    return { map: map, best: best };
  }

  function findTransfer(from, to, reach) {
    const out = [];
    const a = Data.stationMap.get(from);
    if (!a) return out;
    a.entries.forEach((x) => {
      const d = x.dir;
      for (let o = x.order + 1; o <= d.stops.length; o++) {
        const tName = d.stops[o - 1].name;
        if (tName === to) continue;
        const hub = Data.stationMap.get(tName);
        if (!hub) continue;
        hub.entries.forEach((y) => {
          if (y.dir === d) return;
          const next = (reach.map.get(y.dir.id) || new Map()).get(y.order);
          if (!next) return;
          out.push(buildPlan([makeLeg(d, x.order, o), makeLeg(y.dir, y.order, next.entry.order)]));
        });
      }
    });
    return dedupe(out);
  }

  function findTwoTransfer(from, to, reach) {
    const out = [];
    const a = Data.stationMap.get(from);
    if (!a) return out;
    let stopped = false;
    a.entries.forEach((x) => {
      if (stopped) return;
      const d1 = x.dir;
      for (let o1 = x.order + 1; o1 <= d1.stops.length && !stopped; o1++) {
        const h1 = d1.stops[o1 - 1].name;
        if (h1 === to) continue;
        const s1 = Data.stationMap.get(h1);
        if (!s1) continue;
        s1.entries.forEach((y) => {
          if (stopped || y.dir === d1) return;
          const d2 = y.dir;
          for (let o2 = y.order + 1; o2 <= d2.stops.length; o2++) {
            const h2 = d2.stops[o2 - 1].name;
            if (h2 === from || h2 === to || h2 === h1) continue;
            const c = reach.best.get(h2);
            if (!c || c.entry.dir === d2) continue;
            out.push(buildPlan([makeLeg(d1, x.order, o1), makeLeg(d2, y.order, o2), makeLeg(c.dir, c.boardOrder, c.entry.order)]));
            if (out.length > 200) { stopped = true; return; }
          }
        });
      }
    });
    return dedupe(out);
  }

  function renderTip(msg) {
    $('planResult').innerHTML =
      '<div class="plan-empty tip"><svg class="ico"><use href="#i-route"/></svg><b>' + ZJ.esc(msg) + '</b></div>';
  }

  function renderPrompt() {
    $('planResult').innerHTML =
      '<div class="plan-empty"><svg class="ico"><use href="#i-route"/></svg>' +
      '<b>输入起点和终点</b>点上面两个框，选好站就会自动规划</div>';
  }

  function renderPlans() {
    if (!G.plans.length) {
      $('planResult').innerHTML =
        '<div class="plan-empty"><svg class="ico"><use href="#i-route"/></svg>' +
        '<b>暂无可用方案</b>「' + ZJ.esc(G.from) + '」到「' + ZJ.esc(G.to) + '」没有直达或换乘线路<br>可以换一个邻近站点试试</div>';
      return;
    }
    const tabs = G.plans.map((p, i) =>
      '<button class="plan-tab ' + (i === G.idx ? 'on' : '') + '" data-act="plan-idx" data-i="' + i + '">' +
      '<b>' + (p.transfers === 0 ? '直达' : p.transfers + ' 次换乘') + '</b>' +
      '<span>' + p.legs.map((l) => l.line).join(' › ') + ' · ' + p.total + ' 分钟</span></button>').join('');
    const p = G.plans[G.idx] || G.plans[0];
    const legs = p.legs.map((l, i) => {
      const last = i === p.legs.length - 1;
      return '<div class="leg">' +
        '<div class="leg-top"><span class="leg-badge">' + ZJ.esc(l.line) + '</span>' +
        '<b>' + ZJ.esc(l.from) + ' → ' + ZJ.esc(l.to) + '</b></div>' +
        '<div class="leg-meta">乘 ' + l.stops + ' 站 · 约 ' + l.minutes + ' 分钟 · 往 ' + ZJ.esc(l.dir.end) + '</div>' +
        (last ? '<div class="leg-end">到 <b>' + ZJ.esc(l.to) + '</b> 下车</div>'
          : '<div class="leg-end">在 <b>' + ZJ.esc(l.to) + '</b> 同站换乘</div>') +
        '</div>';
    }).join('');
    const meters = p.meters >= 1000 ? (p.meters / 1000).toFixed(1) + ' 公里' : p.meters + ' 米';
    $('planResult').innerHTML =
      '<div class="plan-tabs">' + tabs + '</div>' +
      '<div class="plan-card plan-cardlink" data-act="plan-open">' +
      '<div class="plan-hero">到目的地还有 <b>' + p.stops + '</b> 站' +
      '<span class="kind' + (p.transfers ? ' tf' : '') + '">' + (p.transfers === 0 ? '直达' : '换乘 ' + p.transfers + ' 次') + '</span></div>' +
      '<div class="plan-sub">约 <b>' + p.total + '</b> 分钟 · ' + ZJ.minHM(ZJ.nowMin() + p.total) + ' 到达 · ' + meters + '</div>' +
      legs +
      '<div class="plan-more">看实时车辆与到站提醒<svg class="ico"><use href="#i-right"/></svg></div>' +
      '</div>';
  }

  function plan() {
    if (!G.from) { ZJ.toast('请先选择起点站'); return; }
    if (!G.to) { ZJ.toast('请先选择终点站'); return; }
    /* 同站：清掉上一次结果，避免显示与当前起终点对不上的方案 */
    if (G.from === G.to) {
      G.plans = []; G.idx = 0; G.computing = false;
      renderTip('起点和终点不能是同一个站，请换一个');
      ZJ.toast('起点和终点不能是同一个站');
      return;
    }
    if (G.computing) return;
    G.tip = '';
    pushHistory(G.from, G.to);
    renderHistory();
    G.computing = true;
    $('planResult').innerHTML = '<div class="plan-empty"><b>正在计算出行方案…</b>直达优先，其次比较换乘次数</div>';
    setTimeout(() => {
      let plans = findDirect(G.from, G.to);
      if (!plans.length) plans = findTransfer(G.from, G.to, endReach(G.to));
      if (!plans.length) plans = findTwoTransfer(G.from, G.to, endReach(G.to));
      G.plans = plans;
      G.idx = 0;
      G.computing = false;
      renderPlans();
      if (plans.length) ZJ.toast('找到 ' + plans.length + ' 个可行方案');
    }, 40);
  }

  function openNearby() {
    const list = ZJ.Geo && ZJ.Geo.state === 'ok' ? Data.nearby(ZJ.Geo.lat, ZJ.Geo.lng, 8) : [];
    if (!list.length) {
      ZJ.toast('还没定位成功，请检查定位权限');
      ZJ.Geo.locate(true).then(() => openNearby()).catch(() => {});
      return;
    }
    ZJ.UI.sheet(
      '<div class="sheet-h"><b>选择附近的站点</b><button class="sheet-x" data-act="close-sheet"><svg class="ico"><use href="#i-close"/></svg></button></div>' +
      '<div class="sheet-body"><div class="pick-stops">' +
      list.map((x) => '<button class="pick-stop" data-act="pick-near" data-name="' + ZJ.esc(x.station.name) + '">' +
        ZJ.esc(x.station.name) + ' · ' + ZJ.distTxt(x.dist) + '</button>').join('') +
      '</div><p class="sheet-note">距离为直线距离估算，仅供参考</p></div>'
    );
  }

  const Go = {
    render() {
      renderSelectors();
      renderHistory();
      if (!G.from || !G.to) renderPrompt();
      else if (!G.plans.length) { if (G.tip) renderTip(G.tip); else renderPrompt(); }
      else renderPlans();
    },
    plan: plan
  };
  ZJ.Go = Go;

  /* ---------- 动作 ---------- */
  function pickEnd(which, name) {
    const other = which === 'from' ? G.to : G.from;
    if (name && name === other) { ZJ.toast('起点和终点不能是同一个站'); return; }
    if (which === 'from') G.from = name; else G.to = name;
    G.tip = '';
    renderSelectors();
    if (G.from && G.to) plan();
  }
  ZJ.act('pick-from', () => ZJ.Picker.open('选择起点站', null, (name) => pickEnd('from', name)));
  ZJ.act('pick-to', () => ZJ.Picker.open('选择终点站', null, (name) => pickEnd('to', name)));
  ZJ.act('pick-my', (el, e) => { if (e) e.stopPropagation(); openNearby(); });
  ZJ.act('swap-stops', (el, e) => {
    if (e) e.stopPropagation();
    const t = G.from; G.from = G.to; G.to = t;
    renderSelectors();
    if (G.from && G.to) plan();
  });
  ZJ.act('plan', () => plan());
  ZJ.act('pick-near', (el) => {
    const name = el.dataset.name;
    if (name === G.to) { ZJ.toast('起点和终点不能是同一个站'); return; }
    G.from = name;
    G.tip = '';
    ZJ.UI.closeSheet();
    renderSelectors();
    ZJ.toast('起点已设为「' + G.from + '」');
    if (G.to) plan();
  });
  ZJ.act('plan-idx', (el, e) => { if (e) e.stopPropagation(); G.idx = +el.dataset.i; renderPlans(); });
  ZJ.act('plan-open', (el, e) => {
    if (e && e.target.closest('.plan-tab')) return;
    const p = G.plans[G.idx] || G.plans[0];
    if (!p) { ZJ.toast('请先生成出行方案'); return; }
    if (!ZJ.Plan || !ZJ.Plan.open) { ZJ.toast('方案详情暂不可用'); return; }
    ZJ.Plan.open(p, G.from, G.to);
  });
  ZJ.act('hist-open', (el) => {
    const h = history()[+el.dataset.i];
    if (!h) return;
    G.from = h.from; G.to = h.to;
    renderSelectors();
    plan();
  });
  ZJ.act('hist-del', (el, e) => {
    if (e) e.stopPropagation();
    const list = history();
    list.splice(+el.dataset.i, 1);
    ZJ.Store.set(HIST_KEY, list);
    renderHistory();
    ZJ.toast('已删除该记录');
  });
  ZJ.act('clear-hist', () => {
    if (!history().length) { ZJ.toast('暂无搜索记录'); return; }
    ZJ.Store.set(HIST_KEY, []);
    renderHistory();
    ZJ.toast('已清空搜索历史');
  });
})();
