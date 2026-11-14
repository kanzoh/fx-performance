

function sideCell(e) {
  const b = Number(e.open_buy || 0);
  const s = Number(e.open_sell || 0);
  if (!b && !s) return "-";
  if (b && !s) return `<span class="side-pill side-buy">買い${b > 1 ? " " + b : ""}</span>`;
  if (s && !b) return `<span class="side-pill side-sell">売り${s > 1 ? " " + s : ""}</span>`;
  return `<span class="side-pill side-buy">買い${b}</span><span class="side-pill side-sell">売り${s}</span>`;
}

const FAST_POLL_MS = 500;
const SLOW_POLL_MS = 500;

const CHART_POLL_MS = 2500;

const IDLE_BASIS_POLL_MS = 10 * 60 * 1000;

let latestSummary = null;
let latestTrades = [];
let latestPositions = [];
let latestOrders = [];
let latestPerformance = null;
let idleBasisByMagic = null;
let idleGapsByMagic = new Map();
let idleBasisId = null;

let riskPctByMagic = new Map();
let liveRiskPct = null;
let riskLoadFailed = false;
let chart;
const chartHistoryByKey = new Map();
let chartMode = localStorage.getItem("chartMode") === "account" ? "account" : "ea";

let perfScope = localStorage.getItem("perfScope") === "all" ? "all" : "lineup";
const DEFAULT_EA_NAMES = new Map([]);

const DISPLAY_EA_NAMES = {};

function mergeEaNames(serverNames) {
  const merged = new Map(DEFAULT_EA_NAMES);
  for (const [magic, name] of Object.entries(serverNames || {})) {
    if (name) merged.set(String(magic), DISPLAY_EA_NAMES[String(name)] || String(name));
  }
  return merged;
}
let eaNames = new Map(DEFAULT_EA_NAMES);

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}

async function fetchJSON(url) {
  const sep = url.includes("?") ? "&" : "?";
  const res = await fetch(`${url}${sep}_=${Date.now()}`, { cache: "no-store" });
  return res.json();
}

const ACTION_TIMEOUT_MS = 15000;

async function postJSON(url, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ACTION_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("サーバーへの接続が不安定なため、応答がありませんでした(15秒)。回線状況を確認し、もう一度お試しください。");
    }
    throw new Error("サーバーに接続できませんでした。回線状況を確認してください。");
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `リクエストが失敗しました(${res.status})`);
  }
  return data;
}

async function refreshAfterAction(...refreshFns) {
  try {
    await Promise.all(refreshFns.map((fn) => fn()));
  } catch (error) {
    console.warn("post-action refresh failed (action itself already succeeded):", error);
  }
}

function fmt(n) {
  if (n === null || n === undefined) return "-";
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtPrice(n) {
  if (n === null || n === undefined) return "-";
  const value = Number(n);
  if (!Number.isFinite(value)) return "-";
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 5 });
}

