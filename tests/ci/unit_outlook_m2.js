// M2（欠点修正）のユニット検証：90日見通し（computeOutlook90）の前提を資金繰り予測に揃える。
//   (a) 前払費用の按分（非現金の支出行）は日割り支出（drip）に混ぜない
//       → 按分行を足しても見通しの推移（pts）が 1 円も変わらないこと。
//       対照として、現金の支出を足すと推移が下がること（drip が効いている証拠）。
//   (b) 配当・分配金（手入力の前提）が受取月の収入イベントとして数えられる
//       → 90日後の残高が配当額の分だけ増え、イベント一覧にも現れること。
// 取引はオブジェクトを直接組み立てて state に入れる（CSV を経由しない）。
// 開始残高はスタブで固定し、シナリオ間の差分だけで検証する（実行日に依存しない）。
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
  'CF_CASH_ACCOUNTS', 'CF_INVESTMENT_ACCOUNTS', 'CF_FINANCING_ACCOUNTS', 'forecastIsCashAccount', 'sumCashFromMap',
  'CARD_KNOWN_CYCLES', 'CARD_CYCLE_CLOSING_DAYS', 'CARD_CYCLE_LAGS', 'CARD_CYCLE_FIT_THRESHOLD',
  'cardCycleClosingDate', 'cardCycleClosingDateForSettlement', 'cardSettleDate',
  'collectCardRawData', 'inferCardBillingCycle', 'cardCycleCacheTx', 'cardCycleCache', 'getCardBillingCycle',
  'CARD_WARN_DAYS', 'computeCardSchedule', 'projectCardSettlementMonthKey',
  'SUB_MONTHLY_MIN', 'SUB_MONTHLY_MAX', 'SUB_MONTHLY_SKIP_MIN', 'SUB_MONTHLY_SKIP_MAX', 'SUB_YEARLY_MIN', 'SUB_YEARLY_MAX',
  'SUBSCRIPTION_EXCLUDED_CATEGORIES', 'SUB_GRACE_DAYS', 'subscriptionGroupKey', 'detectRecurrenceFreq',
  'detectSubscriptions', 'detectSubscriptionsUncached', 'detectInvestmentSubscriptions', 'manualFixedCostKey',
  'subsCache', 'subsCacheOn', 'latestActualDate', 'isPrepaidAccount', 'isExcludedRow', 'breakdownKeyForRow',
  'DIVIDEND_LS_KEY', 'loadDividends', 'SALARY_NET_LS_KEY', 'SALARY_NET_DEFAULT', 'PASS_PRICE_DEFAULT',
  'loadSalaryNetAssumption', 'salaryNetStoredValue', 'saveSalaryNetAssumption',
  'passReimbursementMap', 'passReimbursementForKey', 'PAYROLL_SHAKAI_RE', 'outlookMonthlySalary',
  'computeOutlook90', 'askCurStart', 'askCycleAt', 'rowsInRange', 'txSorted', 'rebuildTxIndex', 'lowerBound',
];
const extracted = new Map();
for (const name of WANTED) {
  const code = extractDecl(name);
  if (!code) { console.error('extract failed:', name); process.exit(2); }
  extracted.set(name, code);
}
// M3・M4（別PR）の新宣言は、そちらがマージされた後だけ実行時に必要になる。
// 存在すれば取り込む（任意抽出）ことで、マージ順序に依存せずこのテストが動き続ける。
for (const name of ['subscriptionTypicalAmount', 'normalizeCardAccountName', 'CARD_KNOWN_CYCLES_BY_NORM']) {
  if (!extracted.has(name)) {
    const code = extractDecl(name);
    if (code) extracted.set(name, code);
  }
}

