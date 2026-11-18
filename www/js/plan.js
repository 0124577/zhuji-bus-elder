/* 出行方案详情：竖向换乘流程 + 分段实时公交 + 下车站提醒 */
(function () {
  const ZJ = window.ZJ;
  const $ = ZJ.$;

  const P = {
    plan: null,
    from: '',
    to: '',
    data: new Map(), /* dirId -> { vehicles, err, at, loading } */
    req: 0,
    timer: null
  };

  function legData(leg) {
    return P.data.get(leg.dir.id) || { vehicles: [], err: '', at: 0, loading: !P.data.get(leg.dir.id) };
  }
  function arrivals(leg) {
    const d = legData(leg);
    return d.vehicles.length ? ZJ.RT.arrivalsTo(leg.dir, d.vehicles, leg.fromOrder) : [];
  }
  /* 第一段的车才是「现在要等的车」；换乘段的实时在各段卡片里单独看 */
  function firstBus() {
    const leg = P.plan.legs[0];
    const b = arrivals(leg)[0];
    if (!b) return null;
    return { remain: b.atStation ? 0 : b.remain, minutes: b.minutes, atStation: !!b.atStation, plate: b.v.plate || '', leg: leg, idx: 0 };
  }

  /* ---------------- 顶部：到目的地还有几站 ---------------- */
  function renderHero() {
    const p = P.plan;
    const s = firstBus();
    const anyErr = p.legs.some((l) => legData(l).err);
    const kind = p.transfers === 0 ? '直达' : '换乘 ' + p.transfers + ' 次';
    const hasLive = !!s;

    const d0 = legData(p.legs[0]);
    let line2;
    if (s) {
      line2 = '<i class="live-dot"></i>' + ZJ.esc(s.leg.line) + '：还有 ' + s.remain + ' 站 · 约 ' + s.minutes + ' 分钟到站';
    } else if (!d0.at) {
      line2 = '<i class="live-dot"></i>正在获取实时车辆…';
    } else if (d0.err) {
      line2 = '<i class="live-dot off"></i>实时不可用 · 按静态里程估算';
    } else {
      line2 = '<i class="live-dot off"></i>第一段暂无车 · 按静态里程估算';
    }

    $('plSummary').innerHTML =
      '<div class="pl-hero">' +
      '<div class="pl-hero-l"><span class="pl-hero-t">到目的地还有</span>' +
      '<span class="pl-hero-n">' + p.stops + '<em>站</em></span></div>' +
      '<div class="pl-hero-r"><b>约 ' + p.total + ' 分钟 · ' + ZJ.minHM(ZJ.nowMin() + p.total) + ' 到达</b>' +
      '<span>' + line2 + '</span></div></div>' +
      '<div class="pl-chips">' +
      '<span class="chip">' + kind + '</span>' +
      '<span class="chip">' + p.stops + ' 站</span>' +
      '<span class="chip">' + (p.meters >= 1000 ? (p.meters / 1000).toFixed(1) + ' 公里' : p.meters + ' 米') + '</span>' +
      '<span class="chip">' + p.legs.length + ' 段</span>' +
      (hasLive ? '<span class="chip live">实时</span>' : '') +
      '</div>' +
      bannerFor(anyErr);
  }

  /* 仅接口异常时给降级横幅（无车已在高亮条里说明，避免重复） */
  function bannerFor(anyErr) {
    if (!anyErr) return '';
    return '<div class="degrade-banner"><svg class="ico"><use href="#i-refresh"/></svg>' +
      '<div><b>实时数据暂不可用，已自动降级</b><span>站点、首末班、换乘与提醒地址仍可用，恢复后自动更新</span></div>' +
      '<button data-act="plan-refresh">重试</button></div>';
  }

  /* ---------------- 段落实时块 ---------------- */
  function liveBox(leg) {
    const d = legData(leg);
    if (d.loading && !d.at) {
      return '<div class="fl-hero-live"><span class="num">…</span><span class="txt">正在获取实时车辆…</span></div>';
    }
    if (d.err) {
      return '<div class="fl-hero-live err"><span class="num">实时不可用</span>' +
        '<span class="txt">' + ZJ.esc(d.err) + '<br>已按静态里程估算约 ' + leg.minutes + ' 分钟</span></div>';
    }
    const b = arrivals(leg)[0];
    if (b) {
      const remain = b.atStation ? 0 : b.remain;
      return '<div class="fl-hero-live"><span class="num">' + remain + '<em>站</em></span>' +
        '<span class="txt"><b>' + (b.atStation ? '车已到上车站，请上车' : '到上车站 · 约 ' + b.minutes + ' 分钟') + '</b>' +
        '<br>' + ZJ.esc(b.v.plate || '车辆') + ' · ' + ZJ.esc(ZJ.RT.positionText(leg.dir, b.v)) + '</span></div>';
    }
    const inService = ZJ.isInService(leg.dir);
    return '<div class="fl-hero-live err"><span class="num">暂无车</span>' +
      '<span class="txt">' + (inService ? '此刻暂无开往上车站的车，稍后自动刷新' : '运营时段 ' + ZJ.esc(leg.dir.first) + ' – ' + ZJ.esc(leg.dir.last)) +
      '<br>按静态里程估算乘车约 ' + leg.minutes + ' 分钟</span></div>';
  }

  function seg(leg, i) {
    const d = legData(leg);
    const rm = ZJ.Reminder.find(leg.line, leg.dir.key, leg.to);
    const meters = leg.meters >= 1000 ? (leg.meters / 1000).toFixed(1) + ' 公里' : leg.meters + ' 米';
    const live = liveBox(leg);
    return '<div class="fl-row"><div class="fl-rail"><span class="fl-dot mid"></span><span class="fl-line"></span></div>' +
      '<div class="fl-body"><div class="fl-seg">' +
      '<div class="fl-seg-h"><span class="leg-badge">' + ZJ.esc(leg.line) + '</span>' +
      '<span class="fl-dir">往 ' + ZJ.esc(leg.dir.end) + '</span>' +
      '<button class="fl-bell' + (rm ? ' on' : '') + '" data-act="fl-bell" data-line="' + ZJ.esc(leg.line) +
      '" data-dir="' + ZJ.esc(leg.dir.key) + '" data-station="' + ZJ.esc(leg.to) + '" aria-label="到站提醒">' +
      '<svg class="ico"><use href="#i-bell"/></svg></button></div>' +
      live +
      '<div class="fl-route-meta"><span>乘 <b>' + leg.stops + ' 站</b></span><span><b>' + meters + '</b></span>' +
      '<span>约 <b>' + leg.minutes + ' 分钟</b></span></div>' +
      '<button class="fl-open" data-act="pl-line" data-line="' + ZJ.esc(leg.line) + '" data-dir="' + ZJ.esc(leg.dir.key) +
      '" data-station="' + ZJ.esc(leg.from) + '">查看「' + ZJ.esc(leg.line) + '」全部车辆' +
      '<svg class="ico"><use href="#i-right"/></svg></button>' +
      '</div></div></div>';
  }

  function stopRow(name, tag, sub, dot, last) {
    return '<div class="fl-row"><div class="fl-rail"><span class="fl-dot ' + dot + '"></span>' +
      (last ? '' : '<span class="fl-line"></span>') + '</div>' +
      '<div class="fl-body"><div class="fl-name">' + ZJ.esc(name) + (tag ? '<span class="tag">' + tag + '</span>' : '') + '</div>' +
      (sub ? '<div class="fl-sub">' + sub + '</div>' : '') + '</div></div>';
  }

  function renderFlow() {
    const p = P.plan;
    let html = stopRow(P.from, '起点', '在这里上车', '', false);
    p.legs.forEach((leg, i) => {
      html += seg(leg, i);
      if (i < p.legs.length - 1) {
        html += stopRow(leg.to, '换乘', '同站换乘，预留 5 分钟', 'mid', false);
      }
    });
    html += stopRow(P.to, '终点', '在这里下车，步行前往目的地', 'end', true);
    $('plFlow').innerHTML = '<div class="flow">' + html + '</div>';
  }

  function render() {
    if (!P.plan) return;
    renderHero();
    renderFlow();
  }

  /* ---------------- 数据 ---------------- */
  async function loadAll() {
    if (!P.plan) return;
    const rid = ++P.req;
    P.plan.legs.forEach((leg) => {
      const old = P.data.get(leg.dir.id) || {};
      P.data.set(leg.dir.id, { vehicles: old.vehicles || [], err: '', at: old.at || 0, loading: !old.at });
    });
    render();
    await ZJ.batch(P.plan.legs, 3, async (leg) => {
      try {
        const data = await ZJ.Api.vehicles(leg.dir.id);
        if (rid !== P.req) return;
        P.data.set(leg.dir.id, { vehicles: ZJ.RT.normalize(leg.dir, data), err: '', at: Date.now(), loading: false });
      } catch (e) {
        if (rid !== P.req) return;
        P.data.set(leg.dir.id, { vehicles: [], err: (e && e.message) || '网络异常', at: Date.now(), loading: false });
      }
    });
    if (rid !== P.req) return;
    render();
  }

  function pollMs() {
    const s = Number(ZJ.Prefs.get('poll')) || 15;
    return Math.max(5, Math.min(60, s)) * 1000;
  }
  function startPoll() {
    stopPoll();
    P.timer = setInterval(() => {
      if (document.visibilityState === 'visible' && $('page-plan').classList.contains('on')) loadAll();
    }, pollMs());
  }
  function stopPoll() {
    if (P.timer) clearInterval(P.timer);
    P.timer = null;
  }

  const Plan = {
    open(plan, from, to) {
      if (!plan || !plan.legs || !plan.legs.length) { ZJ.toast('方案信息不完整'); return; }
      P.plan = plan;
      P.from = from || plan.legs[0].from;
      P.to = to || plan.legs[plan.legs.length - 1].to;
      P.data = new Map();
      P.req++;
      $('plTitle').textContent = '出行方案';
      $('plSub').textContent = P.from + ' → ' + P.to + ' · ' + (plan.transfers === 0 ? '直达' : plan.transfers + ' 次换乘');
      $('plSummary').innerHTML = '';
      $('plFlow').innerHTML = '<div class="pl-loading"><span class="spin"></span>正在获取实时车辆…</div>';
      ZJ.UI.openFull('page-plan');
      render();
      loadAll();
      startPoll();
    },
    close() {
      stopPoll();
      P.req++;
      ZJ.UI.closeFull('page-plan');
    },
    refresh() { ZJ.Api.resetHealth(); loadAll(); },
    state() { return P; }
  };
  ZJ.Plan = Plan;

  /* ---------------- 动作 ---------------- */
  ZJ.act('plan-back', () => Plan.close());
  ZJ.act('plan-refresh', () => { ZJ.Api.resetHealth(); loadAll(); ZJ.toast('正在重新获取实时数据…'); });
  ZJ.act('pl-line', (el) => {
    ZJ.Line.open(el.dataset.line, el.dataset.dir, el.dataset.station);
  });
  /* 下车站提醒：点铃铛开/关 */
  ZJ.act('fl-bell', (el) => {
    ZJ.Reminder.openSheet({ line: el.dataset.line, dirKey: el.dataset.dir, station: el.dataset.station }, () => {
      render();
      if (ZJ.Home) ZJ.Home.renderReminders();
    });
  });
})();