function fmtPips(n) {
  if (n === null || n === undefined || n === "") return "-";
  const value = Number(n);
  if (!Number.isFinite(value)) return "-";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

function pipsClass(n) {
  return profitClass(n);
}

function fmtSigned(n) {
  if (n === null || n === undefined) return "-";
  const value = Number(n);
  const sign = value > 0 ? "+" : "";
  return sign + value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtYen(n) {
  if (n === null || n === undefined) return "-";
  return Number(n).toLocaleString("ja-JP", { maximumFractionDigits: 0 }) + "円";
}

function fmtSignedYen(n) {
  if (n === null || n === undefined) return "-";
  const value = Number(n);
  const sign = value > 0 ? "+" : "";
  return sign + value.toLocaleString("ja-JP", { maximumFractionDigits: 0 }) + "円";
}

function pctDigits(value) {
  const a = Math.abs(value);
  if (a === 0) return 1;
  if (a >= 0.05) return 1;
  if (a >= 0.005) return 2;
  if (a >= 0.0005) return 3;
  return -1;
}

function pctBody(value) {
  const d = pctDigits(value);
  if (d < 0) return (value < 0 ? "-" : "") + "<0.001%";
  return value.toLocaleString("ja-JP", { minimumFractionDigits: d, maximumFractionDigits: d }) + "%";
}

function fmtPct(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "-";
  const value = Number(n);
  const sign = value > 0 ? "+" : "";
  return sign + pctBody(value);
}

function fmtPlainPct(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "-";
  return pctBody(Number(n));
}

let adaptiveMeasureCanvas = null;

function clampColumnWidth(value, min, max) {
  return Math.max(min, Math.min(max, Math.ceil(value)));
}

function tableTextWidth(text) {
  if (!adaptiveMeasureCanvas) adaptiveMeasureCanvas = document.createElement("canvas");
  const ctx = adaptiveMeasureCanvas.getContext("2d");
  const sample = document.querySelector(".data-table td") || document.querySelector(".data-table") || document.body;
  const style = window.getComputedStyle(sample);
  ctx.font = `${style.fontWeight || "720"} ${style.fontSize || "17px"} ${style.fontFamily || "sans-serif"}`;
  return ctx.measureText(String(text ?? "-")).width;
}

function widthForTexts(texts, min, max, padding = 30) {
  let widest = 0;
  for (const text of texts) widest = Math.max(widest, tableTextWidth(text));
  return clampColumnWidth(widest + padding, min, max);
}

function addWidthText(set, value) {
  if (value === null || value === undefined || value === "") return;
  set.add(String(value));
}

function addMoneyWidthText(set, value, signed = true) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return;
  set.add(signed ? fmtSignedYen(value) : fmtYen(value));
}

function rowList(value) {
  return Array.isArray(value) ? value : [];
}

function updateAdaptiveColumnWidths() {

  const eaTexts = new Set(["未設定"]);
  const magicTexts = new Set(["888999"]);
  const accountTexts = new Set(["30004813"]);
  const symbolTexts = new Set(["EURUSD", "USDJPY"]);
  const moneyTexts = new Set([fmtYen(0), fmtSignedYen(0)]);
  const profitTexts = new Set([fmtSignedYen(0)]);
  const realizedTexts = new Set([fmtSignedYen(0)]);
  const percentTexts = new Set([fmtPct(0), fmtPlainPct(100)]);
  const pipsTexts = new Set([fmtPips(0), fmtPips(123.4), fmtPips(-123.4)]);
  const pfTexts = new Set([fmtRatio(0), fmtRatio(10)]);
  const rfTexts = new Set([fmtRatio(0), fmtRatio(10)]);
  const srTexts = new Set([fmtRatio(0), fmtRatio(100)]);

  const addIdentity = (row) => {
    if (!row) return;
    const magic = row.magic === null || row.magic === undefined || row.magic === "" ? "-" : String(row.magic);
    if (magic !== "-" && magic !== "0") {
      addWidthText(magicTexts, magic);
      addWidthText(eaTexts, row.ea_name || row.expert_name || eaNames.get(magic) || "\u672a\u8a2d\u5b9a");
    }
    addWidthText(accountTexts, row.account_login);
    addWidthText(symbolTexts, row.symbol || row.symbols);
  };

  for (const account of rowList(latestSummary?.accounts)) {
    addWidthText(accountTexts, account.account_login);
    for (const field of ["balance", "equity", "margin", "free_margin"]) addMoneyWidthText(moneyTexts, account[field], false);
    addMoneyWidthText(profitTexts, account.profit, true);
  }

  for (const row of rowList(latestSummary?.ea_stats)) {
    addIdentity(row);
    addMoneyWidthText(moneyTexts, row.floating_profit, true);
    addMoneyWidthText(profitTexts, row.floating_profit, true);
    addMoneyWidthText(realizedTexts, row.total_profit, true);
    addWidthText(pipsTexts, fmtPips(row.tp_pips));
    addWidthText(pipsTexts, fmtPips(row.sl_pips));
    addWidthText(pipsTexts, fmtPips(row.current_pips));
  }

  const performanceRows = [latestPerformance?.total]
    .concat(rowList(latestPerformance?.by_account))
    .concat(rowList(latestPerformance?.by_ea))
    .concat(rowList(latestPerformance?.by_account_ea))
    .filter(Boolean);
  for (const row of performanceRows) {
    addIdentity(row);
    for (const field of ["gross_profit", "profit", "floating_profit", "live_profit", "dd", "expectancy"]) {
      addMoneyWidthText(moneyTexts, row[field], field !== "gross_profit" && field !== "dd");
    }
    if (row.gross_loss !== null && row.gross_loss !== undefined) addWidthText(moneyTexts, fmtLossYen(row.gross_loss));
    addWidthText(pfTexts, fmtPf(row));
    addWidthText(rfTexts, fmtRatio(row.rf));
    addWidthText(srTexts, fmtRatio(row.sr));
    addWidthText(percentTexts, fmtPlainPct(row.dd_pct));
    addWidthText(percentTexts, fmtPlainPct(row.win_rate));
    addWidthText(percentTexts, fmtPct(row.annual_return));
  }

  for (const row of rowList(latestTrades)) {
    addIdentity(row);
    addMoneyWidthText(moneyTexts, row.profit, true);
    addMoneyWidthText(profitTexts, row.profit, true);
  }

  for (const row of rowList(latestPositions).concat(rowList(latestOrders))) {
    addIdentity(row);
    addMoneyWidthText(moneyTexts, row.swap, true);
    addMoneyWidthText(moneyTexts, row.profit, true);
    addMoneyWidthText(profitTexts, row.profit, true);
    addWidthText(pipsTexts, fmtPips(row.tp_pips));
    addWidthText(pipsTexts, fmtPips(row.sl_pips));
    addWidthText(pipsTexts, fmtPips(row.current_pips));
  }

  const eaWidth = widthForTexts(eaTexts, 150, 560, 64);
  const magicWidth = widthForTexts(magicTexts, 86, 104, 32);
  const accountWidth = widthForTexts(accountTexts, 100, 124, 32);
  const symbolWidth = widthForTexts(symbolTexts, 88, 112, 32);
  const moneyWidth = widthForTexts(moneyTexts, 112, 150, 30);
  const profitWidth = widthForTexts(profitTexts, 112, 152, 30);
  const realizedWidth = widthForTexts(realizedTexts, 112, 152, 30);
  const pfWidth = widthForTexts(pfTexts, 74, 94, 30);
  const rfWidth = widthForTexts(rfTexts, 74, 100, 30);
  const srWidth = widthForTexts(srTexts, 86, 128, 34);
  const percentWidth = widthForTexts(percentTexts, 100, 132, 32);
  const pipsWidth = widthForTexts(pipsTexts, 88, 118, 28);
  const rateWidth = Math.max(116, percentWidth);
  const ddMoneyWidth = Math.max(100, Math.min(138, moneyWidth - 8));
  const expectancyWidth = Math.max(102, Math.min(140, moneyWidth - 4));

  const metricWidth = 92 + 92 + 92 + pfWidth + rfWidth + srWidth + (moneyWidth * 5) + ddMoneyWidth + expectancyWidth + percentWidth + rateWidth + 132;
  const memoMin = 170;
  const commentMin = 180;
  const eaTableMin = eaWidth + magicWidth + symbolWidth + 190 + 92 + 58 + 92 + profitWidth + realizedWidth + percentWidth + rateWidth + 290 + memoMin + 24;
  const accountPerformanceMin = accountWidth + metricWidth + memoMin + 24;
  const eaPerformanceMin = eaWidth + magicWidth + symbolWidth + metricWidth + memoMin + 24;
  const accountEaPerformanceMin = accountWidth + eaWidth + magicWidth + symbolWidth + metricWidth + memoMin + 24;
  const tradesTableMin = eaWidth + magicWidth + accountWidth + 116 + 108 + symbolWidth + 58 + moneyWidth + 148 + 148 + commentMin + 24;
  const positionsTableMin = eaWidth + magicWidth + accountWidth + 116 + symbolWidth + 58 + 110 + moneyWidth + profitWidth + 148 + Math.max(commentMin, 280) + 24;

  const root = document.documentElement.style;
  root.setProperty("--col-ea-width", `${eaWidth}px`);
  root.setProperty("--ea-badge-max-width", `${Math.max(90, eaWidth - 24)}px`);
  root.setProperty("--col-magic-width", `${magicWidth}px`);
  root.setProperty("--col-account-width", `${accountWidth}px`);
  root.setProperty("--col-symbol-width", `${symbolWidth}px`);
  root.setProperty("--col-money-width", `${moneyWidth}px`);
  root.setProperty("--col-profit-width", `${profitWidth}px`);
  root.setProperty("--col-realized-width", `${realizedWidth}px`);
  root.setProperty("--col-pf-width", `${pfWidth}px`);
  root.setProperty("--col-rf-width", `${rfWidth}px`);
  root.setProperty("--col-sr-width", `${srWidth}px`);
  root.setProperty("--col-percent-width", `${percentWidth}px`);
  root.setProperty("--col-rate-width", `${rateWidth}px`);
  root.setProperty("--col-pips-width", `${pipsWidth}px`);
  root.setProperty("--col-dd-money-width", `${ddMoneyWidth}px`);
  root.setProperty("--col-expectancy-width", `${expectancyWidth}px`);
  root.setProperty("--ea-table-min-width", `${eaTableMin}px`);
  root.setProperty("--account-performance-table-min-width", `${accountPerformanceMin}px`);
  root.setProperty("--ea-performance-table-min-width", `${eaPerformanceMin}px`);
  root.setProperty("--account-ea-performance-table-min-width", `${accountEaPerformanceMin}px`);
  root.setProperty("--trades-table-min-width", `${tradesTableMin}px`);
  root.setProperty("--positions-table-min-width", `${positionsTableMin}px`);
}
function fmtRatio(n) {
  if (n === null || n === undefined) return "-";
  const value = Number(n);
  if (!Number.isFinite(value)) return "-";
  return value.toLocaleString("ja-JP", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPf(row) {
  if (row?.pf !== null && row?.pf !== undefined) return fmtRatio(row.pf);
  const grossProfit = Number(row?.gross_profit || 0);
  const grossLoss = Number(row?.gross_loss || 0);
  if (grossProfit === 0 && grossLoss > 0) return "0.00";
  return "-";
}

function fmtRf(row) {
  if (row?.rf !== null && row?.rf !== undefined) return fmtRatio(row.rf);
  const profit = Number(row?.profit || 0);
  const dd = Number(row?.dd || 0);
  if (profit <= 0 && dd === 0) return "0.00";
  return "-";
}

function fmtTime(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtTimeMs(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const base = d.toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return `${base}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

function fmtResetTime(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function niceScale(min, max, targetTicks) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    min = Number.isFinite(min) ? min : 0;
    max = min + 1;
  }
  const span = max - min;
  const rawStep = span / targetTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const niceNorm = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  const step = niceNorm * mag;
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = niceMin; v <= niceMax + step / 1000; v += step) {
    ticks.push(Math.round(v / step) * step);
  }
  return { min: niceMin, max: niceMax, step, ticks };
}

function profitClass(n) {
  const value = Number(n || 0);
  if (value > 0) return "profit-positive";
  if (value < 0) return "profit-negative";
  return "profit-flat";
}

function ratioClass(n, breakeven) {
  if (n === "∞") return "profit-positive";
  const value = Number(n);
  if (!Number.isFinite(value)) return "profit-flat";
  if (value > breakeven) return "profit-positive";
  if (value < breakeven) return "profit-negative";
  return "profit-flat";
}

function winRateClass(rate) {
  if (rate === null || rate === undefined || Number.isNaN(Number(rate))) return "rate-flat";
  if (rate >= 70) return "rate-good";
  if (rate >= 50) return "rate-mid";
  return "rate-low";
}

const MAGIC_BADGE_COLORS = [
  { bg: "#e8f0ff", border: "#8aa8f7", text: "#1e3a8a" },
  { bg: "#e7f7f0", border: "#74c69d", text: "#166534" },
  { bg: "#fff4d6", border: "#f3ba4d", text: "#8a4b00" },
  { bg: "#fbe7ee", border: "#e98aae", text: "#9f1239" },
  { bg: "#e7f6fb", border: "#67c2d5", text: "#155e75" },
  { bg: "#efe9ff", border: "#a78bfa", text: "#4c1d95" },
  { bg: "#edf7df", border: "#a3d977", text: "#3f6212" },
];

function magicHash(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function activeMagicList() {
  const values = rowList(latestSummary?.ea_stats)
    .map((row) => String(row.magic ?? ""))
    .filter((value) => value && value !== "0" && value !== "-");
  for (const key of eaNames.keys()) {
    const value = String(key ?? "");
    if (value && value !== "0" && value !== "-") values.push(value);
  }
  return values
    .filter((value, index, list) => list.indexOf(value) === index)
    .sort((a, b) => a.localeCompare(b, "ja-JP", { numeric: true }));
}

function indexedMagicColor(index) {
  const paletteIndex = index % MAGIC_BADGE_COLORS.length;
  const cycle = Math.floor(index / MAGIC_BADGE_COLORS.length);
  if (cycle === 0) return MAGIC_BADGE_COLORS[paletteIndex];
  const hue = Math.round((index * 137.508) % 360);
  const saturation = 62 + (index % 5) * 4;
  const bgLightness = 92 - (cycle % 3) * 3;
  const borderLightness = 42 - Math.min(cycle % 3, 2) * 3;
  return {
    bg: `hsl(${hue} ${Math.min(saturation + 10, 84)}% ${bgLightness}%)`,
    border: `hsl(${hue} ${saturation}% ${borderLightness}%)`,
    text: `hsl(${hue} ${Math.min(saturation + 8, 86)}% 24%)`,
  };
}

const PAIR_ORDER = ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "EURJPY", "GBPJPY"];
const PAIR_HUES = { XAUUSD: 42, EURUSD: 218, GBPUSD: 275, USDJPY: 352, AUDUSD: 140, EURJPY: 188, GBPJPY: 22 };

function pairOfSymbols(value) {

  const first = String(value || "").split(/[,\s/]+/).filter(Boolean)[0] || "";
  const m = first.toUpperCase().match(/^[A-Z]{6}/);
  return m ? m[0] : "";
}

function symbolByMagicMap() {
  const map = new Map();
  const add = (rows) => {
    for (const row of rowList(rows)) {
      const magic = String(row.magic ?? "");
      if (!magic || magic === "0" || magic === "-" || map.has(magic)) continue;
      const pair = pairOfSymbols(row.symbols || row.symbol);
      if (pair) map.set(magic, pair);
    }
  };
  add(latestSummary?.ea_stats);
  add(latestPerformance?.by_ea);
  add(latestPerformance?.by_account_ea);
  return map;
}

function pairRank(pair) {
  const i = PAIR_ORDER.indexOf(pair);
  return i >= 0 ? i : pair ? PAIR_ORDER.length : PAIR_ORDER.length + 1;
}

function comparePairThenName(aMagic, bMagic, pairs = symbolByMagicMap()) {
  const a = String(aMagic ?? ""), b = String(bMagic ?? "");
  const pa = pairs.get(a) || "", pb = pairs.get(b) || "";
  return (pairRank(pa) - pairRank(pb))
    || pa.localeCompare(pb)
    || (eaNames.get(a) || a).localeCompare(eaNames.get(b) || b, "ja-JP", { numeric: true })
    || a.localeCompare(b, "ja-JP", { numeric: true });
}

function pairShadeColor(pair, index, count) {
  let hue = PAIR_HUES[pair];
  if (hue === undefined) hue = magicHash(pair) % 360;
  const t = count > 1 ? index / (count - 1) : 0;
  const bgL = Math.round(94 - t * 12);
  const borderL = Math.round(52 - t * 14);
  const textL = Math.round(34 - t * 16);
  return {
    bg: `hsl(${hue} 78% ${bgL}%)`,
    border: `hsl(${hue} 62% ${borderL}%)`,
    text: `hsl(${hue} 80% ${textL}%)`,
  };
}

function magicColor(magic) {
  const text = String(magic ?? "-");
  const pairs = symbolByMagicMap();
  const pair = pairs.get(text);
  if (pair) {
    const members = [...pairs.entries()].filter(([, p]) => p === pair).map(([m]) => m)
      .sort((a, b) => comparePairThenName(a, b, pairs));
    return pairShadeColor(pair, members.indexOf(text), members.length);
  }
  const activeMagics = activeMagicList();
  const activeIndex = activeMagics.indexOf(text);
  if (activeIndex >= 0) return indexedMagicColor(activeIndex);
  return indexedMagicColor(magicHash(text) % Math.max(MAGIC_BADGE_COLORS.length, 24));
}

function eaBadge(magic) {
  const magicKey = magic === null || magic === undefined || magic === "" ? "-" : String(magic);
  const name = magicKey !== "-" ? eaNames.get(magicKey) : null;
  const label = name || magicKey;
  const title = name ? `${name} (${magicKey}) - クリックして名前を編集` : `${magicKey} - クリックして名前を設定`;
  const color = magicColor(magicKey);
  const clickable = magicKey === "-" ? "" : ` data-ea-badge-magic="${magicKey}"`;
  return `<span class="ea-badge" title="${escapeHtml(title)}"${clickable} style="--magic-bg:${color.bg};--magic-border:${color.border};--magic-text:${color.text}">${escapeHtml(label)}</span>`;
}

function eaNameCell(magic) {
  const magicKey = magic === null || magic === undefined || magic === "" ? "-" : String(magic);
  if (magicKey === "-" || magicKey === "0") return "-";
  if (eaNames.get(magicKey)) return `<span class="ea-name-wrap">${eaBadge(magicKey)}</span>`;
  return `<span class="ea-name-wrap ea-name-wrap-unnamed"><span class="ea-badge ea-badge-unnamed" title="${magicKey} - set EA name" data-ea-badge-magic="${magicKey}">\u672a\u8a2d\u5b9a</span></span>`;
}

function parseTradeTime(value) {
  if (!value) return null;
  if (typeof value === "string") {
    const m = value.match(/^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function sameLocalDay(a, b) {
  return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function accountServerNow(account) {
  return account ? parseTradeTime(account.export_time) : null;
}

function isTradeOnDay(trade, day) {
  const closeTime = parseTradeTime(trade.close_time);
  return sameLocalDay(closeTime, day);
}

function resolveTradingDay(trades, accountsByLogin) {
  for (const account of accountsByLogin.values()) {
    const serverNow = accountServerNow(account);
    if (serverNow) return serverNow;
  }
  let latest = null;
  for (const t of trades) {
    const closeTime = parseTradeTime(t.close_time);
    if (closeTime && (!latest || closeTime.getTime() > latest.getTime())) latest = closeTime;
  }
  return latest;
}

function levelLabel(level) {
  if (level === "danger") return "危険";
  if (level === "warn") return "注意";
  return "確認";
}

function inferAlertMeasure(alert) {
  if (alert.measure) return alert.measure;
  const text = `${alert.title || ""} ${alert.action || ""}`;
  const mentionsStop = /停止|stop|STOP|豁｢|蛛懈/.test(text);
  const mentionsConfirm = /確認|疑|遒ｺ隱/.test(text);
  if (mentionsStop && mentionsConfirm && alert.level !== "danger") return "停止疑いを検知";
  if (mentionsStop) return "停止推奨（自動停止なし）";
  if (alert.level === "danger") return "警告発動（通知のみ）";
  if (alert.level === "warn") return "注意喚起（通知のみ）";
  return "確認表示";
}

function pushAlert(alerts, alert) {
  alerts.push({
    level: alert.level,
    scope: alert.scope || "ea",
    title: alert.title,
    current: alert.current || "",
    threshold: alert.threshold || "",
    measure: inferAlertMeasure(alert),
    action: alert.action || "",
    basis: alert.basis || "",
    badge: alert.badge || "",
    score: alert.score || 0,
  });
}

function alertLevelByThreshold(value, warnValue, dangerValue, direction = "lower") {
  if (!Number.isFinite(value)) return null;
  if (direction === "lower") {
    if (value < dangerValue) return "danger";
    if (value < warnValue) return "warn";
  } else {
    if (value >= dangerValue) return "danger";
    if (value >= warnValue) return "warn";
  }
  return null;
}

function losingStreakProbability(winRate, streak) {
  const wr = Number(winRate);
  if (!Number.isFinite(wr) || wr < 0 || wr > 100 || streak <= 0) return null;
  return Math.pow(1 - (wr / 100), streak) * 100;
}

function htmlText(html) {
  const template = document.createElement("template");
  template.innerHTML = html || "";
  return template.content.textContent.trim();
}

function accountBadge(login) {
  return `<span class="account-badge">${login}</span>`;
}

function alertGroup(alert) {
  if (alert.scope === "ea") {
    const magic = htmlText(alert.badge) || "不明";
    return { key: `ea:${magic}`, label: `EA ${magic}`, badge: alert.badge || eaBadge(magic) };
  }
  const match = String(alert.current || "").match(/口座\s+([^/\s]+)/);
  const login = match ? match[1] : "口座";
  return { key: `account:${login}`, label: `口座 ${login}`, badge: accountBadge(login) };
}

function alertText(value) {
  return htmlText(value) || String(value || "");
}

function memoClass(note) {
  const text = String(note || "");
  if (/[-−]/.test(text) && /含み|現在|損益|決済|DD/.test(text)) return "memo-danger";
  if (/危険|停止|大|低下|損|DD大|決済-|証拠金率危険/.test(text)) return "memo-danger";
  if (/注意|DD注意|確認|補正|保有/.test(text)) return "memo-warn";
  if (/含み益|決済\+|通常監視/.test(text)) return "memo-ok";
  if (/現在|Reset|データなし|決済なし/.test(text)) return "memo-muted";
  return "memo-info";
}

function memoHtml(notes) {
  const list = (notes || []).filter(Boolean);
  if (!list.length) return `<span class="memo-token memo-muted">-</span>`;
  return list
    .map((note) => `<span class="memo-token ${memoClass(note)}">${note}</span>`)
    .join(` <span class="memo-sep">/</span> `);
}

function alertRowKey(alert) {
  return [
    alertText(alert.badge),
    alert.title,
    alert.threshold,
    alert.measure,
    alert.action,
    alert.basis,
  ].join("|");
}

function alertMemo(alert) {
  const text = `${alert.title || ""} ${alert.current || ""} ${alert.measure || ""} ${alert.action || ""} ${alert.basis || ""}`;
  const notes = [];
  if (alert.level === "danger") notes.push("即確認");
  else if (alert.level === "warn") notes.push("注意監視");
  if (/停止/.test(text)) notes.push("停止候補");
  if (/DD|ドローダウン/.test(text)) notes.push("DD確認");
  if (/連敗/.test(text)) notes.push("連敗");
  if (/含み/.test(text)) notes.push("含み");
  if (!notes.length) notes.push("通常監視");
  return memoHtml(notes.slice(0, 3));
}

function ensureAlertTable(el) {
  if (el.dataset.mode === "table") return el.querySelector("tbody");
  el.dataset.mode = "table";
  el.innerHTML = `<div class="alert-table-wrap">
    <table class="alert-table">
      <colgroup>
        <col class="alert-col-ea">
        <col class="alert-col-level">
        <col class="alert-col-title">
        <col class="alert-col-current">
        <col class="alert-col-threshold">
        <col class="alert-col-measure">
        <col class="alert-col-action">
        <col class="alert-col-basis">
        <col class="alert-col-memo">
      </colgroup>
      <thead>
        <tr>
          <th class="grp-id">EA</th>
          <th class="grp-id grp-end">重要度</th>
          <th class="grp-detect">検知内容</th>
          <th class="grp-detect">現在</th>
          <th class="grp-detect grp-end">基準</th>
          <th class="grp-response">発動措置</th>
          <th class="grp-response">推奨対応</th>
          <th class="grp-response grp-end">根拠</th>
          <th>メモ</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  </div>`;
  return el.querySelector("tbody");
}

function setCellHtml(cell, html, className = "") {
  const value = html === null || html === undefined || html === "" ? "-" : String(html);
  if (cell.dataset.html !== value) {
    cell.innerHTML = value;
    cell.dataset.html = value;
  }
  if (cell.className !== className) cell.className = className;
}

function reconcileAlertRows(tbody, rows) {
  const existing = new Map();
  for (const tr of tbody.querySelectorAll("tr[data-key]")) {
    existing.set(tr.dataset.key, tr);
  }

  const seen = new Set();
  for (const row of rows) {
    const key = String(row.key);
    seen.add(key);
    let tr = existing.get(key);
    if (!tr || tr.children.length !== row.cells.length) {
      tr?.remove();
      tr = document.createElement("tr");
      tr.dataset.key = key;
      for (let i = 0; i < row.cells.length; i++) {
        tr.appendChild(document.createElement("td"));
      }
    }
    if (tr.className !== row.className) tr.className = row.className;
    row.cells.forEach((cell, index) => {
      setCellHtml(tr.children[index], cell.html, cell.className || "");
      tr.children[index].colSpan = cell.colspan || 1;
    });
    tbody.appendChild(tr);
  }

  for (const [key, tr] of existing.entries()) {
    if (!seen.has(key)) tr.remove();
  }
}

function renderAlertList(id, alerts, emptyText, grouped = false) {
  const el = document.getElementById(id);
  if (!el) return;
  const tbody = ensureAlertTable(el);

  const levelRank = { danger: 3, warn: 2, info: 1 };
  const sortedAlerts = alerts
    .slice()
    .sort((a, b) => {
      const eaDiff = alertText(a.badge).localeCompare(alertText(b.badge), "ja-JP", { numeric: true });
      return grouped && eaDiff ? eaDiff : (levelRank[b.level] - levelRank[a.level]) || (b.score - a.score);
    });

  const rows = sortedAlerts.length
    ? sortedAlerts.map((a, index) => {
        const group = alertGroup(a);
        return {
          key: `alert:${index}`,
          className: `alert-row alert-row-${a.level}`,
          cells: [
            { html: group.badge || "-", className: "grp-id" },
            { html: `<span class="alert-level-text alert-level-${a.level}">${levelLabel(a.level)}</span>`, className: "grp-id grp-end" },
            { html: a.title, className: "alert-title-text grp-detect" },
            { html: a.current || "-", className: `alert-current-text alert-current-${a.level} grp-detect` },
            { html: a.threshold || "-", className: "grp-detect grp-end" },
            { html: `<span class="alert-measure-text alert-measure-${a.level}">${a.measure || "-"}</span>`, className: "alert-measure-cell grp-response" },
            { html: a.action || "-", className: `alert-action-text alert-action-${a.level} grp-response` },
            { html: a.basis || "-", className: "alert-basis-text grp-response grp-end" },
            { html: alertMemo(a), className: "alert-memo-text" },
          ],
        };
      })
    : [
        {
          key: "empty",
          className: "alert-row alert-row-idle",
          cells: [
            { html: "-", className: "grp-id" },
            { html: `<span class="alert-level-text alert-level-none">待機</span>`, className: "grp-id grp-end" },
            { html: emptyText, className: "alert-title-text grp-detect" },
            { html: "-", className: "grp-detect" },
            { html: "-", className: "grp-detect grp-end" },
            { html: `<span class="alert-measure-text alert-measure-none">未発動</span>`, className: "alert-measure-cell grp-response" },
            { html: "-", className: "grp-response" },
            { html: "-", className: "grp-response grp-end" },
            { html: memoHtml(["通常監視"]), className: "alert-memo-text" },
          ],
        },
      ];
  reconcileAlertRows(tbody, rows);
}

function eaSummaryMemo(e, eaFloatingRate, winRateValue) {
  const notes = [];
  const trades = Number(e.trades || 0);
  if (e.reset_at) notes.push(`Reset ${fmtResetTime(e.reset_at)}`);
  if (Number(e.inferred_positions || 0) > 0) notes.push(`magic0補正${fmt(e.inferred_positions)}`);
  if (Number.isFinite(eaFloatingRate) && eaFloatingRate <= -1) notes.push("含み損注意");
  if (Number.isFinite(eaFloatingRate) && eaFloatingRate >= 1) notes.push("含み益");
  if (trades >= 10 && Number.isFinite(winRateValue) && winRateValue < 40) notes.push("勝率低下");
  if (!notes.length) notes.push("通常監視");
  return memoHtml(notes.slice(0, 3));
}

function buildAlerts() {
  const alerts = [];
  const summary = latestSummary || { accounts: [], ea_stats: [] };
  const performance = latestPerformance || { by_ea: [], by_account: [], by_account_ea: [] };
  const accountsByLogin = new Map((summary.accounts || []).map((a) => [String(a.account_login), a]));
  const performanceByMagic = new Map((performance.by_ea || []).map((row) => [String(row.magic || "-"), row]));

  for (const ea of summary.ea_stats || []) {
    const magic = String(ea.magic || "-");
    const account = accountsByLogin.get(String(ea.account_login)) || {};
    const balance = Number(account.balance || account.equity || 0);
    const floating = Number(ea.floating_profit || 0);
    const rate = balance ? (floating / balance) * 100 : null;
    const level = alertLevelByThreshold(rate, -1, -2, "lower");
    if (level) {
      pushAlert(alerts, {
        level,
        scope: "ea",
        title: level === "danger" ? "EA含み損が拡大" : "EA含み損に注意",
        current: `${fmtPct(rate)} / ${fmtSignedYen(floating)}`,
        threshold: "注意 -1.0%以下 / 危険 -2.0%以下",
        action: level === "danger" ? "新規停止・ロット縮小・保有理由を確認" : "ポジション偏りと相場環境を確認",
        basis: "口座残高に対するEA単位の未決済損益",
        badge: eaBadge(magic),
        score: level === "danger" ? 91 : 61,
      });
    }
  }

  for (const row of performance.by_ea || []) {
    const magic = String(row.magic || "-");
    const trades = Number(row.trades || 0);
    const pf = Number(row.pf);
    const rf = Number(row.rf);
    const dd = Number(row.dd_pct);
    const winRate = Number(row.win_rate);
    const expectancy = Number(row.expectancy);
    const sampleText = trades < 20 ? `取引${trades}回のため参考値` : `取引${trades}回`;

    let level = trades >= 10 ? alertLevelByThreshold(pf, 1.2, 1.0, "lower") : null;
    if (level) {
      pushAlert(alerts, {
        level,
        scope: "ea",
        title: level === "danger" ? "PFが1.0未満" : "PF低下",
        current: `PF ${fmtRatio(pf)} / ${sampleText}`,
        threshold: "注意 1.20未満 / 危険 1.00未満",
        action: level === "danger" ? "稼働継続の可否を確認" : "直近の負け方とスプレッド影響を確認",
        basis: "MT5公式のProfit Factor。1.0未満は総利益が総損失を下回る",
        badge: eaBadge(magic),
        score: level === "danger" ? 88 : 58,
      });
    }

    level = trades >= 10 ? alertLevelByThreshold(rf, 1.0, 0.5, "lower") : null;
    if (level) {
      pushAlert(alerts, {
        level,
        scope: "ea",
        title: level === "danger" ? "RFが低すぎます" : "RF低下",
        current: `RF ${fmtRatio(rf)} / ${sampleText}`,
        threshold: "注意 1.00未満 / 危険 0.50未満",
        action: "利益に対してDDが重いので、ロット・停止条件を確認",
        basis: "MT5公式のRecovery Factor。純利益を最大DDで割ったリスク効率",
        badge: eaBadge(magic),
        score: level === "danger" ? 87 : 57,
      });
    }

    level = alertLevelByThreshold(dd, 15, 25, "higher");
    if (level) {
      pushAlert(alerts, {
        level,
        scope: "ea",
        title: level === "danger" ? "DDが大きい" : "DDに注意",
        current: `DD ${fmtPlainPct(dd)} / ${sampleText}`,
        threshold: "注意 15.0%以上 / 危険 25.0%以上",
        action: level === "danger" ? "最大許容DDとの比較（DD単独では停止判断しない）" : "負けの集中と相場変化を確認",
        basis: "最大ドローダウンはEAのメンテ判断に使う主要リスク指標",
        badge: eaBadge(magic),
        score: level === "danger" ? 86 : 56,
      });
    }

    level = trades >= 20 ? alertLevelByThreshold(winRate, 40, 30, "lower") : null;
    if (level) {
      pushAlert(alerts, {
        level,
        scope: "ea",
        title: level === "danger" ? "勝率が大きく低下" : "勝率低下",
        current: `勝率 ${fmtPlainPct(winRate)} / 取引${trades}回`,
        threshold: "注意 40%未満 / 危険 30%未満",
        action: "エントリー条件のズレ、時間帯、相場環境を確認",
        basis: "PFだけでは見えない勝ち負けの質を補助確認",
        badge: eaBadge(magic),
        score: level === "danger" ? 84 : 55,
      });
    }

    if (trades >= 10 && Number.isFinite(expectancy) && expectancy < 0) {
      level = trades >= 20 ? "danger" : "warn";
      pushAlert(alerts, {
        level,
        scope: "ea",
        title: "期待利得がマイナス",
        current: `期待利得 ${fmtSignedYen(expectancy)} / ${sampleText}`,
        threshold: "注意 0円未満 / 危険 20回以上で0円未満",
        action: "EAの優位性低下を確認。直近の決済分布を見る",
        basis: "MT5公式のExpected Payoff。1取引あたりの期待損益",
        badge: eaBadge(magic),
        score: level === "danger" ? 83 : 54,
      });
    }
  }

  const tradesByMagic = new Map();
  for (const trade of latestTrades || []) {
    const magic = String(trade.magic || "");
    if (magic && magic !== "0") (tradesByMagic.get(magic) || tradesByMagic.set(magic, []).get(magic)).push(trade);
  }

  for (const [magic, rows] of tradesByMagic.entries()) {
    const sorted = rows.slice().sort((a, b) => (parseTradeTime(b.close_time)?.getTime() || 0) - (parseTradeTime(a.close_time)?.getTime() || 0));
    const perf = performanceByMagic.get(magic) || {};
    const winRate = Number(perf.win_rate);
    let streak = 0;
    for (const row of sorted) {
      if (Number(row.profit || 0) < 0) streak += 1;
      else break;
    }
    const streakProbability = losingStreakProbability(winRate, streak);
    if (streak >= 5) {
      pushAlert(alerts, {
        level: "danger",
        scope: "ea",
        title: "連敗が続いています",
        current: `${streak}連敗${streakProbability !== null ? ` / 想定確率 ${fmtPlainPct(streakProbability)}` : ""}`,
        threshold: "注意 3連敗以上 / 危険 5連敗以上、または想定確率3%未満",
        action: "新規停止・直近エントリー条件・相場環境を確認",
        basis: Number.isFinite(winRate) ? `現在の勝率 ${fmtPlainPct(winRate)} から連敗確率を補正` : "勝率データ不足のため連敗数で判定",
        badge: eaBadge(magic),
        score: 95,
      });
    } else if (streak >= 3) {
      const level = streakProbability !== null && streakProbability < 3 ? "danger" : "warn";
      pushAlert(alerts, {
        level,
        scope: "ea",
        title: level === "danger" ? "連敗確率が低い水準" : "連敗に注意",
        current: `${streak}連敗${streakProbability !== null ? ` / 想定確率 ${fmtPlainPct(streakProbability)}` : ""}`,
        threshold: "注意 3連敗以上 / 危険 5連敗以上、または想定確率3%未満",
        action: level === "danger" ? "稼働継続前に相場とのズレを確認" : "次の負け方を監視",
        basis: Number.isFinite(winRate) ? `現在の勝率 ${fmtPlainPct(winRate)} から連敗確率を補正` : "勝率データ不足のため連敗数で判定",
        badge: eaBadge(magic),
        score: level === "danger" ? 90 : 65,
      });
    }

    const tradingDay = resolveTradingDay(sorted, accountsByLogin);
    const todayLoss = sorted.reduce((total, row) => {
      return tradingDay && isTradeOnDay(row, tradingDay) ? total + Number(row.profit || 0) : total;
    }, 0);
    const accountBalances = new Map(sorted.map((row) => {
      const account = accountsByLogin.get(String(row.account_login)) || {};
      return [String(row.account_login), Number(account.balance || account.equity || 0)];
    }));
    const baseBalance = Array.from(accountBalances.values()).reduce((total, v) => total + v, 0);
    const todayRate = baseBalance ? (todayLoss / baseBalance) * 100 : null;

    const riskPct = riskPctByMagic.get(magic) || liveRiskPct;
    const dayStartBalance = baseBalance - todayLoss;
    const todayR = riskPct && dayStartBalance > 0 ? todayLoss / (dayStartBalance * riskPct / 100) : null;
    const dailyLevel = todayR !== null
      ? (todayR < -3 ? "danger" : todayR < -2 ? "warn" : null)
      : riskLoadFailed && todayRate !== null
        ? (todayRate <= -2 ? "danger" : todayRate <= -1 ? "warn" : null)
        : null;
    if (dailyLevel) {
      pushAlert(alerts, {
        level: dailyLevel,
        scope: "ea",
        title: dailyLevel === "danger" ? "日次損失が大きい" : "日次損失に注意",
        current: `本日 ${todayR !== null ? `${todayR.toFixed(2)}R / ` : ""}${fmtPct(todayRate)} / ${fmtSignedYen(todayLoss)}`,
        threshold: todayR !== null
          ? `注意 -2Rより悪い（損切り2回分を超える）/ 危険 -3Rより悪い（1R=残高の${riskPct}%）`
          : "注意 -1.0%以下 / 危険 -2.0%以下（リスク%が読めないため旧基準）",
        action: dailyLevel === "danger" ? "当日の新規停止・ロット縮小を検討" : "本日の相場環境とエントリー集中を確認",
        basis: "損切り1回(-1R)は想定内。1日に損切り2回分を超えたら知らせる（スマホの big_loss -2.0R と同じ大きさ）",
        badge: eaBadge(magic),
        score: dailyLevel === "danger" ? 90 : 60,
      });
    }
  }

  for (const [magic, basis] of (idleBasisByMagic || new Map()).entries()) {
    let from = basis.liveSince;
    for (const row of tradesByMagic.get(magic) || []) {
      const t = serverWallMs(row.close_time);
      if (t !== null && (from === null || t > from)) from = t;
    }
    if (from === null) continue;
    const idleHours = serverOpenHoursBetween(from, serverWallNowMs());
    const level = idleHours >= basis.p99 ? "warn" : idleHours >= basis.p90 ? "info" : null;
    if (!level) continue;
    const longer = basis.gaps.filter((g) => g >= idleHours).length / basis.gaps.length * 100;
    pushAlert(alerts, {
      level,
      scope: "ea",
      title: "取引停止の確認",
      current: `${tradesByMagic.has(magic) ? "最終取引" : "実弾開始"}から ${fmt(Math.round(idleHours))}時間（休場を除く）/ BTでこれより長い間隔は ${fmtPlainPct(longer)}`,
      threshold: `確認 BTの間隔の長い方10%（${fmt(Math.round(basis.p90))}時間〜）/ 注意 長い方1%（${fmt(Math.round(basis.p99))}時間〜）`,
      action: level === "warn" ? "EA稼働・自動売買・対象チャートを確認" : "稼働状況だけ確認",
      basis: `この本のバックテストの決済の間隔 ${fmt(basis.gaps.length)}件（休場を除く）と比べる`,
      badge: eaBadge(magic),
      score: level === "warn" ? 40 : 20,
    });
  }

  const levelRank = { danger: 3, warn: 2, info: 1 };
  return alerts.sort((a, b) => (levelRank[b.level] - levelRank[a.level]) || (b.score - a.score));
}

function renderAlerts() {
  const alerts = buildAlerts().filter((a) => a.scope === "ea");

  const counted = alerts.filter((a) => a.level !== "info");
  const alertEaCount = new Set(counted.map((a) => alertText(a.badge)).filter(Boolean)).size;
  setText("metric-alert-ea-count", fmt(alertEaCount), `metric-value ${alertEaCount > 0 ? "profit-negative" : "profit-flat"}`);
  for (const panel of document.querySelectorAll(".alert-panel")) {
    panel.classList.toggle("alert-active", counted.length > 0);
    panel.classList.toggle("alert-has-danger", alerts.some((a) => a.level === "danger"));
  }
  renderAlertList("ea-alert-list", alerts.slice(0, 12), "現在、EA別の重要なアラートはありません", true);
  renderDecisionPanel(alerts);
  renderTodayPerformance();
}

function renderTodayPerformance() {
  const accountsByLogin = new Map((latestSummary?.accounts || []).map((a) => [String(a.account_login), a]));
  const eaTrades = (latestTrades || []).filter((t) => t.magic && String(t.magic) !== "0");
  const tradingDay = resolveTradingDay(eaTrades, accountsByLogin);
  const todayTrades = tradingDay ? eaTrades.filter((t) => isTradeOnDay(t, tradingDay)) : [];
  const todayProfit = todayTrades.reduce((total, t) => total + Number(t.profit || 0), 0);
  const todayWins = todayTrades.filter((t) => Number(t.profit || 0) > 0).length;
  const todayWinRate = todayTrades.length ? (todayWins / todayTrades.length) * 100 : null;

  const todayFloating = tradingDay
    ? (latestPositions || [])
        .filter((p) => sameLocalDay(parseTradeTime(p.open_time), tradingDay))
        .reduce((total, p) => total + Number(p.profit || 0), 0)
    : 0;
  const todayTotal = todayProfit + todayFloating;

  setText("today-realized", fmtSignedYen(todayProfit), profitClass(todayProfit));
  setText("today-trades", fmt(todayTrades.length));
  setText("today-win-rate", todayWinRate === null ? "-" : fmtPlainPct(todayWinRate), `rate-pill ${winRateClass(todayWinRate)}`);
  setText("today-total", fmtSignedYen(todayTotal), profitClass(todayTotal));

  const dayLabel = tradingDay
    ? `${tradingDay.getMonth() + 1}/${tradingDay.getDate()}`
    : "-";
  setText("today-day-label", tradingDay ? `EA決済ベース(${dayLabel})` : "EA決済ベース");
}

function semanticSpan(text, className) {
  return `<span class="${className}">${text}</span>`;
}

function alertTone(level) {
  if (level === "danger") return "semantic-danger";
  if (level === "warn") return "semantic-warn";
  if (level === "info") return "semantic-info";
  return "semantic-muted";
}

function renderDecisionPanel() {
  renderOperationalPanel();
}

function setupTabs() {
  for (const button of document.querySelectorAll(".tab-button")) {
    button.addEventListener("click", () => {
      const tab = button.dataset.tab;
      for (const b of document.querySelectorAll(".tab-button")) {
        b.classList.toggle("active", b === button);
      }
      for (const panel of document.querySelectorAll(".tab-panel")) {
        panel.classList.toggle("active", panel.id === `tab-${tab}`);
      }
    });
  }

  document.getElementById("ea-trade-filter")?.addEventListener("change", renderTradeTables);
  document.getElementById("account-trade-filter")?.addEventListener("change", renderTradeTables);
}

function panelStorageKey(panel, index) {
  const table = panel.querySelector("table[id]");
  if (table) return `panel:${table.id}`;
  const element = panel.querySelector("[id]");
  if (element?.id) return `panel:${element.id}`;
  const title = panel.querySelector("h2")?.textContent?.trim() || `panel-${index}`;
  return `panel:${title}`;
}

function setupCollapsiblePanels() {
  const panels = Array.from(document.querySelectorAll(".panel"));
  panels.forEach((panel, index) => {
    const title = panel.querySelector(":scope > .section-title");
    if (!title || title.querySelector(".collapse-button")) return;

    const key = panelStorageKey(panel, index);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "collapse-button";
    title.appendChild(button);

    const shouldCollapse = false;
    panel.classList.toggle("collapsed", shouldCollapse);

    const sync = () => {
      const collapsed = panel.classList.contains("collapsed");
      button.textContent = collapsed ? "開く" : "閉じる";
      button.setAttribute("aria-expanded", collapsed ? "false" : "true");
    };

    button.addEventListener("click", () => {
      panel.classList.toggle("collapsed");
      localStorage.setItem(key, panel.classList.contains("collapsed") ? "closed" : "open");
      sync();
    });
    sync();
  });
}

async function postEaReset(accountLogin, magic, action) {
  await postJSON("/api/ea-reset", { account_login: accountLogin, magic, action });
  await refreshAfterAction(refreshSummary, refreshTrades, refreshPerformance);
}

function setupEaResetActions() {
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-ea-reset-action]");
    if (!button) return;
    const accountLogin = button.dataset.accountLogin;
    const magic = button.dataset.magic;
    const action = button.dataset.eaResetAction;
    if (!accountLogin || !magic) return;

    const message = action === "clear"
      ? "この再集計を解除して、全期間の集計に戻します。口座の残高・有効額は常に実際の値のままです。"
      : "このEAの成績(PF・勝率・損益・取引回数)を今ここから再集計します。口座残高や保有ポジションはそのままで、過去の決済統計だけを区切り直します。";
    if (!window.confirm(message)) return;

    button.disabled = true;
    try {
      await postEaReset(accountLogin, magic, action);

      window.alert(action === "clear" ? "再集計を解除しました。" : "この時点から再集計を開始しました。");
    } catch (error) {
      window.alert(error.message || "EA reset failed");
    } finally {
      button.disabled = false;
    }
  });
}

async function postEaDelete(accountLogin, magic) {
  await postJSON("/api/ea-delete", { account_login: accountLogin, magic });
  await refreshAfterAction(refreshSummary, refreshTrades, refreshPerformance, refreshPositions);
}

function setupEaDeleteActions() {
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-ea-delete-action]");
    if (!button) return;
    const accountLogin = button.dataset.accountLogin;
    const magic = button.dataset.magic;
    if (!accountLogin || !magic) return;

    const message = "このEAをEA別概要の一覧から削除します。過去の決済データは復元されません(再度このEAが取引を始めれば新しいデータとして追跡されます)。続けますか？";
    if (!window.confirm(message)) return;

    button.disabled = true;
    try {
      await postEaDelete(accountLogin, magic);
      window.alert("このEAを削除しました。");
    } catch (error) {
      window.alert(error.message || "EA delete failed");
    } finally {
      button.disabled = false;
    }
  });
}

async function postEaName(magic, name) {
  await postJSON("/api/ea-name", { magic, name });
  await refreshAfterAction(refreshSummary, refreshTrades, refreshPerformance);
}

function setupEaNameActions() {
  document.addEventListener("click", async (event) => {
    const badge = event.target.closest("[data-ea-badge-magic]");
    if (!badge) return;
    const magic = badge.dataset.eaBadgeMagic;
    if (!magic || magic === "-") return;

    const current = eaNames.get(magic) || "";
    const input = window.prompt(`EA ${magic} の表示名を入力してください(空欄で解除)`, current);
    if (input === null) return;

    try {
      await postEaName(magic, input.trim());
    } catch (error) {
      window.alert(error.message || "EA name update failed");
    }
  });
}

async function postAccountRebase(accountLogin, action) {
  await postJSON("/api/account-rebase", { account_login: accountLogin, action });

  for (const key of Array.from(chartHistoryByKey.keys())) {
    if (key.startsWith(`${accountLogin}|`)) chartHistoryByKey.delete(key);
  }
  await refreshAfterAction(refreshSummary, refreshChart);
}

function setupAccountRebaseActions() {
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-account-rebase-action]");
    if (!button) return;
    const accountLogin = button.dataset.accountLogin;
    const action = button.dataset.accountRebaseAction;
    if (!accountLogin) return;

    const message = action === "clear"
      ? "この口座の再集計を解除して、全期間の損益率推移に戻します。"
      : `口座 ${accountLogin} の損益率推移を今ここから0%として再スタートします。残高・有効額・保有ポジションなど現在の実際の値には一切影響しません。続けますか？`;
    if (!window.confirm(message)) return;

    button.disabled = true;
    try {
      await postAccountRebase(accountLogin, action);
      window.alert(action === "clear" ? "口座の再集計を解除しました。" : "この時点から損益率推移を再スタートしました。");
    } catch (error) {
      window.alert(error.message || "Account rebase failed");
    } finally {
      button.disabled = false;
    }
  });
}

async function postAccountDelete(accountLogin) {
  await postJSON("/api/account-delete", { account_login: accountLogin });
  for (const key of Array.from(chartHistoryByKey.keys())) {
    if (key.startsWith(`${accountLogin}|`)) chartHistoryByKey.delete(key);
  }
  await refreshAfterAction(refreshSummary, refreshTrades, refreshPerformance, refreshPositions, refreshChart);
}

function setupAccountDeleteActions() {
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-account-delete-action]");
    if (!button) return;
    const accountLogin = button.dataset.accountLogin;
    if (!accountLogin) return;

    const message = `口座 ${accountLogin} の残高履歴・ポジション・決済履歴・EAリセット情報をすべて削除します。この操作は元に戻せません。続けますか？`;
    if (!window.confirm(message)) return;

    button.disabled = true;
    try {
      await postAccountDelete(accountLogin);
      window.alert(`口座 ${accountLogin} のデータを削除しました。`);
    } catch (error) {
      window.alert(error.message || "Account delete failed");
    } finally {
      button.disabled = false;
    }
  });
}

function updateHtml(el, html) {
  if (el.dataset.html !== html) {
    el.innerHTML = html;
    el.dataset.html = html;
  }
}

function reconcileRows(tbody, rows, keyFn, htmlFn) {
  const existing = new Map();
  for (const tr of tbody.querySelectorAll("tr[data-key]")) {
    existing.set(tr.dataset.key, tr);
  }

  const seen = new Set();
  for (const row of rows) {
    const key = String(keyFn(row));
    seen.add(key);
    let tr = existing.get(key);
    if (!tr) {
      tr = document.createElement("tr");
      tr.dataset.key = key;
    }
    updateHtml(tr, htmlFn(row));
    tbody.appendChild(tr);
  }

  for (const [key, tr] of existing.entries()) {
    if (!seen.has(key)) tr.remove();
  }
}

function setText(id, value, className) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value;
  if (className !== undefined) el.className = className;
}

function setHtml(id, value, className) {
  const el = document.getElementById(id);
  if (!el) return;
  const html = value === null || value === undefined || value === "" ? "-" : String(value);
  if (el.dataset.html !== html) {
    el.innerHTML = html;
    el.dataset.html = html;
  }
  if (className !== undefined) el.className = className;
}

function fxServerOffsetHours(ms) {
  const y = new Date(ms).getUTCFullYear();
  const nthSunday = (month, n) => {
    const first = new Date(Date.UTC(y, month, 1)).getUTCDay();
    return Date.UTC(y, month, 1 + ((7 - first) % 7) + 7 * (n - 1));
  };
  const start = nthSunday(2, 2) + 7 * 36e5, end = nthSunday(10, 1) + 6 * 36e5;
  return ms >= start && ms < end ? 3 : 2;
}

function serverWallMs(value) {
  const m = typeof value === "string" && value.match(/^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) : null;
}

function serverWallNowMs() {
  const now = Date.now();
  return now + fxServerOffsetHours(now) * 36e5;
}

function serverOpenHoursBetween(a, b) {
  if (b <= a) return (b - a) / 36e5;
  let open = 0;
  for (let s = a; s < b;) {
    const e = Math.min(b, (Math.floor(s / 864e5) + 1) * 864e5);
    const day = new Date(s).getUTCDay();
    if (day !== 6 && day !== 0) open += e - s;
    s = e;
  }
  return open / 36e5;
}

async function refreshStatus() {
  const s = await fetchJSON("/api/status");
  const el = document.getElementById("status");
  if (s.last_error) {
    el.textContent = `ERROR ${s.last_error}`;
    el.className = "status-pill status-error";
  } else if (s.market && s.market.closed && s.market.current_at_close && !s.stale) {

    el.textContent = s.market.label || "市場休場中";
    el.className = "status-pill status-closed";
  } else if (s.source_stale) {
    el.textContent = `STALE MT5 ${fmt(s.source_age_seconds)}s`;
    el.className = "status-pill status-stale";
  } else {
    el.textContent = `LIVE ${fmtTimeMs(s.last_success_at)}`;
    el.className = "status-pill status-live";
  }
}

async function refreshSummary() {
  const data = await fetchJSON("/api/summary");
  latestSummary = data;
  eaNames = mergeEaNames(data.ea_names || {});
  updateAdaptiveColumnWidths();
  renderAccountOverview(data.accounts, data.ea_resets || [], data.ea_stats || []);
  renderAccountStatusTable(data.accounts, data.ea_stats, data.ea_resets || [], data.account_baselines || {});
  const accountsByLogin = new Map(data.accounts.map((a) => [String(a.account_login), a]));

  const eaBody = document.querySelector("#ea-table tbody");
  let openCount = 0;
  let floatingTotal = 0;
  let visibleEaRealizedTotal = 0;
  const pairsNow = symbolByMagicMap();
  const eaStatsSorted = data.ea_stats.slice().sort((a, b) => comparePairThenName(a.magic, b.magic, pairsNow));
  const eaRows = eaStatsSorted.map((e) => {
    const winRateValue = e.trades ? (e.wins / e.trades) * 100 : null;
    const winRate = winRateValue === null ? "-" : winRateValue.toFixed(1) + "%";
    const magic = e.magic === null || e.magic === undefined ? "-" : e.magic;
    const account = accountsByLogin.get(String(e.account_login)) || {};
    const balance = Number(account.balance || 0);
    const eaFloatingRate = balance ? (Number(e.floating_profit || 0) / balance) * 100 : null;
    openCount += Number(e.open_positions || 0);
    floatingTotal += Number(e.floating_profit || 0);
    visibleEaRealizedTotal += Number(e.total_profit || 0);
    return {
      key: `${e.account_login}:${magic}`,
      html: `<td class="grp-id">${eaNameCell(magic)}</td><td class="grp-id">${magic}</td>
      <td class="grp-id grp-end">${e.symbols || "-"}</td>
      <td class="grp-count ${Number(e.open_positions || 0) > 0 ? "open-on" : ""}">${fmt(e.open_positions)}</td>
      <td class="grp-count side-cell">${sideCell(e)}</td>
      <td class="grp-count">${fmt(e.open_volume)}</td>
      <td class="grp-count grp-end">${fmt(e.trades)}</td>
      <td class="grp-money ${profitClass(e.floating_profit)}">${fmtSignedYen(e.floating_profit)}</td>
      <td class="grp-money ${profitClass(e.total_profit)}">${fmtSignedYen(e.total_profit)}</td>
      <td class="grp-percent ${profitClass(eaFloatingRate)}">${fmtPct(eaFloatingRate)}</td>
      <td class="grp-percent grp-end"><span class="rate-pill ${winRateClass(winRateValue)}">${winRate}</span></td>
      <td class="ea-exit-countdown" data-exit-account="${Number(e.account_login)}" data-exit-magic="${Number(e.magic)}" data-exit-open="${Number(e.open_positions || 0)}">確認中</td>
      <td class="ea-reset-cell">
        <button type="button" class="mini-button" data-ea-reset-action="reset" data-account-login="${e.account_login}" data-magic="${magic}">ここから再集計</button>
        <button type="button" class="mini-button mini-button-muted" data-ea-reset-action="clear" data-account-login="${e.account_login}" data-magic="${magic}" ${e.reset_at ? "" : "disabled"}>解除</button>
        <button type="button" class="mini-button mini-button-danger" data-ea-delete-action data-account-login="${e.account_login}" data-magic="${magic}">EA削除</button>
      </td>
      <td class="ea-memo">${eaSummaryMemo(e, eaFloatingRate, winRateValue)}</td>`,
    };
  });
  reconcileRows(eaBody, eaRows, (row) => row.key, (row) => row.html);
  window.renderEaExitCountdown?.();

  const realizedTotal = visibleEaRealizedTotal;

  setText("metric-ea-count", fmt(data.ea_stats.length));
  setText("metric-open-count", fmt(openCount));
  setText("metric-floating", fmtSignedYen(floatingTotal), `metric-value ${profitClass(floatingTotal)}`);
  setText("metric-realized", fmtSignedYen(realizedTotal), `metric-value ${profitClass(realizedTotal)}`);
  setText("metric-total", fmtSignedYen(floatingTotal + realizedTotal), `metric-value ${profitClass(floatingTotal + realizedTotal)}`);
  renderAlerts();
}

function renderTopPerformance(data) {

  const accountRows = data.by_account || [];
  const all = perfScope === "all" && accountRows.length === 1;
  const total = all ? accountRows[0] : data.total;
  const detached = data.detached;
  if (!total) return;

  const note = document.getElementById("top-detached");
  if (note) {
    const n = Number((detached || {}).trades || 0);
    const p = Number((detached || {}).profit || 0);
    if (perfScope === "all" && !all) {
      note.innerHTML = "※ 口座が1つでないので「今までの全部」は出せません。<b>いまの顔ぶれ</b>を出しています。";
    } else {

      note.innerHTML = "";
    }
  }
  setText("top-pf", fmtPf(total));
  setText("top-rf", fmtRf(total));
  setText("top-trades", fmt(total.trades));
  setText("top-dd", fmtPlainPct(total.dd_pct), profitClass(-Number(total.dd_pct || 0)));

  const ddCell = document.getElementById("top-dd");
  if (ddCell) {
    const ddYen = Number(total.dd || 0);
    ddCell.title = ddYen
      ? `決済ベースの最大の落ち込み ${fmtYen(ddYen)}（残高に対する割合）`
      : "決済ベースの落ち込みはまだありません";
  }
  setText("top-sr", fmtRatio(total.sr));
  setText("top-win-rate", fmtPlainPct(total.win_rate), `rate-pill ${winRateClass(total.win_rate)}`);
  setText("top-expectancy", fmtSignedYen(total.expectancy), profitClass(total.expectancy));
  setText("top-annual", fmtPct(total.annual_return), profitClass(total.annual_return));
}

function renderAccountOverview(accounts) {
  const logins = [...new Set(accounts.map(account => String(account.account_login || "")).filter(Boolean))];
  setText("top-account-login", logins.length ? `口座 ${logins.join(" / ")}` : "口座 未確認");
  const sum = (field) => accounts.reduce((total, account) => total + Number(account[field] || 0), 0);
  const hasValue = (field) => accounts.some((account) => account[field] !== null && account[field] !== undefined);

  const balance = sum("balance");
  const equity = sum("equity");
  const profit = sum("profit");
  const margin = hasValue("margin") ? sum("margin") : null;
  const freeMargin = hasValue("free_margin") ? sum("free_margin") : null;
  const marginLevel = margin && margin > 0 ? (equity / margin) * 100 : null;

  setText("top-balance", fmtYen(balance));
  setText("top-equity", fmtYen(equity));
  setText("top-margin", margin === null ? "-" : fmtYen(margin));
  setText("top-free-margin", freeMargin === null ? "-" : fmtYen(freeMargin));
  setText("top-margin-level", fmtPlainPct(marginLevel), marginLevel !== null && marginLevel < 300 ? "profit-negative" : "profit-flat");
  setText("top-account-profit", fmtSignedYen(profit), profitClass(profit));
}

function accountStatusMemo(account) {
  const notes = [];
  const profit = Number(account.profit || 0);
  const balance = Number(account.balance || account.equity || 0);
  const margin = Number(account.margin || 0);
  const equity = Number(account.equity || 0);
  const marginLevel = margin > 0 ? (equity / margin) * 100 : null;
  const profitRate = balance ? (profit / balance) * 100 : null;
  if (marginLevel !== null && marginLevel < 200) notes.push("証拠金率危険");
  else if (marginLevel !== null && marginLevel < 300) notes.push("証拠金率注意");
  if (profitRate !== null && profitRate <= -2) notes.push("含み損大");
  else if (profitRate !== null && profitRate <= -1) notes.push("含み損注意");
  if (!notes.length) notes.push("通常監視");
  return memoHtml(notes);
}

function renderAccountStatusTable(accounts, eaStats, eaResets = [], accountBaselines = {}) {
  const body = document.querySelector("#account-status-table tbody");
  if (!body) return;
  const eaByAccount = new Map();
  for (const row of eaStats || []) {
    const login = String(row.account_login || "");
    if (!eaByAccount.has(login)) eaByAccount.set(login, []);
    eaByAccount.get(login).push(row);
  }
  const rows = (accounts || []).map((account) => {
    const login = String(account.account_login || "-");
    const eaRows = eaByAccount.get(login) || [];
    const balance = Number(account.balance || 0);
    const equity = Number(account.equity || 0);
    const profit = Number(account.profit || 0);
    const margin = account.margin === null || account.margin === undefined ? null : Number(account.margin);
    const freeMargin = account.free_margin === null || account.free_margin === undefined ? null : Number(account.free_margin);
    const marginLevel = margin && margin > 0 ? (equity / margin) * 100 : null;
    const openPositions = eaRows.reduce((total, row) => total + Number(row.open_positions || 0), 0);
    const openVolume = eaRows.reduce((total, row) => total + Number(row.open_volume || 0), 0);
    return {
      key: login,
      html: `<td class="grp-id grp-end">${login}</td>
        <td class="grp-money">${fmtYen(balance)}</td>
        <td class="grp-money">${fmtYen(equity)}</td>
        <td class="grp-money ${profitClass(profit)}">${fmtSignedYen(profit)}</td>
        <td class="grp-money">${margin === null ? "-" : fmtYen(margin)}</td>
        <td class="grp-money grp-end">${freeMargin === null ? "-" : fmtYen(freeMargin)}</td>
        <td class="grp-percent grp-end ${marginLevel !== null && marginLevel < 300 ? "profit-negative" : "profit-flat"}">${fmtPlainPct(marginLevel)}</td>
        <td class="grp-count">${fmt(eaRows.length)}</td>
        <td class="grp-count ${openPositions > 0 ? "open-on" : ""}">${fmt(openPositions)}</td>
        <td class="grp-count grp-end">${fmt(openVolume)}</td>
        <td class="grp-action account-action-cell">
          <button type="button" class="mini-button" data-account-rebase-action="rebase" data-account-login="${login}">ここから再集計</button>
          <button type="button" class="mini-button mini-button-muted" data-account-rebase-action="clear" data-account-login="${login}" ${accountBaselines[login] ? "" : "disabled"}>解除</button>
          <button type="button" class="mini-button mini-button-danger" data-account-delete-action data-account-login="${login}">口座データ削除</button>
        </td>
        <td class="ea-memo">${accountStatusMemo(account)}</td>`,
    };
  });
  reconcileRows(body, rows, (row) => row.key, (row) => row.html);
}

const SVG_NS = "http://www.w3.org/2000/svg";
let chartSkeleton = null;

function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

const CHART_GEOM = { width: 1280, height: 560, left: 44, right: 118, top: 30, bottom: 78 };

function buildChartSkeleton(chartEl) {
  const { width, height, left, right, top, bottom } = CHART_GEOM;
  chartEl.innerHTML = `<div class="chart-legend"></div><div class="chart-svg-wrap"></div>`;
  const legend = chartEl.querySelector(".chart-legend");
  const wrap = chartEl.querySelector(".chart-svg-wrap");
  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "口座別損益率推移" });
  svg.appendChild(svgEl("rect", { x: 0, y: 0, width, height, fill: "#ffffff" }));
  const xgrid = svgEl("g");
  const ygrid = svgEl("g");
  svg.appendChild(xgrid);
  svg.appendChild(ygrid);
  const axisY = svgEl("line", { x1: width - right, y1: top, x2: width - right, y2: height - bottom, stroke: "#8fa0b3", "stroke-width": 1.8 });
  const axisX = svgEl("line", { x1: left, y1: height - bottom, x2: width - right, y2: height - bottom, stroke: "#8fa0b3", "stroke-width": 1.8 });
  svg.appendChild(axisY);
  svg.appendChild(axisX);
  const xlabels = svgEl("g");
  svg.appendChild(xlabels);
  const seriesGroup = svgEl("g");
  svg.appendChild(seriesGroup);
  wrap.appendChild(svg);
  chartSkeleton = {
    chartEl,
    legend,
    wrap,
    svg,
    xgrid,
    ygrid,
    xlabels,
    seriesGroup,
    yGridItems: [],
    xGridItems: [],
    seriesItems: new Map(),
    legendItems: new Map(),
  };
  return chartSkeleton;
}

function ensureChartSkeleton(chartEl) {
  if (chartSkeleton && chartSkeleton.chartEl === chartEl && chartEl.contains(chartSkeleton.svg)) {
    return chartSkeleton;
  }
  return buildChartSkeleton(chartEl);
}

function reconcileGridItems(groupEl, items, count, makeItem) {
  while (items.length < count) {
    const item = makeItem();
    groupEl.appendChild(item.line);
    groupEl.appendChild(item.text);
    items.push(item);
  }
  while (items.length > count) {
    const item = items.pop();
    item.line.remove();
    item.text.remove();
  }
}

let chartTopFrom = null;
let chartTopFunded = false;
let chartTopReturnNote = "";

async function buildAccountChartSeries() {
  chartTopFrom = null;
  chartTopFunded = false;
  chartTopReturnNote = "";
  const data = await fetchJSON("/api/account-return-history");
  const age = (Date.now()-Date.parse(data?.latest_at))/1000;
  if (!data || data.error || !Array.isArray(data.points) || !Number.isFinite(age) || age < -2 || age > 300) {
    chartTopReturnNote = "収益率の記録を確認できません";
    return [];
  }
  chartTopFrom = Date.parse(data.anchor_at);
  chartTopReturnNote = data.note || "入出金影響を除外した推計";
  const points = data.points.map(r=>({x:Date.parse(r.fetched_at),y:r.return_pct}))
    .filter(p=>Number.isFinite(p.x) && typeof p.y==="number" && Number.isFinite(p.y));
  return points.length ? [{
    key: "acct:"+data.account_login,
    label: "#"+data.account_login,
    color: "hsl(215, 72%, 42%)",
    points
  }] : [];
}

async function buildEaChartSeries() {
  const fetchedRows = await fetchJSON("/api/ea-history");
  const byMagic = {};
  for (const row of fetchedRows || []) {
    const magic = row && row.magic !== undefined ? String(row.magic) : "";
    if (!magic || magic === "0") continue;
    (byMagic[magic] ||= []).push(row);
  }

  const activeMagics = new Set((latestSummary?.ea_stats || []).map((e) => String(e.magic)).filter((m) => m && m !== "0"));
  for (const magic of activeMagics) {
    if (!byMagic[magic]) byMagic[magic] = [];
  }

  const floatingByMagic = new Map();
  for (const e of latestSummary?.ea_stats || []) {
    const magic = String(e.magic);
    floatingByMagic.set(magic, (floatingByMagic.get(magic) || 0) + Number(e.floating_profit || 0));
  }

  const pairsChart = symbolByMagicMap();
  return Object.keys(byMagic).sort((a, b) => comparePairThenName(a, b, pairsChart)).map((magic) => {
    const magicRows = byMagic[magic]
      .slice()
      .sort((a, b) => (parseTradeTime(a.close_time)?.getTime() ?? 0) - (parseTradeTime(b.close_time)?.getTime() ?? 0));
    const points = magicRows
      .map((r) => {
        const t = parseTradeTime(r.close_time);
        return t ? { x: t.getTime(), y: Number(r.cumulative_profit) } : null;
      })
      .filter(Boolean);

    if (activeMagics.has(magic) || points.length) {
      const lastRealized = points.length ? points[points.length - 1].y : 0;
      points.push({ x: Date.now(), y: lastRealized + (floatingByMagic.get(magic) || 0) });
    }
    return {
      key: `ea:${magic}`,
      label: eaNames.get(magic) || `#${magic}`,
      color: magicColor(magic).text,
      points,
    };
  }).filter((s) => s.points.length);
}
function chooseTimeTickStep(spanMs) {
  const minute = 60 * 1000;
  const hour = 60 * minute;
  if (spanMs <= 90 * minute) return 10 * minute;
  if (spanMs <= 3 * hour) return 15 * minute;
  if (spanMs <= 8 * hour) return 30 * minute;
  if (spanMs <= 18 * hour) return hour;
  if (spanMs <= 36 * hour) return 2 * hour;
  const day = 24 * hour;
  if (spanMs <= 4 * day) return 6 * hour;

  if (spanMs <= 14 * day) return day;
  if (spanMs <= 60 * day) return 7 * day;
  if (spanMs <= 240 * day) return 28 * day;
  return 91 * day;
}

function buildTimeTicks(minX, maxX, plotW) {
  const spanX = maxX - minX || 1;
  const step = chooseTimeTickStep(spanX);
  const minLabelGapPx = 78;
  const minGapMs = (spanX / Math.max(plotW, 1)) * minLabelGapPx;
  const ticks = [];
  const pushTick = (x, force = false) => {
    if (!Number.isFinite(x)) return;
    if (!force && ticks.length && Math.abs(x - ticks[ticks.length - 1]) < minGapMs) return;
    ticks.push(x);
  };

  pushTick(minX, true);

  let firstClockTick;
  if (step >= 24 * 60 * 60 * 1000) {
    const anchor = new Date(minX);
    anchor.setHours(0, 0, 0, 0);
    let tick = anchor.getTime();
    while (tick < minX) tick += step;
    firstClockTick = tick;
  } else {
    firstClockTick = Math.ceil(minX / step) * step;
  }
  for (let x = firstClockTick; x < maxX; x += step) {
    if (Math.abs(x - minX) < minGapMs || Math.abs(maxX - x) < minGapMs) continue;
    pushTick(x);
  }
  if (!ticks.length || Math.abs(maxX - ticks[ticks.length - 1]) >= minGapMs * 0.7) {
    pushTick(maxX, true);
  } else if (ticks.length > 1) {
    ticks[ticks.length - 1] = maxX;
  }
  return ticks;
}

function monthCategory(x) {
  const d = new Date(x);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

function calendarMonthRange(minX, maxX) {
  const start = new Date(minX);
  const end = new Date(maxX);
  return {
    min: Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1),
    max: Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1),
  };
}

