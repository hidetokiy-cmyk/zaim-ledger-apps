// 【配置メモ】この検証は H4（computeForecast のメモ化）が前提。H4 は未マージ
// （ローカルブランチ fix-h4-forecast-memoize）のため、main では宣言抽出に失敗して
// 終了するのが正常。H4 のマージ後は tests/ci/ へ移して CI の関門に加えること。
// H4（欠点修正）のユニット検証：資金繰り予測（computeForecast）のメモ化。
// 合成フィクスチャ（fixtures_make、asOf=2026-11-14 固定）で次を確認する。
//   - 同じ入力で2回呼んでも実計算（computeForecastUncached）は1回だけ走り、同じオブジェクトが返る
//   - メモ化した結果は実計算の結果と一致する（数値の射影で比較）
//   - 取引のインプレース変更・設定の変更・前提（給与）の localStorage 変更で指紋が変わり、再計算される
//   - メモ化経由の呼び出し（指紋計算込み）が実計算より十分に速い
// Usage: node unit_forecast_h4.js [index.html path]
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const REPO_ROOT = path.join(__dirname, '..', '..');
const htmlPath = process.argv[2] || path.join(REPO_ROOT, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf-8');
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const main = scripts.find((s) => s.includes('function renderPointsCard'));
if (!main) { console.error('main script not found'); process.exit(2); }

const declStart = new Map();
{
  const re = /^( {0,2})(?:function\s+([A-Za-z_$][\w$]*)\s*\()|^ {0,2}(?:(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=)/gm;
  let m;
  while ((m = re.exec(main))) {
    const name = m[2] || m[3];
    const idx = m.index + (m[1] ? m[1].length : (m[0].match(/^ */) || [''])[0].length);
    if (!declStart.has(name)) declStart.set(name, { idx, isFunc: !!m[2] });
    if (m[3]) {
      const lineEnd = main.indexOf('\n', m.index);
      const rest = main.slice(m.index, lineEnd === -1 ? undefined : lineEnd);
      for (const mm of rest.matchAll(/,\s*([A-Za-z_$][\w$]*)\s*=/g)) {
        if (!declStart.has(mm[1])) declStart.set(mm[1], { idx, isFunc: false });
      }
    }
  }
}
function extractDecl(name) {
  const info = declStart.get(name);
  if (!info) return null;
  let depthB = 0, depthP = 0, depthK = 0, sawBrace = false;
  for (let i = info.idx; i < main.length; i++) {
    const ch = main[i];
    if (ch === '{') { depthB++; sawBrace = true; }
    else if (ch === '}') { depthB--; if (info.isFunc && sawBrace && depthB === 0) return main.slice(info.idx, i + 1); }
    else if (ch === '(') depthP++;
    else if (ch === ')') depthP--;
    else if (ch === '[') depthK++;
    else if (ch === ']') depthK--;
    else if (ch === ';' && !info.isFunc && depthB === 0 && depthP === 0 && depthK === 0) return main.slice(info.idx, i + 1);
  }
  return null;
}

const WANTED = [
  'startOfDay', 'addDays', 'dkey', 'nthWeekday', 'shunbunDay', 'shubunDay', 'holidayCache', 'computeJpHolidays', 'isJpHoliday', 'isBusinessDay', 'isFutureRow',
  'adjustedCycleStart', 'cycleBoundsForKey', 'getCycleBounds', 'cycleLabel',
  'VOID_ACCOUNT', 'findCol', 'parseCsvDate', 'parseAmount', 'clean', 'canonAcct', 'mapAggSetting', 'parseZaimCSV',
  'blankAccountMeta', 'getAccountMeta', 'accountMetaCache', 'accountMetaRev', 'accountFlagSet', 'liveAccountSet',
  'CF_CASH_ACCOUNTS', 'CF_INVESTMENT_ACCOUNTS', 'CF_FINANCING_ACCOUNTS', 'forecastIsCashAccount',
  'CARD_KNOWN_CYCLES', 'normalizeCardAccountName', 'CARD_KNOWN_CYCLES_BY_NORM', 'CARD_CYCLE_CLOSING_DAYS', 'CARD_CYCLE_LAGS', 'CARD_CYCLE_FIT_THRESHOLD',
  'cardCycleClosingDate', 'cardCycleClosingDateForSettlement', 'cardSettleDate',
  'collectCardRawData', 'inferCardBillingCycle', 'cardCycleCacheTx', 'cardCycleCache', 'getCardBillingCycle',
  'latestActualDate', 'isPrepaidAccount', 'isExcludedRow', 'breakdownKeyForRow',
  'SUB_MONTHLY_MIN', 'SUB_MONTHLY_SKIP_MIN', 'SUB_YEARLY_MIN', 'SUBSCRIPTION_EXCLUDED_CATEGORIES', 'SUB_GRACE_DAYS',
  'subscriptionGroupKey', 'detectRecurrenceFreq', 'detectSubscriptions', 'detectSubscriptionsUncached', 'subscriptionTypicalAmount', 'detectInvestmentSubscriptions', 'manualFixedCostKey',
  'subsCache', 'subsCacheOn',
  'FORECAST_MONTHS_AHEAD', 'FORECAST_WINDOW_MIN', 'FORECAST_SEASONAL_MIN_MONTHS',
  'computeForecastMonthlyHistory', 'forecastAvg', 'forecastStdev', 'computeForecast', 'computeForecastUncached', 'forecastDataKey', 'forecastCache',
  'DIVIDEND_LS_KEY', 'loadDividends', 'SALARY_NET_LS_KEY', 'SALARY_NET_DEFAULT', 'PASS_PRICE_DEFAULT', 'loadSalaryNetAssumption',
  'passReimbursementMap', 'passReimbursementForKey', 'projectCardSettlementMonthKey',
  'sumCashFromMap', 'accountBalanceAsOfLabel', 'parseAsofDate',
];
const extracted = new Map();
for (const name of WANTED) {
  const code = extractDecl(name);
  if (!code) { console.error('extract failed:', name); process.exit(2); }
  extracted.set(name, code);
}

const { buildFixture } = require('./fixtures_make');
const fixture = buildFixture(new Date(2026, 10, 14));
const rawSettings = fixture.settings;
const csvText = fixture.csvText;
const papaSrc = fs.readFileSync(path.join(REPO_ROOT, 'papaparse.min.js'), 'utf-8');

const lsStore = new Map();
const sandbox = { console, process, localStorage: { getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null), setItem: (k, v) => lsStore.set(k, String(v)), removeItem: (k) => lsStore.delete(k) } };
sandbox.__ls = lsStore;
vm.createContext(sandbox);
vm.runInContext(papaSrc, sandbox);
vm.runInContext(`
  let voidRowsForReconcile = [];
  const state = { transactions: [], balancePattern: 0 };
  const settings = {
    prepaidAccounts: [], furusatoKeyword: 'ふるさと納税',
    accountBalanceOverride: new Map(), balanceExcludedAccounts: new Set(), accountBalanceInited: false,
    accountMeta: new Map(), accountGroupList: [], accountMetaInited: false,
    securitiesScrapeInfo: null, monthClose: {}, yearClose: {}, savedViews: [], securitiesHistory: [],
    zaimScrapeInfo: null, accountBalanceAsOfDate: null,
    pendingZaimImport: null, pendingZaimCsv: null, zaimCsvSyncedAt: null, syncHeartbeat: null,
    pendingSecuritiesImport: null, pendingPointExpiry: null,
    manualFixedCosts: new Map(), accountRenames: new Map(), categoryBudgets: new Map(),
  };
  // 起点残高は変更前後の差分比較が目的なので 0 に固定する（絶対値は実アプリ側で別途確認）
  function getAccountBalancesAsOf() { return new Map(); }
`, sandbox);
sandbox.__raw = rawSettings;
vm.runInContext(`
  settings.prepaidAccounts = __raw.prepaidAccounts || [];
  settings.accountMeta = new Map(Object.entries(__raw.accountMeta || {}));
  settings.balanceExcludedAccounts = new Set(__raw.balanceExcludedAccounts || []);
  settings.manualFixedCosts = new Map(Object.entries(__raw.manualFixedCosts || {}));
  settings.monthClose = __raw.monthClose || {};
  settings.yearClose = __raw.yearClose || {};
  settings.accountBalanceAsOfDate = __raw.accountBalanceAsOfDate || null;
  settings.zaimScrapeInfo = __raw.zaimScrapeInfo || null;
  settings.securitiesHistory = __raw.securitiesHistory || [];
`, sandbox);
vm.runInContext([...new Set(extracted.values())].join('\n'), sandbox);
sandbox.__csv = csvText;
vm.runInContext(`state.transactions = parseZaimCSV(__csv);`, sandbox);

const testSrc = `
let pass = 0, fail = 0;
const check = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS', name); } else { fail++; console.log('  FAIL', name, extra || ''); } };

// 実計算の回数を数えるプロキシ（ラッパは呼び出し時に名前解決するので差し替えが効く）
let rawCount = 0;
const __origUncached = computeForecastUncached;
computeForecastUncached = function () { rawCount++; return __origUncached(); };

const proj = (f) => JSON.stringify({
  usableCount: f.usableCount, windowSize: f.windowSize, sufficientData: f.sufficientData, startBalance: f.startBalance,
  months: (f.months || []).map((m) => [m.key, Math.round(m.income), Math.round(m.fixed), Math.round(m.variable), Math.round(m.balance), Math.round(m.upper), Math.round(m.lower)]),
  basis: f.basis ? { s: f.basis.windowStartKey, e: f.basis.windowEndKey, ia: Math.round(f.basis.incomeAvg), va: Math.round(f.basis.variableAvg), sal: f.basis.salaryAssumption, fm: f.basis.fixedMonthlyTotal, fy: f.basis.fixedYearlyTotal } : null,
  hist: (f.history || []).map((m) => [m.key, Math.round(m.income), Math.round(m.fixed), Math.round(m.variable), Math.round(m.investFin)]),
});

parseAsofDate = () => new Date(2026, 10, 14);
console.log('== フィクスチャ：メモ化の基本動作 ==');
check('指紋が作れる（forecastDataKey が文字列を返す）', typeof forecastDataKey() === 'string' && forecastDataKey().length > 0);
const t0 = Date.now();
const fc1 = computeForecast();
const tRaw = Date.now() - t0;
check('1回目で実計算が1回走る', rawCount === 1, String(rawCount));
check('予測が成立する（sufficientData）', fc1.sufficientData === true);
const t1 = Date.now();
const fc2 = computeForecast();
const tCached = Date.now() - t1;
check('2回目は実計算が走らない', rawCount === 1, String(rawCount));
check('2回目は同じオブジェクトが返る', fc2 === fc1);
const raw = computeForecastUncached();
check('実計算を直接呼ぶと回数が増える', rawCount === 2, String(rawCount));
check('メモ化の結果と実計算の結果が一致', proj(fc1) === proj(raw));
console.log('  実計算 ' + tRaw + 'ms / メモ化経由（指紋計算込み） ' + tCached + 'ms');
check('メモ化経由が実計算より十分に速い', tCached < Math.max(5, tRaw / 3), tCached + 'ms vs ' + tRaw + 'ms');

console.log('== 入力が変わったら再計算される ==');
const victim = state.transactions.find((r) => r.type === 'expense');
victim.amount += 1;
const fc3 = computeForecast();
check('取引のインプレース変更で再計算される', rawCount === 3, String(rawCount));
check('再計算後は新しいオブジェクト', fc3 !== fc1);
victim.amount -= 1;
computeForecast();
check('取引を戻すと再計算される（古い結果は使い回さない）', rawCount === 4, String(rawCount));
settings.accountBalanceOverride.set('テスト口座', 12345);
computeForecast();
check('設定（残高上書き）の変更で再計算される', rawCount === 5, String(rawCount));
settings.accountBalanceOverride.delete('テスト口座');
__ls.set('zaimLedgerSalaryNet', '202129');
const fc6 = computeForecast();
check('前提（給与・localStorage）の変更で再計算される', rawCount === 6, String(rawCount));
check('新しい前提が結果に反映される（salaryAssumption=202129）', fc6.basis && fc6.basis.salaryAssumption === 202129, fc6.basis && String(fc6.basis.salaryAssumption));
const fc7 = computeForecast();
check('前提が同じうちは再びメモ化される', rawCount === 6 && fc7 === fc6, String(rawCount));

console.log('== 結果: pass ' + pass + ' / fail ' + fail + ' ==');
if (fail) process.exit(1);
`;
vm.runInContext(testSrc, sandbox);
