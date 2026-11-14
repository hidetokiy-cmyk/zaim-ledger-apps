// M3（欠点修正）のユニット検証：サブスク検出の金額モデルと周期判定。
//   - 代表額（typicalAmount）＝直近3件の中央値。最新行が非定型（初回日割り・一度きりの
//     買い増し）でも予測が引っ張られないこと。年次は改定前の定型額が代表になること。
//   - 間隔の大半が50〜70日（1か月欠け）のサブスクは隔月払い（periodMonths=2）と判定し、
//     月次換算は代表額÷2 になること。
//   - 資金繰り予測の根拠（basis.fixedMonthlyTotal / fixedYearlyTotal）と各月の固定費が、
//     上記の月次換算・代表額で増えること（差分で検証）。
// 土台は合成フィクスチャ（fixtures_make、asOf=2026-11-14 固定）で、検証用の取引行を
// パース済みの行オブジェクトを複製して足す。
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
  'CARD_KNOWN_CYCLES', 'CARD_CYCLE_CLOSING_DAYS', 'CARD_CYCLE_LAGS', 'CARD_CYCLE_FIT_THRESHOLD',
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
for (const name of ['computeForecastUncached', 'forecastDataKey', 'forecastCache']) {
  if (!extracted.has(name)) {
    const code = extractDecl(name);
    if (code) extracted.set(name, code);
  }
}

const { buildFixture } = require('./fixtures_make');
const fixture = buildFixture(new Date(2026, 10, 14));
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

console.log('== ベースライン（フィクスチャのみ） ==');
const baseSubs = detectSubscriptions();
const baseFc = computeForecast();
check('予測が成立する', baseFc.sufficientData === true);
console.log('  base fixedMonthlyTotal =', baseFc.basis.fixedMonthlyTotal, '| fixedYearlyTotal =', baseFc.basis.fixedYearlyTotal, '| month0 fixed =', baseFc.months[0].fixed);

console.log('== 検証用の定期支払いを足す ==');
const tmpl = state.transactions.find((r) => r.type === 'expense');
function addRow(y, m, d, store, amount) {
  const r = Object.assign({}, tmpl);
  r.date = new Date(y, m - 1, d);
  r.fromAccount = '現金';
  r.toAccount = '';
  r.store = store;
  r.category = '通信';
  r.subCategory = '';
  r.amount = amount;
  state.transactions.push(r);
}
// A：隔月払い（60日前後の間隔）¥6,000
addRow(2026, 5, 10, '隔月テスト店', 6000);
addRow(2026, 7, 9, '隔月テスト店', 6000);
addRow(2026, 9, 8, '隔月テスト店', 6000);
addRow(2026, 11, 7, '隔月テスト店', 6000);
// B：月次。初回は日割り ¥1,000、定型 ¥1,500、最新行だけ一度きりの ¥2,980
addRow(2026, 8, 15, '変動テスト店', 1000);
addRow(2026, 9, 15, '変動テスト店', 1500);
addRow(2026, 10, 15, '変動テスト店', 1500);
addRow(2026, 11, 14, '変動テスト店', 2980);
// C：年次。定型 ¥12,000、最新行で ¥15,000 に改定されたばかり
addRow(2024, 3, 10, '年次テスト店', 12000);
addRow(2025, 3, 10, '年次テスト店', 12000);
addRow(2026, 3, 10, '年次テスト店', 15000);
subsCache = null;

console.log('== 検出結果（M3） ==');
const subs = detectSubscriptions();
const A = subs.find((s) => s.label === '隔月テスト店');
const B = subs.find((s) => s.label === '変動テスト店');
const C = subs.find((s) => s.label === '年次テスト店');
check('A（隔月）が検出される', !!A);
check('A は freq=month のまま', A && A.freq === 'month', A && A.freq);
check('A は periodMonths=2（隔月払い）', A && A.periodMonths === 2, A && String(A.periodMonths));
check('A の代表額 = 6,000', A && A.typicalAmount === 6000, A && String(A.typicalAmount));
check('A の月次換算 = 6,000 ÷ 2 = 3,000', A && A.monthlyEquivalent === 3000, A && String(A.monthlyEquivalent));
check('B（月次・金額変動）が検出される', !!B);
check('B は periodMonths=1', B && B.periodMonths === 1, B && String(B.periodMonths));
check('B の最新額は 2,980 のまま（実績表示用）', B && B.amount === 2980, B && String(B.amount));
check('B の代表額 = 直近3件の中央値 1,500（最新の一度きりの額に引っ張られない）', B && B.typicalAmount === 1500, B && String(B.typicalAmount));
check('B の月次換算 = 1,500', B && B.monthlyEquivalent === 1500, B && String(B.monthlyEquivalent));
check('C（年次）が検出される', !!C && C.freq === 'year', C && C.freq);
check('C の代表額 = 12,000（改定直後は定型額側）', C && C.typicalAmount === 12000, C && String(C.typicalAmount));
check('C の月次換算 = 12,000 ÷ 12 = 1,000', C && C.monthlyEquivalent === 1000, C && String(C.monthlyEquivalent));

console.log('== 資金繰り予測への反映（差分） ==');
const fc = computeForecast();
console.log('  new fixedMonthlyTotal =', fc.basis.fixedMonthlyTotal, '| fixedYearlyTotal =', fc.basis.fixedYearlyTotal, '| month0 fixed =', fc.months[0].fixed);
check('fixedMonthlyTotal の増分 = A 3,000 + B 1,500 = 4,500', Math.abs((fc.basis.fixedMonthlyTotal - baseFc.basis.fixedMonthlyTotal) - 4500) < 0.01, String(fc.basis.fixedMonthlyTotal - baseFc.basis.fixedMonthlyTotal));
check('fixedYearlyTotal の増分 = C の代表額 12,000', Math.abs((fc.basis.fixedYearlyTotal - baseFc.basis.fixedYearlyTotal) - 12000) < 0.01, String(fc.basis.fixedYearlyTotal - baseFc.basis.fixedYearlyTotal));
check('先頭月の固定費の増分 = 4,500（月次換算で毎月に均される）', Math.abs((fc.months[0].fixed - baseFc.months[0].fixed) - 4500) < 0.01, String(fc.months[0].fixed - baseFc.months[0].fixed));

console.log('== 結果: pass ' + pass + ' / fail ' + fail + ' ==');
if (fail) process.exit(1);
`;
vm.runInContext(testSrc, sandbox);