function buildMonthlyTimeTicks(minX, maxX) {
  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || maxX < minX) return [];
  const start = new Date(minX);
  const year = start.getUTCFullYear();
  let month = start.getUTCMonth();
  const ticks = [];
  let tick = Date.UTC(year, month, 1);
  if (tick < minX) tick = Date.UTC(year, ++month, 1);
  while (tick <= maxX) {
    ticks.push(tick);
    tick = Date.UTC(year, ++month, 1);
  }

  return ticks.length ? ticks : [minX];
}

function buildMonthlyChartPoints(points, currentX) {
  if (!points.length) return [];
  const monthly = new Map();
  for (const point of points) {
    const d = new Date(point.x);
    const monthStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    monthly.set(monthStart, { x: monthStart, y: point.y });
  }
  const currentMonth = calendarMonthRange(currentX, currentX).min;
  monthly.set(currentMonth, { x: currentMonth, y: points[points.length - 1].y });
  return [...monthly.values()].sort((a, b) => a.x - b.x);
}

function accountPeriodStart(x, unit) {
  const d = new Date(x);
  if (unit === "month") return calendarMonthRange(x, x).min;
  if (unit === "year") return Date.UTC(d.getUTCFullYear(), 0, 1);
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return unit === "week" ? day - ((d.getUTCDay() + 6) % 7) * 86400000 : day;
}

