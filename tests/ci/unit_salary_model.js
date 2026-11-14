// 給与モデル反映（契約手取りの前提＋定期券・交通費精算）のユニット検証：
// 対象 index.html のメインスクリプトから実物の宣言を抽出して Node 上で実行する（unit_outlook_fix と同方式）。
// 合成フィクスチャ（fixtures_make）を実パーサで読み、
//   - loadSalaryNetAssumption() の初期値（未設定→202129）・0保存時のフォールバック（null）
//   - passReimbursementMap() が実データから購入月（2026-05 / 2026-11）を検出すること
//   - passReimbursementForKey() の購入サイクル補完（5月・11月）と対象外月（0）
//   - computeForecast() で 11月度＝前提 202,129＋定期券 66,970、12月度＝前提のみ、
//     前提 0 のときは実績ベースに戻り basis.salaryAssumption が null になること
// を確認する。日付は asOf=2026-11-14 に固定（旧版は実行日依存だった）。
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
  // 日付・祝日
  'startOfDay', 'addDays', 'dkey', 'nthWeekday', 'shunbunDay', 'shubunDay', 'holidayCache', 'computeJpHolidays', 'isJpHoliday', 'isBusinessDay', 'isFutureRow',
  // 会計サイクル
  'adjustedCycleStart', 'cycleBoundsForKey', 'getCycleBounds', 'cycleLabel',
  // CSV パーサ
  'VOID_ACCOUNT', 'findCol', 'parseCsvDate', 'parseAmount', 'clean', 'canonAcct', 'mapAggSetting', 'parseZaimCSV',
  // 口座メタ
  'blankAccountMeta', 'getAccountMeta', 'accountMetaCache', 'accountMetaRev', 'accountFlagSet', 'liveAccountSet',
  'CF_CASH_ACCOUNTS', 'CF_INVESTMENT_ACCOUNTS', 'CF_FINANCING_ACCOUNTS', 'forecastIsCashAccount', 'sumCashFromMap',
  // カードサイクル・予定表
  'CARD_KNOWN_CYCLES', 'normalizeCardAccountName', 'CARD_KNOWN_CYCLES_BY_NORM', 'CARD_CYCLE_CLOSING_DAYS', 'CARD_CYCLE_LAGS', 'CARD_CYCLE_FIT_THRESHOLD',
  'cardCycleClosingDate', 'cardCycleClosingDateForSettlement', 'cardSettleDate',
  'collectCardRawData', 'inferCardBillingCycle', 'cardCycleCacheTx', 'cardCycleCache', 'getCardBillingCycle',
  'CARD_WARN_DAYS', 'computeCardSchedule', 'projectCardSettlementMonthKey',
  // 給与推定（フォールバック先）
  'PAYROLL_SHAKAI_RE', 'outlookMonthlySalary',
  // 今回の追加：給与前提・定期券精算
  'SALARY_NET_LS_KEY', 'SALARY_NET_DEFAULT', 'PASS_PRICE_DEFAULT',
  'loadSalaryNetAssumption', 'salaryNetStoredValue', 'saveSalaryNetAssumption',
  'passReimbursementMap', 'passReimbursementForKey',
  // 資金繰り予測
  'DIVIDEND_LS_KEY', 'loadDividends',
  'FORECAST_MONTHS_AHEAD', 'FORECAST_WINDOW_MIN', 'FORECAST_WINDOW_MAX', 'FORECAST_SEASONAL_MIN_MONTHS',
  'forecastAvg', 'forecastStdev', 'breakdownKeyForRow', 'subscriptionGroupKey',
  'detectSubscriptions', 'detectSubscriptionsUncached', 'subscriptionTypicalAmount', 'detectInvestmentSubscriptions',
  'subsCacheOn', 'subsCache', 'latestActualDate', 'isPrepaidAccount', 'isExcludedRow',
  'SUBSCRIPTION_EXCLUDED_CATEGORIES', 'SUB_GRACE_DAYS', 'detectPrepaidSubscriptions', 'detectRecurrenceFreq', 'manualFixedCostKey',
  'SUB_MONTHLY_MIN', 'SUB_MONTHLY_MAX', 'SUB_MONTHLY_SKIP_MIN', 'SUB_MONTHLY_SKIP_MAX', 'SUB_YEARLY_MIN', 'SUB_YEARLY_MAX',
  'computeForecastMonthlyHistory', 'computeForecast',
];
const extracted = new Map();
for (const name of WANTED) {
  const code = extractDecl(name);
  if (!code) { console.error('extract failed:', name); process.exit(2); }
  extracted.set(name, code);
}
console.log('抽出した宣言数:', extracted.size);

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

const lsStore = new Map();
const localStorageStub = {
  getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null),
  setItem: (k, v) => lsStore.set(k, String(v)),
  removeItem: (k) => lsStore.delete(k),
};
const sandbox = { console, process, localStorage: localStorageStub };
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
  function parseAsofDate() { return new Date(2026, 10, 14); }
  function getAccountBalancesAsOf() { return new Map(); }
`, sandbox);
sandbox.__raw = rawSettings;
vm.runInContext(`
  settings.accountMeta = new Map(Object.entries(__raw.accountMeta || {}));
  settings.balanceExcludedAccounts = new Set(__raw.balanceExcludedAccounts || []);
  settings.manualFixedCosts = new Map(Object.entries(__raw.manualFixedCosts || {}));
  settings.monthClose = __raw.monthClose || {};
  settings.yearClose = __raw.yearClose || {};
  settings.accountBalanceAsOfDate = __raw.accountBalanceAsOfDate || null;
  settings.zaimScrapeInfo = __raw.zaimScrapeInfo || null;
