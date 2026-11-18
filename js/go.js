/* 出行：起点/终点直接查（站名搜索），结果同时给出 直达 · 换乘 · 附近可达站点 */
(function () {
  const ZJ = window.ZJ;
  const $ = ZJ.$;
  const Data = ZJ.Data;
  const HIST_KEY = 'zjbus.history.v1';
  const NEAR_RADIUS = 1000;

  const G = {
    from: '', to: '',
    direct: [], transfer: [], near: [],
    live: new Map(), /* dirId -> { list, err, at } */
    loading: false
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

  /* ---------- 附近可达站点（步行 1 公里内） ---------- */
  function nearOf(centerName, otherName) {
    const s = Data.stationMap.get(centerName);
    if (!s || !s.lat || !s.lng) return [];
    const raw = Data.nearby(s.lat, s.lng, 40) || [];
    const out = [];
    raw.forEach((x) => {
      if (x.station.name === centerName) return;
      if (x.dist > NEAR_RADIUS) return;
      if (out.length >= 4) return;
      out.push({
        name: x.station.name,
        dist: x.dist,
        direct: otherName ? findDirect(x.station.name, otherName, 1).length > 0 : false
      });
    });
    return out;
  }

  function buildNear() {
    const list = [];
    const a = nearOf(G.from, G.to);
    const b = nearOf(G.to, G.from);
    if (a.length) list.push({ end: 'from', label: '起点「' + G.from + '」附近', items: a });
    if (b.length) list.push({ end: 'to', label: '终点「' + G.to + '」附近', items: b });
    return list;
  }

  /* ---------- 结果渲染 ---------- */
  function promptBox() {
    return '<div class="plan-empty"><svg class="ico"><use href="#i-route"/></svg>' +
      '<b>输入起点和终点</b>点上面的输入框，输入站名（如「火车站」）<br>马上给出直达车、换乘车和附近站点</div>';
  }

  function liveOf(leg) {
    const d = G.live.get(leg.dir.id);
    if (!d) return { txt: '正在获取实时车辆…', cls: '' };
    if (d.err) return { txt: '实时不可用 · 按静态估算', cls: 'err' };
    if (!d.list.length) return { txt: '暂无车辆 · 按静态估算', cls: '' };
    const arr = ZJ.RT.arrivalsTo(leg.dir, d.list, leg.fromOrder);
    if (!arr.length) return { txt: '车辆已过站 · 等下一班', cls: '' };
    const b = arr[0];
    const remain = b.atStation ? 0 : b.remain;
    return {
      txt: (b.atStation ? '车已到站' : '<b>还有 ' + remain + ' 站</b>') + ' · 约 ' + b.minutes + ' 分钟' + (b.v.plate ? ' · ' + ZJ.esc(b.v.plate) : ''),
      cls: ''
    };
  }

  function card(p, kind, i) {
    const live = liveOf(p.legs[0]);
    const lines = p.legs.map((l, k) =>
      (k ? '<span class="res-arrow">›</span>' : '') +
      '<span class="res-badge"><svg class="ico"><use href="#i-bus"/></svg>' + ZJ.esc(l.line) + '</span>').join('');
    const arrive = ZJ.minHM(ZJ.nowMin() + p.total);
    return '<button class="res-card" data-act="plan-open" data-kind="' + kind + '" data-i="' + i + '">' +
      '<div class="res-top">' +
      '<div class="res-min">' + p.total + '<small>分钟</small></div>' +
      '<div class="res-meta">约 <b>' + arrive + '</b> 到达<br>' + p.stops + ' 站 · ' + (p.meters >= 1000 ? (p.meters / 1000).toFixed(1) + ' 公里' : p.meters + ' 米') + '</div>' +
      '<span class="res-kind">' + (p.transfers === 0 ? '直达' : '换乘 ' + p.transfers + ' 次') + '</span>' +
      '</div>' +
      '<div class="res-lines">' + lines + '</div>' +
      '<div class="res-live ' + live.cls + '"><svg class="ico"><use href="#i-bus"/></svg>' +
      '<span>' + (p.legs.length > 1 ? ZJ.esc(p.legs[0].line) + ' ' : '') + live.txt + '</span>' +
      '<span class="res-go">详情<svg class="ico"><use href="#i-right"/></svg></span></div>' +
      '</button>';
  }

  function nearSec(groups) {
    if (!groups.length) return '';
    const body = groups.map((g) =>
      '<div class="near-grp"><div class="lab"><svg class="ico"><use href="#i-walk"/></svg>' +
      ZJ.esc(g.label) + ' · 步行 1 公里内</div>' +
      g.items.map((x) =>
        '<button class="near-item" data-act="near-set" data-end="' + g.end + '" data-name="' + ZJ.esc(x.name) + '">' +
        '<b>' + ZJ.esc(x.name) + '</b>' +
        '<span class="d">' + ZJ.distTxt(x.dist) + '</span>' +
        (x.direct ? '<span class="ok">有直达</span>' : '') +
        '<span class="pick">设为' + (g.end === 'from' ? '起点' : '终点') + '</span>' +
        '</button>').join('') +
      '</div>').join('');
    return '<section class="res-sec"><div class="res-h"><b>附近可达站点</b><span>走几步就能坐车</span></div>' +
      '<p class="tip-line">换乘不方便时，可以改用附近站点试试</p>' + body + '</section>';
  }

  function renderResult() {
    if (!G.from || !G.to) { $('planResult').innerHTML = promptBox(); return; }
    if (G.loading) {
      $('planResult').innerHTML = '<div class="plan-empty"><b>正在查询…</b>直达优先，其次换乘，最后给附近站点</div>';
      return;
    }
    G.near = buildNear();
    let html = '';
    if (G.direct.length) {
      html += '<section class="res-sec"><div class="res-h"><b>直达方案</b><span>' + G.direct.length + ' 个 · 不用换车</span></div>' +
        G.direct.map((p, i) => card(p, 'direct', i)).join('') + '</section>';
    }
    if (G.transfer.length) {
      html += '<section class="res-sec"><div class="res-h"><b>换乘方案</b><span>' + G.transfer.length + ' 个 · 时间从短到长</span></div>' +
        G.transfer.map((p, i) => card(p, 'transfer', i)).join('') + '</section>';
    }
    if (!G.direct.length && !G.transfer.length) {
      html += '<div class="plan-empty"><svg class="ico"><use href="#i-route"/></svg>' +
        '<b>没有找到直通车</b>「' + ZJ.esc(G.from) + '」到「' + ZJ.esc(G.to) + '」暂时没有直达或换乘线路<br>看看下面的附近站点吧</div>';
    }
    html += nearSec(G.near);
    $('planResult').innerHTML = html;
  }

  /* ---------- 实时车辆（只查每个方案的第一段） ---------- */
  async function loadLive() {
    const legs = [];
    const seen = new Set();
    G.direct.concat(G.transfer).forEach((p) => {
      const l = p.legs[0];
      if (!seen.has(l.dir.id)) { seen.add(l.dir.id); legs.push(l); }
    });
    const todo = legs.slice(0, 6);
    if (!todo.length) return;
    await ZJ.batch(todo, 3, async (leg) => {
      if (G.live.has(leg.dir.id)) return;
      try {
        const data = await ZJ.Api.vehicles(leg.dir.id);
        G.live.set(leg.dir.id, { list: ZJ.RT.normalize(leg.dir, data), err: '', at: Date.now() });
      } catch (e) {
        G.live.set(leg.dir.id, { list: [], err: (e && e.message) || '网络异常', at: Date.now() });
      }
    });
    if ($('page-go') && $('page-go').classList.contains('on')) renderResult();
  }

  /* ---------- 查询 ---------- */
  function plan() {
    if (!G.from) { ZJ.toast('请先输入起点站'); return; }
    if (!G.to) { ZJ.toast('请先输入终点站'); return; }
    if (G.from === G.to) { ZJ.toast('起点和终点不能是同一个站'); return; }
    pushHistory(G.from, G.to);
    renderHistory();
    G.loading = true;
    G.live = new Map();
    renderResult();
    setTimeout(() => {
      G.direct = findDirect(G.from, G.to, 3);
      G.transfer = G.direct.length ? [] : findTransfer(G.from, G.to, endReach(G.to), 3);
      if (!G.direct.length && !G.transfer.length) {
        G.transfer = findTwoTransfer(G.from, G.to, endReach(G.to), 3);
      }
      G.loading = false;
      renderResult();
      loadLive();
      const n = G.direct.length + G.transfer.length;
      if (n) ZJ.toast('找到 ' + n + ' 个方案');
      else ZJ.toast('没有直通车，看看附近站点');
    }, 30);
  }

  const Go = {
    render() {
      renderEnds();
      renderHistory();
      renderResult();
      if (G.from && G.to && (G.direct.length || G.transfer.length)) loadLive();
    },
    state() { return G; },
    setEnds(from, to) { G.from = from; G.to = to; }
  };
  ZJ.Go = Go;

  /* ---------- 动作 ---------- */
  ZJ.act('pick-from', () => ZJ.Picker.open('输入起点站', null, (name) => {
    G.from = name; renderEnds();
    if (G.to && G.to !== G.from) plan();
  }));
  ZJ.act('pick-to', () => ZJ.Picker.open('输入终点站', null, (name) => {
    G.to = name; renderEnds();
    if (G.from && G.from !== G.to) plan();
  }));
  ZJ.act('pick-my', (el, e) => {
    if (e) e.stopPropagation();
    ZJ.Picker.openNearby('我的位置附近', (name) => {
      G.from = name; renderEnds();
      if (G.to && G.to !== G.from) plan();
    });
  });
  ZJ.act('swap-stops', (el, e) => {
    if (e) e.stopPropagation();
    const t = G.from; G.from = G.to; G.to = t;
    renderEnds();
    if (G.from && G.to) plan();
  });
  ZJ.act('plan', () => plan());
  ZJ.act('near-set', (el) => {
    const name = el.dataset.name;
    if (el.dataset.end === 'from') G.from = name; else G.to = name;
    renderEnds();
    ZJ.toast((el.dataset.end === 'from' ? '起点' : '终点') + '已改为「' + name + '」');
    plan();
  });
  ZJ.act('plan-open', (el) => {
    const kind = el.dataset.kind;
    const i = Number(el.dataset.i) || 0;
    const p = (kind === 'direct' ? G.direct : G.transfer)[i];
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