function accountPeriodBefore(start, unit) {
  const d = new Date(start);
  if (unit === "month") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1);
  if (unit === "year") return Date.UTC(d.getUTCFullYear() - 1, 0, 1);
  return start - (unit === "week" ? 604800000 : 86400000);
}

function accountPeriodCategory(x, unit) {
  if (unit === "month") return monthCategory(x);
  if (unit === "year") return new Date(x).getUTCFullYear();
  return Math.floor(accountPeriodStart(x, unit) / (unit === "week" ? 604800000 : 86400000));
}

function buildAccountPeriodTicks(minX, maxX, unit, maxTicks = Infinity) {
  const first = accountPeriodStart(minX, unit);
  const last = accountPeriodStart(maxX, unit);
  const count = accountPeriodCategory(last, unit) - accountPeriodCategory(first, unit);
  const stride = Number.isFinite(maxTicks) ? Math.max(1, Math.ceil(count / (Math.max(2, maxTicks) - 1))) : 1;
  const d = new Date(first);
  const ticks = [];
  for (let i = 0; i <= count; i += stride) {
    ticks.push(unit === "month" ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + i, 1)
      : unit === "year" ? Date.UTC(d.getUTCFullYear() + i, 0, 1)
      : first + i * (unit === "week" ? 604800000 : 86400000));
  }
  if (ticks.length && ticks[ticks.length - 1] !== last) ticks.push(last);
  return ticks;
}