const lsStore = new Map();
const localStorageStub = {
  getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null),
  setItem: (k, v) => lsStore.set(k, String(v)),
  removeItem: (k) => lsStore.delete(k),
};
const sandbox = { console, process, localStorage: localStorageStub };
sandbox.__ls = lsStore;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(REPO_ROOT, 'papaparse.min.js'), 'utf-8'), sandbox);
vm.runInContext(`
  let voidRowsForReconcile = [];
  const state = { transactions: [], balancePattern: 0 };
  const settings = {
    prepaidAccounts: ['前払費用'], furusatoKeyword: 'ふるさと納税',
    accountBalanceOverride: new Map(), balanceExcludedAccounts: new Set(), accountBalanceInited: false,
    accountMeta: new Map(), accountGroupList: [], accountMetaInited: false,
    securitiesScrapeInfo: null, monthClose: {}, yearClose: {}, savedViews: [], securitiesHistory: [],
    zaimScrapeInfo: null, accountBalanceAsOfDate: null,
    pendingZaimImport: null, pendingZaimCsv: null, zaimCsvSyncedAt: null, syncHeartbeat: null,
    pendingSecuritiesImport: null, pendingPointExpiry: null, externalPoints: null,
    manualFixedCosts: new Map(), accountRenames: new Map(), categoryBudgets: new Map(),
  };
  settings.accountMeta.set('現金', { cash: true });
  settings.accountMeta.set('前払費用', { prepaid: true });
  settings.accountMeta.set('テストカード', { card: true });
  // 開始残高は固定（現金 100,000）。基準日は今日。
  function parseAsofDate() { return startOfDay(new Date()); }
  function getAccountBalancesAsOf() { return new Map([['現金', 100000]]); }
`, sandbox);
// startOfDay は抽出側にあるため、スタブ定義の時点では未定義。parseAsofDate の中身は
// 呼び出し時に解決されるので、抽出コードの評価後に有効になる。
vm.runInContext([...new Set(extracted.values())].join('\n'), sandbox);

const testSrc = `
let pass = 0, fail = 0;
const check = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS', name); } else { fail++; console.log('  FAIL', name, extra || ''); } };

function mkRow(date, fromAccount, amount, store) {
  return { date, type: 'expense', fromAccount, toAccount: '', amount, category: '食費', subcategory: '', store, item: '', memo: '', includeInCalculation: true, balanceAdjustment: false };
}
// 直近3サイクル（drip の母集団）に確実に入る日付：各サイクル開始の2日後
function cycleDates() {
  return [askCycleAt(-1), askCycleAt(-2), askCycleAt(-3)].map((b) => addDays(b.start, 2));
}
function cashRows(amount) {
  return cycleDates().map((d) => mkRow(d, '現金', amount, '現金テスト店'));
}
function prepaidRows(amount) {
  return cycleDates().map((d) => mkRow(d, '前払費用', amount, '按分テスト店'));
}
function runOutlook(rows) {
  state.transactions = rows;
  rebuildTxIndex();
  return computeOutlook90();
}

console.log('== (a) 前払費用の按分は日割り支出に混ざらない ==');
const base = runOutlook(cashRows(3000));
check('ベースの見通しが成立する', !!base && base.startBal === 100000, base && String(base.startBal));
const withPrepaid = runOutlook([...cashRows(3000), ...prepaidRows(6000)]);
check('按分行を足しても推移（pts）が完全一致', JSON.stringify(withPrepaid.pts) === JSON.stringify(base.pts));
check('按分行を足しても90日後残高が不変', withPrepaid.endBal === base.endBal, withPrepaid.endBal + ' vs ' + base.endBal);
check('按分行を足しても谷が不変', withPrepaid.valley.bal === base.valley.bal && +withPrepaid.valley.date === +base.valley.date);
const withMoreCash = runOutlook([...cashRows(3000), ...cashRows(3000)]);
check('対照：現金支出を足すと90日後残高は下がる（drip が効いている）', withMoreCash.endBal < base.endBal, withMoreCash.endBal + ' vs ' + base.endBal);

console.log('== (b) 配当が受取月の収入イベントになる ==');
const ahead = addDays(new Date(), 40);
const divMonth = ahead.getMonth() + 1;
__ls.set(DIVIDEND_LS_KEY, JSON.stringify([{ name: 'テスト配当', amount: 30000, months: [divMonth] }]));
const withDiv = runOutlook(cashRows(3000));
check('配当イベントが立つ', withDiv.events.some((e) => e.label === 'テスト配当' && e.amount === 30000), JSON.stringify(withDiv.events));
check('90日後残高が配当額の分だけ増える', Math.round(withDiv.endBal) === Math.round(base.endBal) + 30000, withDiv.endBal + ' vs ' + base.endBal);
__ls.delete(DIVIDEND_LS_KEY);
const noDiv = runOutlook(cashRows(3000));
check('配当を消すと元の推移に戻る', JSON.stringify(noDiv.pts) === JSON.stringify(base.pts));

console.log('== 結果: pass ' + pass + ' / fail ' + fail + ' ==');
if (fail) process.exit(1);
`;
vm.runInContext(testSrc, sandbox);
