/* 瓜瓜去哪儿 — 手機版前端（依 gb.pdf）；中英文介面
 * 只負責「輸入 → 呼叫引擎 → 畫結構化結果」；所有路線計算在 engine.js。輸出契約見 docs/API-spec-v0.md。
 * 流程：首頁 —[路線生成]→ 總覽 —[確定行程]→ 逐段步驟（每段一頁）—[下一步]…[結束]→ 首頁。
 * 只有白色按鈕能前進到下一頁（鍵盤 Enter 只用來選站，不會送出）。 */
(function () {
  'use strict';
  var E = MetroEngine.createEngine(window.METRO_DATA);
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- 儲存（只存偏好，失敗不影響使用） ---------- */
  function load(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 無痕或停用儲存 */ } }

  /* ---------- 語言（中／英）：預設依瀏覽器語言，使用者切換後記住 ---------- */
  var LANG = load('gg.lang', null) || (String(navigator.language || '').toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en');
  var STR = {
    zh: {
      title: '瓜瓜去哪儿', homeTitle: '瓜瓜<br>去哪<small>儿</small>', homeSub: '輸入起站迄站,給你最佳搭乘路線',
      modes: '選擇需求設施', el: '電梯', es: '手扶梯', phFrom: '輸入起站', phTo: '輸入迄站', fromLabel: '起站', toLabel: '迄站',
      go: '路線生成', swap: '對調起站與迄站', langBtn: 'EN', langAria: '切換成英文介面',
      all: '全部', recent: '最近查詢', noMatch: function (q) { return '找不到「' + q + '」'; }, noStations: '沒有車站',
      needFrom: '請輸入起站', needTo: '請輸入迄站',
      badFrom: function (q) { return '找不到起站「' + q + '」，請從建議中選擇'; }, badTo: function (q) { return '找不到迄站「' + q + '」，請從建議中選擇'; },
      same: '起站與迄站相同', noRoute: '找不到可行的路線', unknown: '找不到這個站名', fail: '無法產生路線，請稍後再試',
      best: '最佳<br>路線', about: '約', minUnit: '分', to: '往', transfer: '轉乘', exit: '出站',
      confirm: '確定行程', next: '下一步', done: '結束',
      fac1: '電梯', fac2: '電梯／手扶梯',
      noRec1: '此段沒有車廂建議,', noRec2: '請依站內指引搭乘',
      board: function (n) { return '搭乘第 ' + n + ' 節車廂,'; },
      unkExit: function (f) { return '下車站' + f + '位置請依站內指引'; },
      nearExit: function (f) { return f + ' 將在下車處附近'; },
      nearCar: function (f, l) { return f + ' 在第 ' + l + ' 節車廂附近'; },
      mirrored: '※ 車廂位置為推算，尚未現場核對',
      platform: function (x) { return '往 ' + x + ' 方向月台'; },
      exitN: function (n) { return '出口' + n; }, sep: '、', joinExit: ' , ',
      alertNote: '注意', alertNoElev: function (f, where) { return '此路線經過沒有' + f + '的月台' + (where ? '：' + where : '') + '，請先向站務人員確認。'; },
      alertAnomaly: '電梯異常公告',
      foot: '時間、車廂為預估，電梯以車站現場公告為準',
      carsAria: function (n, on) { return '共 ' + n + ' 節車廂' + (on ? '，建議搭第 ' + on + ' 節' : ''); },
      liveBest: function (m) { return '最佳路線約 ' + m + ' 分鐘'; }, liveStep: function (k, n) { return '第 ' + k + ' 段，共 ' + n + ' 段'; },
      routeAria: function (a, b) { return '從' + a + '到' + b; },
      eta: '到站時間', etaEst: '預估', lastTrain: '末班車已過', depAt: '發車', soon: '即將進站', minUnitEta: ' 分', liveTag: '即時'
    },
    en: {
      title: "Where to, Guagua?", homeTitle: 'Where to,<br>Guagua?', homeSub: 'Enter your origin and destination for the best route',
      modes: 'Facilities needed', el: 'Elevator', es: 'Escalator', phFrom: 'From station', phTo: 'To station', fromLabel: 'From station', toLabel: 'To station',
      go: 'Find route', swap: 'Swap origin and destination', langBtn: '中', langAria: 'Switch to Chinese',
      all: 'All', recent: 'Recent', noMatch: function (q) { return 'No match for "' + q + '"'; }, noStations: 'No stations',
      needFrom: 'Enter an origin station', needTo: 'Enter a destination station',
      badFrom: function (q) { return 'Origin "' + q + '" not found. Pick one from the list.'; }, badTo: function (q) { return 'Destination "' + q + '" not found. Pick one from the list.'; },
      same: 'Origin and destination are the same', noRoute: 'No route found', unknown: 'Station not found', fail: 'Could not plan a route. Try again later.',
      best: 'Best<br>Route', about: 'About', minUnit: ' min', to: 'to', transfer: 'Transfer', exit: 'Exit',
      confirm: 'Confirm trip', next: 'Next', done: 'Done',
      fac1: 'elevator', fac2: 'elevator/escalator',
      noRec1: 'No car suggestion for this leg,', noRec2: 'follow the in-station signs',
      board: function (n) { return 'Board car ' + n + ','; },
      unkExit: function (f) { return 'check the in-station signs for the ' + f + ' at your exit station'; },
      nearExit: function (f) { return 'the ' + f + ' is near where you get off'; },
      nearCar: function (f, l) { return 'the ' + f + ' is near car ' + l; },
      mirrored: '※ Car position is estimated, not yet verified on site',
      platform: function (x) { return 'Platform toward ' + x; },
      exitN: function (n) { return 'Exit ' + n; }, sep: ', ', joinExit: ', ',
      alertNote: 'Note', alertNoElev: function (f, where) { return 'This route passes a platform with no ' + f + (where ? ' (' + where + ')' : '') + '. Please check with station staff first.'; },
      alertAnomaly: 'Elevator outage notice',
      foot: 'Times and cars are estimates. Follow on-site notices for elevator status.',
      carsAria: function (n, on) { return n + ' cars' + (on ? ', suggested car ' + on : ''); },
      liveBest: function (m) { return 'Best route, about ' + m + ' minutes'; }, liveStep: function (k, n) { return 'Leg ' + k + ' of ' + n; },
      routeAria: function (a, b) { return 'From ' + a + ' to ' + b; },
      eta: 'Arrival in', etaEst: 'est.', lastTrain: 'Last train has left', depAt: 'dep.', soon: 'Arriving now', minUnitEta: ' min', liveTag: 'live'
    }
  };
  function t(k, a, b) { var s = STR[LANG][k]; if (s == null) s = STR.zh[k]; return typeof s === 'function' ? s(a, b) : s; }
  var EN = window.STATION_EN || {};                                   // 站名英文譯名（TDX）
  var LINE_EN = { '文湖線': 'Wenhu Line', '淡水信義線': 'Tamsui–Xinyi Line', '松山新店線': 'Songshan–Xindian Line', '中和新蘆線': 'Zhonghe–Xinlu Line', '板南線': 'Bannan Line' };
  function sname(name) { return LANG === 'en' ? (EN[name] || name) : name; }      // 主要顯示的站名
  function ssub(name) { return LANG === 'en' ? name : (EN[name] || ''); }          // 底下／右邊的譯名
  function lname(l) { return LANG === 'en' ? (LINE_EN[l] || l) : l; }
  function lshort(l) { return LANG === 'en' ? (LINE_EN[l] || l).replace(' Line', '') : l.replace('線', ''); }

  /* ---------- 線色（站名底色；轉乘站為兩線漸層） ---------- */
  var LINE_COLOR = { '板南線': 'var(--bl)', '文湖線': 'var(--br)', '淡水信義線': 'var(--r)', '松山新店線': 'var(--g)', '中和新蘆線': 'var(--o)' };

  var ST = new Map();
  E.stations().forEach(function (s) { ST.set(s.name, s); });

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function norm(s) { return String(s || '').replace(/臺/g, '台').replace(/\s+/g, '').replace(/站$/, '').toUpperCase(); }
  function codeOf(name, line) { var s = ST.get(name); if (!s || !s.lines[0]) return ''; var l = line && s.lines.filter(function (x) { return x.line === line; })[0]; return (l || s.lines[0]).code; }
  function spacing(name) { if (LANG === 'en') return 0; var n = Array.from(name || '').length; return n <= 3 ? .5 : n === 4 ? .25 : 0; }

  /* 站名輸入解析：中文（含臺／台、有無「站」）或英文站名（不分大小寫）皆可 */
  var EN_INDEX = {};
  Object.keys(EN).forEach(function (zh) { EN_INDEX[norm(EN[zh]).replace(/STATION$/, '')] = zh; });
  function resolveAny(text) {
    var r = E.resolveStation(text); if (r && r.name) return r;
    var n = norm(text).replace(/STATION$/, ''); if (n && EN_INDEX[n]) return { name: EN_INDEX[n] };
    return { name: null };
  }

  /* 站名底色：單一路線＝該線色；轉乘站＝兩線過渡漸層，firstLine 為左側（先到的那條線） */
  function bgOf(name, firstLine) {
    var s = ST.get(name), ls = [];
    if (s) s.lines.forEach(function (l) { if (ls.indexOf(l.line) < 0) ls.push(l.line); });
    if (firstLine && ls.indexOf(firstLine) > 0) { ls.splice(ls.indexOf(firstLine), 1); ls.unshift(firstLine); }
    var cs = ls.map(function (l) { return LINE_COLOR[l] || '#777'; });
    if (cs.length < 2) return cs[0] || '#777';
    return 'linear-gradient(90deg,' + cs.join(',') + ')';
  }
  /* 底色規則：有 toLine（此站要換車）→ firstLine→toLine 漸層；只有 firstLine（不換車）→ 搭乘線單色。
     方塊內：站名在上、譯名在下（中文介面＝英文譯名；英文介面＝中文站名）。 */
  function pill(name, firstLine, toLine) {
    var bg = toLine ? 'linear-gradient(90deg,' + LINE_COLOR[firstLine] + ',' + LINE_COLOR[toLine] + ')' : firstLine ? LINE_COLOR[firstLine] || '#777' : bgOf(name, null);
    var sub = ssub(name);
    return '<span class="pill' + (LANG === 'en' ? ' en' : '') + '" style="background:' + bg + '"><span class="pn">' + esc(sname(name)) + '</span>' + (sub ? '<span class="ps">' + esc(sub) + '</span>' : '') + '</span>';
  }

  var state = { from: null, to: null, route: null, result: null, mode: 'wheel', k: 0 };

  /* ---------- 畫面切換（一次一頁，每頁滿屏） ---------- */
  var screens = { home: $('home'), overview: $('overview'), step: $('step') };
  function show(name, push) {
    if (name !== 'step') stopEta();
    Object.keys(screens).forEach(function (n) { var el = screens[n]; el.classList.remove('active', 'enter'); });
    var el = screens[name];
    el.classList.add('active'); void el.offsetWidth; el.classList.add('enter');
    var h = el.querySelector('h1'); (h || el).focus({ preventScroll: true });
    var sc = el.querySelector('.scroll, .step-body'); if (sc) sc.scrollTop = 0;
    if (push) { try { history.pushState({ screen: name, k: state.k }, '', '#' + name); } catch (e) { /* file:// 等環境 */ } }
  }
  window.addEventListener('popstate', function (ev) {
    var s = ev.state;
    if (!s || s.screen === 'home' || !state.route) { show('home'); return; }
    state.k = s.k || 0;
    if (s.screen === 'overview') renderOverview(); else renderStep();
    show(s.screen);
  });

  /* ---------- 首頁：欄位與站名選單 ---------- */
  var COARSE = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
  var F = {
    from: { input: $('i-from'), code: $('c-from'), field: $('f-from'), list: $('l-from'), items: [], active: -1 },
    to: { input: $('i-to'), code: $('c-to'), field: $('f-to'), list: $('l-to'), items: [], active: -1 }
  };

  /* 下拉選單：與 annotator 的「路線分類展示」相同——上方篩選鈕（全部＋各線），下方依線分組，站碼由小到大；轉乘站在各線底下各出現一次 */
  var LINES = ['文湖線', '淡水信義線', '松山新店線', '中和新蘆線', '板南線'];
  var LINE_VAR = { '文湖線': 'var(--br)', '淡水信義線': 'var(--r)', '松山新店線': 'var(--g)', '中和新蘆線': 'var(--o)', '板南線': 'var(--bl)' };
  var codeNum = function (c) { var m = String(c).match(/(\d+)([A-Z]?)/); return m ? +m[1] * 10 + (m[2] ? m[2].charCodeAt(0) - 64 : 0) : 0; };
  var ROWS = [];
  LINES.forEach(function (l) {
    var rows = [];
    ST.forEach(function (s) { s.lines.forEach(function (x) { if (x.line === l) rows.push({ n: s.name, l: l, code: x.code }); }); });
    rows.sort(function (a, b) { return codeNum(a.code) - codeNum(b.code); });
    ROWS = ROWS.concat(rows);
  });
  var listFilter = 'all';
  function visibleRows(q) {
    q = norm(q);
    return ROWS.filter(function (r) {
      if (listFilter !== 'all' && r.l !== listFilter) return false;
      return !q || norm(r.n).indexOf(q) >= 0 || norm(EN[r.n] || '').indexOf(q) >= 0 || r.code.toUpperCase().indexOf(q) === 0;
    });
  }

  function setField(w, name) {
    var f = F[w];
    state[w] = name || null;
    f.input.value = name ? sname(name) : '';
    f.code.textContent = name ? codeOf(name) : '';
    f.field.classList.toggle('resolved', !!name);
    var sp = name ? spacing(sname(name)) : 0;
    f.input.style.letterSpacing = sp ? sp + 'em' : '';
    f.input.style.marginRight = sp ? -sp + 'em' : '';
  }

  /* 選單列：站碼＋主名稱＋譯名（中文介面：英文在右；英文介面：中文在右） */
  function optRow(f, idx, n, code, cur) {
    var sub = ssub(n);
    return '<li role="option" id="' + f.list.id + '-' + idx + '" aria-selected="false"' + (cur ? ' class="cur" aria-current="true"' : '') + '><span class="code">' + esc(code) + '</span><span class="nm">' + esc(sname(n)) + '</span>' + (sub ? '<span class="tr">' + esc(sub) + '</span>' : '') + '</li>';
  }
  function renderList(w) {
    /* 已選好站、還沒改字時，不拿站名當關鍵字（否則只剩那一站，無法換選）；使用者開始輸入才篩選 */
    var f = F[w], q = f.dirty ? f.input.value : '', items = [], html = '';
    html += '<li class="chips" role="presentation">' + ['all'].concat(LINES).map(function (l) {
      return '<button type="button" class="chip' + (listFilter === l ? ' on' : '') + '" data-f="' + l + '" tabindex="-1">' +
        (l === 'all' ? esc(t('all')) : '<i style="background:' + LINE_VAR[l] + '"></i>' + esc(lshort(l))) + '</button>';
    }).join('') + '</li>';
    if (!q.trim() && listFilter === 'all') {
      var rec = load('gg.recent', []).filter(function (n) { return ST.has(n); }).slice(0, 4);
      if (rec.length) {
        html += '<li class="lh recent" role="presentation">' + esc(t('recent')) + '</li>';
        rec.forEach(function (n) { items.push(n); html += optRow(f, items.length - 1, n, codeOf(n), false); });
      }
    }
    var last = '', rows = visibleRows(q);
    rows.forEach(function (r) {
      if (r.l !== last) { last = r.l; html += '<li class="lh" role="presentation" style="background:' + LINE_VAR[r.l] + '">' + esc(lname(r.l)) + '</li>'; }
      items.push(r.n);
      html += optRow(f, items.length - 1, r.n, r.code, state[w] === r.n);
    });
    if (!rows.length) html += '<li class="none" role="presentation">' + esc(q.trim() ? t('noMatch', q.trim()) : t('noStations')) + '</li>';
    f.items = items; f.active = -1;
    f.list.innerHTML = html;
    f.list.classList.add('open');
    f.input.setAttribute('aria-expanded', 'true');
    place(w);
    f.list.scrollTop = 0;   /* 剛展開一律停在最上面（不跳到已選站）；之後使用者自己滑動不受限 */
    document.querySelector('.app').classList.toggle('kb', COARSE);
  }
  /* 選單的方向與最大高度：以 visualViewport（扣掉鍵盤）與外框的交集為準；下方空間不足就改往上開 */
  function place(w) {
    var f = F[w]; if (!f.list.classList.contains('open')) return;
    var vv = window.visualViewport, vt = vv ? vv.offsetTop : 0, vb = vt + (vv ? vv.height : innerHeight);
    var fr = document.querySelector('.frame').getBoundingClientRect(), fb = f.field.getBoundingClientRect();
    var lo = Math.max(fr.top, vt) + 8, hi = Math.min(fr.bottom, vb) - 8;
    var below = hi - fb.bottom - 8, above = fb.top - lo - 8, up = below < 190 && above > below;
    f.list.classList.toggle('up', up);
    f.list.style.setProperty('--mh', Math.max(110, Math.floor(up ? above : below)) + 'px');
  }
  function closeList(w) { var f = F[w]; f.list.classList.remove('open'); f.input.setAttribute('aria-expanded', 'false'); f.input.removeAttribute('aria-activedescendant'); if (!F.from.list.classList.contains('open') && !F.to.list.classList.contains('open')) document.querySelector('.app').classList.remove('kb'); }
  function move(w, d) {
    var f = F[w]; if (!f.items.length) return;
    f.active = (f.active + d + f.items.length) % f.items.length;
    Array.prototype.forEach.call(f.list.querySelectorAll('[role=option]'), function (li, i) { li.setAttribute('aria-selected', i === f.active ? 'true' : 'false'); if (i === f.active) li.scrollIntoView({ block: 'nearest' }); });
    f.input.setAttribute('aria-activedescendant', f.list.id + '-' + f.active);
  }
  function choose(w, name) {
    setField(w, name); closeList(w); setErr('');
    if (w === 'from' && !state.to) F.to.input.focus(); else F[w].input.blur();
  }
  var errKey = null;
  function setErr(msg) { $('err').textContent = msg || ''; }

  ['from', 'to'].forEach(function (w) {
    var f = F[w];
    f.input.addEventListener('focus', function () { f.dirty = false; closeList(w === 'from' ? 'to' : 'from'); f.field.classList.remove('resolved'); f.input.style.letterSpacing = ''; f.input.style.marginRight = ''; f.input.select(); renderList(w); setTimeout(function () { f.field.scrollIntoView({ block: COARSE ? 'start' : 'nearest', behavior: 'smooth' }); setTimeout(function () { place(w); }, 350); }, 300); });
    f.input.addEventListener('input', function () { f.dirty = true; state[w] = null; f.code.textContent = ''; setErr(''); renderList(w); });
    /* 選單的開關不再綁輸入框焦點：iOS 再點輸入框、或收鍵盤都會讓它失焦，那時選單必須留著讓人滑。
       只在「選了站」「點選單與欄位以外」「Esc」時才收起（見 choose、document pointerdown、keydown）。 */
    f.input.addEventListener('blur', function () {
      setTimeout(function () {
        var r = resolveAny(f.input.value);
        if (r.name && !f.list.classList.contains('open')) setField(w, r.name);
      }, 120);
    });
    f.field.addEventListener('click', function () { if (!f.list.classList.contains('open')) { f.dirty = false; renderList(w); } });
    f.input.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); move(w, 1); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); move(w, -1); }
      else if (ev.key === 'Escape') { closeList(w); }
      else if (ev.key === 'Enter') {            // Enter 只選站，不前進；前進只靠白色按鈕
        ev.preventDefault();
        var pick = f.items[f.active >= 0 ? f.active : 0];
        if (pick) choose(w, pick);
      }
    });
    /* 手機：用 click 選取（手指拖曳捲動不會產生 click），不要綁 pointerdown；mousedown 只防止輸入框失焦 */
    f.list.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
    f.list.addEventListener('click', function (ev) {
      var chip = ev.target.closest('[data-f]');
      if (chip) { listFilter = chip.dataset.f; renderList(w); f.list.scrollTop = 0; return; }
      var li = ev.target.closest('[role=option]'); if (!li) return;
      choose(w, f.items[+li.id.slice(f.list.id.length + 1)]);
    });
  });

  document.addEventListener('pointerdown', function (ev) {
    if (ev.target.closest('.stack')) return;
    ['from', 'to'].forEach(function (w) { if (F[w].list.classList.contains('open')) { closeList(w); var r = resolveAny(F[w].input.value); if (r.name) setField(w, r.name); } });
  });

  $('swap').addEventListener('click', function () {
    var a = state.from, b = state.to;
    if (!a && !b) return;
    setField('from', b); setField('to', a);
    $('arrow').classList.toggle('flip');
  });

  /* 「選擇需求設施」→ 引擎的 mode：只勾電梯＝wheel（輪椅／嬰兒車，只走電梯）；勾手扶梯＝walk；兩個都勾、或兩個都不勾＝walk（電梯或手扶梯皆可）。 */
  function modeOf() { var el = $('m-el').checked, es = $('m-es').checked; return (el && !es) ? 'wheel' : 'walk'; }
  ['m-el', 'm-es'].forEach(function (id) { $(id).addEventListener('change', function () { save('gg.modes', { el: $('m-el').checked, es: $('m-es').checked }); }); });

  $('form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    ['from', 'to'].forEach(function (w) { if (!state[w]) { var r = resolveAny(F[w].input.value); if (r.name) setField(w, r.name); } });
    if (!state.from) { var q1 = F.from.input.value.trim(); setErr(q1 ? t('badFrom', q1) : t('needFrom')); F.from.input.focus(); return; }
    if (!state.to) { var q2 = F.to.input.value.trim(); setErr(q2 ? t('badTo', q2) : t('needTo')); F.to.input.focus(); return; }
    var res;
    try { res = E.plan({ from: state.from, to: state.to, mode: modeOf(), max: 1 }); } catch (e) { res = { error: { code: 'INTERNAL' } }; }
    if (res.error) {
      var M = { SAME_STATION: 'same', NO_ROUTE: 'noRoute', UNKNOWN_STATION: 'unknown' };
      setErr(t(M[res.error.code] || 'fail')); return;
    }
    setErr('');
    state.result = res; state.route = res.routes[0]; state.mode = modeOf(); state.k = 0; state.planAt = Date.now(); state.svcBase = svcBase(state.planAt);
    save('gg.v1', { from: state.from, to: state.to });
    var rc = load('gg.recent', []).filter(function (n) { return n !== state.from && n !== state.to; });
    save('gg.recent', [state.to, state.from].concat(rc).slice(0, 8));
    renderOverview(); show('overview', true);
  });

  /* ---------- 結構化結果 → 模型 ---------- */
  function build() {
    var rides = [], pending = null, exit = null;
    state.route.steps.forEach(function (s) {
      if (s.type === 'transfer') pending = s;
      else if (s.type === 'ride') { rides.push({ ride: s, transfer: pending }); pending = null; }
      else if (s.type === 'exit') exit = s;
    });
    return { rides: rides, exit: exit };
  }
  function facility() { return t(state.mode === 'walk' ? 'fac2' : 'fac1'); }

  /* 車廂文字：design 句型「搭乘第 N 節車廂, 電梯 將在下車處附近」；資料不足時改為誠實的說法 */
  function carText(r) {
    var car = r.car, al = r.alight, out = { l1: '', l2: '', sub: '', warn: '' };
    if (car.recommended == null) {
      out.l1 = t('noRec1'); out.l2 = t('noRec2');
    } else {
      out.l1 = t('board', car.recommended);
      var okAl = al && al.dataBasis === 'annotated' && al.targetCars && al.targetCars.length;
      if (!okAl) out.l2 = t('unkExit', facility());
      else if (al.targetCars.indexOf(car.recommended) >= 0) out.l2 = t('nearExit', facility());
      else out.l2 = t('nearCar', facility(), al.targetCars.join(t('sep')));
      if (car.basis === 'mirrored') out.warn = t('mirrored');
    }
    if (r.towards) out.sub = t('platform', sname(r.towards));
    return out;
  }
  function exitsText(x) {
    var ids = (x.elevatorExits || []).map(function (e) { return e.id; }).filter(function (v, i, a) { return v !== '0' && a.indexOf(v) === i; });
    return ids.length ? ids.map(function (i) { return t('exitN', i); }).join(t('joinExit')) : '';
  }
  /* 內文中的數字（車廂、出口編號）加粗放大 */
  function numB(s) { return esc(s).replace(/(\d+)/g, '<b class="n">$1</b>'); }
  function code(name, line) { return '<span class="cd">' + esc(codeOf(name, line)) + '</span>'; }
  function spaced(name) { var m = sname(name), sp = spacing(m); return '<span' + (sp ? ' class="sp" style="letter-spacing:' + sp * 1.1 + 'em;margin-right:' + -sp * 1.1 + 'em"' : '') + '>' + esc(m) + '</span>'; }

  function hdr(id) {
    var r = state.route, a = state.route.steps[0], z = state.route.steps[state.route.steps.length - 1];
    return '<div class="hd"><div class="row"><h1 class="title" id="' + id + '">' + t('best') + '</h1>' +
      '<div class="title time">' + esc(t('about')) + '<br><span class="num">' + Math.round(r.totalMin) + '</span>' + esc(t('minUnit')) + '</div></div>' +
      '<div class="route-line" aria-label="' + esc(t('routeAria', sname(a.station), sname(z.station))) + '">' + code(a.station, a.line) + spaced(a.station) +
      '<svg viewBox="0 0 14 16" aria-hidden="true"><path d="M0 0l14 8L0 16z" fill="#fff"/></svg>' + code(z.station, z.line) + spaced(z.station) + '</div></div>';
  }

  /* ---------- 2. 路線總覽 ---------- */
  function renderOverview() {
    var m = build(), r = state.route, html = hdr('ov-h'), alerts = '';
    var nowarn = (r.warnings || []).filter(function (w) { return w.code === 'NO_ELEVATOR_PLATFORM'; });
    if (state.result.searchMode === 'relaxed' || nowarn.length) {
      var where = nowarn.map(function (w) { return sname(w.station) + (w.line ? (LANG === 'en' ? ' ' : '（') + lname(w.line) + (LANG === 'en' ? '' : '）') : ''); }).join(t('sep'));
      alerts += '<div class="alert"><b>' + esc(t('alertNote')) + '</b>　' + esc(t('alertNoElev', facility(), where)) + '</div>';
    }
    var an = (r.flags && r.flags.anomalyStations) || [];
    if (an.length) alerts += '<div class="alert"><b>' + esc(t('alertAnomaly')) + '</b>　' + esc(an.map(sname).join(t('sep'))) + '</div>';

    var nodes = '';
    m.rides.forEach(function (x, i) {
      var rd = x.ride, nextT = m.rides[i + 1] && m.rides[i + 1].transfer;
      var tx = carText(rd);
      if (x.transfer) nodes += '<div class="node link"><div class="line1">' + pill(x.transfer.station, x.transfer.fromLine, x.transfer.toLine) + '<span>' + esc(t('transfer')) + '</span></div></div>';
      nodes += '<div class="node link"><div class="line1">' + (x.transfer ? pill(rd.from, x.transfer.fromLine, x.transfer.toLine) : pill(rd.from, rd.line)) + '<span>' + esc(t('to')) + '</span>' + (nextT ? pill(rd.to, rd.line, nextT.toLine) : pill(rd.to, rd.line)) + '</div>' +
        (tx.sub ? '<p class="note sub first">' + esc(tx.sub) + '</p>' : '') +
        '<p class="note' + (tx.sub ? ' after' : '') + '">' + numB(tx.l1) + ' ' + numB(tx.l2) + '</p>' +
        (tx.warn ? '<p class="note sub warn">' + esc(tx.warn) + '</p>' : '') + '</div>';   /* 月台方向放主標上方 */
    });
    var ex = m.exit, lastLine = m.rides[m.rides.length - 1].ride.line;
    nodes += '<div class="node"><div class="line1">' + pill(ex.station, lastLine) + '<span>' + esc(t('exit')) + '</span></div></div>';   /* 出口編號只在最後一頁顯示（依設計稿） */
    html = '<div class="scroll" style="display:flex;flex-direction:column">' + html + alerts + '<div class="tl">' + nodes + '</div>' +
      '<p class="foot-note">' + esc(t('foot')) + '</p></div>' +
      '<div class="actions"><button class="btn" type="button" id="ov-go">' + esc(t('confirm')) + '</button></div>';
    screens.overview.innerHTML = html;
    $('ov-go').addEventListener('click', function () { state.k = 0; renderStep(); show('step', true); });
    $('live').textContent = t('liveBest', Math.round(r.totalMin));
  }

  /* ---------- 3、4. 逐段步驟 ---------- */
  var ICON_EL = '<img src="assets/elevator.svg" alt="" aria-hidden="true">';   /* 取自 gb.pdf 的原圖示 */
  var ICON_ES = '<img class="es" src="assets/escalator.png" alt="" aria-hidden="true">';   /* 使用者提供的原圖 */

  /* ---------- 到站時間（mm:ss）：現在時間對班表 ----------
     班表＝TDX StationTimeTable（app/timetable.js，延遲載入；不含文湖線）。時刻只到「分」，秒數＝該分鐘 0 秒。
     第 1 段取「現在時間之後的第一班」，到了發車時間才換下一班；之後各段把中間的搭乘與轉乘時間算進去再對班表（見 startEta）。沒有班表的線（文湖線）退回引擎的預估時間並標「預估」。
     不含國定假日（以週一至五／六／日判斷）。 */
  var TT = null, ttLoading = null, etaTimer = null, etaToken = 0;
  function loadTT() {
    if (window.TIMETABLE) { TT = window.TIMETABLE; return Promise.resolve(TT); }
    if (!ttLoading) ttLoading = new Promise(function (res) {
      var sc = document.createElement('script'); sc.src = 'timetable.js';
      sc.onload = function () { TT = window.TIMETABLE || null; res(TT); }; sc.onerror = function () { res(null); };
      document.head.appendChild(sc);
    });
    return ttLoading;
  }
  function svcBase(ms) {                                   // 臺北營運日起點（04:00 前算前一天）
    var day = Math.floor((ms + 8 * 36e5) / 864e5) * 864e5 - 8 * 36e5;
    return (ms - day) / 1000 < 4 * 3600 ? day - 864e5 : day;
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  /* 只顯示分鐘（無條件捨去，不會高估剩餘時間）；不到 1 分鐘顯示「即將進站」 */
  function showMin(el, s) {
    if (s < 60) { el.classList.add('small'); el.textContent = t('soon'); return; }
    el.classList.remove('small'); el.innerHTML = '<span class="m">' + Math.floor(s / 60) + '</span><span class="u">' + esc(t('minUnitEta')) + '</span>';
  }
  var livePoll = null, live = null;
  function stopEta() { etaToken++; if (etaTimer) { clearInterval(etaTimer); etaTimer = null; } if (livePoll) { clearInterval(livePoll); livePoll = null; } }
  function nextDeparture(rd, readySec, dayKey) {
    var code = codeOf(rd.from, rd.line), groups = TT && TT[code]; if (!groups) return null;
    var towards = String(rd.towards || '').replace(/臺/g, '台'), dir = null;
    groups.forEach(function (g) { if (dir == null && g.n === towards) dir = g.d; });
    if (dir == null) {                                      // 終點站名對不上：用「下一站站碼」判斷行進方向
      var nx = rd.stopNames && rd.stopNames[1], nc = nx ? codeNum(codeOf(nx, rd.line)) : 0, bc = codeNum(code);
      groups.forEach(function (g) { var dc = 0; ST.forEach(function (s) { if (s.name === g.n) s.lines.forEach(function (l) { if (l.line === rd.line) dc = codeNum(l.code); }); }); if (dir == null && dc && ((dc > bc) === (nc > bc))) dir = g.d; });
    }
    if (dir == null) return null;
    var set = {}; groups.forEach(function (g) { if (g.d === dir && g[dayKey]) g[dayKey].split(',').forEach(function (x) { set[x] = 1; }); });
    var mins = Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
    return mins.length ? mins : [];
  }
  /* 第 k 段的發車時刻＝把前面各段「搭乘時間（rideMin）＋轉乘時間（transfer.estimatedMin）」都納入再對班表：
     第 1 段：現在之後的第一班；第 k 段：上一段發車 ＋ 搭乘 ＋ 轉乘 → 預計到這站的時刻之後的第一班。
     某段沒有班表（文湖線）就用引擎的候車預估代替，整個結果標「預估」。 */
  function startEta(rd) {
    stopEta();
    var el = $('eta'); if (!el || !state.route) return;
    var tag = $('eta-tag'), clock = $('eta-clock'), token = etaToken;
    var base = state.svcBase, dayKey = (function (d) { return d === 0 ? 'su' : d === 6 ? 'sa' : 'wd'; })(new Date(base + 8 * 36e5).getUTCDay());
    var rides = build().rides, k = state.k, liveUrl = (window.GUAGUA_CONFIG || {}).liveUrl;
    live = null;
    function fetchLive() {                                           // 向 Worker 取即時到站（Worker 端有快取，這裡每 15 秒一次）
      fetch(liveUrl, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { if (token === etaToken && j && j.rows) live = j; }).catch(function () { /* 失敗就繼續用班表 */ });
    }
    if (liveUrl) { fetchLive(); livePoll = setInterval(fetchLive, 15000); }
    function liveDep(r, base) {                                      // 這一站、這個方向最近一班的即時進站時刻（營運日秒）；沒有就 null
      if (!live) return null;
      var code = codeOf(r.from, r.line), tw = String(r.towards || '').replace(/臺/g, '台'), best = null;
      live.rows.forEach(function (x) { if (x.s === code && x.d === tw && x.a >= Date.now() - 5000 && (best == null || x.a < best)) best = x.a; });
      return best == null ? null : (best - base * 1) / 1000;
    }
    loadTT().then(function () {
      if (token !== etaToken) return;                                               // 已離開這一頁
      var legs = [];                                                                  // 各段班表（分鐘陣列）或 null
      for (var i = 0; i <= k; i++) legs.push(nextDeparture(rides[i].ride, 0, dayKey));
      function chain(nowSec) {
        var dep = null, est = false, last = false, usedLive = false;
        for (var i = 0; i <= k; i++) {
          var r = rides[i].ride, ready = i === 0 ? nowSec : dep + rides[i - 1].ride.rideMin * 60 + (rides[i].transfer ? rides[i].transfer.estimatedMin * 60 : 0);
          var mins = legs[i], d = null, ld = i === 0 ? liveDep(r, base) : null;
          if (ld != null) { d = ld; usedLive = true; }
          else if (mins && mins.length) { for (var j = 0; j < mins.length; j++) if (mins[j] * 60 >= ready) { d = mins[j] * 60; break; } if (d == null) return { last: true }; }
          else { est = true; d = ready + ((r.board && r.board.waitMin) || 0) * 60; }
          dep = d;
        }
        return { dep: dep, est: est, live: usedLive };
      }
      function tick() {
        var nowSec = (Date.now() - base) / 1000, c = chain(nowSec);
        tag.textContent = c.est ? t('etaEst') : c.live ? t('liveTag') : '';
        if (c.last) { el.classList.add('small'); el.textContent = t('lastTrain'); clock.textContent = ''; return; }
        showMin(el, Math.max(0, Math.round(c.dep - nowSec)));
        if (c.est || c.live) clock.textContent = ''; else { var hm = Math.floor(c.dep / 60) % 1440; clock.textContent = pad2(Math.floor(hm / 60)) + ':' + pad2(hm % 60) + ' ' + t('depAt'); }
      }
      tick(); etaTimer = setInterval(tick, 1000);
    });
  }

  function renderStep() {
    var m = build(), k = state.k, x = m.rides[k], rd = x.ride, last = k === m.rides.length - 1, tx = carText(rd);
    var ctx = '<div class="eta"><span class="eta-l">' + esc(t('eta')) + '<small id="eta-tag">&nbsp;</small></span><b class="eta-t" id="eta" aria-live="off">--</b><span class="eta-c" id="eta-clock"></span></div>';
    var nextT = m.rides[k + 1] && m.rides[k + 1].transfer;
    if (x.transfer) ctx += '<div class="node link"><div class="line1">' + pill(x.transfer.station, x.transfer.fromLine, x.transfer.toLine) + '<span>' + esc(t('transfer')) + '</span></div></div>';
    ctx += '<div class="node' + (k === 0 ? ' drop' : '') + '"><div class="line1">' + (x.transfer ? pill(rd.from, x.transfer.fromLine, x.transfer.toLine) : pill(rd.from, rd.line)) + '<span>' + esc(t('to')) + '</span>' + (nextT ? pill(rd.to, rd.line, nextT.toLine) : pill(rd.to, rd.line)) + '</div></div>';
    var n = rd.car.total || 6, on = rd.car.recommended, cars = '';
    for (var i = 1; i <= n; i++) cars += '<div class="car' + (i === on ? ' on pop' : '') + '">' + (i === on ? i : '') + '</div>';
    var tail = '';
    if (last) {
      var ex = m.exit;
      tail += '<div class="exit"><div class="line1">' + pill(ex.station, rd.line) + '<span>' + esc(t('exit')) + '</span></div>' + (exitsText(ex) ? '<p class="exits">' + esc(exitsText(ex)) + '</p>' : '') + '</div>';
    }
    tail += '<button class="btn" type="button" id="st-go">' + esc(t(last ? 'done' : 'next')) + '</button>';
    screens.step.innerHTML = hdr('st-h') +
      '<div class="step-body"><div class="ctx">' + ctx + '</div>' +
      '<div class="cars" style="grid-template-columns:repeat(' + n + ',1fr)" role="img" aria-label="' + esc(t('carsAria', n, on)) + '">' + cars + '</div>' +
      '<div class="info"><div class="txt">' + esc(tx.l1) + '<br>' + esc(tx.l2) + (tx.sub ? '<span class="s">' + esc(tx.sub) + '</span>' : '') + (tx.warn ? '<span class="s">' + esc(tx.warn) + '</span>' : '') + '</div>' + (state.mode === 'walk' ? ICON_ES : ICON_EL) + '</div></div>' +
      '<div class="tail">' + tail + '</div>';
    $('st-go').addEventListener('click', function () {
      if (last) { state.route = null; state.result = null; show('home'); try { history.pushState({ screen: 'home' }, '', '#home'); } catch (e) { /* 略 */ } return; }
      state.k = k + 1; renderStep(); show('step', true);
    });
    startEta(rd);
    $('live').textContent = t('liveStep', k + 1, m.rides.length);
  }

  /* ---------- 語言切換：首頁右上角按鈕（中文介面顯示「EN」，英文介面顯示「中」） ---------- */
  function applyStatic() {
    document.documentElement.lang = LANG === 'zh' ? 'zh-Hant' : 'en';
    document.body.classList.toggle('en', LANG === 'en');
    document.title = t('title');
    $('home-h').innerHTML = t('homeTitle');
    $('home-sub').textContent = t('homeSub');
    $('modes-l').textContent = t('modes'); $('t-el').textContent = t('el'); $('t-es').textContent = t('es');
    F.from.input.placeholder = t('phFrom'); F.from.input.setAttribute('aria-label', t('fromLabel'));
    F.to.input.placeholder = t('phTo'); F.to.input.setAttribute('aria-label', t('toLabel'));
    $('go').textContent = t('go');
    $('swap').setAttribute('aria-label', t('swap'));
    $('lang').textContent = t('langBtn'); $('lang').setAttribute('aria-label', t('langAria'));
  }
  function setLang(l) {
    LANG = l; save('gg.lang', l); applyStatic();
    ['from', 'to'].forEach(function (w) { if (state[w]) setField(w, state[w]); if (F[w].list.classList.contains('open')) renderList(w); });
    if (state.route) { if (screens.overview.classList.contains('active')) renderOverview(); if (screens.step.classList.contains('active')) renderStep(); }
  }
  $('lang').addEventListener('click', function () { setLang(LANG === 'zh' ? 'en' : 'zh'); });

  /* ---------- 鍵盤：讓 App 高度跟著「可視範圍」（iOS 不縮小版面，只縮小 visualViewport） ---------- */
  (function () {
    var vv = window.visualViewport, root = document.documentElement;
    if (!vv) return;
    function sync() {
      root.style.setProperty('--app-h', vv.height + 'px');
      root.style.setProperty('--app-top', vv.offsetTop + 'px');
      ['from', 'to'].forEach(place);
    }
    vv.addEventListener('resize', sync); vv.addEventListener('scroll', sync);
  })();

  /* ---------- PWA：Service Worker（離線可開） ---------- */
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () { /* 不支援或失敗：照常使用 */ }); });
  }

  /* ---------- 初始化 ---------- */
  var last = load('gg.v1', null), mo = load('gg.modes', null);
  applyStatic();
  if (last) { if (ST.has(last.from)) setField('from', last.from); if (ST.has(last.to)) setField('to', last.to); }
  if (mo) { $('m-el').checked = !!mo.el; $('m-es').checked = !!mo.es; }
  try { history.replaceState({ screen: 'home' }, '', '#home'); } catch (e) { /* 略 */ }
  window.__gg = { state: state, show: show, renderOverview: renderOverview, renderStep: renderStep, setField: setField, setLang: setLang };   // 供偵錯
})();