function buildAccountPeriodPoints(points, currentX, unit) {
  const out = buildAccountPeriodBuckets(points, currentX, unit);
  if (out.length) out.unshift({ x: accountPeriodBefore(accountPeriodStart(points[0].x, unit), unit), y: points[0].y });
  return out;
}

function buildAccountPeriodBuckets(points, currentX, unit) {
  if (unit === "month") return buildMonthlyChartPoints(points, currentX);
  if (!points.length) return [];
  const buckets = new Map();
  for (const point of points) {
    const start = accountPeriodStart(point.x, unit);
    buckets.set(start, { x: start, y: point.y });
  }
  const current = accountPeriodStart(currentX, unit);
  buckets.set(current, { x: current, y: points[points.length - 1].y });
  return [...buckets.values()].sort((a, b) => a.x - b.x);
}

function renderChartSeries(chartEl, series, options) {
  const { formatValue, ariaLabel } = options;
  const periodUnit = ["day", "week", "month", "year"].includes(options.timeTickUnit) ? options.timeTickUnit : null;
  if (!series.length) {
    updateHtml(chartEl, `<div class="chart-empty">履歴データなし</div>`);
    chartSkeleton = null;
    return;
  }

  const allPoints = series.flatMap((s) => s.points);
  const dataMinX = Math.min(...allPoints.map((p) => p.x));

  const dataMaxX = Math.max(...allPoints.map((p) => p.x), Date.now());

  const range = periodUnit
    ? { min: accountPeriodBefore(accountPeriodStart(dataMinX, periodUnit), periodUnit), max: accountPeriodStart(dataMaxX, periodUnit) }
    : { min: dataMinX, max: dataMaxX };
  const minX = range.min;
  const maxX = range.max;
  for (const s of series) {
    const first = s.points[0];
    const last = s.points[s.points.length - 1];
    if (first && first.x > dataMinX) {
      s.points.unshift({ x: dataMinX, y: first.y });
    }
    if (last && last.x < dataMaxX) {
      s.points.push({ x: dataMaxX, y: last.y });
    }
  }
  const rawMinY = Math.min(...allPoints.map((p) => p.y));
  const rawMaxY = Math.max(...allPoints.map((p) => p.y));
  const padY = Math.max((rawMaxY - rawMinY) * 0.18, 0.2);
  const { min: minY, max: maxY, ticks: yTicks } = niceScale(
    Math.min(rawMinY, 0) - padY,
    Math.max(rawMaxY, 0) + padY,
    5
  );

  const { width, height, left, right, top, bottom } = CHART_GEOM;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const xPos = periodUnit
    ? (x) => left + ((accountPeriodCategory(x, periodUnit) - accountPeriodCategory(minX, periodUnit)) /
                     (accountPeriodCategory(maxX, periodUnit) - accountPeriodCategory(minX, periodUnit) || 1)) * plotW
    : (x) => left + ((x - minX) / spanX) * plotW;
  const yPos = (y) => top + (1 - ((y - minY) / spanY)) * plotH;

  const chart = ensureChartSkeleton(chartEl);
  chart.svg.setAttribute("aria-label", ariaLabel);

  reconcileGridItems(chart.ygrid, chart.yGridItems, yTicks.length, () => ({
    line: svgEl("line", { stroke: "#d6dee8" }),
    text: svgEl("text", { "text-anchor": "start", fill: "#172033", "font-size": 20, "font-weight": 900 }),
  }));
  yTicks.forEach((yValue, i) => {
    const y = yPos(yValue);
    const item = chart.yGridItems[i];
    item.line.setAttribute("x1", left);
    item.line.setAttribute("y1", y);
    item.line.setAttribute("x2", width - right);
    item.line.setAttribute("y2", y);
    item.text.setAttribute("x", width - right + 16);
    item.text.setAttribute("y", y + 7);
    item.text.textContent = formatValue(yValue);
  });

  const spanDays = spanX / (24 * 60 * 60 * 1000);
  const fmtAxisX = (x) => {
    const d = new Date(x);
    if (periodUnit) {
      if (x === minX) return "開始";
      const local = new Date(x);
      const crossesYear = new Date(minX).getUTCFullYear() !== new Date(maxX).getUTCFullYear();
      if (periodUnit === "year") return local.getUTCFullYear() + "年";
      if (periodUnit === "month") return (crossesYear ? local.getUTCFullYear() + "年" : "") + (local.getUTCMonth() + 1) + "月";
      return (crossesYear ? local.getUTCFullYear() + "/" : "") + (local.getUTCMonth() + 1) + "/" + local.getUTCDate()
        + (periodUnit === "week" ? "週" : "");
    }
    if (spanDays >= 400) return d.toLocaleDateString("ja-JP", { year: "numeric", month: "numeric" });
    if (spanDays >= 2) return d.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
    if (spanDays >= 1) {
      return d.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" }) + " "
           + d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  };
  const xValues = periodUnit
    ? buildAccountPeriodTicks(minX, maxX, periodUnit, Math.max(2, Math.floor(plotW / 90)))
    : buildTimeTicks(minX, maxX, plotW);
  reconcileGridItems(chart.xlabels, chart.xGridItems, xValues.length, () => ({
    line: svgEl("line", { stroke: "#e8edf3" }),
    text: svgEl("text", { fill: "#172033", "font-size": 20, "font-weight": 900 }),
  }));

  let lastAxisLabel = null;
  xValues.forEach((x, i) => {
    const px = xPos(x);
    const item = chart.xGridItems[i];
    item.line.setAttribute("x1", px);
    item.line.setAttribute("y1", top);
    item.line.setAttribute("x2", px);
    item.line.setAttribute("y2", height - bottom);
    let label = fmtAxisX(x);
    if (label === lastAxisLabel) label = "";
    else lastAxisLabel = label;
    const anchor = i === 0 ? "start" : i === xValues.length - 1 ? "end" : "middle";
    item.text.setAttribute("x", px);
    item.text.setAttribute("y", height - 24);
    item.text.setAttribute("text-anchor", anchor);
    item.text.textContent = label;
  });

  const seenKeys = new Set();
  for (const s of series) {
    seenKeys.add(s.key);
    let item = chart.seriesItems.get(s.key);
    if (!item) {
      item = {
        path: svgEl("path", { fill: "none", "stroke-linejoin": "round", "stroke-linecap": "round", "vector-effect": "non-scaling-stroke" }),
        circle: svgEl("circle"),
      };
      chart.seriesGroup.appendChild(item.path);
      chart.seriesGroup.appendChild(item.circle);
      chart.seriesItems.set(s.key, item);
    }
    const drawPoints = periodUnit
      ? buildAccountPeriodPoints(s.points, dataMaxX, periodUnit) : s.points;
    const d = drawPoints.map((p, i) => `${i ? "L" : "M"} ${xPos(p.x).toFixed(1)} ${yPos(p.y).toFixed(1)}`).join(" ");
    const last = drawPoints[drawPoints.length - 1];
    item.path.setAttribute("d", d);
    item.path.setAttribute("stroke", s.color);
    item.path.setAttribute("stroke-width", 2.5);
    item.circle.setAttribute("cx", xPos(last.x).toFixed(1));
    item.circle.setAttribute("cy", yPos(last.y).toFixed(1));
    item.circle.setAttribute("r", 5.5);
    item.circle.setAttribute("fill", s.color);

    let legendItem = chart.legendItems.get(s.key);
    if (!legendItem) {
      const root = document.createElement("span");
      root.className = "chart-legend-item";
      const swatch = document.createElement("span");
      swatch.className = "chart-legend-swatch";
      const label = document.createElement("span");
      label.className = "chart-legend-label";
      const value = document.createElement("span");
      value.className = "chart-legend-value";
      root.appendChild(swatch);
      root.appendChild(label);
      root.appendChild(value);
      chart.legend.appendChild(root);
      legendItem = { root, swatch, label, value };
      chart.legendItems.set(s.key, legendItem);
    }
    legendItem.swatch.style.background = s.color;
    legendItem.label.textContent = s.label;
    legendItem.value.textContent = formatValue(last.y);
  }
  for (const [key, item] of chart.seriesItems) {
    if (!seenKeys.has(key)) {
      item.path.remove();
      item.circle.remove();
      chart.seriesItems.delete(key);
    }
  }
  for (const [key, item] of chart.legendItems) {
    if (!seenKeys.has(key)) {
      item.root.remove();
      chart.legendItems.delete(key);
    }
  }
}

let chartRequestId = 0;

let accountChartPeriod = "month";
const ACCOUNT_CHART_PERIODS = [
  { unit: "day", label: "日単位", note: "日次区切り：UTC基準" },
  { unit: "week", label: "週単位", note: "週次区切り：UTC基準（月曜〜日曜）" },
  { unit: "month", label: "月単位", note: "月次区切り：UTC基準" },
  { unit: "year", label: "年単位", note: "年次区切り：UTC基準" },
];

function setupAccountChartPeriodToggle() {
  const topEl = document.getElementById("equity-chart-top");
  const box = topEl && topEl.parentElement;
  if (!box || !box.parentElement || document.getElementById("account-chart-period-toggle")) return;
  const controls = document.createElement("div");
  controls.id = "account-chart-period-toggle";
  controls.className = "chart-mode-toggle";
  controls.style.marginBottom = "10px";
  controls.style.flexWrap = "wrap";
  controls.setAttribute("role", "group");
  controls.setAttribute("aria-label", "口座全体の損益率の表示単位");
  const buttons = [];
  const updateActive = () => buttons.forEach((button) => {
    const active = button.dataset.accountChartPeriod === accountChartPeriod;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  for (const period of ACCOUNT_CHART_PERIODS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chart-mode-button";
    button.textContent = period.label;
    button.dataset.accountChartPeriod = period.unit;
    button.addEventListener("click", async () => {
      if (accountChartPeriod === period.unit) return;
      accountChartPeriod = period.unit;
      updateActive();
      await refreshChart();
    });
    buttons.push(button);
    controls.appendChild(button);
  }
  updateActive();
  box.parentElement.insertBefore(controls, box);
}

async function refreshChart() {
  const chartEl = document.getElementById("equity-chart");

  const topEl = document.getElementById("equity-chart-top");
  if (!chartEl && !topEl) return;

  const requestId = ++chartRequestId;
  if (topEl) {
    const total = await buildAccountChartSeries();
    if (requestId !== chartRequestId) return;
    renderChartSeries(topEl, total, { formatValue: fmtPct,
                                      timeTickUnit: accountChartPeriod,
                                      ariaLabel: "口座全体の損益率推移" });

    const note = document.getElementById("top-chart-note");
    if (note) {
      const d = chartTopFrom ? new Date(chartTopFrom) : null;
      const day = d ? d.toLocaleDateString("ja-JP", { timeZone: "UTC", year: "numeric", month: "numeric", day: "numeric" }) : "";
      const period = ACCOUNT_CHART_PERIODS.find((p) => p.unit === accountChartPeriod);
      note.textContent = period.note + "・" + (day ? day + "から継続・" : "") + chartTopReturnNote;
    }
  }
  if (!chartEl) return;
  const mode = chartMode;
  const series = mode === "account" ? await buildAccountChartSeries() : await buildEaChartSeries();
  if (requestId !== chartRequestId) return;
  if (mode === "account") {
    renderChartSeries(chartEl, series, { formatValue: fmtPct, ariaLabel: "口座別損益率推移" });
  } else {
    renderChartSeries(chartEl, series, { formatValue: fmtSignedYen, ariaLabel: "EA別累積損益推移（含み損益込み）" });
  }
}

function setupPerfScopeToggle() {
  const buttons = document.querySelectorAll("[data-perf-scope]");
  const applyActiveState = () => buttons.forEach((b) => b.classList.toggle("active", b.dataset.perfScope === perfScope));
  applyActiveState();
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.perfScope === perfScope) return;
      perfScope = button.dataset.perfScope;
      localStorage.setItem("perfScope", perfScope);
      applyActiveState();
      if (latestPerformance) renderTopPerformance(latestPerformance);
    });
  });
}

