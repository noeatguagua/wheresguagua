/* 瓜瓜去哪儿 — 手機版前端（依 gb.pdf）
 * 只負責「輸入 → 呼叫引擎 → 畫結構化結果」；所有路線計算在 engine.js。輸出契約見 docs/API-spec-v0.md。
 * 流程：首頁 —[路線生成]→ 總覽 —[確定行程]→ 逐段步驟（每段一頁）—[下一步]…[結束]→ 首頁。
 * 只有白色按鈕能前進到下一頁（鍵盤 Enter 只用來選站，不會送出）。 */
(function () {
  'use strict';
  var E = MetroEngine.createEngine(window.METRO_DATA);
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- 線色（站名底色；轉乘站為兩線漸層） ---------- */
  var LINE_COLOR = { '板南線': 'var(--bl)', '文湖線': 'var(--br)', '淡水信義線': 'var(--r)', '松山新店線': 'var(--g)', '中和新蘆線': 'var(--o)' };

  var ST = new Map();
  E.stations().forEach(function (s) { ST.set(s.name, s); });

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function norm(s) { return String(s || '').replace(/臺/g, '台').replace(/\s+/g, '').replace(/站$/, '').toUpperCase(); }
  function codeOf(name, line) { var s = ST.get(name); if (!s || !s.lines[0]) return ''; var l = line && s.lines.filter(function (x) { return x.line === line; })[0]; return (l || s.lines[0]).code; }
  function allCodes(name) { var s = ST.get(name); return s ? s.lines.map(function (l) { return l.code; }).join(' · ') : ''; }
  function spacing(name) { var n = Array.from(name || '').length; return n <= 3 ? .5 : n === 4 ? .25 : 0; }

  /* 站名底色：單一路線＝該線色；轉乘站＝兩線過渡漸層，firstLine 為左側（先到的那條線） */
  function bgOf(name, firstLine) {
    var s = ST.get(name), ls = [];
    if (s) s.lines.forEach(function (l) { if (ls.indexOf(l.line) < 0) ls.push(l.line); });
    if (firstLine && ls.indexOf(firstLine) > 0) { ls.splice(ls.indexOf(firstLine), 1); ls.unshift(firstLine); }
    var cs = ls.map(function (l) { return LINE_COLOR[l] || '#777'; });
    if (cs.length < 2) return cs[0] || '#777';
    return 'linear-gradient(90deg,' + cs.join(',') + ')';
  }
  /* 底色規則：有 toLine（此站要換車）→ firstLine→toLine 漸層；只有 firstLine（不換車）→ 搭乘線單色；都沒有（站名建議）→ 該站所有線 */
  function pill(name, firstLine, sm, toLine) {
    var bg = toLine ? 'linear-gradient(90deg,' + LINE_COLOR[firstLine] + ',' + LINE_COLOR[toLine] + ')' : firstLine ? LINE_COLOR[firstLine] || '#777' : bgOf(name, null);
    return '<span class="pill' + (sm ? ' sm' : '') + '" style="background:' + bg + '">' + esc(name) + '</span>';
  }

  /* ---------- 儲存（只存偏好，失敗不影響使用） ---------- */
  function load(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 無痕或停用儲存 */ } }

  var state = { from: null, to: null, route: null, result: null, mode: 'wheel', k: 0 };

  /* ---------- 畫面切換（一次一頁，每頁滿屏） ---------- */
  var screens = { home: $('home'), overview: $('overview'), step: $('step') };
  function show(name, push) {
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

  /* ---------- 首頁：欄位與站名建議 ---------- */
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
      return !q || norm(r.n).indexOf(q) >= 0 || r.code.toUpperCase().indexOf(q) === 0;
    });
  }

  function setField(w, name) {
    var f = F[w];
    state[w] = name || null;
    f.input.value = name || '';
    f.code.textContent = name ? codeOf(name) : '';
    f.field.classList.toggle('resolved', !!name);
    var sp = name ? spacing(name) : 0;
    f.input.style.letterSpacing = sp ? sp + 'em' : '';
    f.input.style.marginRight = sp ? -sp + 'em' : '';
  }

  function renderList(w) {
    /* 已選好站、還沒改字時，不拿站名當關鍵字（否則只剩那一站，無法換選）；使用者開始輸入才篩選 */
    var f = F[w], q = f.dirty ? f.input.value : '', items = [], html = '';
    html += '<li class="chips" role="presentation">' + ['all'].concat(LINES).map(function (l) {
      return '<button type="button" class="chip' + (listFilter === l ? ' on' : '') + '" data-f="' + l + '" tabindex="-1">' +
        (l === 'all' ? '全部' : '<i style="background:' + LINE_VAR[l] + '"></i>' + esc(l.replace('線', ''))) + '</button>';
    }).join('') + '</li>';
    if (!q.trim() && listFilter === 'all') {
      var rec = load('gg.recent', []).filter(function (n) { return ST.has(n); }).slice(0, 4);
      if (rec.length) {
        html += '<li class="lh recent" role="presentation">最近查詢</li>';
        rec.forEach(function (n) { items.push(n); html += '<li role="option" id="' + f.list.id + '-' + (items.length - 1) + '" aria-selected="false"><span class="code">' + esc(codeOf(n)) + '</span><span class="nm">' + esc(n) + '</span></li>'; });
      }
    }
    var last = '', rows = visibleRows(q);
    rows.forEach(function (r) {
      if (r.l !== last) { last = r.l; html += '<li class="lh" role="presentation" style="background:' + LINE_VAR[r.l] + '">' + esc(r.l) + '</li>'; }
      items.push(r.n);
      html += '<li role="option" id="' + f.list.id + '-' + (items.length - 1) + '" aria-selected="false"' + (state[w] === r.n ? ' class="cur" aria-current="true"' : '') + '><span class="code">' + esc(r.code) + '</span><span class="nm">' + esc(r.n) + '</span></li>';
    });
    if (!rows.length) html += '<li class="none" role="presentation">' + (q.trim() ? '找不到「' + esc(q.trim()) + '」' : '沒有車站') + '</li>';
    f.items = items; f.active = -1;
    f.list.innerHTML = html;
    f.list.classList.add('open');
    f.input.setAttribute('aria-expanded', 'true');
    place(w);
    var cur = f.list.querySelector('.cur'); if (cur && !q) f.list.scrollTop = Math.max(0, cur.offsetTop - 120);
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
  function setErr(msg) { $('err').textContent = msg || ''; }

  ['from', 'to'].forEach(function (w) {
    var f = F[w];
    f.input.addEventListener('focus', function () { f.dirty = false; closeList(w === 'from' ? 'to' : 'from'); f.field.classList.remove('resolved'); f.input.style.letterSpacing = ''; f.input.style.marginRight = ''; f.input.select(); renderList(w); setTimeout(function () { f.field.scrollIntoView({ block: COARSE ? 'start' : 'nearest', behavior: 'smooth' }); setTimeout(function () { place(w); }, 350); }, 300); });
    f.input.addEventListener('input', function () { f.dirty = true; state[w] = null; f.code.textContent = ''; setErr(''); renderList(w); });
    /* 選單的開關不再綁輸入框焦點：iOS 再點輸入框、或收鍵盤都會讓它失焦，那時選單必須留著讓人滑。
       只在「選了站」「點選單與欄位以外」「Esc」時才收起（見 choose、document pointerdown、keydown）。 */
    f.input.addEventListener('blur', function () {
      setTimeout(function () {
        var r = E.resolveStation(f.input.value);
        if (r && r.name && !f.list.classList.contains('open')) setField(w, r.name);
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
    ['from', 'to'].forEach(function (w) { if (F[w].list.classList.contains('open')) { closeList(w); var r = E.resolveStation(F[w].input.value); if (r && r.name) setField(w, r.name); } });
  });

  $('swap').addEventListener('click', function () {
    var a = state.from, b = state.to;
    if (!a && !b) return;
    setField('from', b); setField('to', a);
    $('arrow').classList.toggle('flip');
  });

  /* 「選擇上下樓」→ 引擎的 mode：只勾電梯＝wheel（輪椅／嬰兒車，只走電梯）；勾手扶梯＝walk（電梯或手扶梯皆可）；都不勾＝比照電梯（較安全）。 */
  function modeOf() { var el = $('m-el').checked, es = $('m-es').checked; return es ? 'walk' : 'wheel'; }
  ['m-el', 'm-es'].forEach(function (id) { $(id).addEventListener('change', function () { save('gg.modes', { el: $('m-el').checked, es: $('m-es').checked }); }); });

  $('form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    ['from', 'to'].forEach(function (w) { if (!state[w]) { var r = E.resolveStation(F[w].input.value); if (r && r.name) setField(w, r.name); } });
    if (!state.from) { setErr(F.from.input.value.trim() ? '找不到起站「' + F.from.input.value.trim() + '」，請從建議中選擇' : '請輸入起站'); F.from.input.focus(); return; }
    if (!state.to) { setErr(F.to.input.value.trim() ? '找不到迄站「' + F.to.input.value.trim() + '」，請從建議中選擇' : '請輸入迄站'); F.to.input.focus(); return; }
    var res;
    try { res = E.plan({ from: state.from, to: state.to, mode: modeOf(), max: 1 }); } catch (e) { res = { error: { code: 'INTERNAL' } }; }
    if (res.error) {
      var M = { SAME_STATION: '起站與迄站相同', NO_ROUTE: '找不到可行的路線', UNKNOWN_STATION: '找不到這個站名' };
      setErr(M[res.error.code] || '無法產生路線，請稍後再試'); return;
    }
    setErr('');
    state.result = res; state.route = res.routes[0]; state.mode = modeOf(); state.k = 0;
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
  function facility() { return state.mode === 'walk' ? '電梯／手扶梯' : '電梯'; }

  /* 車廂文字：design 句型「搭乘第 N 節車廂, 電梯 將在下車處附近」；資料不足時改為誠實的說法 */
  function carText(r) {
    var car = r.car, al = r.alight, out = { l1: '', l2: '', sub: '', warn: '' };
    if (car.recommended == null) {
      out.l1 = '此段沒有車廂建議,'; out.l2 = '請依站內指引搭乘';
    } else {
      out.l1 = '搭乘第 ' + car.recommended + ' 節車廂,';
      var okAl = al && al.dataBasis === 'annotated' && al.targetCars && al.targetCars.length;
      if (!okAl) out.l2 = '下車站' + facility() + '位置請依站內指引';
      else if (al.targetCars.indexOf(car.recommended) >= 0) out.l2 = facility() + ' 將在下車處附近';
      else out.l2 = facility() + ' 在第 ' + al.targetCars.join('、') + ' 節車廂附近';
      if (car.basis === 'mirrored') out.warn = '※ 車廂位置為推算，尚未現場核對';
    }
    if (r.towards) out.sub = '往 ' + r.towards + ' 方向月台';
    return out;
  }
  function exitsText(x) {
    var ids = (x.elevatorExits || []).map(function (e) { return e.id; }).filter(function (v, i, a) { return v !== '0' && a.indexOf(v) === i; });
    return ids.length ? ids.map(function (i) { return '出口' + i; }).join(' , ') : '';
  }
  function code(name, line) { return '<span class="cd">' + esc(codeOf(name, line)) + '</span>'; }
  function spaced(name) { return '<span' + (spacing(name) ? ' class="sp" style="letter-spacing:' + spacing(name) * 1.1 + 'em;margin-right:' + -spacing(name) * 1.1 + 'em"' : '') + '>' + esc(name) + '</span>'; }

  function hdr(id) {
    var r = state.route, a = state.route.steps[0], z = state.route.steps[state.route.steps.length - 1];
    return '<div class="hd"><div class="row"><h1 class="title" id="' + id + '">最佳<br>路線</h1>' +
      '<div class="title time">約<br><span class="num">' + Math.round(r.totalMin) + '</span>分</div></div>' +
      '<div class="route-line" aria-label="從' + esc(a.station) + '到' + esc(z.station) + '">' + code(a.station, a.line) + spaced(a.station) +
      '<svg viewBox="0 0 14 16" aria-hidden="true"><path d="M0 0l14 8L0 16z" fill="#fff"/></svg>' + code(z.station, z.line) + spaced(z.station) + '</div></div>';
  }

  /* ---------- 2. 路線總覽 ---------- */
  function renderOverview() {
    var m = build(), r = state.route, html = hdr('ov-h'), alerts = '';
    var nowarn = (r.warnings || []).filter(function (w) { return w.code === 'NO_ELEVATOR_PLATFORM'; });
    if (state.result.searchMode === 'relaxed' || nowarn.length) {
      var where = nowarn.map(function (w) { return w.station + (w.line ? '（' + w.line + '）' : ''); }).join('、');
      alerts += '<div class="alert"><b>注意</b>　此路線經過沒有' + facility() + '的月台' + (where ? '：' + esc(where) : '') + '，請先向站務人員確認。</div>';
    }
    var an = (r.flags && r.flags.anomalyStations) || [];
    if (an.length) alerts += '<div class="alert"><b>電梯異常公告</b>　' + esc(an.join('、')) + '</div>';

    var nodes = '';
    m.rides.forEach(function (x, i) {
      var rd = x.ride, prevLine = x.transfer ? x.transfer.fromLine : null, nextT = m.rides[i + 1] && m.rides[i + 1].transfer;
      var t = carText(rd);
      if (x.transfer) nodes += '<div class="node link"><div class="line1">' + pill(x.transfer.station, x.transfer.fromLine, false, x.transfer.toLine) + '<span>轉乘</span></div></div>';
      nodes += '<div class="node link"><div class="line1">' + (x.transfer ? pill(rd.from, x.transfer.fromLine, false, x.transfer.toLine) : pill(rd.from, rd.line)) + '<span>往</span>' + (nextT ? pill(rd.to, rd.line, false, nextT.toLine) : pill(rd.to, rd.line)) + '</div>' +
        (t.sub ? '<p class="note sub first">' + esc(t.sub) + '</p>' : '') +
        '<p class="note' + (t.sub ? ' after' : '') + '">' + esc(t.l1) + ' ' + esc(t.l2) + '</p>' +
        (t.warn ? '<p class="note sub warn">' + esc(t.warn) + '</p>' : '') + '</div>';   /* 月台方向放主標上方 */
    });
    var ex = m.exit, lastLine = m.rides[m.rides.length - 1].ride.line;
    nodes += '<div class="node"><div class="line1">' + pill(ex.station, lastLine) + '<span>出站</span></div></div>';   /* 出口編號只在最後一頁顯示（依設計稿） */
    html = '<div class="scroll" style="display:flex;flex-direction:column">' + html + alerts + '<div class="tl">' + nodes + '</div>' +
      '<p class="foot-note">時間、車廂為預估，電梯以車站現場公告為準</p></div>' +
      '<div class="actions"><button class="btn" type="button" id="ov-go">確定行程</button></div>';
    screens.overview.innerHTML = html;
    $('ov-go').addEventListener('click', function () { state.k = 0; renderStep(); show('step', true); });
    $('live').textContent = '最佳路線約 ' + Math.round(r.totalMin) + ' 分鐘';
  }

  /* ---------- 3、4. 逐段步驟 ---------- */
  var ICON_EL = '<img src="assets/elevator.svg" alt="" aria-hidden="true">';   /* 取自 gb.pdf 的原圖示 */
  var ICON_ES = '<img class="es" src="assets/escalator.png" alt="" aria-hidden="true">';   /* 使用者提供的原圖 */

  function renderStep() {
    var m = build(), k = state.k, x = m.rides[k], rd = x.ride, last = k === m.rides.length - 1, t = carText(rd);
    var ctx = '';
    var nextT = m.rides[k + 1] && m.rides[k + 1].transfer;
    if (x.transfer) ctx += '<div class="node link"><div class="line1">' + pill(x.transfer.station, x.transfer.fromLine, false, x.transfer.toLine) + '<span>轉乘</span></div></div>';
    ctx += '<div class="node' + (k === 0 ? ' drop' : '') + '"><div class="line1">' + (x.transfer ? pill(rd.from, x.transfer.fromLine, false, x.transfer.toLine) : pill(rd.from, rd.line)) + '<span>往</span>' + (nextT ? pill(rd.to, rd.line, false, nextT.toLine) : pill(rd.to, rd.line)) + '</div></div>';
    var n = rd.car.total || 6, on = rd.car.recommended, cars = '';
    for (var i = 1; i <= n; i++) cars += '<div class="car' + (i === on ? ' on pop' : '') + '">' + (i === on ? i : '') + '</div>';
    var tail = '';
    if (last) {
      var ex = m.exit;
      tail += '<div class="exit"><div class="line1">' + pill(ex.station, rd.line) + '<span>出站</span></div>' + (exitsText(ex) ? '<p class="exits">' + esc(exitsText(ex)) + '</p>' : '') + '</div>';
    }
    tail += '<button class="btn" type="button" id="st-go">' + (last ? '結束' : '下一步') + '</button>';
    screens.step.innerHTML = hdr('st-h') +
      '<div class="step-body"><div class="ctx">' + ctx + '</div>' +
      '<div class="cars" style="grid-template-columns:repeat(' + n + ',1fr)" role="img" aria-label="共 ' + n + ' 節車廂' + (on ? '，建議搭第 ' + on + ' 節' : '') + '">' + cars + '</div>' +
      '<div class="info"><div class="txt">' + esc(t.l1) + '<br>' + esc(t.l2) + (t.sub ? '<span class="s">' + esc(t.sub) + '</span>' : '') + (t.warn ? '<span class="s">' + esc(t.warn) + '</span>' : '') + '</div>' + (state.mode === 'walk' ? ICON_ES : ICON_EL) + '</div></div>' +
      '<div class="tail">' + tail + '</div>';
    $('st-go').addEventListener('click', function () {
      if (last) { state.route = null; state.result = null; show('home'); try { history.pushState({ screen: 'home' }, '', '#home'); } catch (e) { /* 略 */ } return; }
      state.k = k + 1; renderStep(); show('step', true);
    });
    $('live').textContent = '第 ' + (k + 1) + ' 段，共 ' + m.rides.length + ' 段';
  }

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

  /* ---------- 初始化 ---------- */
  var last = load('gg.v1', null), mo = load('gg.modes', null);
  if (last) { if (ST.has(last.from)) setField('from', last.from); if (ST.has(last.to)) setField('to', last.to); }
  if (mo) { $('m-el').checked = !!mo.el; $('m-es').checked = !!mo.es; }
  try { history.replaceState({ screen: 'home' }, '', '#home'); } catch (e) { /* 略 */ }
  window.__gg = { state: state, show: show, renderOverview: renderOverview, renderStep: renderStep, setField: setField };   // 供偵錯
})();