`, sandbox);
vm.runInContext([...new Set(extracted.values())].join('\n'), sandbox);
sandbox.__csv = csvText;
vm.runInContext(`state.transactions = parseZaimCSV(__csv);`, sandbox);

const testSrc = `
let pass = 0, fail = 0;
const check = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS', name); } else { fail++; console.log('  FAIL', name, extra || ''); } };
console.log('transactions =', state.transactions.length);

console.log('== 給与前提の読み書き（初期値・フォールバック） ==');
localStorage.removeItem(SALARY_NET_LS_KEY);
check('未設定 → loadSalaryNetAssumption() = 202129（契約手取りの初期値）', loadSalaryNetAssumption() === 202129, String(loadSalaryNetAssumption()));
check('未設定 → salaryNetStoredValue() = 202129（入力欄の初期表示）', salaryNetStoredValue() === 202129, String(salaryNetStoredValue()));
saveSalaryNetAssumption(0);
check('0を保存 → loadSalaryNetAssumption() = null（実績ベースへフォールバック）', loadSalaryNetAssumption() === null, String(loadSalaryNetAssumption()));
check('0を保存 → salaryNetStoredValue() = 0（入力欄は0のまま）', salaryNetStoredValue() === 0, String(salaryNetStoredValue()));
saveSalaryNetAssumption(180000);
check('180000を保存 → loadSalaryNetAssumption() = 180000', loadSalaryNetAssumption() === 180000, String(loadSalaryNetAssumption()));
localStorage.removeItem(SALARY_NET_LS_KEY);

console.log('== 定期券（交通費精算）の検出 ==');
const pm = passReimbursementMap();
console.log('  detected:', JSON.stringify([...pm.entries()]));
check('2026-05（購入 5/10 の振替から検出） = 66,970', pm.get('2026-05') === 66970, String(pm.get('2026-05')));
check('2026-11（購入 11/8 の振替＋11/25 の先行登録行） = 66,970', pm.get('2026-11') === 66970, String(pm.get('2026-11')));
check('検出は2件だけ（誤検出なし）', pm.size === 2, String(pm.size));
check('検出ありの月はその額（2026-11）', passReimbursementForKey('2026-11', pm) === 66970);
check('補完：2027-05（購入サイクル） = 66,970', passReimbursementForKey('2027-05', pm) === 66970, String(passReimbursementForKey('2027-05', pm)));
check('補完：2027-11（購入サイクル） = 66,970', passReimbursementForKey('2027-11', pm) === 66970);
check('対象外：2027-06 = 0', passReimbursementForKey('2027-06', pm) === 0);
check('対象外：2026-12 = 0', passReimbursementForKey('2026-12', pm) === 0);

console.log('== 資金繰り予測（前提あり：初期値 202,129） ==');
const f1 = computeForecast();
console.log('  sufficientData:', f1.sufficientData, '| months:', f1.months.map((m) => m.key + ':' + m.income + (m.pass ? '(pass ' + m.pass + ')' : '')).join(' '));
check('予測が成立する', f1.sufficientData === true);
check('basis.salaryAssumption = 202129', f1.basis && f1.basis.salaryAssumption === 202129, String(f1.basis && f1.basis.salaryAssumption));
const nov = f1.months.find((m) => m.key === '2026-11');
const dec = f1.months.find((m) => m.key === '2026-12');
check('11月度が予測に含まれる', !!nov);
check('11月度 pass = 66,970', nov && nov.pass === 66970, nov && String(nov.pass));
check('11月度 給与見込み = 202,129 + 66,970 = 269,099', nov && nov.income === 269099, nov && String(nov.income));
check('12月度 給与見込み = 202,129（標準月＝前提のみ）', dec && dec.income === 202129, dec && String(dec.income));
check('12月度 pass = 0', dec && dec.pass === 0, dec && String(dec.pass));

console.log('== 資金繰り予測（前提 0 → 実績ベースへフォールバック） ==');
saveSalaryNetAssumption(0);
const f2 = computeForecast();
console.log('  months:', f2.months.map((m) => m.key + ':' + m.income + (m.pass ? '(pass ' + m.pass + ')' : '')).join(' '));
check('basis.salaryAssumption = null', f2.basis && f2.basis.salaryAssumption === null, String(f2.basis && f2.basis.salaryAssumption));
const nov2 = f2.months.find((m) => m.key === '2026-11');
const dec2 = f2.months.find((m) => m.key === '2026-12');
check('フォールバック時も定期券は立つ（11月度 pass = 66,970）', nov2 && nov2.pass === 66970, nov2 && String(nov2.pass));
check('フォールバック時の給与は前提額ではない（11月度 income − pass ≠ 202,129）', nov2 && (nov2.income - nov2.pass) !== 202129, nov2 && String(nov2.income));
check('フォールバック時の給与は前提額ではない（12月度 income ≠ 202,129）', dec2 && dec2.income !== 202129, dec2 && String(dec2.income));
localStorage.removeItem(SALARY_NET_LS_KEY);

console.log('== 結果: pass ' + pass + ' / fail ' + fail + ' ==');
if (fail) process.exit(1);
`;
vm.runInContext(testSrc, sandbox);
