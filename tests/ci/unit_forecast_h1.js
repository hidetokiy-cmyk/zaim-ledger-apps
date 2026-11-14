// H1（欠点修正）のユニット検証：資金繰り予測の平均母集団から進行中の会計月を外す。
// 合成フィクスチャ（fixtures_make、asOf=2026-11-14 固定、進行中月=2026-10）で
//   - 窓（basis.windowStartKey〜windowEndKey）に進行中月が含まれないこと
//   - 変動費平均が「完了月の直近6ヶ月」の単純平均と一致すること
//   - usableCount が history 件数 − 1 になること
// を確認し、合成データで
//   - 完了月が2ヶ月以上あれば進行中月を除いた平均になること
//   - 完了月が2ヶ月に満たない場合は従来どおり進行中月も含める（フォールバック）こと
// を確認する。
// Usage: node unit_forecast_h1.js [index.html path]
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
  'computeForecastMonthlyHistory', 'forecastAvg', 'forecastStdev', 'computeForecast',
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
// メモ化（H4）関連の宣言は、H4 が main に入る前は存在しない。computeForecast が
// それらを参照する版でのみ必要になるため、存在すれば取り込む（任意抽出）。
for (const name of ['computeForecastUncached', 'forecastDataKey', 'forecastCache']) {
  if (!extracted.has(name)) {
    const code = extractDecl(name);
    if (code) extracted.set(name, code);
  }
}

const rawSettings = fixture.settings;
const csvText = fixture.csvText;
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

parseAsofDate = () => new Date(2026, 10, 14);
console.log('== フィクスチャ（asOf=2026-11-14 固定） ==');
const asOf = parseAsofDate();
const currentKey = getCycleBounds(asOf).key;
console.log('  asOf =', asOf.toISOString().slice(0, 10), '| currentKey =', currentKey, '| tx =', state.transactions.length);
const hist = computeForecastMonthlyHistory();
const fc = computeForecast();
check('予測が成立する（sufficientData）', fc.sufficientData === true);
check('窓の末尾が進行中月でない', fc.basis.windowEndKey < currentKey, fc.basis.windowEndKey + ' vs ' + currentKey);
check('history の末尾は進行中月（実績表は従来どおり進行中月を含む）', hist[hist.length - 1].key === currentKey, hist[hist.length - 1].key);
check('usableCount = history 件数 − 1（進行中月だけが外れる）', fc.usableCount === hist.length - 1, fc.usableCount + ' vs ' + hist.length);
const completedAsc = hist.filter((m) => m.key < currentKey);
const win = completedAsc.slice(-fc.windowSize);
const expectedVarAvg = win.reduce((t, m) => t + m.variable, 0) / win.length;
check('変動費平均が完了月の窓の単純平均と一致', Math.abs(fc.basis.variableAvg - expectedVarAvg) < 0.01, fc.basis.variableAvg + ' vs ' + expectedVarAvg);
check('窓の開始キーが完了月の窓と一致', fc.basis.windowStartKey === win[0].key, fc.basis.windowStartKey + ' vs ' + win[0].key);
const oldStyleAvg = hist.slice(-fc.windowSize).reduce((t, m) => t + m.variable, 0) / fc.windowSize;
check('（参考）進行中月混入時の平均より下がらない＝楽観バイアスが消える方向', fc.basis.variableAvg >= oldStyleAvg, fc.basis.variableAvg + ' vs ' + oldStyleAvg);
console.log('  variableAvg:', Math.round(fc.basis.variableAvg), '（混入時:', Math.round(oldStyleAvg) + '）', '| window:', fc.basis.windowStartKey, '〜', fc.basis.windowEndKey);

console.log('== 合成データ（フォールバック条件） ==');
// asOf を 2026-11-14 に固定し、現金口座だけの最小取引で会計月を作る
parseAsofDate = () => new Date(2026, 10, 14);
const meta = { cash: true, card: false, deposit: true, investment: false, prepaid: false, unpaid: false, financing: false, group: '', dormant: false, principalOnly: false, liquidExcluded: false };
settings.accountMeta = new Map([['現金', meta]]);
settings.accountMetaInited = true;
const mkRow = (y, mo, d, type, amount, key) => ({
  date: new Date(y, mo - 1, d), dayKey: y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0'),
  acctMonthKey: key, type, amount, category: type === 'income' ? '給与' : '食費', subCategory: '', store: '', item: '', memo: '',
  fromAccount: type === 'expense' ? '現金' : '', toAccount: type === 'income' ? '現金' : '', aggSetting: 'include',
});
// 完了月 2026-08（変動費60,000）・2026-09（90,000）、進行中 2026-10（途中分10,000）
const rowsFull = [
  mkRow(2026, 8, 10, 'income', 200000, '2026-08'), mkRow(2026, 8, 12, 'expense', 60000, '2026-08'),
  mkRow(2026, 9, 10, 'income', 200000, '2026-09'), mkRow(2026, 9, 12, 'expense', 90000, '2026-09'),
  mkRow(2026, 11, 10, 'income', 200000, '2026-10'), mkRow(2026, 11, 12, 'expense', 10000, '2026-10'),
];
state.transactions = rowsFull;
const fcA = computeForecast();
check('完了月2ヶ月：窓の末尾は完了月 2026-09', fcA.basis.windowEndKey === '2026-09', fcA.basis.windowEndKey);
check('完了月2ヶ月：変動費平均 = (60,000+90,000)/2 = 75,000', Math.abs(fcA.basis.variableAvg - 75000) < 0.01, String(fcA.basis.variableAvg));
check('完了月2ヶ月：usableCount = 2', fcA.usableCount === 2, String(fcA.usableCount));
// 完了月が 2026-09 のみの場合はフォールバック（進行中月も含める）
state.transactions = rowsFull.filter((r) => r.acctMonthKey !== '2026-08');
const fcB = computeForecast();
check('完了月1ヶ月：フォールバックで窓の末尾が進行中月 2026-10', fcB.basis.windowEndKey === '2026-10', fcB.basis.windowEndKey);
check('完了月1ヶ月：変動費平均 = (90,000+10,000)/2 = 50,000（従来動作）', Math.abs(fcB.basis.variableAvg - 50000) < 0.01, String(fcB.basis.variableAvg));

console.log('== 結果: pass ' + pass + ' / fail ' + fail + ' ==');
if (fail) process.exit(1);
`;
vm.runInContext(testSrc, sandbox);