function setupChartModeToggle() {
  const buttons = document.querySelectorAll("[data-chart-mode]");
  const applyActiveState = () => {
    buttons.forEach((b) => b.classList.toggle("active", b.dataset.chartMode === chartMode));
    setText("chart-title", chartMode === "account" ? "口座別損益率推移" : "EA別累積損益推移（含み損益込み）");
  };
  applyActiveState();
  buttons.forEach((button) => {
    button.addEventListener("click", async () => {
      const mode = button.dataset.chartMode;
      if (mode === chartMode) return;
      chartMode = mode;
      localStorage.setItem("chartMode", chartMode);
      applyActiveState();

      await refreshChart();
    });
  });
}

const PERFORMANCE_METRIC_GROUPS = [
  { text: "取引", group: "count", col: "col-trade-count" },
  { text: "勝", group: "count", col: "col-small-count" },
  { text: "負", group: "count", col: "col-small-count", end: true },
  { text: "PF", group: "ratio", col: "col-pf" },
  { text: "RF", group: "ratio", col: "col-rf" },
  { text: "SR", group: "ratio", col: "col-ratio", end: true },
  { text: "総利益", group: "money", col: "col-money" },
  { text: "総損失", group: "money", col: "col-money" },
  { text: "損益", group: "money", col: "col-money" },
  { text: "含み損益", group: "money", col: "col-money" },
  { text: "現在損益", group: "money", col: "col-money" },
  { text: "DD額", group: "money", col: "col-dd-money" },
  { text: "期待利得", group: "money", col: "col-expectancy", end: true },
  { text: "DD%", group: "percent", col: "col-percent" },
  { text: "勝率", group: "percent", col: "col-rate" },
  { text: "年利", group: "percent", col: "col-annual", end: true },
  { text: "メモ", group: "memo", col: "col-memo" },
];

