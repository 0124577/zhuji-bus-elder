/* 站点选择器：线路展开 / 站名搜索（统一组件，两个 Tab 共用） */
(function () {
  const ZJ = window.ZJ;
  const Data = ZJ.Data;

  const P = { title: '', cb: null, line: '', dirKey: '', tab: 'tree', q: '', expanded: '', scoped: false };

  function header() {
    return '<div class="sheet-h"><b>' + ZJ.esc(P.title) + '</b>' +
      '<button class="sheet-x" data-act="close-sheet"><svg class="ico"><use href="#i-close"/></svg></button></div>';
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

  function treeList() {
    const q = P.q.trim();
    const list = Data.searchLines(q, 60);
    if (!list.length) {
      return '<div class="pick-empty">没有匹配「' + ZJ.esc(q) + '」的线路<br>' +
        (q ? '<button class="mini" style="margin-top:10px;height:34px;padding:0 14px" data-act="pick-to-search">改搜站点「' + ZJ.esc(q) + '」</button>' : '输入线路号可快速定位') +
        '</div>';
    }
    let html = '';
    list.forEach((l) => {
      const open = P.expanded === l.name;
      html += '<button class="pick-line ' + (open ? 'open' : '') + '" data-act="pick-line" data-name="' + ZJ.esc(l.name) + '">' +
        '<b>' + ZJ.esc(l.name) + '</b><span>' + l.dirs.length + ' 个方向</span>' +
        '<svg class="ico"><use href="#i-right"/></svg></button>';
      if (open) {
        l.dirs.forEach((d) => {
          html += '<div class="pick-stops" style="padding:4px 0 8px">' +
            '<div class="fav-lab" style="padding-left:30px">往 ' + ZJ.esc(d.end) + '（' + d.stops.length + ' 站）</div>' +
            d.stops.map((s) => '<button class="pick-stop" data-act="pick-station" data-name="' + ZJ.esc(s.name) + '">' +
              s.o + '. ' + ZJ.esc(s.name) + '</button>').join('') +
            '</div>';
        });
      }
    });
    if (!q && Data.lines.length > 60) html += '<div class="pick-empty" style="padding:14px">共 ' + Data.lines.length + ' 条线路，输入线路号可快速定位</div>';
    return html;
  }

  function searchList() {
    const q = P.q.trim();
    if (!q) return '<div class="pick-empty">输入站点名称，如「火车站」「西施」<br>支持中文模糊匹配</div>';
    const list = Data.searchStations(q, 40);
    if (!list.length) return '<div class="pick-empty">没有找到包含「' + ZJ.esc(q) + '」的站点<br>换一个关键词试试</div>';
    return '<div class="pick-stops">' + list.map((s) =>
      '<button class="pick-stop" data-act="pick-station" data-name="' + ZJ.esc(s.name) + '">' +
      ZJ.esc(s.name) + ' · 途经 ' + s.entries.length + ' 个方向</button>').join('') + '</div>';
  }

  function listFor() {
    if (P.scoped) return scopedList();
    return P.tab === 'tree' ? treeList() : searchList();
  }

  function renderList() {
    const holder = document.getElementById('pkList');
    if (holder) holder.innerHTML = listFor();
  }

  function render() {
    let html = header();
    if (P.scoped) {
      const line = Data.lineOf(P.line);
      const dir = line && (line.dirs.find((d) => d.key === P.dirKey) || line.dirs[0]);
      html += '<div class="sheet-body">' +
        (dir ? '<div class="fav-lab" style="margin-bottom:8px">' + ZJ.esc(P.line) + ' · 往 ' + ZJ.esc(dir.end) + '</div>' : '') +
        '<div class="sheet-search"><svg class="ico"><use href="#i-search"/></svg>' +
        '<input id="pkQ" type="text" placeholder="在本线路内搜索站点" value="' + ZJ.esc(P.q) + '"></div>' +
        '<div id="pkList">' + listFor() + '</div></div>';
    } else {
      html += '<div class="sheet-tabs">' +
        '<button class="sheet-tab ' + (P.tab === 'tree' ? 'on' : '') + '" data-act="pick-tab" data-tab="tree">线路展开</button>' +
        '<button class="sheet-tab ' + (P.tab === 'search' ? 'on' : '') + '" data-act="pick-tab" data-tab="search">搜索站点</button>' +
        '</div><div class="sheet-body">' +
        '<div class="sheet-search"><svg class="ico"><use href="#i-search"/></svg>' +
        '<input id="pkQ" type="text" placeholder="' + (P.tab === 'tree' ? '输入线路号，如 23、105' : '输入站点名称，如 火车站') + '" value="' + ZJ.esc(P.q) + '"></div>' +
        '<div id="pkList">' + listFor() + '</div></div>';
    }
    if (ZJ.UI.isSheetOpen && ZJ.UI.isSheetOpen()) ZJ.UI.updateSheet(html); else ZJ.UI.sheet(html);
    const input = document.getElementById('pkQ');
    if (input) {
      input.addEventListener('input', () => {
        P.q = input.value;
        /* 线路 Tab 里输入的是站名时，自动切到站名搜索，避免“查不到线路”的困惑 */
        if (!P.scoped && P.tab === 'tree' && P.q.trim() && !/^[0-9]/.test(P.q.trim()) &&
            ZJ.Data.searchStations(P.q, 1).length && !ZJ.Data.searchLines(P.q, 1).length) {
          P.tab = 'search';
          const q = P.q;
          render();
          const again = document.getElementById('pkQ');
          if (again) { again.focus(); again.setSelectionRange(q.length, q.length); }
          return;
        }
        renderList();
      });
      /* 站名搜索 Tab 自动聚焦，省一次点击（线路 Tab 不弹键盘，避免挡列表） */
      if (!P.scoped && P.tab === 'search') {
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
      P.expanded = '';
      if (typeof opts === 'string') {
        P.line = opts; P.dirKey = 'up'; P.scoped = true;
      } else if (opts && opts.line) {
        P.line = opts.line; P.dirKey = opts.dirKey || 'up'; P.scoped = true;
      } else {
        P.line = ''; P.dirKey = ''; P.scoped = false;
      }
      P.tab = 'tree';
      render();
    }
  };
  ZJ.Picker = Picker;

  ZJ.act('pick-to-search', () => { P.tab = 'search'; render(); });
  ZJ.act('pick-tab', (el) => {
    P.tab = el.dataset.tab;
    P.q = '';
    P.expanded = '';
    render();
  });
  ZJ.act('pick-line', (el) => {
    P.expanded = P.expanded === el.dataset.name ? '' : el.dataset.name;
    renderList();
    const open = document.querySelector('#sheet .pick-line.open');
    if (open) open.scrollIntoView({ block: 'nearest' });
  });
  ZJ.act('pick-station', (el) => pick(el.dataset.name));
  ZJ.act('close-sheet', () => ZJ.UI.closeSheet());
})();
