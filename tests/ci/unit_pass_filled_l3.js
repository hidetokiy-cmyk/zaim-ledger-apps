// L3（欠点修正）のユニット検証：定期券（交通費精算）の自動補完に「補完」マーカーが付くこと。
// データから検出できない購入サイクル月（5月・11月）は現行価格で補完されるが、その分は
// 検出分と区別できる必要がある。合成データ（定期券の取引を一切含まない実績）で、
// 資金繰り予測の対象月に passFilled = true が立つことを確認する。
// 検出できた月の passFilled = false は unit_salary_model.js（フィクスチャ検出あり）で確認する。
// Usage: node unit_pass_filled_l3.js [index.html path]
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
  'FORECAST_MONTHS_AHEAD', 'FORECAST_WINDOW_MIN', 'FORECAST_WINDOW_MAX', 'FORECAST_SEASONAL_MIN_MONTHS',
  'computeForecastMonthlyHistory', 'median', 'forecastAvg', 'forecastStdev', 'computeForecast', 'computeForecastUncached', 'forecastDataKey', 'forecastCache',
  'DIVIDEND_LS_KEY', 'loadDividends', 'SALARY_NET_LS_KEY', 'SALARY_NET_DEFAULT', 'PASS_PRICE_DEFAULT', 'loadSalaryNetAssumption',
  'passReimbursementMap', 'passReimbursementForKey', 'passReimbursementFilled', 'projectCardSettlementMonthKey',
  'sumCashFromMap', 'accountBalanceAsOfLabel', 'parseAsofDate',
];
const extracted = new Map();
for (const name of WANTED) {
  const code = extractDecl(name);
  if (!code) { console.error('extract failed:', name); process.exit(2); }
  extracted.set(name, code);
}

const papaSrc = fs.readFileSync(path.join(REPO_ROOT, 'papaparse.min.js'), 'utf-8');
const sandbox = { console, process, localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } };
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
    pendingSecuritiesImport: null, pendingPointExpiry: null, externalPoints: null,
    manualFixedCosts: new Map(), accountRenames: new Map(), categoryBudgets: new Map(),
  };
  function getAccountBalancesAsOf() { return new Map(); }
`, sandbox);
vm.runInContext([...new Set(extracted.values())].join('\n'), sandbox);

const testSrc = `
let pass = 0, fail = 0;
const check = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS', name); } else { fail++; console.log('  FAIL', name, extra || ''); } };

// 判定そのもの（マップを直接渡す）
const emptyMap = new Map();
check('未検出の購入サイクル月（2027-05）は補完', passReimbursementFilled('2027-05', emptyMap) === true);
check('未検出の購入サイクル月（2027-11）は補完', passReimbursementFilled('2027-11', emptyMap) === true);
check('対象外月（2027-06）は補完ではない', passReimbursementFilled('2027-06', emptyMap) === false);
check('検出できた月は補完ではない', passReimbursementFilled('2027-05', new Map([['2027-05', 66970]])) === false);
check('補完額は現行価格 66,970 のまま（計算は不変）', passReimbursementForKey('2027-05', emptyMap) === 66970);

// 資金繰り予測の月オブジェクトに passFilled が立つこと。
// asOf = 2026-04-20（進行中の会計月は 2026-03）、定期券の取引は一切なし。
// 行の日付はすべて実今日（テスト実行日）より前に置く（isFutureRow が実日付で
// 未来行を弾くため、未来の日付にすると実行日に依存してしまう）。
parseAsofDate = () => new Date(2026, 3, 20);
const metaBase = { cash: false, card: false, deposit: false, investment: false, prepaid: false, unpaid: false, financing: false, group: '', dormant: false, principalOnly: false, liquidExcluded: false };
settings.accountMeta = new Map([['現金', Object.assign({}, metaBase, { cash: true, deposit: true })]]);
settings.accountMetaInited = true;
const mkRow = (y, mo, d, type, amount, key) => ({
  date: new Date(y, mo - 1, d), dayKey: y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0'),
  acctMonthKey: key, type, amount, category: type === 'income' ? '給与' : '食費', subCategory: '', store: '', item: '', memo: '',
  fromAccount: type === 'expense' ? '現金' : '', toAccount: type === 'income' ? '現金' : '', aggSetting: 'include',
});
const rows = [];
['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03'].forEach((k) => {
  const [y, m] = k.split('-').map(Number);
  rows.push(mkRow(y, m, 10, 'income', 200000, k));
  rows.push(mkRow(y, m, 12, 'expense', 50000, k));
});
state.transactions = rows;
const fc = computeForecast();
check('予測が成立する（sufficientData）', fc.sufficientData === true);
const may = fc.months.find((m) => m.key === '2026-05');
const apr = fc.months.find((m) => m.key === '2026-04');
console.log('  months:', fc.months.map((m) => m.key + ':pass=' + m.pass + (m.passFilled ? '(補完)' : '')).join(' '));
check('2026-05 が予測に含まれる', !!may);
check('2026-05 の pass は補完額 66,970', may && may.pass === 66970, may && String(may.pass));
check('2026-05 は passFilled = true（補完マーク）', may && may.passFilled === true, may && String(may.passFilled));
check('2026-04 は pass = 0・passFilled = false', apr && apr.pass === 0 && apr.passFilled === false, apr && (apr.pass + '/' + apr.passFilled));

console.log('== 結果: pass ' + pass + ' / fail ' + fail + ' ==');
if (fail) process.exit(1);
`;
vm.runInContext(testSrc, sandbox);
