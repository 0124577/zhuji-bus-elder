/* 出行：起点/终点站名直查，结果一个列表，卡片直接写「到目的地还有几站」 */
(function () {
  const ZJ = window.ZJ;
  const $ = ZJ.$;
  const Data = ZJ.Data;
  const HIST_KEY = 'zjbus.history.v1';

  const G = {
    from: '', to: '',
    plans: [],
    live: new Map(), /* dirId -> { list, err, at } */
    loading: false,
    tip: '' /* 输入有误时的提示（如起终点相同） */
  };

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
      $('histList').innerHTML = '<div class="empty-block">还没有查询记录<br>输入起点和终点就会自动保存</div>';
      return;
    }
    $('histList').innerHTML = list.map((h, i) =>
      '<div class="hist-row" data-act="hist-open" data-i="' + i + '">' +
      '<div class="hist-main"><b>' + ZJ.esc(h.from) + ' → ' + ZJ.esc(h.to) + '</b><span>' + fmtWhen(h.ts) + '</span></div>' +
      '<button class="hist-del" data-act="hist-del" data-i="' + i + '"><svg class="ico"><use href="#i-trash"/></svg></button>' +
      '</div>').join('');
  }

  /* ---------- 起终点显示 ---------- */
  function renderEnds() {
    const fc = $('fromName'), tc = $('toName');
    fc.textContent = G.from || '输入起点站';
    tc.textContent = G.to || '输入终点站';
    fc.classList.toggle('ph', !G.from);
    tc.classList.toggle('ph', !G.to);
  }

  /* ---------- 方案计算（本地静态数据） ---------- */
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
    const meters = legs.reduce((s, l) => s + l.meters, 0);
    const stops = legs.reduce((s, l) => s + l.stops, 0);
    return {
      legs: legs, transfers: transfers, ride: ride, meters: meters,
      stops: stops, total: ride + transfers * 5,
      key: legs.map((l) => l.key).join('>')
    };
  }
  function dedupe(list, limit) {
    const map = new Map();
    list.forEach((p) => {
      const old = map.get(p.key);
      if (!old || p.total < old.total) map.set(p.key, p);
    });
    return [...map.values()].sort((a, b) => a.transfers - b.transfers || a.total - b.total).slice(0, limit || 6);
  }

  function findDirect(from, to, limit) {
    const out = [];
    const a = Data.stationMap.get(from), b = Data.stationMap.get(to);
    if (!a || !b) return out;
    a.entries.forEach((x) => b.entries.forEach((y) => {
      if (x.dir === y.dir && y.order > x.order) out.push(buildPlan([makeLeg(x.dir, x.order, y.order)]));
    }));
    return dedupe(out, limit);
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

  function findTransfer(from, to, reach, limit) {
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
    return dedupe(out, limit);
  }

  function findTwoTransfer(from, to, reach, limit) {
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
            if (out.length > 160) { stopped = true; return; }
          }
        });
      }
    });
    return dedupe(out, limit);
  }

  /* ---------- 结果渲染（一个列表，卡片先写「到目的地还有几站」） ---------- */
  function promptBox() {
    return '<div class="plan-empty"><svg class="ico"><use href="#i-route"/></svg>' +
      '<b>输入起点和终点</b>点上面两个框，输入站名（如「火车站」）</div>';
  }

  function liveOf(leg) {
    const d = G.live.get(leg.dir.id);
    if (!d) return { txt: '正在获取车辆…', cls: '' };
    if (d.err) return { txt: '实时不可用 · 按静态估算', cls: 'err' };
    if (!d.list.length) return { txt: '暂无车辆 · 按静态估算', cls: 'off' };
    const arr = ZJ.RT.arrivalsTo(leg.dir, d.list, leg.fromOrder);
    if (!arr.length) return { txt: '车辆已过站 · 等下一班', cls: 'off' };
    const b = arr[0];
    if (b.atStation) return { txt: '<b>车已到站</b> · 请到站台等', cls: '' };
    return { txt: '<b>车还有 ' + b.remain + ' 站</b> · 约 ' + b.minutes + ' 分钟', cls: '' };
  }

  function distTxt(m) {
    return m >= 1000 ? (m / 1000).toFixed(1) + ' 公里' : m + ' 米';
  }

  function card(p, i) {
    const live = liveOf(p.legs[0]);
    const lines = p.legs.map((l, k) =>
      (k ? '<span class="res-arrow">›</span>' : '') +
      '<span class="res-badge"><svg class="ico"><use href="#i-bus"/></svg>' + ZJ.esc(l.line) + '</span>').join('');
    const arrive = ZJ.minHM(ZJ.nowMin() + p.total);
    return '<button class="res-card" data-act="plan-open" data-i="' + i + '">' +
      '<div class="res-stops">到目的地还有 <b>' + p.stops + '</b> 站' +
      '<span class="res-kind' + (p.transfers ? ' tf' : '') + '">' +
      (p.transfers === 0 ? '直达' : '换乘 ' + p.transfers + ' 次') + '</span></div>' +
      '<div class="res-sub">约 <b>' + p.total + '</b> 分钟 · ' + arrive + ' 到达 · ' + distTxt(p.meters) + '</div>' +
      '<div class="res-lines">' + lines + '</div>' +
      '<div class="res-live ' + live.cls + '">' +
      (p.legs.length > 1 ? ZJ.esc(p.legs[0].line) + ' · ' : '') + live.txt +
      '<span class="res-go">详情<svg class="ico"><use href="#i-right"/></svg></span></div>' +
      '</button>';
  }

  /* 任一方案第一段取车失败 → 顶部给降级提示与重试（卡片内也有「实时不可用」） */
  function liveFailed() {
    let bad = false;
    G.plans.forEach((p) => {
      const d = G.live.get(p.legs[0].dir.id);
      if (d && d.err) bad = true;
    });
    return bad;
  }

  function renderResult() {
    if (!G.from || !G.to) { $('planResult').innerHTML = promptBox(); return; }
    if (G.tip) {
      $('planResult').innerHTML = '<div class="plan-empty tip"><svg class="ico"><use href="#i-route"/></svg>' +
        '<b>' + ZJ.esc(G.tip) + '</b></div>';
      return;
    }
    if (G.loading) {
      $('planResult').innerHTML = '<div class="plan-empty"><b>正在查询…</b>马上就好</div>';
      return;
    }
    if (!G.plans.length) {
      $('planResult').innerHTML = '<div class="plan-empty"><svg class="ico"><use href="#i-route"/></svg>' +
        '<b>没有找到可坐的车</b>「' + ZJ.esc(G.from) + '」到「' + ZJ.esc(G.to) + '」没有直达或换乘线路<br>换个站名试试</div>';
      return;
    }
    $('planResult').innerHTML =
      (liveFailed()
        ? '<div class="degrade-banner"><svg class="ico"><use href="#i-refresh"/></svg>' +
          '<div><b>实时车辆暂不可用，已按静态数据估算</b><span>站数、耗时与换乘仍可正常查看，恢复后自动更新</span></div>' +
          '<button data-act="go-refresh">重试</button></div>'
        : '') +
      '<div class="res-count">共 ' + G.plans.length + ' 个方案 · 换乘少、时间短的在前</div>' +
      G.plans.map((p, i) => card(p, i)).join('');
  }

  /* ---------- 实时车辆（只查每个方案的第一段） ---------- */
  let busy = false; /* 同一时刻只跑一轮实时请求，避免快速切 Tab 时请求叠加 */
  async function loadLive(force) {
    if (busy) return;
    busy = true;
    try {
      const legs = [];
      const seen = new Set();
      G.plans.forEach((p) => {
        const l = p.legs[0];
        if (!seen.has(l.dir.id)) { seen.add(l.dir.id); legs.push(l); }
      });
      const todo = legs.slice(0, 6);
      if (!todo.length) return;
      await ZJ.batch(todo, 3, async (leg) => {
        if (!force && G.live.has(leg.dir.id)) return;
        try {
          const data = await ZJ.Api.vehicles(leg.dir.id);
          G.live.set(leg.dir.id, { list: ZJ.RT.normalize(leg.dir, data), err: '', at: Date.now() });
        } catch (e) {
          G.live.set(leg.dir.id, { list: [], err: (e && e.message) || '网络异常', at: Date.now() });
        }
      });
    } finally {
      busy = false;
      if ($('page-go') && $('page-go').classList.contains('on')) renderResult();
    }
  }

  /* ---------- 查询 ---------- */
  function plan() {
    if (!G.from) { ZJ.toast('请先输入起点站'); return; }
    if (!G.to) { ZJ.toast('请先输入终点站'); return; }
    /* 同站：清掉上一次的结果，避免显示与当前起终点不符的方案 */
    if (G.from === G.to) {
      G.plans = [];
      G.live = new Map();
      G.tip = '起点和终点不能是同一个站，请换一个站';
      G.loading = false;
      renderResult();
      ZJ.toast('起点和终点不能是同一个站');
      return;
    }
    if (G.loading) return;
    G.tip = '';
    pushHistory(G.from, G.to);
    renderHistory();
    G.loading = true;
    G.live = new Map();
    renderResult();
    setTimeout(() => {
      let list = findDirect(G.from, G.to, 3);
      if (!list.length) {
        list = findTransfer(G.from, G.to, endReach(G.to), 3);
        if (!list.length) list = findTwoTransfer(G.from, G.to, endReach(G.to), 3);
      }
      G.plans = list;
      G.loading = false;
      renderResult();
      loadLive();
      if (!list.length) ZJ.toast('没有找到可坐的车，换个站名试试');
    }, 30);
  }

  let pollTimer = null;
  function pollMs() {
    const s = Number(ZJ.Prefs.get('poll')) || 15;
    return Math.max(5, Math.min(60, s)) * 1000;
  }
  function startPoll() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      const on = $('page-go') && $('page-go').classList.contains('on');
      const fullOpen = document.querySelector('.fullpage.on');
      if (!on || fullOpen || document.visibilityState !== 'visible') return;
      if (G.from && G.to && G.plans.length && !G.loading) loadLive(true);
    }, pollMs());
  }
  startPoll();

  const Go = {
    render() {
      renderEnds();
      renderHistory();
      renderResult();
      if (G.from && G.to && G.plans.length) loadLive(true);
    },
    state() { return G; },
    setEnds(from, to) { G.from = from; G.to = to; G.tip = ''; renderEnds(); },
    /* 供设置页清缓存后调用：清空本页显示 */
    reset() {
      G.plans = []; G.live = new Map(); G.tip = ''; G.loading = false;
      G.from = ''; G.to = '';
      renderEnds(); renderResult();
    }
  };
  ZJ.Go = Go;

  /* 选站：与另一端同名时不覆盖，避免出现「起点=终点」却显示旧方案 */
  function pickEnd(which, name) {
    const other = which === 'from' ? G.to : G.from;
    if (name && name === other) {
      ZJ.toast('起点和终点不能是同一个站');
      return false;
    }
    if (which === 'from') G.from = name; else G.to = name;
    G.tip = '';
    renderEnds();
    if (G.from && G.to) plan();
    return true;
  }

  /* ---------- 动作 ---------- */
  ZJ.act('pick-from', () => ZJ.Picker.open('输入起点站', null, (name) => pickEnd('from', name)));
  ZJ.act('pick-to', () => ZJ.Picker.open('输入终点站', null, (name) => pickEnd('to', name)));
  ZJ.act('pick-my', (el, e) => {
    if (e) e.stopPropagation();
    ZJ.Picker.openNearby('我的位置附近', (name) => pickEnd('from', name));
  });
  ZJ.act('swap-stops', (el, e) => {
    if (e) e.stopPropagation();
    if (!G.from && !G.to) { ZJ.toast('先选起点和终点'); return; }
    const t = G.from; G.from = G.to; G.to = t;
    G.tip = '';
    renderEnds();
    if (G.from && G.to) plan(); else renderResult();
  });
  ZJ.act('plan', () => plan());
  ZJ.act('go-refresh', () => {
    ZJ.Api.resetHealth();
    G.live = new Map();
    renderResult();
    loadLive(true);
    ZJ.toast('正在重新获取实时车辆…');
  });
  ZJ.act('plan-open', (el) => {
    const p = G.plans[Number(el.dataset.i) || 0];
    if (!p) { ZJ.toast('方案已失效，请重新查询'); return; }
    if (!ZJ.Plan || !ZJ.Plan.open) { ZJ.toast('方案详情暂不可用'); return; }
    ZJ.Plan.open(p, G.from, G.to);
  });
  ZJ.act('hist-open', (el) => {
    const h = history()[+el.dataset.i];
    if (!h) return;
    G.from = h.from; G.to = h.to;
    renderEnds();
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
    if (!history().length) { ZJ.toast('暂无查询记录'); return; }
    ZJ.Store.set(HIST_KEY, []);
    renderHistory();
    ZJ.toast('已清空查询记录');
  });
})();
