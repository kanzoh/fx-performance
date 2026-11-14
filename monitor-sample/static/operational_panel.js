
let opsEvidence = null, opsStatus = null, opsHealth = null;
let opsErrors = [], opsReceivedAt = 0;
const opsNumber = value => typeof value === 'number' && Number.isFinite(value);
const opsTone = state => state === 'bad' ? 'semantic-danger' : state === 'ok' ? 'semantic-ok' : 'semantic-warn';
const opsSpan = (text, state) => `<span class="${opsTone(state)}">${escapeHtml(String(text))}</span>`;
function opsUTC(value) {
  const d = new Date(value);
  return value && Number.isFinite(d.getTime()) ? d.toISOString().replace('T',' ').replace(/\.\d+Z$/, ' UTC') : '未確認';
}
function renderOperationalPanel() {
  const e = opsEvidence, s = opsStatus;
  const elapsed = e ? (Date.now()-Date.parse(e.checked_at))/1000 : NaN;
  const transportUnknown = !e || !opsReceivedAt || Date.now()-opsReceivedAt>30000 || !Number.isFinite(elapsed) || elapsed < -2;
  if (transportUnknown) {
    for (const key of ['runtime','protection','deployment','freshness','monitor','risk']) setHtml('operational-'+key, opsSpan('未確認 — 実物データを読み取れません', 'unknown'));
    setHtml('operational-issues', opsSpan('確認待ち：未取得・通信失敗を「異常なし」として扱いません', 'unknown'));
    setText('operational-checked-at', '読み取り未確認・UTC基準');
    return;
  }
  const age = opsNumber(e.source_age_seconds) ? e.source_age_seconds+Math.max(0,elapsed) : NaN;
  const stale = !e.source_fresh || !s || s.stale !== false || s.source_stale !== false || s.last_error || !Number.isFinite(age) || !opsNumber(e.stale_after_seconds) || age > e.stale_after_seconds;
  const issues = Array.isArray(e.issues) ? e.issues.slice() : [];
  if (stale) issues.push({kind:'source',state:'unknown',title:'現在状態は未確認',detail:'元データまたは監視更新が古い・未取得です。以前の確認値で正常とは判定しません'});
  const runtimeDiff = issues.some(i => i.kind==='runtime');
  const deployment = issues.filter(i => i.kind==='deployment');
  const count = n => opsNumber(n) ? String(n) : '未確認';
  setHtml('operational-runtime', opsSpan(`チャート装着 ${stale ? '未確認' : count(e.attached_n)}本 ／ 想定 ${count(e.expected_n)}本`, stale || runtimeDiff || !opsNumber(e.attached_n) || !opsNumber(e.expected_n) ? 'unknown' : 'ok')+'<br><small>装着確認は、継続動作・実行中の入力・売買許可の確認ではありません</small>');
  setHtml('operational-protection', stale || !opsNumber(e.positions_n) ? opsSpan('未確認 — 最新の建玉情報を取得できません','unknown') : opsSpan(`サーバーSL ${count(e.protected_n)}／${count(e.positions_n)}件 ・ SLなし ${count(e.missing_sl_n)}件 ・ 未確認 ${count(e.unknown_sl_n)}件`,e.missing_sl_n ? 'bad' : e.unknown_sl_n ? 'unknown' : 'ok')+`<br><small>TP未設定 ${count(e.tp_unset_n)}件（EA仕様で必須と確認できた場合だけ注意表示）</small>`);
  setHtml('operational-deployment', opsSpan(`保存設定が指すEX5の登録指紋一致 ${count(e.saved_hash_matches)}／${count(e.expected_n)}本 ・ 差分／未確認 ${deployment.length}件`, deployment.length || runtimeDiff || !opsNumber(e.expected_n) ? 'unknown' : 'ok')+'<br><small>保存設定との照合。実行中の版・入力値はこの情報だけでは保証できません</small>');
  if (e.market_closed === true && !stale) {

    setHtml('operational-freshness', opsSpan(`${e.market_label || '市場休場中'}・金曜の終値で停止 ／ 監視取得 ${s ? opsUTC(s.last_success_at) : '未確認'}`, 'ok'));
  } else setHtml('operational-freshness', opsSpan(`元データ ${Number.isFinite(age) ? Math.max(0,age).toFixed(1)+'秒前' : '未確認'} ／ 監視取得 ${s ? opsUTC(s.last_success_at) : '未確認'}`,stale ? 'unknown' : 'ok'));
  let monitorState = 'ok';
  const layers = opsHealth && opsHealth.layers;
  const domains = opsHealth && opsHealth.domains;
  const layer = key => Array.isArray(layers) ? layers.find(x=>x.key===key) : layers && layers[key];
  const domain = key => Array.isArray(domains) ? domains.find(x=>x.key===key) : domains && domains[key];
  const checks = [layer('L0'),domain('DATA')];
  if (checks.some(check=>!check)) {
    monitorState='unknown';
    issues.push({kind:'monitor',state:'unknown',title:'監視処理が未確認',detail:'監視の健全性を取得できません'});
  } else {
    for (const check of checks.filter(Boolean)) {
      const outdated = !opsNumber(check.age_min) || !opsNumber(opsHealth.stale_after_min) || check.age_min < 0 || check.age_min+Math.max(0,(Date.now()-opsReceivedAt)/60000)>opsHealth.stale_after_min;
      if (check.state !== 'ok' || outdated) {
        monitorState = check.state === 'bad' ? 'bad' : monitorState === 'bad' ? 'bad' : 'unknown';
        issues.push({kind:'monitor',state:check.state==='bad' ? 'bad' : 'unknown',title:'監視の入力／判定を要確認',detail:outdated && check.state==='ok' ? '確認時刻が古い・未取得です' : check.note || check.detail || '監視結果が未確認です'});
      }
    }
  }
  if (opsErrors.length) { monitorState='unknown'; issues.push({kind:'monitor',state:'unknown',title:'一部の取得が失敗',detail:opsErrors.join('・')}); }
  setHtml('operational-monitor', opsSpan(monitorState==='ok' ? '入力・判定処理を確認' : monitorState==='bad' ? '判定できない状態 — 詳細は下の要確認事項' : '未確認／確認が必要',monitorState));
  const r=e.risk || {};
  const riskText = !stale && opsNumber(r.loss) && opsNumber(r.pct) ? `現値からSLまで ${r.loss.toLocaleString('ja-JP',{maximumFractionDigits:0})} ${r.currency || ''}（有効証拠金比 ${r.pct.toFixed(2)}％）` : `SLまでの想定損失：未計測${r.missing_n ? '（'+r.missing_n+'件の口座通貨換算が未取得）' : ''}`;
  const concentration = stale ? '保有内訳：未確認' : (e.concentration || []).map(c=>`${c.symbol} ${c.side} ${c.n}件`).join(' ／ ') || '保有なし';
  setHtml('operational-risk', `<span class="${!stale && opsNumber(r.loss) ? 'semantic-info' : 'semantic-warn'}" title="${escapeHtml(r.basis || '')}">${escapeHtml(riskText)}</span><br><small>${escapeHtml(concentration)}</small>`);
  const unique = new Map(issues.map(i=>[i.title+'|'+i.detail,i]));
  setHtml('operational-issues', unique.size ? [...unique.values()].map(i=>`<div class="decision-focus-item">${opsSpan(i.title,i.state)}<div class="decision-focus-text">${escapeHtml(String(i.detail || ''))}</div></div>`).join('') : opsSpan('取得できた確認項目に異常なし（未計測項目の保証ではありません）','ok'));
  setText('operational-checked-at', `確認 ${opsUTC(e.checked_at)} ・ 10秒ごと`);
}
async function refreshOperationalPanel() {
  const controller = new AbortController();
  const timeout = setTimeout(()=>controller.abort(),12000);
  try {
    const results = await Promise.allSettled(['operational-snapshot','status','health'].map(async name=>{
      const response=await fetch('/api/'+name,{cache:'no-store',signal:controller.signal});
      if (!response.ok) throw new Error('unavailable');
      const value=await response.json();
      if (!value || typeof value!=='object' || value.error) throw new Error('invalid');
      return value;
    }));
    [opsEvidence,opsStatus,opsHealth] = results.map(r=>r.status==='fulfilled' ? r.value : null);
    opsErrors=results.flatMap((r,i)=>r.status==='fulfilled' ? [] : [['実物データ','更新状態','監視処理'][i]]);
    opsReceivedAt=Date.now();
    renderOperationalPanel();
  } finally { clearTimeout(timeout); }
}
document.addEventListener('DOMContentLoaded',()=>{
  scheduleNonOverlapping(refreshOperationalPanel,10000);
  setInterval(renderOperationalPanel,1000);
});