function idHeaderGroups(options) {
  const idHeaders = [];
  if (options.account) idHeaders.push("口座");
  if (options.ea) idHeaders.push("EA名", "Magic");
  if (options.symbols) idHeaders.push("銘柄");
  return idHeaders.map((text, i) => ({ text, group: "id", end: i === idHeaders.length - 1 }));
}

function setPerformanceHeaders(table, options = {}) {
  if (!table) return;
  const head = table.querySelector("thead tr");
  if (!head) return;
  const grouped = idHeaderGroups(options).concat(PERFORMANCE_METRIC_GROUPS);
  const key = grouped.map((g) => g.text).join("|");
  const html = grouped.map((g) => `<th class="grp-${g.group}${g.end ? " grp-end" : ""}">${g.text}</th>`).join("");
  if (head.dataset.columns !== key) {
    head.dataset.columns = key;
    head.innerHTML = html;
  }
  setPerformanceColumns(table, options);
}

function setPerformanceColumns(table, options = {}) {
  if (!table) return;
  const cols = [];
  if (options.account) cols.push("col-account");
  if (options.ea) cols.push("col-ea", "col-magic");
  if (options.symbols) cols.push("col-symbol");
  for (const m of PERFORMANCE_METRIC_GROUPS) cols.push(m.col);
  const key = cols.join("|");
  let colgroup = table.querySelector("colgroup");
  if (!colgroup) {
    colgroup = document.createElement("colgroup");
    table.insertBefore(colgroup, table.firstChild);
  }
  if (colgroup.dataset.columns !== key) {
    colgroup.dataset.columns = key;
    colgroup.innerHTML = cols.map((className) => `<col class="${className}">`).join("");
  }
}

function fmtLossYen(n) {
  const value = Math.abs(Number(n || 0));
  if (!Number.isFinite(value)) return "-";
  return value === 0 ? fmtYen(0) : fmtSignedYen(-value);
}

function performanceMemo(row) {
  const notes = [];
  const trades = Number(row.trades || 0);
  const ddPct = Number(row.dd_pct || 0);
  const winRate = Number(row.win_rate || 0);
  if (!trades) notes.push("決済なし");
  if (ddPct >= 10) notes.push("DD大");
  else if (ddPct >= 5) notes.push("DD注意");
  if (trades >= 5 && winRate < 35) notes.push("勝率注意");
  if (!notes.length) notes.push("通常監視");
  return memoHtml(notes);
}

function performanceHtml(row, options = {}) {
  let idCells;
  if (options.subtotal) {
    const idParts = [];
    if (options.account) idParts.push({ html: row.account_login, className: "" });
    if (options.ea) {
      idParts.push({ html: "\u53e3\u5ea7\u5408\u8a08", className: " account-subtotal-label" });
      idParts.push({ html: "-", className: "" });
    }
    if (options.symbols) idParts.push({ html: "-", className: "" });
    idCells = idParts
      .map((cell, i) => `<td class="grp-id${i === idParts.length - 1 ? " grp-end" : ""}${cell.className}">${cell.html}</td>`)
      .join("");
  } else {
    const idParts = [];
    if (options.account) idParts.push(row.account_login);
    if (options.ea) idParts.push(eaNameCell(row.magic), row.magic ?? "-");
    if (options.symbols) idParts.push(row.symbols || "-");
    idCells = idParts
      .map((content, i) => `<td class="grp-id${i === idParts.length - 1 ? " grp-end" : ""}">${content}</td>`)
      .join("");
  }
  return `${idCells}
    <td class="grp-count">${fmt(row.trades)}</td>
    <td class="grp-count">${fmt(row.wins)}</td>
    <td class="grp-count grp-end">${fmt(row.losses)}</td>
    <td class="grp-ratio ${ratioClass(fmtPf(row), 1)}">${fmtPf(row)}</td>
    <td class="grp-ratio ${ratioClass(fmtRf(row), 1)}">${fmtRf(row)}</td>
    <td class="grp-ratio grp-end ${ratioClass(row.sr, 0)}">${fmtRatio(row.sr)}</td>
    <td class="grp-money profit-pos">${fmtYen(row.gross_profit)}</td>
    <td class="grp-money profit-neg">${fmtLossYen(row.gross_loss)}</td>
    <td class="grp-money ${profitClass(row.profit)}">${fmtSignedYen(row.profit)}</td>
    <td class="grp-money ${profitClass(row.floating_profit)}">${fmtSignedYen(row.floating_profit)}</td>
    <td class="grp-money ${profitClass(row.live_profit)}">${fmtSignedYen(row.live_profit)}</td>
    <td class="grp-money ${profitClass(-Number(row.dd || 0))}">${fmtYen(row.dd)}</td>
    <td class="grp-money grp-end ${profitClass(row.expectancy)}">${fmtSignedYen(row.expectancy)}</td>
    <td class="grp-percent ${profitClass(-Number(row.dd_pct || 0))}">${fmtPlainPct(row.dd_pct)}</td>
    <td class="grp-percent"><span class="rate-pill ${winRateClass(row.win_rate)}">${fmtPlainPct(row.win_rate)}</span></td>
    <td class="grp-percent grp-end ${profitClass(row.annual_return)}">${fmtPct(row.annual_return)}</td>
    <td class="ea-memo">${performanceMemo(row)}</td>`;
}

async function refreshPerformance() {
  const data = await fetchJSON("/api/performance");
  latestPerformance = data;
  updateAdaptiveColumnWidths();
  renderTopPerformance(data);

  const eaBody = document.querySelector("#ea-performance-table tbody");
  if (eaBody) {
    setPerformanceHeaders(eaBody.closest("table"), { ea: true, symbols: true });
    const pairsNow = symbolByMagicMap();
    reconcileRows(
      eaBody,
      rowList(data.by_ea).slice().sort((a, b) => comparePairThenName(a.magic, b.magic, pairsNow)),
      (row) => row.magic,
      (row) => performanceHtml(row, { ea: true, symbols: true }),
    );
  }

  const accountEaBody = document.querySelector("#account-ea-performance-table tbody");
  if (accountEaBody) {
    setPerformanceHeaders(accountEaBody.closest("table"), { account: true, ea: true, symbols: true });
    const totalsByAccount = new Map((data.by_account || []).map((row) => [String(row.account_login), row]));
    const rowsByAccount = new Map();
    for (const row of data.by_account_ea) {
      const acct = String(row.account_login);
      if (!rowsByAccount.has(acct)) rowsByAccount.set(acct, []);
      rowsByAccount.get(acct).push(row);
    }
    const accountOrder = (data.by_account || []).map((row) => String(row.account_login));
    for (const acct of rowsByAccount.keys()) {
      if (!accountOrder.includes(acct)) accountOrder.push(acct);
    }
    const combinedRows = [];
    for (const acct of accountOrder) {
      const rows = rowsByAccount.get(acct);
      if (!rows || !rows.length) continue;
      const pairsAcct = symbolByMagicMap();
      combinedRows.push(...rows.slice().sort((a, b) => comparePairThenName(a.magic, b.magic, pairsAcct)));
      const totalRow = totalsByAccount.get(acct);
      if (totalRow) combinedRows.push({ ...totalRow, __subtotal: true });
    }
    reconcileRows(
      accountEaBody,
      combinedRows,
      (row) => (row.__subtotal ? `${row.account_login}:total` : `${row.account_login}:${row.magic}`),
      (row) =>
        row.__subtotal
          ? performanceHtml(row, { account: true, ea: true, symbols: true, subtotal: true })
          : performanceHtml(row, { account: true, ea: true, symbols: true }),
    );
  }
  renderAlerts();
}

function populateSelect(select, options, allLabel) {
  if (!select) return;
  const current = select.value || "all";
  const html = [`<option value="all">${allLabel}</option>`]
    .concat(options.map((value) => `<option value="${value}">${value}</option>`))
    .join("");
  if (select.dataset.html !== html) {
    select.innerHTML = html;
    select.dataset.html = html;
    select.value = options.includes(current) ? current : "all";
  }
}

function setTradeHeaders(table, options = {}) {
  if (!table) return;
  const head = table.querySelector("thead tr");
  if (!head) return;
  const idHeaders = options.eaFirst
    ? [{ text: "EA名", group: "id" }, { text: "Magic", group: "id" }, { text: "口座", group: "id", end: true }]
    : [{ text: "口座", group: "id" }, { text: "EA名", group: "id" }, { text: "Magic", group: "id", end: true }];
  const grouped = idHeaders.concat([
    { text: "Ticket", group: "detail" },
    { text: "建玉ID", group: "detail" },
    { text: "銘柄", group: "detail" },
    { text: "ロット", group: "detail", end: true },
    { text: "損益", group: "money", end: true },
    { text: "開始時刻", group: "time" },
    { text: "決済時刻", group: "time", end: true },
    { text: "コメント", group: null },
  ]);
  const key = grouped.map((g) => g.text).join("|");
  const html = grouped
    .map((g) => `<th class="${g.group ? `grp-${g.group}${g.end ? " grp-end" : ""}` : ""}">${g.text}</th>`)
    .join("");
  if (head.dataset.columns !== key) {
    head.dataset.columns = key;
    head.innerHTML = html;
  }
}

