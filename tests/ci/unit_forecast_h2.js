// H2（欠点修正）のユニット検証：カード決済の「基礎額」を資金繰り予測の固定費に計上する。
// 合成フィクスチャ（fixtures_make、asOf=2026-11-14 固定）で
//   - basis.fixedCardBaseAvg が、実績集計の基礎額（fixed − fixedCash − cardSub）の窓平均と一致すること
//   - 予測各月の固定費に基礎額が含まれていること（基礎額を引いた最小月＝サブスク月額合計）
//   - 実績集計（history）自体は変わらないこと（基礎額は従来どおり fixed 側に計上済み）
// を確認し、合成データ（カード決済のみ・サブスクなし）で
//   - 基礎額の月平均がそのまま毎月の固定費になること
// を確認する。
// Usage: node unit_forecast_h2.js [index.html path]
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
  'subscriptionGroupKey', 'detectRecurrenceFreq', 'detectSubscriptions', 'detectSubscriptionsUncached', 'detectInvestmentSubscriptions', 'manualFixedCostKey',
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
console.log('== フィクスチャ ==');
const hist = computeForecastMonthlyHistory();
const fc = computeForecast();
check('予測が成立する（sufficientData）', fc.sufficientData === true);
check('fixedCardBaseAvg が basis に載る', typeof fc.basis.fixedCardBaseAvg === 'number' && fc.basis.fixedCardBaseAvg > 0, String(fc.basis.fixedCardBaseAvg));
// 期待値の窓は予測本体（H1 以降）と同じ「完了月の直近 windowSize 件」。
// 旧版は hist の末尾 windowSize 件（進行中月を含む）で計算していたが、実データでは
// 両窓の基礎額合計が偶然一致していたため差が見えなかった。フィクスチャでは
// 決済のない完了月（2026-04）が窓に入り、窓の定義差がそのまま FAIL になる。
const currentKey = getCycleBounds(new Date(2026, 10, 14)).key;
const win = hist.filter((m) => m.key < currentKey).slice(-fc.windowSize);
const expectedBaseAvg = win.reduce((t, m) => t + Math.max(0, m.fixed - m.fixedCash - m.cardSub), 0) / win.length;
check('基礎額の平均が実績集計の基礎額（fixed−fixedCash−cardSub）の窓平均と一致', Math.abs(fc.basis.fixedCardBaseAvg - expectedBaseAvg) < 0.01, fc.basis.fixedCardBaseAvg + ' vs ' + expectedBaseAvg);
check('基礎額の根拠行（cardFixedRows）が窓分だけ集まる', Array.isArray(fc.basis.fixedCardBaseRows) && fc.basis.fixedCardBaseRows.length > 0, String((fc.basis.fixedCardBaseRows || []).length));
const fixedMinusBase = fc.months.map((m) => m.fixed - fc.basis.fixedCardBaseAvg);
check('全月の固定費に基礎額が含まれる（基礎額控除後もサブスク月額以上）', fixedMinusBase.every((v) => v >= fc.basis.fixedMonthlyTotal - 0.01), JSON.stringify(fixedMinusBase));
check('基礎額控除後の最小月 ＝ サブスク月額合計（年払いが乗らない月）', Math.abs(Math.min(...fixedMinusBase) - fc.basis.fixedMonthlyTotal) < 0.01, Math.min(...fixedMinusBase) + ' vs ' + fc.basis.fixedMonthlyTotal);
check('実績集計は不変：基礎額は history の fixed 側に計上済み（窓合計 > 0）', win.reduce((t, m) => t + (m.fixed - m.fixedCash - m.cardSub), 0) > 0);
console.log('  fixedCardBaseAvg:', Math.round(fc.basis.fixedCardBaseAvg), '| monthly fixed:', fc.months.map((m) => Math.round(m.fixed)).join(', '));

console.log('== 合成データ（カード決済のみ・サブスクなし） ==');
parseAsofDate = () => new Date(2026, 10, 14);
const metaCash = { cash: true, card: false, deposit: true, investment: false, prepaid: false, unpaid: false, financing: false, group: '', dormant: false, principalOnly: false, liquidExcluded: false };
const metaCard = { cash: false, card: true, deposit: false, investment: false, prepaid: false, unpaid: false, financing: false, group: '', dormant: false, principalOnly: false, liquidExcluded: false };
settings.accountMeta = new Map([['現金', metaCash], ['テストカード', metaCard]]);
settings.accountMetaInited = true;
settings.manualFixedCosts = new Map();   // 実 settings の手動固定費（家賃）を合成条件から外す
const mkRow = (y, mo, d, type, amount, key, from, to) => ({
  date: new Date(y, mo - 1, d), dayKey: y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0'),
  acctMonthKey: key, type, amount, category: type === 'income' ? '給与' : 'その他', subCategory: '', store: '', item: '', memo: '',
  fromAccount: from || '', toAccount: to || '', aggSetting: 'include',
});
// 決済（現金→テストカード）：2026-07: 50,000 / 08: 50,000 / 09: 80,000 / 10（進行中）: 50,000
// 残額の中央値 = 50,000 → 各月の基礎額は 50,000（09 は超過 30,000 が変動費）
const rows = [];
[['2026-07', 2026, 8, 10, 50000], ['2026-08', 2026, 9, 10, 50000], ['2026-09', 2026, 10, 10, 80000], ['2026-10', 2026, 11, 10, 50000]].forEach(([key, y, mo, d, amt]) => {
  rows.push(mkRow(y, mo, 5, 'income', 200000, key, '', '現金'));
  rows.push(mkRow(y, mo, d, 'transfer', amt, key, '現金', 'テストカード'));
});
state.transactions = rows;
const fcS = computeForecast();
check('合成：予測が成立する', fcS.sufficientData === true);
check('合成：基礎額の平均 = 50,000', Math.abs(fcS.basis.fixedCardBaseAvg - 50000) < 0.01, String(fcS.basis.fixedCardBaseAvg));
check('合成：サブスクなしでも毎月の固定費 = 50,000（基礎額のみ）', fcS.months.every((m) => Math.abs(m.fixed - 50000) < 0.01), JSON.stringify(fcS.months.map((m) => m.fixed)));
const histS = computeForecastMonthlyHistory();
const sep = histS.find((m) => m.key === '2026-09');
check('合成：2026-09 の実績分類は 基礎額50,000（fixed側）＋超過30,000（variable側）', sep && Math.abs((sep.fixed - sep.fixedCash - sep.cardSub) - 50000) < 0.01 && Math.abs(sep.variable - 30000) < 0.01, sep ? JSON.stringify({ fixed: sep.fixed, variable: sep.variable }) : 'no bucket');

console.log('== 結果: pass ' + pass + ' / fail ' + fail + ' ==');
if (fail) process.exit(1);
`;
vm.runInContext(testSrc, sandbox);
