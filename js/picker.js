/* 站点选择器：只搜站名（不再按线路展开），支持“附近站点”快捷选择 */
(function () {
  const ZJ = window.ZJ;
  const Data = ZJ.Data;

  const P = { title: '', cb: null, line: '', dirKey: '', q: '', scoped: false, onlyNear: false, near: [] };

  function header() {
    return '<div class="sheet-h"><b>' + ZJ.esc(P.title) + '</b>' +
      '<button class="sheet-x" data-act="close-sheet"><svg class="ico"><use href="#i-close"/></svg></button></div>';
  }

  function nearList() {
    if (!P.near.length) {
      return '<div class="pick-empty">没有取到位置，可以直接输入站名搜索<br>例如「火车站」「西施」</div>';
    }
    return '<div class="near-grp"><div class="lab"><svg class="ico"><use href="#i-walk"/></svg>离我最近的站点</div>' +
      P.near.map((x) => '<button class="near-item" data-act="pick-station" data-name="' + ZJ.esc(x.station.name) + '">' +
        '<b>' + ZJ.esc(x.station.name) + '</b><span class="d">' + ZJ.distTxt(x.dist) + '</span>' +
        '<span class="pick">选它</span></button>').join('') + '</div>';
  }

  function scopedList() {
    const line = Data.lineOf(P.line);
    if (!line) return '<div class="pick-empty">线路不存在</div>';
    const dir = line.dirs.find((d) => d.key === P.dirKey) || line.dirs[0];
    const q = P.q.trim();
    const stops = dir.stops.filter((s) => !q || s.name.indexOf(q) > -1);
    if (!stops.length) return '<div class="pick-empty">本线路没有匹配「' + ZJ.esc(q) + '」的站点<br>试试更短的关键词</div>';
    return '<div class="pick-stops">' + stops.map((s) =>
      '<button class="pick-stop" data-act="pick-station" data-name="' + ZJ.esc(s.name) + '">' +
      s.o + '. ' + ZJ.esc(s.name) + '</button>').join('') + '</div>';
  }

  function searchList() {
    const q = P.q.trim();
    if (!q) return nearList();
    const list = Data.searchStations(q, 40);
    if (!list.length) {
      return '<div class="pick-empty">没有找到包含「' + ZJ.esc(q) + '」的站点<br>换一个关键词试试</div>';
    }
    return '<div class="pick-stops">' + list.map((s) =>
      '<button class="pick-stop" data-act="pick-station" data-name="' + ZJ.esc(s.name) + '">' +
      ZJ.esc(s.name) + ' · 途经 ' + s.entries.length + ' 个方向</button>').join('') + '</div>';
  }

  function listFor() {
    if (P.scoped) return scopedList();
    if (P.onlyNear && !P.q.trim()) return nearList();
    return searchList();
  }

  function renderList() {
    const holder = document.getElementById('pkList');
    if (holder) holder.innerHTML = listFor();
  }

  function loadNear() {
    if (ZJ.Geo && ZJ.Geo.state === 'ok') {
      P.near = (Data.nearby(ZJ.Geo.lat, ZJ.Geo.lng, 5) || []).slice(0, 5);
      return;
    }
    P.near = [];
    if (ZJ.Geo && ZJ.Geo.locate) {
      ZJ.Geo.locate(true).then(() => {
        P.near = (Data.nearby(ZJ.Geo.lat, ZJ.Geo.lng, 5) || []).slice(0, 5);
        if (!P.q.trim()) renderList();
      }).catch(() => {});
    }
  }

  function render() {
    let html = header();
    const ph = P.scoped ? '在本线路内搜索站点' : '输入站点名称，如「火车站」';
    const line = P.scoped ? Data.lineOf(P.line) : null;
    const dir = line && (line.dirs.find((d) => d.key === P.dirKey) || line.dirs[0]);
    html += '<div class="sheet-body">' +
      (dir ? '<div class="fav-lab" style="margin-bottom:8px">' + ZJ.esc(P.line) + ' · 往 ' + ZJ.esc(dir.end) + '</div>' : '') +
      '<div class="sheet-search"><svg class="ico"><use href="#i-search"/></svg>' +
      '<input id="pkQ" type="text" inputmode="search" autocomplete="off" placeholder="' + ph + '" value="' + ZJ.esc(P.q) + '"></div>' +
      '<div id="pkList">' + listFor() + '</div></div>';
    if (ZJ.UI.isSheetOpen && ZJ.UI.isSheetOpen()) ZJ.UI.updateSheet(html); else ZJ.UI.sheet(html);
    const input = document.getElementById('pkQ');
    if (input) {
      input.addEventListener('input', () => {
        P.q = input.value;
        renderList();
      });
      if (!P.onlyNear) {
        try { input.focus({ preventScroll: true }); } catch (e) {}
      }
    }
  }

  function pick(name) {
    const cb = P.cb;
    ZJ.UI.closeSheet();
    if (cb) setTimeout(() => cb(name), 220);
  }

  const Picker = {
    /* open(title, null|{line,dirKey}, cb) */
    open(title, opts, cb) {
      P.title = title || '选择站点';
      P.cb = cb || null;
      P.q = '';
      P.onlyNear = false;
      if (typeof opts === 'string') {
        P.line = opts; P.dirKey = 'up'; P.scoped = true;
      } else if (opts && opts.line) {
        P.line = opts.line; P.dirKey = opts.dirKey || 'up'; P.scoped = true;
      } else {
        P.line = ''; P.dirKey = ''; P.scoped = false;
      }
      if (!P.scoped) loadNear();
      render();
    },
    /* 只展示附近站点（「我的位置」入口） */
    openNearby(title, cb) {
      P.title = title || '附近站点';
      P.cb = cb || null;
      P.q = '';
      P.scoped = false;
      P.onlyNear = true;
      loadNear();
      render();
    }
  };
  ZJ.Picker = Picker;

  ZJ.act('pick-station', (el) => pick(el.dataset.name));
  ZJ.act('close-sheet', () => ZJ.UI.closeSheet());
})();
