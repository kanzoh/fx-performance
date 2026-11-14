

(() => {
  'use strict';
  const table = document.getElementById('ea-table');
  if (!table) return;
  const status = document.getElementById('ea-exit-countdown-status');
  const STORE = 'exitCountdownMemo_v1';
  let snapshot = null, received = 0, busy = false, offset = null;
  let memo = {};
  try { memo = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (_) { memo = {}; }
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(memo)); } catch (_) {} };

  const date = value => new Intl.DateTimeFormat('ja-JP', {
    timeZone:'Asia/Tokyo', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hourCycle:'h23'
  }).format(new Date(value * 1000));
  const clock = value => new Intl.DateTimeFormat('ja-JP', {
    timeZone:'Asia/Tokyo', hour:'2-digit', minute:'2-digit', hourCycle:'h23'
  }).format(new Date(value * 1000));
  const remaining = value => {
    if (value <= 0) return '期限到達・決済確認待ち';
    const n = Math.floor(value), d = Math.floor(n / 86400);
    return (d ? `${d}日 ` : '') + [Math.floor(n%86400/3600), Math.floor(n%3600/60), n%60]
      .map(x => String(x).padStart(2,'0')).join(':');
  };
  function line(cell, tag, text) {
    const el = document.createElement(tag); el.textContent = text; cell.appendChild(el);
  }
  const isFresh = () => {
    const elapsed = (performance.now() - received) / 1000;
    return snapshot?.fresh === true && elapsed <= 25 &&
      Number.isFinite(snapshot.source_age_seconds) && snapshot.source_age_seconds + elapsed <= 45;
  };

  function learn() {
    if (!snapshot || snapshot.fresh !== true || !Array.isArray(snapshot.rows)) return;
    const account = String(snapshot.account_login);
    const seen = new Set();
    for (const row of snapshot.rows) {
      const key = account + ':' + String(row.magic);
      seen.add(key);
      if (row.known && Number.isFinite(row.due_utc) && row.position_count > 0) {
        memo[key] = {due_utc: row.due_utc, count: row.position_count, confirmed: Number(snapshot.server_now_utc)};
      } else {
        delete memo[key];
      }
    }
    for (const key of Object.keys(memo)) {
      if (key.startsWith(account + ':') && !seen.has(key)) delete memo[key];
    }
    save();
  }

  function render() {
    const elapsed = (performance.now() - received) / 1000;
    const fresh = isFresh();
    const now = fresh ? Number(snapshot?.server_now_utc) + elapsed
                      : (offset === null ? Date.now() / 1000 : Date.now() / 1000 + offset);
    let carried = 0;
    const rows = new Map((snapshot?.rows || []).map(row => [String(row.magic), row]));
    for (const cell of table.querySelectorAll('[data-exit-magic]')) {
      cell.replaceChildren(); cell.className = 'ea-exit-countdown'; cell.title = '';
      const key = cell.dataset.exitAccount + ':' + cell.dataset.exitMagic;
      const open = Number(cell.dataset.exitOpen);
      const sameAccount = String(snapshot?.account_login) === cell.dataset.exitAccount;
      let due = null, confirmed = null;
      if (fresh && sameAccount) {
        const row = rows.get(cell.dataset.exitMagic);
        if (!row && open === 0) { cell.textContent = '—'; line(cell, 'small', '建玉なし'); continue; }
        if (!row?.known || !Number.isFinite(row.due_utc) || !Number.isFinite(now)) {
          cell.textContent = '決済予定を未確認'; cell.classList.add('exit-unknown'); continue;
        }
        due = row.due_utc;
      } else {
        if (open === 0) { cell.textContent = '—'; line(cell, 'small', '建玉なし'); continue; }
        const m = memo[key];
        if (!m || !Number.isFinite(m.due_utc) || !Number.isFinite(now)) {
          cell.textContent = '未確認／更新待ち'; cell.classList.add('exit-unknown'); continue;
        }
        due = m.due_utc; confirmed = m.confirmed; carried++;
      }
      const left = due - now;
      line(cell, 'strong', remaining(left));
      line(cell, 'small', date(due) + ' JST' + (confirmed ? `・最終確認 ${clock(confirmed)}` : ''));
      cell.title = '週末・休日前の強制決済を含む最も近い時間決済の予定。TP/SL・価格条件の決済が先行する場合があります。' +
        (confirmed ? '　いまは前回確認した予定から数えています（予定は建玉を持つ間は変わりません）。' : '');
      if (left <= 3600) cell.classList.add(left <= 0 ? 'exit-due' : 'exit-soon');
    }
    if (status) {
      status.textContent = 'magic number単位・時間決済は日本時間（JST）' +
        (fresh ? (snapshot.market_closed ? '・市場休場中' : '・自動更新') : (carried ? '・前回の確認から数えています' : '・更新待ち'));
      const forced = snapshot?.next_forced;
      status.title = fresh && forced?.known ? `次の強制決済予定（参考）：${date(forced.due_utc)} JST（${forced.reason}）` : '';
    }
    window.renderEaExitDistance?.();
  }
  window.renderEaExitCountdown = render;

  async function load() {
    if (busy) return; busy = true;
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch('/api/exit-countdown', {cache:'no-store', signal:controller.signal});
      if (!response.ok) throw new Error('unavailable');
      const data = await response.json();
      if (!Array.isArray(data.rows)) throw new Error('invalid');
      snapshot = data; received = performance.now();
      if (Number.isFinite(Number(data.server_now_utc))) offset = Number(data.server_now_utc) - Date.now() / 1000;
      learn();
    } catch (_) { snapshot = null; }
    finally { clearTimeout(timeout); busy = false; render(); }
  }
  load(); setInterval(load, 10000); setInterval(render, 1000);
})();

