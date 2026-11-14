

(function () {
"use strict";
var U = window.UI2 = {};
var $ = function (id) { return document.getElementById(id); };
var each = function (sel, f) { Array.prototype.forEach.call(document.querySelectorAll(sel), f); };
function sgn(v, dg) { if (v === null || v === undefined) return "—"; var s = Math.abs(v).toFixed(dg === undefined ? 2 : dg); return (v > 0 ? "+" : v < 0 ? "−" : "") + s; }
function pct(v, dg) { return v === null || v === undefined ? "—" : sgn(v, dg) + "%"; }
function cls(v) { return v > 0 ? "pos" : v < 0 ? "neg" : ""; }
function syen(v) { if (v === null || v === undefined) return "—"; return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(Math.round(v)).toLocaleString("ja-JP") + "円"; }
function jdate(s) { var p = s.split("-"); return +p[0] + "年" + (+p[1]) + "月" + (+p[2]) + "日"; }
function md(s) { var p = s.split("-"); return (+p[1]) + "/" + (+p[2]); }
function mlabel(m) { var p = m.split("-"); return +p[0] + "年" + (+p[1]) + "月"; }
function hours(h) { if (h === null || h === undefined) return "—"; return h < 48 ? h.toFixed(1) + "時間" : (h / 24).toFixed(1) + "日"; }
function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
var PAIR_ORDER = ["XAU/USD（金）", "EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "EUR/JPY", "GBP/JPY"];
function pidx(p) { var i = PAIR_ORDER.indexOf(p); return i < 0 ? "x" : i; }
function pvars(p) { var i = pidx(p); return "--c:var(--pc-" + i + ");--cs:var(--pcs-" + i + ")"; }
function pcol(p) { return "var(--pc-" + pidx(p) + ")"; }
function ptag(p) { return "<span class='ptag' style='" + pvars(p) + "'><i></i>" + esc(p) + "</span>"; }
function pairRank(p) { var i = PAIR_ORDER.indexOf(p); return i < 0 ? 99 : i; }
function heatBg(v, mx) { var a = Math.min(.5, .07 + .43 * Math.abs(v) / mx); return v >= 0 ? "rgba(21,128,61," + a.toFixed(2) + ")" : "rgba(180,35,24," + a.toFixed(2) + ")"; }
U.h = { sgn: sgn, pct: pct, cls: cls, syen: syen, jdate: jdate, md: md, mlabel: mlabel, hours: hours, esc: esc, pvars: pvars, pcol: pcol, ptag: ptag, pairRank: pairRank, heatBg: heatBg, PAIR_ORDER: PAIR_ORDER };


var NS = "http://www.w3.org/2000/svg";
function el(n, a, parent) { var e = document.createElementNS(NS, n); for (var k in a) e.setAttribute(k, a[k]); if (parent) parent.appendChild(e); return e; }
function niceTicks(lo, hi, n) {
  var span = hi - lo || 1, step = Math.pow(10, Math.floor(Math.log10(span / n))), err = span / n / step;
  if (err >= 7.5) step *= 10; else if (err >= 3.5) step *= 5; else if (err >= 1.5) step *= 2;
  var t = [], v = Math.ceil(lo / step - 1e-9) * step; for (; v <= hi + 1e-9; v += step) t.push(+v.toFixed(6)); return t;
}
function tip(host) { var t = document.createElement("div"); t.className = "tip"; host.appendChild(t); return t; }
function placeTip(t, host, x, y, html) {
  t.innerHTML = html; t.style.opacity = 1; var w = t.offsetWidth, hw = host.clientWidth;
  var left = x + 12; if (left + w > hw) left = x - w - 12; if (left < 0) left = 0; t.style.left = left + "px"; t.style.top = Math.max(0, y - 10) + "px";
}
function lineChart(host, opt) {
  var W = host.clientWidth || 600, H = opt.h, ml = 46, mr = 10, mt = 8, mb = opt.xaxis ? 22 : 6;
  host.innerHTML = "";
  var svg = el("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": opt.label }, host);
  var vals = opt.data.map(function (d) { return opt.y(d); }), lo = Math.min(0, Math.min.apply(null, vals)), hi = Math.max(0, Math.max.apply(null, vals));
  var pad = (hi - lo) * 0.08 || 1; if (hi > 0) hi += pad; if (lo < 0) lo -= pad;
  var n = opt.data.length, X = function (i) { return ml + (W - ml - mr) * (n < 2 ? 0.5 : i / (n - 1)); }, Y = function (v) { return mt + (H - mt - mb) * (hi - v) / (hi - lo); };
  niceTicks(lo, hi, opt.ticks || 4).forEach(function (v) {
    el("line", { x1: ml, x2: W - mr, y1: Y(v), y2: Y(v), stroke: v === 0 ? "var(--u-axis)" : "var(--u-grid)", "stroke-width": 1 }, svg);
    var t = el("text", { x: ml - 6, y: Y(v) + 4, "text-anchor": "end", "class": "tick" }, svg); t.textContent = (v > 0 ? "+" : "") + v + "%";
  });
  if (opt.xaxis) {
    var xf = opt.xfmt, step = Math.max(1, Math.ceil(n / (W < 480 ? 4 : 8))), lastLab = null;
    for (var i = 0; i < n; i += step) {
      var lab = xf(opt.data[i]); if (lab === lastLab) continue; lastLab = lab;
      var t = el("text", { x: X(i), y: H - 5, "text-anchor": i === 0 ? "start" : "middle", "class": "tick" }, svg); t.textContent = lab;
    }
  }
  var pts = opt.data.map(function (d, i) { return X(i).toFixed(1) + "," + Y(opt.y(d)).toFixed(1); });
  el("path", { d: "M" + X(0) + "," + Y(0) + "L" + pts.join("L") + "L" + X(n - 1) + "," + Y(0) + "Z", fill: opt.soft }, svg);
  el("polyline", { points: pts.join(" "), fill: "none", stroke: opt.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
  if (n <= 40) pts.forEach(function (pt) { var xy = pt.split(","); el("circle", { cx: xy[0], cy: xy[1], r: 3, fill: opt.color, stroke: "#fff", "stroke-width": 1.5 }, svg); });
  var cross = el("line", { y1: mt, y2: H - mb, stroke: "var(--u-axis)", "stroke-width": 1, opacity: 0 }, svg);
  var dot = el("circle", { r: 4.5, fill: opt.color, stroke: "#fff", "stroke-width": 2, opacity: 0 }, svg);
  var tp = tip(host);
  function move(ev) {
    var r = svg.getBoundingClientRect(), cx = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left, sx = cx * W / r.width;
    var i = Math.round((sx - ml) / (W - ml - mr) * (n - 1)); i = Math.max(0, Math.min(n - 1, i));
    var d = opt.data[i], x = X(i), y = Y(opt.y(d));
    cross.setAttribute("x1", x); cross.setAttribute("x2", x); cross.setAttribute("opacity", 1);
    dot.setAttribute("cx", x); dot.setAttribute("cy", y); dot.setAttribute("opacity", 1);
    placeTip(tp, host, x * r.width / W, y * r.width / W, opt.tip(d));
  }
  function leave() { cross.setAttribute("opacity", 0); dot.setAttribute("opacity", 0); tp.style.opacity = 0; }
  svg.addEventListener("mousemove", move); svg.addEventListener("touchstart", move, { passive: true }); svg.addEventListener("touchmove", move, { passive: true });
  svg.addEventListener("mouseleave", leave); svg.addEventListener("touchend", leave);
}
function barChart(host, opt) {
  var W = host.clientWidth || 600, rows = opt.rows, n = rows.length; host.innerHTML = "";
  if (!n) return;
  var vals = rows.map(function (r) { return r.v; }), lo = Math.min(0, Math.min.apply(null, vals)), hi = Math.max(0, Math.max.apply(null, vals));
  var pad = (hi - lo) * 0.16 || 1; if (hi > 0) hi += pad; if (lo < 0) lo -= pad;
  var tp, svg;
  if (opt.horizontal) {
    var rowH = opt.h ? Math.min(56, Math.max(26, (opt.h - 22) / n)) : 28, ml = Math.min(130, W * 0.38), mr = 12, mt = 2, mb = 20, H = mt + mb + rowH * n;
    svg = el("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": opt.label }, host);
    var X = function (v) { return ml + (W - ml - mr) * (v - lo) / (hi - lo); };
    niceTicks(lo, hi, W < 420 ? 3 : 4).forEach(function (v) {
      el("line", { x1: X(v), x2: X(v), y1: mt, y2: H - mb, stroke: v === 0 ? "var(--u-axis)" : "var(--u-grid)", "stroke-width": 1 }, svg);
      var t = el("text", { x: X(v), y: H - 5, "text-anchor": "middle", "class": "tick" }, svg); t.textContent = (v > 0 ? "+" : "") + v + "%";
    });
    rows.forEach(function (r, i) {
      var y = mt + i * rowH + rowH * 0.22, h = rowH * 0.56, x0 = X(Math.min(0, r.v)), x1 = X(Math.max(0, r.v));
      var t = el("text", { x: ml - (r.color ? 16 : 8), y: y + h / 2 + 4, "text-anchor": "end", "class": "tick", style: "fill:var(--u-ink2);font-size:13px" }, svg); t.textContent = r.label;
      if (r.color) el("circle", { cx: ml - 8, cy: y + h / 2, r: 4, fill: r.color }, svg);
      var b = el("rect", { x: x0, y: y, width: Math.max(2, x1 - x0), height: h, rx: 3, fill: r.v >= 0 ? "var(--u-up)" : "var(--u-down)" }, svg);
      var vl = el("text", { x: x1 + 4, y: y + h / 2 + 4, "text-anchor": "start", "class": "tick", style: "fill:var(--u-ink2);font-weight:700" }, svg); vl.textContent = pct(r.v, 1);
      var hit = el("rect", { x: ml, y: mt + i * rowH, width: W - ml - mr, height: rowH, fill: "transparent" }, svg);
      bindTip(hit, b, r);
    });
  } else {
    var H2 = opt.h || 160, ml2 = 40, mr2 = 8, mt2 = 14, mb2 = 20, bw = (W - ml2 - mr2) / n;
    svg = el("svg", { viewBox: "0 0 " + W + " " + H2, role: "img", "aria-label": opt.label }, host);
    var Y = function (v) { return mt2 + (H2 - mt2 - mb2) * (hi - v) / (hi - lo); };
    niceTicks(lo, hi, 4).forEach(function (v) {
      el("line", { x1: ml2, x2: W - mr2, y1: Y(v), y2: Y(v), stroke: v === 0 ? "var(--u-axis)" : "var(--u-grid)", "stroke-width": 1 }, svg);
      var t = el("text", { x: ml2 - 6, y: Y(v) + 4, "text-anchor": "end", "class": "tick" }, svg); t.textContent = (v > 0 ? "+" : "") + v + "%";
    });
    rows.forEach(function (r, i) {
      var w = Math.min(44, bw * 0.56), x = ml2 + bw * i + (bw - w) / 2, y0 = Y(Math.max(0, r.v)), y1 = Y(Math.min(0, r.v));
      var b = el("rect", { x: x, y: y0, width: w, height: Math.max(2, y1 - y0), rx: 3, fill: r.v >= 0 ? "var(--u-up)" : "var(--u-down)" }, svg);
      var t = el("text", { x: ml2 + bw * i + bw / 2, y: H2 - 5, "text-anchor": "middle", "class": "tick" }, svg); t.textContent = r.label;
      var lab = el("text", { x: ml2 + bw * i + bw / 2, y: r.v >= 0 ? y0 - 4 : y1 + 12, "text-anchor": "middle", "class": "tick", style: "fill:var(--u-ink2);font-weight:700" }, svg); lab.textContent = pct(r.v, 1);
      var hit = el("rect", { x: ml2 + bw * i, y: mt2, width: bw, height: H2 - mt2 - mb2, fill: "transparent" }, svg);
      bindTip(hit, b, r);
    });
  }
  tp = tip(host);
  function bindTip(hit, bar, r) {
    function show(ev) {
      var rc = svg.getBoundingClientRect(), cx = (ev.touches ? ev.touches[0].clientX : ev.clientX) - rc.left, cy = (ev.touches ? ev.touches[0].clientY : ev.clientY) - rc.top;
      bar.setAttribute("opacity", .8); placeTip(tp, host, cx, cy, r.tip);
    }
    function hide() { bar.setAttribute("opacity", 1); tp.style.opacity = 0; }
    hit.addEventListener("mousemove", show); hit.addEventListener("mouseleave", hide);
    hit.addEventListener("touchstart", show, { passive: true }); hit.addEventListener("touchend", hide);
  }
}

function fanChart(host, c, h) {
  var W = host.clientWidth || 400, H = h || 200, ml = 46, mr = 10, mt = 8, mb = 22, k = c.risk_now;
  host.innerHTML = "";
  var B = [[0, 0, 0, 0, 0, 0]].concat(c.band), N = B.length - 1, P = c.path;
  var vals = []; B.forEach(function (b) { vals.push(b[1] * k, b[5] * k); }); P.forEach(function (v) { vals.push(v * k); });
  var lo = Math.min(0, Math.min.apply(null, vals)), hi = Math.max(0, Math.max.apply(null, vals)), pad = (hi - lo) * 0.06 || 1; hi += pad; lo -= pad;
  var svg = el("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "実運用とバックテストの見比べ" }, host);
  var X = function (i) { return ml + (W - ml - mr) * i / N; }, Y = function (v) { return mt + (H - mt - mb) * (hi - v) / (hi - lo); };
  niceTicks(lo, hi, 4).forEach(function (v) {
    el("line", { x1: ml, x2: W - mr, y1: Y(v), y2: Y(v), stroke: v === 0 ? "var(--u-axis)" : "var(--u-grid)", "stroke-width": 1 }, svg);
    var t = el("text", { x: ml - 6, y: Y(v) + 4, "text-anchor": "end", "class": "tick" }, svg); t.textContent = (v > 0 ? "+" : "") + v + "%";
  });
  var step = Math.max(1, Math.ceil(N / 6));
  for (var i = 0; i <= N; i += step) { var t = el("text", { x: X(i), y: H - 5, "text-anchor": i === 0 ? "start" : "middle", "class": "tick" }, svg); t.textContent = i + "回"; }
  function area(a, b) { var up = B.map(function (r) { return X(r[0]) + "," + Y(r[a] * k); }), dn = B.slice().reverse().map(function (r) { return X(r[0]) + "," + Y(r[b] * k); }); return "M" + up.join("L") + "L" + dn.join("L") + "Z"; }
  el("path", { d: area(5, 1), fill: "var(--u-blue-soft)" }, svg);
  el("path", { d: area(4, 2), fill: "var(--u-blue-mid)" }, svg);
  el("polyline", { points: B.map(function (r) { return X(r[0]) + "," + Y(r[3] * k); }).join(" "), fill: "none", stroke: "var(--u-blue)", "stroke-width": 1.5, "stroke-dasharray": "4 3" }, svg);
  if (P.length > 1) {
    var lp = P.map(function (v, i) { return X(i) + "," + Y(v * k); });
    var lc = c.verdict === "low" ? "var(--u-down)" : "var(--u-ink)";
    el("polyline", { points: lp.join(" "), fill: "none", stroke: lc, "stroke-width": 2.2, "stroke-linejoin": "round" }, svg);
    lp.forEach(function (pt, i) { if (!i) return; var xy = pt.split(","); el("circle", { cx: xy[0], cy: xy[1], r: 3, fill: lc, stroke: "#fff", "stroke-width": 1.2 }, svg); });
  }
  var cross = el("line", { y1: mt, y2: H - mb, stroke: "var(--u-axis)", "stroke-width": 1, opacity: 0 }, svg), tp = tip(host);
  svg.addEventListener("mousemove", function (ev) {
    var r = svg.getBoundingClientRect(), sx = (ev.clientX - r.left) * W / r.width, i = Math.round((sx - ml) / (W - ml - mr) * N); i = Math.max(0, Math.min(N, i));
    var b = B[i], x = X(i); cross.setAttribute("x1", x); cross.setAttribute("x2", x); cross.setAttribute("opacity", 1);
    placeTip(tp, host, x * r.width / W, 20, "<div class='t'>" + i + " 回目まで</div>" + (i < P.length ? "実運用 <b>" + pct(P[i] * k, 1) + "</b><br>" : "") +
      "BT の中央 " + pct(b[3] * k, 1) + "<br>ほぼ収まる範囲 " + pct(b[1] * k, 1) + " 〜 " + pct(b[5] * k, 1));
  });
  svg.addEventListener("mouseleave", function () { cross.setAttribute("opacity", 0); tp.style.opacity = 0; });
}
function spark(v, W, H) {
  v = v || [0]; W = W || 70; H = H || 22; if (v.length < 2) return "<span class='mut'>—</span>";
  var lo = Math.min.apply(null, v.concat([0])), hi = Math.max.apply(null, v.concat([0])), sp = (hi - lo) || 1;
  var pts = v.map(function (y, i) { return (i * (W - 4) / (v.length - 1) + 2).toFixed(1) + "," + (H - 3 - (y - lo) * (H - 6) / sp).toFixed(1); }).join(" ");
  var z = (H - 3 - (0 - lo) * (H - 6) / sp).toFixed(1), up = v[v.length - 1] >= 0, c = up ? "var(--u-up)" : "var(--u-down)", f = up ? "var(--u-up-soft)" : "var(--u-down-soft)";
  var area = "M2," + z + "L" + pts.split(" ").join("L") + "L" + (W - 2) + "," + z + "Z";
  return "<svg class='spark' width='" + W + "' height='" + H + "' viewBox='0 0 " + W + " " + H + "' aria-hidden='true'><path d='" + area + "' fill='" + f + "'/><line x1='2' x2='" + (W - 2) + "' y1='" + z + "' y2='" + z + "' stroke='var(--u-axis)' stroke-width='1' stroke-dasharray='2 2'/><polyline points='" + pts + "' fill='none' stroke='" + c + "' stroke-width='1.6' stroke-linejoin='round' stroke-linecap='round'/></svg>";
}
U.chart = { lineChart: lineChart, barChart: barChart, fanChart: fanChart, spark: spark };


var UNIT_NAME = { day: "日", week: "週", month: "月", year: "年" };
function pkey(d, unit) {
  if (unit === "day") return d;
  if (unit === "month") return d.slice(0, 7);
  if (unit === "year") return d.slice(0, 4);
  var t = new Date(d + "T00:00:00Z"), wd = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - wd); return t.toISOString().slice(0, 10);
}
function aggregate(points, unit) {
  var out = [], idx = {};
  points.forEach(function (p) {
    var k = pkey(p.d, unit), o = idx[k];
    if (!o) { o = idx[k] = { k: k, d: p.d, g: p.g, dd: p.dd === undefined ? null : p.dd }; out.push(o); }
    else { o.d = p.d; o.g = p.g; if (p.dd !== undefined && p.dd !== null) o.dd = o.dd === null ? p.dd : Math.min(o.dd, p.dd); }
  });
  if (unit !== "day" && out.length && points.length) out.unshift({ k: "start", d: points[0].d, g: 0, dd: 0, start: true });
  return out;
}
function plabel(p, unit, long) {
  if (p.start) return long ? jdate(p.d) + "（起点）" : md(p.d);
  if (unit === "day") return long ? jdate(p.k) : md(p.k);
  if (unit === "week") return long ? jdate(p.k) + " の週" : md(p.k) + "週";
  if (unit === "month") return long ? mlabel(p.k) : (+p.k.slice(5)) + "月";
  return p.k + (long ? "年" : "");
}

function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } return null; }


U.data = null;
function load() {
  return fetch("/api/perf-data?_=" + Date.now(), { cache: "no-store", credentials: "same-origin" })
    .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || r.status); return j; }); })
    .then(function (j) { U.data = j; drawAll(); })
    .catch(function (e) { each("[data-u2-error]", function (x) { x.textContent = "成績の数字を読めません: " + e.message; x.hidden = false; }); });
}


