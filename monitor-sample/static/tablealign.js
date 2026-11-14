

(function () {
  "use strict";
  var BADGE = /(^|\s)(tr|vol|fit|zt|vd|cur|vb|rate-pill|ea-badge|lv|st-badge|side-pill|tag|pill|few|ok|ng|vd-sm|chip|rkno)(\s|$)/;

  var NUM = /^[+\-−±]?[\d,]+(\.\d+)?\s*(%|円|R\/件|R|件|回|本|日|時間|分|か月|倍|pt|pips|年|x)?(\s*[（(][^）)]*[）)])?(\s*[／/・].*)?$/;
  var NUMWORD = /^(負けなし|勝ちなし|負けなし\s*\(.*\)|∞)$/;
  var MEMOHEAD = /^(メモ|備考)$/;
  var IDHEAD = /magic|マジック|口座|ticket|チケット|id$|ＩＤ|番号|コード/i;
  var NOMEMO = "#month-table,#t-corr,.kv-table,.no-memo";
  var NORATCHET = "#month-table,#t-corr,.kv-table,.no-ratchet";
  var MEMO = typeof WeakMap === "function" ? new WeakMap() : null;
  function kind(td) {
    var t = (td.textContent || "").replace(/\s+/g, " ").trim();
    if (td.classList && td.classList.contains("ta-memo")) return "empty";
    if (!t || t === "—" || t === "-" || t === "–") return "empty";
    if (td.querySelector(".pc,.posbar,.bx,svg,canvas")) return "center";
    var kids = td.children;
    if (kids.length === 1 && BADGE.test(kids[0].className || "") && (kids[0].textContent || "").trim() === t) return "badge";
    if (NUMWORD.test(t)) return "numword";
    if (NUM.test(t) && t.length <= 40) return "num";
    return "text";
  }
  function headCells(tb) {
    var hrow = tb.tHead && tb.tHead.rows.length ? tb.tHead.rows[tb.tHead.rows.length - 1] : null, out = [];
    if (!hrow) return out;
    var hi = 0;
    for (var x = 0; x < hrow.cells.length; x++) { var hc = hrow.cells[x]; out.push([hi, (hc.textContent || "").replace(/\s+/g, "")]); hi += hc.colSpan || 1; }
    return out;
  }
  function headSig(tb) { return tb.tHead ? tb.tHead.textContent.replace(/\s+/g, "") : ""; }

  function baseSig(tb) {
    if (!tb.tHead) return "";
    var t = ""; tb.tHead.querySelectorAll("th,td").forEach(function (c) { if (!c.classList.contains("ta-memo")) t += c.textContent; });
    return t.replace(/\s+/g, "");
  }
  function ncols(tb) {
    var hrow = tb.tHead && tb.tHead.rows.length ? tb.tHead.rows[tb.tHead.rows.length - 1] : null, n = 0;
    if (hrow) for (var i = 0; i < hrow.cells.length; i++) n += hrow.cells[i].colSpan || 1;
    return n;
  }

  function ensureMemo(tb) {
    var hrow = tb.tHead.rows[tb.tHead.rows.length - 1];
    var last = hrow.cells[hrow.cells.length - 1];
    if (!(last && last.classList.contains("ta-memo"))) {
      var th = document.createElement("th"); th.className = "ta-memo"; th.textContent = "メモ";
      for (var k = 0; k < tb.tHead.rows.length - 1; k++) { var r0 = tb.tHead.rows[k]; if (r0.cells.length) r0.cells[r0.cells.length - 1].colSpan = (r0.cells[r0.cells.length - 1].colSpan || 1) + 1; }
      hrow.appendChild(th);
    }
    var n = ncols(tb);
    for (var b = 0; b < tb.tBodies.length; b++) {
      var rows = tb.tBodies[b].rows;
      for (var r = 0; r < rows.length; r++) {
        var row = rows[r], span = 0, c;
        for (c = 0; c < row.cells.length; c++) span += row.cells[c].colSpan || 1;
        if (span >= n) continue;
        var lc = row.cells[row.cells.length - 1];
        if (row.cells.length === 1 && lc) { lc.colSpan = (lc.colSpan || 1) + (n - span); continue; }
        var td = document.createElement("td"); td.className = "ta-memo"; row.appendChild(td);
      }
    }
  }
  function memoDecision(tb, memo) {


    var avail = tb.offsetWidth; if (!avail) return memo.mon || false;


    var key = baseSig(tb) + "|" + (tb.parentElement ? tb.parentElement.clientWidth : 0);
    if (memo.mkey === key) return memo.mon;
    tb.classList.add("ta-measure");
    var old = tb.style.getPropertyValue("width"), pri = tb.style.getPropertyPriority("width");
    tb.style.setProperty("width", "auto", "important");
    var nat = tb.offsetWidth;
    if (old) tb.style.setProperty("width", old, pri); else tb.style.removeProperty("width");
    tb.classList.remove("ta-measure");

    var spare = avail - nat;
    memo.mkey = key; memo.mon = spare >= 120 && spare >= avail * 0.2;
    return memo.mon;
  }


  function vis(c) { return c.offsetWidth > 0 || getComputedStyle(c).display !== "none"; }
  function visCells(row) { return [].filter.call(row.cells, function (c) { return getComputedStyle(c).display !== "none"; }); }
  function plainRow(tb) {
    var ok = function (row) { if (!row) return false; var cs = visCells(row); if (cs.length < 2) return false; for (var i = 0; i < cs.length; i++) if ((cs[i].colSpan || 1) > 1) return false; return true; };
    var hr0 = tb.tHead && tb.tHead.rows.length ? tb.tHead.rows[tb.tHead.rows.length - 1] : null;
    if (ok(hr0)) return hr0;
    for (var b = 0; b < tb.tBodies.length; b++) for (var r = 0; r < tb.tBodies[b].rows.length; r++) if (ok(tb.tBodies[b].rows[r])) return tb.tBodies[b].rows[r];
    return null;
  }


  function widthTargets(tb, n) {


    var first = tb.tHead && tb.tHead.rows.length ? (tb.tHead.rows.length === 1 ? tb.tHead.rows[0] : null) : (tb.tBodies[0] && tb.tBodies[0].rows[0]);
    if (!first) return null;
    var cs = visCells(first);
    if (cs.length !== n) return null;
    for (var k = 0; k < cs.length; k++) if ((cs[k].colSpan || 1) > 1) return null;
    var cols = [];
    for (var i = 0; i < tb.children.length; i++) if (tb.children[i].tagName === "COLGROUP") [].forEach.call(tb.children[i].children, function (c) { if (getComputedStyle(c).display !== "none") cols.push(c); });
    if (cols.length !== n) cols = [];
    return { cells: cs, cols: cols };
  }
  function setEls(t, ws) { [t.cells, t.cols].forEach(function (els) { for (var i = 0; i < els.length; i++) { var v = (Math.round(ws[i] * 100) / 100) + "px"; if (els[i].style.width !== v) els[i].style.width = v; els[i].dataset.taw = "1"; } }); }
  function clearEls(t) { if (!t) return; [t.cells, t.cols].forEach(function (els) { for (var i = 0; i < els.length; i++) if (els[i].dataset.taw) { els[i].style.removeProperty("width"); delete els[i].dataset.taw; } }); }
  function unfreeze(tb, els) {
    tb.classList.remove("ta-frozen"); setW(tb, null); clearEls(els);
  }
  function setW(tb, w) {
    if (w === null || w === undefined) { if (tb.dataset.taw) { tb.style.removeProperty("width"); delete tb.dataset.taw; } return; }
    var v = (Math.round(w * 100) / 100) + "px";
    if (tb.style.width !== v) { tb.style.width = v; tb.dataset.taw = "1"; }
  }
  function overflowing(tb) {
    var rows = [];
    if (tb.tHead) for (var h = 0; h < tb.tHead.rows.length; h++) rows.push(tb.tHead.rows[h]);
    for (var b = 0; b < tb.tBodies.length; b++) for (var r = 0; r < tb.tBodies[b].rows.length; r++) rows.push(tb.tBodies[b].rows[r]);
    var n = 0;
    for (var i = 0; i < rows.length; i++) for (var j = 0; j < rows[i].cells.length; j++) { var c = rows[i].cells[j]; if (c.offsetWidth && c.scrollWidth > c.clientWidth + 1) n++; }
    return n;
  }
  function freeze(tb, memo) {
    if (!tb.offsetWidth || (tb.matches && tb.matches(NORATCHET))) return;
    var ref = plainRow(tb); if (!ref) return;
    var rc = visCells(ref), n = rc.length;
    var key = (tb.parentElement ? tb.parentElement.clientWidth : 0) + "|" + baseSig(tb) + "|" + n + "|" + (memo.fitOn ? 1 : 0);
    var els = widthTargets(tb, n);
    if (!els) { if (tb.classList.contains("ta-frozen")) unfreeze(tb, null); return; }
    if (memo.fkey === key && memo.fw === null && Date.now() < (memo.retry || 0)) return;
    if (memo.fkey === key && memo.fw && memo.fw.length === n) {
      setEls(els, memo.fw); setW(tb, memo.tw); tb.classList.add("ta-frozen");
      if (!overflowing(tb)) return;
    }

    tb.classList.remove("ta-frozen"); setW(tb, null); clearEls(els); tb.classList.add("ta-auto");
    var ws = []; for (var i = 0; i < n; i++) ws.push(rc[i].getBoundingClientRect().width);
    var tw = tb.getBoundingClientRect().width;
    var room = tb.parentElement ? tb.parentElement.clientWidth : tw;
    tb.classList.remove("ta-auto");


    var thin = false; for (var t2 = 0; t2 < ws.length; t2++) if (ws[t2] < 20) thin = true;
    if (tw > room + 1 || thin) { memo.fkey = key; memo.fw = null; memo.retry = Date.now() + 10000; unfreeze(tb, els); return; }

    var prev = memo.fkey === key && memo.fw && memo.fw.length === n ? memo.fw : null;
    if (prev) {
      var m = [], slack = [], sum = 0, sl = 0;
      for (var j = 0; j < n; j++) { m.push(Math.max(ws[j], prev[j])); slack.push(m[j] - ws[j]); sum += m[j]; sl += slack[j]; }
      var ex = sum - tw;
      if (ex <= 0.5) ws = m;
      else if (sl >= ex) { for (var q = 0; q < n; q++) m[q] -= slack[q] / sl * ex; ws = m; }
    }
    memo.fkey = key; memo.fw = ws; memo.tw = tw;

    setEls(els, ws); setW(tb, tw); tb.classList.add("ta-frozen");

    if (overflowing(tb) || tb.getBoundingClientRect().width > room + 1) { memo.fw = null; memo.retry = Date.now() + 10000; unfreeze(tb, els); }
  }


  var STORE = {};
  function getMemo(tb) {
    var m = MEMO ? MEMO.get(tb) : null;
    if (m) return m;
    var host = tb.parentElement ? tb.parentElement.closest("[id]") : null, idx = 0;
    if (host) { var all = host.querySelectorAll("table"); for (var i = 0; i < all.length; i++) if (all[i] === tb) { idx = i; break; } }
    var key = (tb.id || "") + "@" + (host ? host.id : "") + "#" + idx + "|" + baseSig(tb);
    m = STORE[key];
    if (!m) { m = STORE[key] = { sig: "", dec: {}, ta: "t" + (++SEQ) }; }
    if (MEMO) MEMO.set(tb, m);
    return m;
  }
  function align(tb) {
    var rows = [];
    for (var b = 0; b < tb.tBodies.length; b++) for (var r = 0; r < tb.tBodies[b].rows.length; r++) rows.push(tb.tBodies[b].rows[r]);
    if (!rows.length) return;
    var memo = getMemo(tb);

    var hc = headCells(tb), canMemo = hc.length >= 2 && !(tb.matches && tb.matches(NOMEMO));
    var fit = false, memoCol = -1;
    if (canMemo) {
      var lastH = hc[hc.length - 1];
      var added = tb.tHead.querySelector("th.ta-memo");
      var hasOwn = MEMOHEAD.test(lastH[1]) && !added;
      if (memoDecision(tb, memo)) {
        if (!hasOwn) ensureMemo(tb);
        fit = true;
        hc = headCells(tb); memoCol = hc[hc.length - 1][0];
      } else if (added) {

        tb.querySelectorAll(".ta-memo").forEach(function (e) { if (e.parentNode) e.parentNode.removeChild(e); });
        hc = headCells(tb); memo.mkey = "";
      }
    }
    if (fit) tb.classList.add("ta-fit"); else tb.classList.remove("ta-fit");
    memo.fitOn = fit;
    var cols = {};
    rows.forEach(function (row) {
      var ci = 0;
      for (var i = 0; i < row.cells.length; i++) {
        var c = row.cells[i], k = kind(c), span = c.colSpan || 1;
        if (span === 1) { var m = cols[ci] || (cols[ci] = {}); m[k] = (m[k] || 0) + 1; }
        ci += span;
      }
    });
    var sig = headSig(tb) + "|" + rows.length;
    if (memo.sig !== sig) { memo.sig = sig; memo.dec = {}; }
    var dec = memo.dec;
    hc.forEach(function (h) {
      if (MEMOHEAD.test(h[1]) || /コメント/.test(h[1])) dec[h[0]] = "left";
      else if (IDHEAD.test(h[1])) dec[h[0]] = "center";
    });
    Object.keys(cols).forEach(function (ci) {
      if (dec[ci]) return;
      var m = cols[ci], best = null, bn = 0, mm = {};
      Object.keys(m).forEach(function (k) { var kk = k === "numword" ? "num" : k; mm[kk] = (mm[kk] || 0) + m[k]; });
      Object.keys(mm).forEach(function (k) { if (k !== "empty" && mm[k] > bn) { bn = mm[k]; best = k; } });
      if (!best) return;
      dec[ci] = best === "num" ? "right" : (best === "badge" || best === "center") ? "center" : "left";
    });
    if (tb.dataset.ta !== memo.ta) tb.dataset.ta = memo.ta;
    var T = 'table[data-ta="' + tb.dataset.ta + '"]';
    var css = Object.keys(dec).map(function (ci) {
      return T + '>tbody>tr>*:nth-child(' + (+ci + 1) + '){text-align:' + dec[ci] + '!important}';
    }).join("") + T + '>thead>tr>*{text-align:center!important}';
    if (fit && memoCol >= 0) {

      css += T + '>*>tr>*{width:1%;white-space:nowrap;padding-left:14px!important;padding-right:14px!important}' +
        T + '>*>tr>*:nth-child(' + (memoCol + 1) + '),' + T + '>*>tr>td[colspan]{width:auto;white-space:normal}' +
        T + '>tbody>tr>*:nth-child(' + (memoCol + 1) + '){text-align:left!important}';
    }
    if (RULES[tb.dataset.ta] !== css) { RULES[tb.dataset.ta] = css; flushRules(); }

    freeze(tb, memo);
    rows.forEach(function (row) {
      var ci = 0;
      for (var i = 0; i < row.cells.length; i++) {
        var c = row.cells[i], span = c.colSpan || 1;
        var a = span > 1 ? "center" : (dec[ci] || "left");
        if (c.style.getPropertyValue("text-align") !== a) c.style.setProperty("text-align", a, "important");
        ci += span;
      }
    });
    var hs = tb.tHead ? tb.tHead.querySelectorAll("th,td") : [];
    for (var h = 0; h < hs.length; h++) if (hs[h].style.getPropertyValue("text-align") !== "center") hs[h].style.setProperty("text-align", "center", "important");
  }
  var SEQ = 0, RULES = {}, STYLE = null;
  function flushRules() {
    if (!STYLE) { STYLE = document.createElement("style"); STYLE.id = "tablealign-rules"; document.head.appendChild(STYLE); }

    var all = "table.ta-measure .ta-memo{display:none!important} html body table.ta-measure.ta-measure>*>tr>*{width:auto!important} " +

      "html body table.ta-frozen.ta-frozen.ta-frozen{table-layout:fixed!important} table.ta-frozen td{font-variant-numeric:tabular-nums} " +
      "html body table.ta-measure.ta-measure.ta-measure,html body table.ta-auto.ta-auto.ta-auto{table-layout:auto!important} table.ta-measure>colgroup>col{width:auto!important} " + Object.keys(RULES).map(function (k) { return RULES[k]; }).join(" ");
    if (STYLE.textContent !== all) STYLE.textContent = all;
  }
  var SEL = "table.u-tbl, table.kv-table, table.data-table";
  function run(root) {
    var ts = (root || document).querySelectorAll(SEL);
    for (var i = 0; i < ts.length; i++) { try { align(ts[i]); } catch (e) {   } }
  }
  var BUSY = false;
  function onMut(recs) {
    if (BUSY) return;

    var set = [];
    function add(t) { if (t && set.indexOf(t) < 0) set.push(t); }
    recs.forEach(function (rc) {
      var n = rc.target;
      if (n && n.nodeType === 3) n = n.parentNode;
      if (n && n.closest) add(n.closest(SEL));
      for (var i = 0; i < rc.addedNodes.length; i++) {
        var a = rc.addedNodes[i];
        if (a.nodeType !== 1) continue;
        if (a.matches && a.matches(SEL)) add(a);
        if (a.querySelectorAll) { var inner = a.querySelectorAll(SEL); for (var j = 0; j < inner.length; j++) add(inner[j]); }
      }
    });
    BUSY = true;
    try { set.forEach(function (t) { try { align(t); } catch (e) {   } }); } finally { BUSY = false; }
  }
  var rt = null;
  function start() {
    run();
    if (window.MutationObserver) {
      var mo = new MutationObserver(function (recs) { onMut(recs); mo.takeRecords(); });
      mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    }

    window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(function () { run(); }, 150); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