(() => {
  'use strict';
  const table = document.getElementById('ea-table');
  if (!table) return;
  const num = v => (v === null || v === undefined || v === '' ? NaN : Number(v));
  const yen = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(Math.round(v)).toLocaleString('ja-JP') + '円';
  let byKey = new Map(), loaded = false, busy = false;

  const style = document.createElement('style');
  style.textContent = '#ea-table{min-width:calc(var(--ea-table-min-width, 1860px) + 170px)}' +
    '#ea-table .col-exit-distance{width:170px}' +
    '#ea-table .ea-exit-distance{text-align:left;white-space:nowrap;line-height:1.35;font-size:.95rem;font-variant-numeric:tabular-nums}' +
    '.ea-exit-distance span{display:block}.ea-exit-distance .to-tp{color:#067647}.ea-exit-distance .to-sl{color:#b42318}' +
    '.ea-exit-distance small{display:block;color:var(--muted,#667085);font-size:.82rem}';
  document.head.appendChild(style);
  const exitCol = table.querySelector('col.col-exit-countdown');
  if (exitCol && !table.querySelector('col.col-exit-distance')) {
    const col = document.createElement('col'); col.className = 'col-exit-distance'; exitCol.after(col);
  }
  const exitTh = [...table.querySelectorAll('thead th')].find(th => th.textContent.includes('次の時間決済'));
  if (exitTh && !table.querySelector('thead th.th-exit-distance')) {
    const th = document.createElement('th'); th.className = 'th-exit-distance'; th.textContent = '利確・損切まで';
    th.title = '今の含み損益から、利確（TP）・損切（SL）に届いたときまでの差（口座通貨）。' +
      '損切の額は MT5 が建値から計算した値、利確の額はその比で出した目安。スワップは含まない。';
    exitTh.after(th);
  }

  function slope(p, bySymbol) {
    const open = num(p.open_price), sl = num(p.sl), slYen = num(p.sl_profit_account_currency), vol = num(p.volume);
    if (!(vol > 0) || !(open > 0)) return NaN;
    if (sl > 0 && sl !== open && Number.isFinite(slYen)) return slYen / ((sl - open) * vol);
    const sign = p.type === 1 || String(p.type_text).toUpperCase() === 'SELL' ? -1 : 1;
    if (bySymbol.has(p.symbol)) return sign * bySymbol.get(p.symbol);
    const cur = num(p.current_price), profit = num(p.profit);
    if (Math.abs(cur - open) / open >= 0.0005 && Number.isFinite(profit)) return profit / ((cur - open) * vol);
    return NaN;
  }

  function learn(rows) {
    const bySymbol = new Map();
    for (const p of rows) {
      const open = num(p.open_price), sl = num(p.sl), slYen = num(p.sl_profit_account_currency), vol = num(p.volume);
      if (vol > 0 && sl > 0 && sl !== open && Number.isFinite(slYen)) bySymbol.set(p.symbol, Math.abs(slYen / ((sl - open) * vol)));
    }
    const next = new Map();
    for (const p of rows) {
      const key = String(p.account_login) + ':' + String(p.magic);
      const e = next.get(key) || {n: 0, toTp: 0, toSl: 0, noTp: 0, noSl: 0, slGain: 0};
      e.n++;
      const k = slope(p, bySymbol), vol = num(p.volume), open = num(p.open_price), profit = num(p.profit);
      const tp = num(p.tp), sl = num(p.sl);
      if (tp > 0 && Number.isFinite(k) && Number.isFinite(profit)) e.toTp += k * vol * (tp - open) - profit; else e.noTp++;
      if (sl > 0 && Number.isFinite(profit)) {
        const slYen = Number.isFinite(num(p.sl_profit_account_currency)) ? num(p.sl_profit_account_currency) : k * vol * (sl - open);
        if (Number.isFinite(slYen)) { e.toSl += slYen - profit; if (slYen >= 0) e.slGain++; } else e.noSl++;
      } else e.noSl++;
      next.set(key, e);
    }
    byKey = next; loaded = true;
  }

  const shared = () => (typeof latestPositions !== 'undefined' && Array.isArray(latestPositions) ? latestPositions : null);
  const initialShared = shared();
  let lastShared = initialShared;

  function render() {
    const rows = shared();
    if (rows && rows !== lastShared) { lastShared = rows; learn(rows); }
    for (const tr of table.querySelectorAll('tbody tr')) {
      const exit = tr.querySelector('td.ea-exit-countdown');
      if (!exit) continue;
      let cell = tr.querySelector('td.ea-exit-distance');
      if (!cell) { cell = document.createElement('td'); cell.className = 'ea-exit-distance'; exit.after(cell); }
      cell.replaceChildren(); cell.title = '';
      const open = Number(exit.dataset.exitOpen);
      const e = byKey.get(exit.dataset.exitAccount + ':' + exit.dataset.exitMagic);
      if (open === 0) { cell.textContent = '—'; continue; }
      if (!e) { cell.textContent = loaded ? '未確認' : '確認中'; continue; }
      const add = (cls, text) => { const s = document.createElement('span'); s.className = cls; s.textContent = text; cell.appendChild(s); };
      add('to-tp', '利確まで ' + (e.noTp ? (e.noTp === e.n ? 'TPなし' : yen(e.toTp) + '＋TPなし' + e.noTp + '件') : yen(e.toTp)));
      add('to-sl', '損切まで ' + (e.noSl ? (e.noSl === e.n ? 'SLなし' : yen(e.toSl) + '＋SLなし' + e.noSl + '件') : yen(e.toSl)));
      const notes = [];
      if (e.n > 1) notes.push(e.n + '件の合計');
      if (e.slGain) notes.push('損切でも建値以上' + (e.n > 1 ? `（${e.slGain}件）` : ''));
      if (notes.length) { const s = document.createElement('small'); s.textContent = notes.join('・'); cell.appendChild(s); }
    }
  }
  window.renderEaExitDistance = render;

  async function load() {
    if (busy) return; busy = true;
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch('/api/positions', {cache:'no-store', signal:controller.signal});
      if (!response.ok) throw new Error('unavailable');
      const rows = await response.json();
      if (!Array.isArray(rows)) throw new Error('invalid');
      learn(rows);
    } catch (_) {}
    finally { clearTimeout(timeout); busy = false; render(); }
  }
  if (shared()) render(); else { load(); setInterval(load, 10000); }
})();