var scope = store("perfScope") === "all" ? "all" : "now";
var period = store("ui2_period") || "day";
var uview = store("ui2_view") || "growth";
function V() { var D = U.data; if (!D) return null; return D.views[scope] || D.views.all; }
function setv(id, html, c) { var e = $(id); if (!e) return; e.innerHTML = html; if (c !== undefined) e.className = "v" + (e.classList.contains("big") ? " big" : "") + (c ? " " + c : ""); }
function drawTop() {
  if (!$("u-growth") || !U.data) return;
  var D = U.data, v = V(), S = v.status, R = v.risk || {};
  setv("u-gain", pct(v.gain), cls(v.gain));
  var g = $("u-gain"); if (g) g.classList.add("big");

  var gk = $("u-gain-k"); if (gk) gk.textContent = "損益率（入出金の影響を除く・" + (scope === "now" ? "今の顔ぶれ " + (v.ea_count || "") + "本" : "口座全体") + "・" + md(D.start) + "から " + D.period_days + "日）";
  var sub = $("u-gain-d"); if (sub) { sub.textContent = ""; sub.style.display = "none"; }
  setv("u-maxdd", v.maxdd.toFixed(2) + "%", "neg");
  var ddk = $("u-maxdd-k"); if (ddk) ddk.textContent = "最大ドローダウン（" + (v.equity_dd ? "含み損込み" : "決済で測定") + "）";
  var dd = $("u-maxdd-d"); if (dd) dd.textContent = "いま −" + S.cur_dd.toFixed(2) + "%";
  setv("u-month", pct(S.month), cls(S.month)); var ml = $("u-month-k"); if (ml) ml.textContent = "今月（" + (+S.month_label.slice(5)) + "月）";
  var g7 = $("u-g7"); if (g7) { g7.textContent = pct(S.g7); g7.className = cls(S.g7); }
  var g30 = $("u-g30"); if (g30) { g30.textContent = pct(S.g30); g30.className = cls(S.g30); }
  var mini = function (k, val, c, d) { return "<div class='m'><div class='k'>" + k + "</div><div class='v " + (c || "") + "'>" + val + "</div>" + (d ? "<div class='d'>" + d + "</div>" : "") + "</div>"; };
  if ($("u-risk")) $("u-risk").innerHTML =
    mini("最大の連敗", R.loss_streak + "回") +
    mini("勝った月", R.win_months + " / " + R.months) +
    mini("最高値の更新なし", R.under_now_days + "日", R.under_now_days ? "" : "pos", "最長 " + R.longest_under_days + "日") +
    mini("1回の最大の負け（残高比）", pct(R.worst_trade), cls(R.worst_trade)) +
    mini("最悪の月", pct(R.worst_month), cls(R.worst_month)) +
    mini("最良の月", pct(R.best_month), cls(R.best_month));
  var G = aggregate(v.days, period);

  var views = { growth: ["損益率の推移", "入金・出金の影響を除いた損益率（時間加重）"], month: ["月ごとの損益率", "その月に決済した取引による損益率（緑はプラス・赤はマイナス）"],
    pair: ["通貨ペアごとの寄与", "その通貨ペアの取引の損益率を足したもの"] };
  $("u-view-title").textContent = views[uview][0]; $("u-view-lead").textContent = views[uview][1];
  $("u-view-growth").hidden = uview !== "growth"; $("u-month-bars").hidden = uview !== "month"; $("u-pair-bars").hidden = uview !== "pair";
  each("[data-u-period]", function (b) { b.parentElement.style.visibility = uview === "growth" ? "" : "hidden"; });


  var area = $("u-chart-area"), side = area ? area.closest(".u-card").nextElementSibling : null, stacked = !side || window.innerWidth <= 1280;
  ["u-growth", "u-dd", "u-month-bars", "u-pair-bars"].forEach(function (id) { if ($(id)) $(id).innerHTML = ""; });
  var full = stacked ? Math.max(300, Math.min(420, (area.clientWidth || 800) * 0.42)) : Math.max(280, area.clientHeight - 2);
  var gh = Math.max(180, full - 70 - 26);
  lineChart($("u-growth"), { data: G, y: function (d) { return d.g; }, h: gh,
    color: "var(--u-blue)", soft: "var(--u-blue-soft)", xaxis: true, ticks: 5, label: "損益率の推移（" + UNIT_NAME[period] + "単位）",
    xfmt: function (d) { return plabel(d, period, false); },
    tip: function (d) { return "<div class='t'>" + plabel(d, period, true) + (d.start || period === "day" ? "" : " の終わり") + "</div><b>" + pct(d.g) + "</b>"; } });
  lineChart($("u-dd"), { data: G, y: function (d) { return d.dd || 0; }, h: 70, color: "var(--u-down)", soft: "var(--u-down-soft)", xaxis: false, ticks: 2, label: "ドローダウンの推移",
    tip: function (d) { return "<div class='t'>" + plabel(d, period, true) + "</div>" + (period === "day" ? "その日" : "その" + UNIT_NAME[period]) + "の最大の下げ <b>" + (!d.dd ? "0.00%" : pct(d.dd)) + "</b>"; } });
  var ddl = $("u-dd-label"); if (ddl) ddl.textContent = "ドローダウン（直前の最高値からの下げ・" + (v.equity_dd ? "含み損込み" : "決済で測定") + "）";

  if (uview === "month") barChart($("u-month-bars"), { label: "月ごとの損益率", h: full, rows: v.months.map(function (r) {
    return { label: (+r.m.slice(5)) + "月", v: r.g, tip: "<div class='t'>" + mlabel(r.m) + "</div><b>" + pct(r.g) + "</b>・" + syen(r.yen) + "・" + r.n + "回" }; }) });
  if (uview === "pair") barChart($("u-pair-bars"), { label: "通貨ペアごとの寄与", horizontal: true, h: full, rows: v.pairs.map(function (r) {
    return { label: r.pair, v: r.contrib, color: pcol(r.pair), tip: "<div class='t'>" + esc(r.pair) + "</div>寄与 <b>" + pct(r.contrib) + "</b>・" + syen(r.yen) + "<br>" + r.n + "回・勝率 " + r.win.toFixed(1) + "%・PF " + (r.pf === null ? "—" : r.pf.toFixed(2)) }; }) });
}
function markTop() {
  each("[data-perf-scope]", function (b) { var on = (b.getAttribute("data-perf-scope") === "all" ? "all" : "now") === scope; b.setAttribute("aria-pressed", String(on)); });
  each("[data-u-period]", function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-u-period") === period)); });
  each("[data-u-view]", function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-u-view") === uview)); });
}
function bindTop() {
  each("[data-perf-scope]", function (b) { b.addEventListener("click", function () { scope = b.getAttribute("data-perf-scope") === "all" ? "all" : "now"; markTop(); drawTop(); }); });
  each("[data-u-period]", function (b) { b.addEventListener("click", function () { period = b.getAttribute("data-u-period"); store("ui2_period", period); markTop(); drawTop(); }); });
  each("[data-u-view]", function (b) { b.addEventListener("click", function () { uview = b.getAttribute("data-u-view"); store("ui2_view", uview); markTop(); drawTop(); }); });
  markTop();
}


var eaSort = store("ui2_ea_sort") || "num", eaView = store("ui2_ea_view") || "cards";
function pfText(r) { if (!r.n) return "—"; if (r.pf === null) return r.win >= 100 ? "負けなし" : "—"; return r.pf.toFixed(2); }
function eaLink(r) { return "<a class='ea-link' href='/backtest#" + encodeURIComponent(r.key || r.name) + "' title='詳細データ（バックテストとフォワードの比べ）を開く'>" + esc(r.name) + "</a>"; }
function drawEA() {
  if (!$("u-ea-cards") || !U.data) return;
  var D = U.data, E = (D.eas || []).filter(function (r) { return r.status === "live" || r.status === "unknown"; });
  var traded = E.filter(function (r) { return r.n > 0; }), judged = E.filter(function (r) { return r.cmp && r.cmp.verdict !== "few"; });
  var stat = function (k, v) { return "<div class='stat'><div class='k'>" + k + "</div><div class='v'>" + v + "</div></div>"; };
  $("u-ea-stats").innerHTML = stat("稼働中の EA", E.length + "<small>本</small>") +
    stat("通貨ペア", E.map(function (r) { return r.pair; }).filter(function (p, i, a) { return a.indexOf(p) === i; }).length + "ペア") +
    stat("損益がプラス", traded.filter(function (r) { return r.contrib > 0; }).length + " / " + traded.length + "<small>本</small>") +
    stat("バックテストどおり（5回以上）", judged.filter(function (r) { return r.cmp.verdict === "in" || r.cmp.verdict === "high"; }).length + " / " + judged.length + "<small>本</small>");
  var cmp = { num: function (a, b) { return a.id - b.id; }, contrib: function (a, b) { return b.contrib - a.contrib; }, n: function (a, b) { return b.n - a.n || b.contrib - a.contrib; },
    since: function (a, b) { return (b.since || "").localeCompare(a.since || ""); } }[eaSort] || function (a, b) { return a.id - b.id; };
  var groups = {}, order = [];
  E.forEach(function (r) { if (!groups[r.pair]) { groups[r.pair] = []; order.push(r.pair); } groups[r.pair].push(r); });
  order.sort(function (a, b) { return pairRank(a) - pairRank(b) || a.localeCompare(b); });
  var badge = function (r) {
    var c = r.cmp; if (!c) return "<span class='mut'>—</span>";
    if (c.verdict === "few") return "<span class='vb few' title='5回未満は判定しない'>" + c.n + "回</span>";
    var t = { "in": ["ok", "範囲内"], high: ["ok", "上振れ"], low: ["ng", "下振れ"] }[c.verdict] || ["few", c.verdict];
    return "<span class='vb " + t[0] + "' title='BT で同じ回数続けたときの広がり（90%）と比べた位置：下から " + c.rank + "%'>" + t[1] + "</span>";
  };
  $("u-ea-cards").innerHTML = order.map(function (p) {
    var g = groups[p].sort(function (a, b) { return cmp(a, b) || a.id - b.id; });
    var n = 0, c = 0, y = 0, plus = 0, tr = 0; g.forEach(function (r) { n += r.n; c += r.contrib; y += r.yen || 0; if (r.n) { tr++; if (r.contrib > 0) plus++; } });
    return "<article class='pcard' style='" + pvars(p) + "'>" +
      "<div class='pcard-h'><h3><i></i>" + esc(p) + "</h3><div class='meta'>" + g.length + "本・" + n + "回・<b class='" + cls(y) + "'>" + syen(y) + "</b><br>寄与 <b class='" + cls(c) + "'>" + (n ? pct(c) : "—") + "</b>・プラス " + plus + " / " + tr + "</div></div>" +
      "<div class='u-tbl-wrap'><table class='u-tbl'><thead><tr><th>EA</th><th>回数</th><th>勝率</th><th>PF</th><th>損益</th><th>寄与</th><th>BT比</th><th>推移</th></tr></thead><tbody>" +
      g.map(function (r) {
        return "<tr><td>" + eaLink(r) + "</td><td>" + r.n + "</td><td>" + (r.n ? r.win.toFixed(0) + "%" : "—") + "</td><td>" + pfText(r) + "</td>" +
          "<td class='" + cls(r.yen) + "'>" + (r.n ? syen(r.yen) : "—") + "</td><td class='" + cls(r.contrib) + "'>" + (r.n ? pct(r.contrib) : "—") + "</td>" +
          "<td>" + badge(r) + "</td><td>" + spark(r.spark) + "</td></tr>";
      }).join("") + "</tbody></table></div></article>";
  }).join("");

  var months = (D.views.now || D.views.all).months.map(function (r) { return r.m; });
  var rows = E.slice().sort(function (a, b) { return pairRank(a.pair) - pairRank(b.pair) || a.id - b.id; });
  var mx = 0; rows.forEach(function (r) { if (r.live) months.forEach(function (m) { var v = r.live.monthly[m]; if (v !== undefined) mx = Math.max(mx, Math.abs(v)); }); }); mx = mx || 1;
  var cur = D.asof.slice(0, 7);
  var h = "<thead><tr><th>EA</th><th style='text-align:left'>通貨ペア</th>" + months.map(function (m) { return "<th>" + (+m.slice(5)) + "月" + (m === cur ? "*" : "") + "</th>"; }).join("") + "<th>合計</th><th>損益</th></tr></thead><tbody>";
  rows.forEach(function (r) {
    h += "<tr><td style='box-shadow:inset 3px 0 0 " + pcol(r.pair) + "'>" + eaLink(r) + "</td><td style='text-align:left'>" + ptag(r.pair) + "</td>";
    months.forEach(function (m) {
      var v = r.live ? r.live.monthly[m] : undefined;
      if (v === undefined) { h += "<td class='mut'>·</td>"; return; }
      h += "<td style='background:" + heatBg(v, mx) + "'>" + sgn(v, 2) + "</td>";
    });
    var t = r.live ? r.live.net_pct : null;
    h += "<td class='" + cls(t) + "' style='font-weight:800'>" + (t === null ? "—" : pct(t)) + "</td><td class='" + cls(r.yen) + "'>" + (r.n ? syen(r.yen) : "—") + "</td></tr>";
  });
  $("u-ea-month").innerHTML = h + "</tbody>";
  setEAView(eaView);
}
function setEAView(v) {
  eaView = v; store("ui2_ea_view", v);
  each("[data-eaview]", function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-eaview") === v)); });
  if ($("u-ea-cards")) $("u-ea-cards").hidden = v !== "cards";
  if ($("u-ea-month-wrap")) $("u-ea-month-wrap").hidden = v !== "month";
  if ($("u-ea-sort-wrap")) $("u-ea-sort-wrap").hidden = v !== "cards";
}
function bindEA() {
  each("[data-eaview]", function (b) { b.addEventListener("click", function () { setEAView(b.getAttribute("data-eaview")); }); });
  var s = $("u-ea-sort"); if (s) { s.value = eaSort; s.addEventListener("change", function () { eaSort = s.value; store("ui2_ea_sort", eaSort); drawEA(); }); }
}



U.compare = function (name) {
  U._curCompare = name;
  var host = $("u-cmp"); if (!host) return;
  if (!U.data) { U._pendingCompare = name; return; }
  var r = (U.data.eas || []).filter(function (x) { return (x.key || x.name) === name; })[0];
  if (!r) { host.hidden = true; return; }
  host.hidden = false;
  var b = r.bt ? r.bt.stats : null, L = r.live;
  $("u-cmp-title").innerHTML = "バックテストと実運用の比べ — " + esc(r.name) + " " + ptag(r.pair);
  var days = r.since ? Math.max(1, (Date.now() - new Date(r.since + "T00:00:00+09:00").getTime()) / 86400000) : null;
  var liveYear = r.n && days && days >= 14 ? r.n / days * 365 : null;
  var f2 = function (v, d) { return v === null || v === undefined ? "—" : (+v).toFixed(d === undefined ? 2 : d); };
  var rows = [
    ["取引回数", b ? b.trades + "回（" + f2(b.years, 1) + "年）" : "—", r.n + "回（" + (r.since ? md(r.since) + "から" : "—") + "）", null],
    ["年あたりの回数", b ? f2(b.per_year, 0) + "回" : "—", liveYear === null ? "—" : f2(liveYear, 0) + "回", null, b ? b.per_year : null, liveYear, 0],
    ["勝率", b ? f2(b.win_pct, 1) + "%" : "—", r.n ? f2(r.win, 1) + "%" : "—", 1, b ? b.win_pct : null, r.n ? r.win : null],
    ["PF", b ? f2(b.pf) : "—", !r.n ? "—" : r.pf === null ? (r.win >= 100 ? "負けなし" : "—") : f2(r.pf), 1, b ? b.pf : null, r.pf],
    ["1回の期待値（残高比）", b ? pct(b.expected_pct, 3) : "—", L ? pct(L.expected_pct, 3) : "—", 1, b ? b.expected_pct : null, L ? L.expected_pct : null],
    ["平均の勝ち", b ? pct(b.avg_win_pct) : "—", L ? pct(L.avg_win_pct) : "—", 1, b ? b.avg_win_pct : null, L ? L.avg_win_pct : null],
    ["平均の負け", b ? pct(b.avg_loss_pct) : "—", L ? pct(L.avg_loss_pct) : "—", 1, b ? b.avg_loss_pct : null, L ? L.avg_loss_pct : null],
    ["最良の1回", b ? pct(b.best_trade_pct) : "—", L ? pct(L.best_trade_pct) : "—", null],
    ["最悪の1回", b ? pct(b.worst_trade_pct) : "—", L ? pct(L.worst_trade_pct) : "—", 1, b ? b.worst_trade_pct : null, L ? L.worst_trade_pct : null],
    ["最大の連敗", b ? b.max_loss_streak + "回" : "—", L ? L.max_loss_streak + "回" : "—", -1, b ? b.max_loss_streak : null, L ? L.max_loss_streak : null],
    ["平均の保有", b ? hours(b.hold_avg_hours) : "—", hours(r.hold), null],
    ["最大ドローダウン（決済）", b ? f2(b.max_dd_pct, 1) + "%" : "—", L ? f2(L.max_dd_pct, 2) + "%" : "—", null]
  ];
  var mark = function (row) {
    if (row[3] === null || row[3] === undefined || row[4] === null || row[4] === undefined || row[5] === null || row[5] === undefined || !r.n) return "";
    var d = (row[5] - row[4]) * row[3];
    if (Math.abs(row[5] - row[4]) < 1e-9) return "<span class='mut'>同じ</span>";
    return d > 0 ? "<span class='pos'>▲ 上</span>" : "<span class='neg'>▼ 下</span>";
  };


  var MEMO = {
    "取引回数": "実運用は動かし始めてからの決済の数。少ないうちは下の比べが大きくぶれる",
    "年あたりの回数": "実運用は2週間以上動かしてから年に直す。差は建てる回数の違い",
    "勝率": "勝った決済の割合。5回未満では読めない",
    "PF": "勝ちの合計÷負けの合計。1 を超えれば黒字",
    "1回の期待値（残高比）": "1回で口座残高の何%増えたか（BT はリスク" + (r.bt ? r.bt.risk : "—") + "%の複利）",
    "平均の勝ち": "勝った決済の平均（残高比）",
    "平均の負け": "負けた決済の平均（残高比）。損切り幅どおりなら BT と近くなる",
    "最良の1回": "1回でいちばん大きい勝ち",
    "最悪の1回": "1回でいちばん大きい負け。BT より大きければ滑りや窓を疑う",
    "最大の連敗": "続けて負けた回数の最長。BT は15年の中での最長",
    "平均の保有": "建ててから決済までの平均",
    "最大ドローダウン（決済）": "決済だけで見た山からの落ち込み。期間の長さが違うので BT とは直接比べない"
  };
  $("u-cmp-table").innerHTML = "<colgroup><col class='c-k'><col class='c-n'><col class='c-n'><col class='c-m'><col class='c-memo'></colgroup>" +
    "<thead><tr><th>項目</th><th>バックテスト</th><th>実運用</th><th>実運用は</th><th class='memo'>メモ</th></tr></thead><tbody>" +
    rows.map(function (row) { return "<tr><td>" + row[0] + "</td><td>" + row[1] + "</td><td><b>" + row[2] + "</b></td><td>" + mark(row) + "</td><td class='memo'>" + esc(MEMO[row[0]] || "") + "</td></tr>"; }).join("") + "</tbody>";
  var c = r.cmp, v = $("u-cmp-verdict");
  if (!c) { v.innerHTML = "<span class='vb few'>比べられません</span> バックテストの1回ごとの記録がありません。"; $("u-cmp-fan").innerHTML = ""; }
  else {
    var txt = { "in": ["ok", "バックテストの範囲内"], high: ["ok", "バックテストより上振れ"], low: ["ng", "バックテストより下振れ"], few: ["few", "まだ判定しない（5回未満）"] }[c.verdict];
    v.innerHTML = "<span class='vb " + txt[0] + "'>" + txt[1] + "</span> 実運用 " + c.n + "回の合計 <b class='" + cls(c.total_r) + "'>" + sgn(c.total_r, 2) + "R</b>" +
      (c.rank !== null && c.rank !== undefined ? "・同じ回数のバックテストの中で下から <b>" + c.rank + "%</b>" : "");
  }
  $("u-cmp-note").textContent = "率は口座残高に対する割合（実運用は決済直前の残高・バックテストはリスク" + (r.bt ? r.bt.risk : "—") + "%の複利）。実運用は回数が少ないうちは大きくぶれます。帯は、バックテストで同じ回数だけ続けて取引したときの広がり（濃い帯 50%・薄い帯 90%）。";


  if (c) {
    var fan = $("u-cmp-fan"), fc = fan.closest(".u-card"), tc = $("u-cmp-table").closest(".u-card"), fh = 230;
    fan.innerHTML = "";
    if (fc && tc) {

      fc.style.alignSelf = tc.style.alignSelf = "start";
      if (fc.offsetTop === tc.offsetTop) fh = Math.max(230, tc.offsetHeight - fc.offsetHeight - 4);
      fc.style.alignSelf = tc.style.alignSelf = "";
    }
    fanChart(fan, c, fh);
  }
};
var _onData = null;
function drawAll() { drawTop(); drawEA(); if (U._pendingCompare !== undefined || U._curCompare) U.compare(U._pendingCompare || U._curCompare); U._pendingCompare = undefined; if (U.onData) U.onData(U.data); }
U.load = load; U.drawAll = drawAll;
var rt = null;
window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(drawAll, 150); });
document.addEventListener("click", function (e) { var b = e.target.closest && e.target.closest(".tab-button[data-tab]"); if (b) setTimeout(drawAll, 30); });
function watchSide() {
  var area = $("u-chart-area"); if (!area || !window.ResizeObserver) return;
  var side = area.closest(".u-card").nextElementSibling, last = 0, tmr = null;
  if (!side) return;
  new ResizeObserver(function () { var h = side.offsetHeight; if (Math.abs(h - last) < 2) return; last = h; clearTimeout(tmr); tmr = setTimeout(drawTop, 80); }).observe(side);
}
function start() { bindTop(); bindEA(); watchSide(); load(); setInterval(load, 120000); }
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