function activeTradeFilterOptions() {
  const activeEas = rowList(latestSummary?.ea_stats);
  const activeAccounts = rowList(latestSummary?.accounts);
  const eaSource = activeEas.length ? activeEas : latestTrades;
  const accountSource = activeAccounts.length ? activeAccounts : latestTrades;
  const eaOptions = Array.from(new Set(eaSource.map((row) => String(row.magic || "").trim()).filter((v) => v && v !== "0" && v !== "-")))
    .sort((a, b) => comparePairThenName(a, b));
  const accountOptions = Array.from(new Set(accountSource.map((row) => String(row.account_login || "").trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, "ja-JP", { numeric: true }));
  return { eaOptions, accountOptions };
}

function renderTradeTables() {
  const { eaOptions, accountOptions } = activeTradeFilterOptions();

  const eaFilter = document.getElementById("ea-trade-filter");
  const accountFilter = document.getElementById("account-trade-filter");
  populateSelect(eaFilter, eaOptions, "すべて");
  populateSelect(accountFilter, accountOptions, "すべて");

  const selectedEa = eaFilter?.value || "all";
  const selectedAccount = accountFilter?.value || "all";

  const eaRows = latestTrades
    .filter((t) => String(t.magic || "") !== "0")
    .filter((t) => selectedEa === "all" || String(t.magic) === selectedEa)
    .slice(0, 80)
    .map((t) => ({
      key: `ea:${t.account_login}:${t.ticket}`,
      html: `<td class="grp-id">${eaNameCell(t.magic)}</td><td class="grp-id">${t.magic || "-"}</td><td class="grp-id grp-end">${t.account_login}</td>
        <td class="grp-detail">${t.ticket}</td><td class="grp-detail">${t.position_id || "-"}</td>
        <td class="grp-detail">${t.symbol || "-"}</td><td class="grp-detail grp-end">${fmt(t.volume)}</td>
        <td class="grp-money grp-end ${profitClass(t.profit)}">${fmtSignedYen(t.profit)}</td>
        <td class="grp-time">${fmtTime(t.open_time)}</td><td class="grp-time grp-end">${fmtTime(t.close_time)}</td><td>${t.comment || ""}</td>`,
    }));
  const eaBody = document.querySelector("#ea-trades-table tbody");
  if (eaBody) {
    setTradeHeaders(eaBody.closest("table"), { eaFirst: true });
    reconcileRows(eaBody, eaRows, (row) => row.key, (row) => row.html);
  }

  const accountRows = latestTrades
    .filter((t) => selectedAccount === "all" || String(t.account_login) === selectedAccount)
    .slice(0, 80)
    .map((t) => ({
      key: `account:${t.account_login}:${t.ticket}`,
      html: `<td class="grp-id">${t.account_login}</td><td class="grp-id">${eaNameCell(t.magic)}</td><td class="grp-id grp-end">${t.magic || "-"}</td>
        <td class="grp-detail">${t.ticket}</td><td class="grp-detail">${t.position_id || "-"}</td>
        <td class="grp-detail">${t.symbol || "-"}</td><td class="grp-detail grp-end">${fmt(t.volume)}</td>
        <td class="grp-money grp-end ${profitClass(t.profit)}">${fmtSignedYen(t.profit)}</td>
        <td class="grp-time">${fmtTime(t.open_time)}</td><td class="grp-time grp-end">${fmtTime(t.close_time)}</td><td>${t.comment || ""}</td>`,
    }));
  const accountBody = document.querySelector("#account-trades-table tbody");
  if (accountBody) {
    setTradeHeaders(accountBody.closest("table"), { eaFirst: false });
    reconcileRows(accountBody, accountRows, (row) => row.key, (row) => row.html);
  }
}

async function refreshTrades() {
  latestTrades = await fetchJSON("/api/trades");
  updateAdaptiveColumnWidths();
  renderTradeTables();
  renderAlerts();
}

async function refreshIdleBasis() {
  const [detail, verdict] = await Promise.all([
    fetchJSON("/api/backtest-detail").catch(() => null), fetchJSON("/api/verdict").catch(() => null)]);
  if (verdict && !verdict.error && Array.isArray(verdict.eas)) {
    riskPctByMagic = new Map(verdict.eas
      .filter((e) => Number(e.risk_percent) > 0)
      .map((e) => [String(e.magic), Number(e.risk_percent)]));
    liveRiskPct = Number(verdict.live_risk_percent) > 0 ? Number(verdict.live_risk_percent) : null;
    riskLoadFailed = false;
  } else if (!riskPctByMagic.size) {
    riskLoadFailed = true;
  }
  if (!detail || detail.error || !Array.isArray(detail.eas) || !verdict || verdict.error || !Array.isArray(verdict.eas)) return;
  const since = new Map(verdict.eas.map((e) => [String(e.magic), serverWallMs(e.live_since)]));
  if (idleBasisId !== detail.baseline_id) {
    idleGapsByMagic = new Map();
    for (const ea of detail.eas) {
      const t = (ea.trades?.t || []).map((v) => Number(v) * 1000).sort((x, y) => x - y);
      const gaps = [];
      for (let i = 1; i < t.length; i += 1) gaps.push(serverOpenHoursBetween(t[i - 1], t[i]));
      if (gaps.length >= 20) idleGapsByMagic.set(String(ea.magic), gaps.sort((x, y) => x - y));
    }
    idleBasisId = detail.baseline_id;
  }
  const next = new Map();
  for (const [magic, gaps] of idleGapsByMagic.entries()) {
    if (!since.has(magic)) continue;
    const at = (q) => gaps[Math.floor(q * (gaps.length - 1))];
    next.set(magic, { gaps, p90: at(0.9), p99: at(0.99), liveSince: since.get(magic) });
  }
  idleBasisByMagic = next;
  renderAlerts();
}

function fmtPositionType(row) {
  const text = row?.type_text || row?.type_label;
  if (text) return escapeHtml(text);
  const type = Number(row?.type);
  if (type === 0) return "BUY";
  if (type === 1) return "SELL";
  return row?.type === null || row?.type === undefined ? "-" : escapeHtml(row.type);
}

function fmtOrderType(row) {
  const text = row?.type_text || row?.type_label;
  if (text) return escapeHtml(text);
  const names = ["BUY", "SELL", "BUY LIMIT", "SELL LIMIT", "BUY STOP", "SELL STOP", "BUY STOP LIMIT", "SELL STOP LIMIT", "CLOSE BY"];
  const type = Number(row?.type);
  return names[type] || (row?.type === null || row?.type === undefined ? "-" : escapeHtml(row.type));
}

function fmtExpiry(value) {
  return value ? fmtTime(value) : "-";
}

function setPositionHeaders(table, options = {}) {
  if (!table) return;
  const head = table.querySelector("thead tr");
  if (!head) return;
  const idHeaders = options.eaFirst
    ? [{ text: "EA名", group: "id" }, { text: "Magic", group: "id" }, { text: "口座", group: "id", end: true }]
    : [{ text: "口座", group: "id" }, { text: "EA名", group: "id" }, { text: "Magic", group: "id", end: true }];
  const grouped = idHeaders.concat([
    { text: "Ticket", group: "detail" },
    { text: "銘柄", group: "detail" },
    { text: "ロット", group: "detail", end: true },
    { text: "建値", group: "money" },
    { text: "スワップ", group: "money" },
    { text: "含み損益", group: "money", end: true },
    { text: "開始時刻", group: "time", end: true },
    { text: "コメント", group: null },
  ]);
  const key = grouped.map((g) => g.text).join("|");
  if (head.dataset.columns !== key) {
    head.dataset.columns = key;
    head.innerHTML = grouped.map((g) => `<th class="${g.group ? `grp-${g.group}${g.end ? " grp-end" : ""}` : ""}">${g.text}</th>`).join("");
  }
}

function setOrderHeaders(table, options = {}) {
  if (!table) return;
  const head = table.querySelector("thead tr");
  if (!head) return;
  const idHeaders = options.eaFirst
    ? [{ text: "EA名", group: "id" }, { text: "Magic", group: "id" }, { text: "口座", group: "id", end: true }]
    : [{ text: "口座", group: "id" }, { text: "EA名", group: "id" }, { text: "Magic", group: "id", end: true }];
  const grouped = idHeaders.concat([
    { text: "Ticket", group: "detail" },
    { text: "注文時刻", group: "time" },
    { text: "種別", group: "detail" },
    { text: "銘柄", group: "detail" },
    { text: "ロット", group: "detail", end: true },
    { text: "価格", group: "money" },
    { text: "S/L", group: "money" },
    { text: "T/P", group: "money" },
    { text: "現在値", group: "money" },
    { text: "期限", group: "time", end: true },
    { text: "コメント", group: null },
  ]);
  const key = grouped.map((g) => g.text).join("|");
  if (head.dataset.columns !== key) {
    head.dataset.columns = key;
    head.innerHTML = grouped.map((g) => `<th class="${g.group ? `grp-${g.group}${g.end ? " grp-end" : ""}` : ""}">${g.text}</th>`).join("");
  }
}
function renderPositionTables() {
  const eaRows = latestPositions
    .slice(0, 80)
    .map((p) => ({
      key: `ea:${p.account_login}:${p.ticket}`,
      html: `<td class="grp-id">${eaNameCell(p.magic)}</td><td class="grp-id">${p.magic || "-"}</td><td class="grp-id grp-end">${p.account_login}</td>
        <td class="grp-detail">${p.ticket}</td><td class="grp-detail">${p.symbol || "-"}</td><td class="grp-detail grp-end">${fmt(p.volume)}</td>
        <td class="grp-money">${fmtPrice(p.open_price)}</td><td class="grp-money ${profitClass(p.swap)}">${fmtSignedYen(p.swap)}</td><td class="grp-money grp-end ${profitClass(p.profit)}">${fmtSignedYen(p.profit)}</td>
        <td class="grp-time grp-end">${fmtTime(p.open_time)}</td><td class="position-comment">${p.comment || ""}</td>`,
    }));
  const eaBody = document.querySelector("#ea-positions-table tbody");
  if (eaBody) {
    setPositionHeaders(eaBody.closest("table"), { eaFirst: true });
    reconcileRows(eaBody, eaRows, (row) => row.key, (row) => row.html);
  }

  const accountRows = latestPositions
    .slice(0, 80)
    .map((p) => ({
      key: `account:${p.account_login}:${p.ticket}`,
      html: `<td class="grp-id">${p.account_login}</td><td class="grp-id">${eaNameCell(p.magic)}</td><td class="grp-id grp-end">${p.magic || "-"}</td>
        <td class="grp-detail">${p.ticket}</td><td class="grp-detail">${p.symbol || "-"}</td><td class="grp-detail grp-end">${fmt(p.volume)}</td>
        <td class="grp-money">${fmtPrice(p.open_price)}</td><td class="grp-money ${profitClass(p.swap)}">${fmtSignedYen(p.swap)}</td><td class="grp-money grp-end ${profitClass(p.profit)}">${fmtSignedYen(p.profit)}</td>
        <td class="grp-time grp-end">${fmtTime(p.open_time)}</td><td class="position-comment">${p.comment || ""}</td>`,
    }));
  const accountBody = document.querySelector("#account-positions-table tbody");
  if (accountBody) {
    setPositionHeaders(accountBody.closest("table"), { eaFirst: false });
    reconcileRows(accountBody, accountRows, (row) => row.key, (row) => row.html);
  }
}

function renderOrderTables() {
  const eaRows = latestOrders
    .slice(0, 80)
    .map((o) => ({
      key: `ea-order:${o.account_login}:${o.ticket}`,
      html: `<td class="grp-id">${eaNameCell(o.magic)}</td><td class="grp-id">${o.magic || "-"}</td><td class="grp-id grp-end">${o.account_login}</td>
        <td class="grp-detail">${o.ticket}</td><td class="grp-time">${fmtTime(o.setup_time)}</td>
        <td class="grp-detail">${fmtOrderType(o)}</td><td class="grp-detail">${o.symbol || "-"}</td><td class="grp-detail grp-end">${fmt(o.volume_current ?? o.volume_initial)}</td>
        <td class="grp-money">${fmtPrice(o.price_open)}</td><td class="grp-money">${fmtPrice(o.sl)}</td><td class="grp-money">${fmtPrice(o.tp)}</td><td class="grp-money">${fmtPrice(o.price_current)}</td>
        <td class="grp-time grp-end">${fmtExpiry(o.expiration_time)}</td><td>${o.comment || ""}</td>`,
    }));
  const eaBody = document.querySelector("#ea-orders-table tbody");
  if (eaBody) {
    setOrderHeaders(eaBody.closest("table"), { eaFirst: true });
    reconcileRows(eaBody, eaRows, (row) => row.key, (row) => row.html);
  }

  const accountRows = latestOrders
    .slice(0, 80)
    .map((o) => ({
      key: `account-order:${o.account_login}:${o.ticket}`,
      html: `<td class="grp-id">${o.account_login}</td><td class="grp-id">${eaNameCell(o.magic)}</td><td class="grp-id grp-end">${o.magic || "-"}</td>
        <td class="grp-detail">${o.ticket}</td><td class="grp-time">${fmtTime(o.setup_time)}</td>
        <td class="grp-detail">${fmtOrderType(o)}</td><td class="grp-detail">${o.symbol || "-"}</td><td class="grp-detail grp-end">${fmt(o.volume_current ?? o.volume_initial)}</td>
        <td class="grp-money">${fmtPrice(o.price_open)}</td><td class="grp-money">${fmtPrice(o.sl)}</td><td class="grp-money">${fmtPrice(o.tp)}</td><td class="grp-money">${fmtPrice(o.price_current)}</td>
        <td class="grp-time grp-end">${fmtExpiry(o.expiration_time)}</td><td>${o.comment || ""}</td>`,
    }));
  const accountBody = document.querySelector("#account-orders-table tbody");
  if (accountBody) {
    setOrderHeaders(accountBody.closest("table"), { eaFirst: false });
    reconcileRows(accountBody, accountRows, (row) => row.key, (row) => row.html);
  }
}

async function refreshPositions() {
  latestPositions = await fetchJSON("/api/positions");
  updateAdaptiveColumnWidths();
  renderPositionTables();
}

async function refreshOrders() {
  latestOrders = await fetchJSON("/api/orders");
  updateAdaptiveColumnWidths();
  renderOrderTables();
}

async function refreshFast() {
  await Promise.all([refreshStatus(), refreshSummary()]);
}

async function refreshSlow() {
  await Promise.all([refreshTrades(), refreshPerformance(), refreshPositions(), refreshOrders()]);
}

setupTabs();
setupCollapsiblePanels();
setupEaResetActions();
setupEaDeleteActions();
setupEaNameActions();
setupAccountDeleteActions();
setupAccountRebaseActions();
setupChartModeToggle();
setupPerfScopeToggle();
setupAccountChartPeriodToggle();
function scheduleNonOverlapping(callback, delayMs) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await callback();
    } finally {
      running = false;
    }
  };
  tick();
  return setInterval(tick, delayMs);
}

scheduleNonOverlapping(refreshFast, FAST_POLL_MS);
scheduleNonOverlapping(refreshSlow, SLOW_POLL_MS);
scheduleNonOverlapping(refreshChart, CHART_POLL_MS);
scheduleNonOverlapping(refreshIdleBasis, IDLE_BASIS_POLL_MS);
