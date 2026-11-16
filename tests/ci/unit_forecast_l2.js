// L2（欠点修正）のユニット検証：資金繰り予測のブレ幅（標準偏差）の母集団を予測本体と揃える。
// 本体は投資・財務を「検出した定期投資」だけに絞って見込むため、ブレ幅の母集団にも
// 生の投資・財務実績（一括投資などの不定期フロー）を混ぜないことを確認する。
// 合成データ：給与・変動費はほぼ一定の完了月6か月＋そのうち1か月に現金→投資口座の
// 一括振替 1,000,000（investFin = -1,000,000）を置く。
//   - 実績集計（history）の investFin には従来どおり一括投資が残ること
//   - basis.netStdev が「給与−変動費」の標準偏差と一致し、一括投資に引きずられないこと
//   - 旧式（投資・財務を含む）なら大きく膨らむ対照も併せて確認する
// Usage: node unit_forecast_l2.js [index.html path]
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

parseAsofDate = () => new Date(2026, 10, 14);
const metaBase = { cash: false, card: false, deposit: false, investment: false, prepaid: false, unpaid: false, financing: false, group: '', dormant: false, principalOnly: false, liquidExcluded: false };
settings.accountMeta = new Map([
  ['現金', Object.assign({}, metaBase, { cash: true, deposit: true })],
  ['テスト投資口座', Object.assign({}, metaBase, { investment: true })],
]);
settings.accountMetaInited = true;
const mkRow = (y, mo, d, type, amount, key, extra) => Object.assign({
  date: new Date(y, mo - 1, d), dayKey: y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0'),
  acctMonthKey: key, type, amount, category: type === 'income' ? '給与' : '食費', subCategory: '', store: '', item: '', memo: '',
  fromAccount: type === 'expense' ? '現金' : '', toAccount: type === 'income' ? '現金' : '', aggSetting: 'include',
}, extra || {});
// 完了月 2026-04〜2026-09：給与 200,000、変動費は 50,000〜65,000 でほぼ一定。
// 2026-06 に現金→投資口座の一括振替 1,000,000（investFin = -1,000,000）。
// 進行中月 2026-10 は途中分のみ（母集団には入らない）。
const VAR = { '2026-04': 50000, '2026-05': 60000, '2026-06': 55000, '2026-07': 65000, '2026-08': 50000, '2026-09': 60000 };
const rows = [];
Object.keys(VAR).forEach((k) => {
  const [y, m] = k.split('-').map(Number);
  rows.push(mkRow(y, m, 10, 'income', 200000, k));
  rows.push(mkRow(y, m, 12, 'expense', VAR[k], k));
});
rows.push(mkRow(2026, 6, 15, 'transfer', 1000000, '2026-06', { fromAccount: '現金', toAccount: 'テスト投資口座', category: '' }));
rows.push(mkRow(2026, 10, 10, 'income', 200000, '2026-10'));
rows.push(mkRow(2026, 10, 12, 'expense', 10000, '2026-10'));
state.transactions = rows;

const hist = computeForecastMonthlyHistory();
const jun = hist.find((m) => m.key === '2026-06');
check('実績集計では一括投資が investFin に残る（2026-06 = -1,000,000）', jun && jun.investFin === -1000000, jun && String(jun.investFin));

const fc = computeForecast();
check('予測が成立する（sufficientData）', fc.sufficientData === true);
const completedAsc = hist.filter((m) => m.key < '2026-10');
const win = completedAsc.slice(-fc.windowSize);
const expectedNew = forecastStdev(win.map((m) => m.income - m.variable));
const expectedOld = forecastStdev(win.map((m) => m.income - m.variable + m.investFin));
console.log('  netStdev:', Math.round(fc.basis.netStdev), '| 期待（給与−変動費）:', Math.round(expectedNew), '| 旧式（投資・財務込み）:', Math.round(expectedOld));
check('ブレ幅が「給与−変動費」の標準偏差と一致', Math.abs(fc.basis.netStdev - expectedNew) < 0.01, fc.basis.netStdev + ' vs ' + expectedNew);
check('一括投資に引きずられない（新式は小さい）', fc.basis.netStdev < 10000, String(Math.round(fc.basis.netStdev)));
check('対照：旧式では大きく膨らむ（> 300,000）', expectedOld > 300000, String(Math.round(expectedOld)));
const m0 = fc.months[0];
check('1か月目の帯の半幅が netStdev と一致', m0 && Math.abs((m0.upper - m0.lower) / 2 - fc.basis.netStdev) < 1, m0 && String((m0.upper - m0.lower) / 2));

console.log('== 結果: pass ' + pass + ' / fail ' + fail + ' ==');
if (fail) process.exit(1);
`;
vm.runInContext(testSrc, sandbox);
