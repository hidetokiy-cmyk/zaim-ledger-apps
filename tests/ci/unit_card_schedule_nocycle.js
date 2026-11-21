// 締め日サイクルのない「カード類」口座（家賃の「口座引落」など）の引落予定のユニット検証。
//   (a) 将来日付の支出行があれば、日付ごとに合算して item 化する（est=false、n＝件数）。
//       引落元はその口座への振替元（現金口座）。将来行が maxItems に満たなければ翌月以降を est=true で延長。
//   (b) 将来行が無ければ、実績（直近の支出日の「日」の最頻値＋直近1か月分の合計）から翌月以降を推定する。
//   (c) サイクルあり口座（確認済みルールのカード）の item は従来どおり（est なし・利用期間あり）。
//   (d) 90日見通し：手動固定費（cashPaid・matchType=store）が、引落予定に入った口座の取引に一致するときは二重計上しない。
//       一致しない（別口座・matchType=none）ときは従来どおりイベント化される。
// 取引はオブジェクトを直接組み立てて state に入れる（CSV を経由しない）。開始残高はスタブで固定。
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
  'passReimbursementMap', 'passReimbursementForKey', 'passReimbursementFilled', 'PAYROLL_SHAKAI_RE', 'outlookMonthlySalary',
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
settings.accountMeta.set('テスト銀行', { cash: true });
settings.accountMeta.set('口座引落', { card: true });
settings.accountMeta.set('三井住友カード', { card: true });
const today = startOfDay(new Date());
const STORE = 'SMBC（家賃（セーフテイ・テスト）';
const RENT = [['家賃', 75000], ['管理費', 9000], ['町内会費', 200], ['トラブルサポート', 1000], ['手数料', 440]];   // 合計 85,640
const RENT_TOTAL = 85640;
const ymd = (d) => d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
function exp(date, from, amount, store, sub) {
  return { date, type: 'expense', fromAccount: from, toAccount: '', amount, category: '住まい', subCategory: sub || '', store: store || '', item: '', memo: '', includeInCalculation: true, balanceAdjustment: false };
}
function xfer(date, from, to, amount) {
  return { date, type: 'transfer', fromAccount: from, toAccount: to, amount, category: '', subCategory: '', store: '', item: '', memo: '', includeInCalculation: true, balanceAdjustment: false };
}
function rentSet(date) { return RENT.map(([sub, a]) => exp(date, '口座引落', a, STORE, sub)); }
// 過去5か月分の家賃（日は 26,27,27,25,23 ＝実データの形）と同日の振替。
// 振替額は家賃合計とずらし（200,000）、締め日サイクルの当てはまりが悪く「推定できない」口座を再現する。
function pastRent() {
  const days = [26, 27, 27, 25, 23];   // 1か月前〜5か月前
  const rows = [];
  days.forEach((dd, i) => {
    const d = new Date(today.getFullYear(), today.getMonth() - 1 - i, dd);
    rows.push(...rentSet(d), xfer(d, 'テスト銀行', '口座引落', 200000));
  });
  return rows;
}
function load(rows) { state.transactions = rows; rebuildTxIndex(); }
function acctEntry(res, name) { return res.cards.find((c) => c.account === name); }

console.log('== 前提：口座引落は締め日サイクルが推定できない ==');
load(pastRent());
check('getCardBillingCycle(口座引落) が null', getCardBillingCycle('口座引落') == null, JSON.stringify(getCardBillingCycle('口座引落')));

console.log('== (a) 将来行が主経路 ==');
const D1 = addDays(today, 4), D2 = addDays(today, 34);
load([...pastRent(), ...rentSet(D1), ...rentSet(D2)]);
let r = computeCardSchedule(6);
let e = acctEntry(r, '口座引落');
check('口座引落が cards に入る', !!e);
check('skipped に入らない', !r.skipped.includes('口座引落'), JSON.stringify(r.skipped));
check('cycle は null', e && e.cycle === null);
check('引落元は振替元（テスト銀行）', e && e.source === 'テスト銀行', e && String(e.source));
check('1件目：日付＝将来行の日、合計＝85,640、n＝5、est=false、closed=false', e && +e.items[0].settle === +D1 && e.items[0].amount === RENT_TOTAL && e.items[0].n === 5 && e.items[0].est === false && e.items[0].closed === false, e && JSON.stringify(e.items[0]));
check('2件目：日付＝2つ目の将来行の日、est=false', e && +e.items[1].settle === +D2 && e.items[1].amount === RENT_TOTAL && e.items[1].est === false);
check('maxItems(6) 件まで延長され、延長分は est=true で同額', e && e.items.length === 6 && e.items.slice(2).every((it) => it.est === true && it.amount === RENT_TOTAL), e && String(e.items.length));
check('全 item が今日以降', e && e.items.every((it) => it.settle >= today));
r = computeCardSchedule(2);
e = acctEntry(r, '口座引落');
check('既定の maxItems=2 では将来行の2件だけ（延長なし）', e && e.items.length === 2 && e.items.every((it) => it.est === false));
// 同日に複数の将来行が別々の金額で入っても日付ごとに合算される
load([...pastRent(), exp(D1, '口座引落', 1000, 'A'), exp(D1, '口座引落', 500, 'B'), exp(D2, '口座引落', 300, 'C')]);
e = acctEntry(computeCardSchedule(2), '口座引落');
check('日付ごとの合算（D1＝1,500・2件、D2＝300・1件）', e && e.items[0].amount === 1500 && e.items[0].n === 2 && e.items[1].amount === 300 && e.items[1].n === 1, e && JSON.stringify(e.items));

console.log('== (b) 将来行が無ければ実績から推定 ==');
load(pastRent());
r = computeCardSchedule(3);
e = acctEntry(r, '口座引落');
check('口座引落が cards に入り skipped には入らない', !!e && !r.skipped.includes('口座引落'));
const lastDayOf = (y, m0) => new Date(y, m0 + 1, 0).getDate();
let expSettle = null;
for (let k = 0; k < 3 && !expSettle; k++) {
  const y = today.getFullYear(), m0 = today.getMonth() + k;
  const d = new Date(y, m0, Math.min(27, lastDayOf(y, m0)));
  if (d >= today) expSettle = d;
}
check('1件目：日の最頻値（27日）の次の到来日', e && +e.items[0].settle === +expSettle, e && ymd(e.items[0].settle) + ' vs ' + ymd(expSettle));
check('金額＝直近1か月分の合計 85,640、n＝5、est=true、closed=false', e && e.items[0].amount === RENT_TOTAL && e.items[0].n === 5 && e.items[0].est === true && e.items[0].closed === false, e && JSON.stringify(e.items[0]));
check('3件（maxItems）まで、毎月27日', e && e.items.length === 3 && e.items.every((it) => it.settle.getDate() === Math.min(27, lastDayOf(it.settle.getFullYear(), it.settle.getMonth()))));
check('引落元は振替元（テスト銀行）', e && e.source === 'テスト銀行');
// 休眠口座・単発利用は拾わない
load([exp(addDays(today, -100), '口座引落', 5000, 'X'), exp(addDays(today, -130), '口座引落', 5000, 'X'), xfer(addDays(today, -100), 'テスト銀行', '口座引落', 5000)]);
r = computeCardSchedule(3);
check('最後の支出が62日より前なら推定しない（skipped に残る）', !acctEntry(r, '口座引落') && r.skipped.includes('口座引落'));
load([exp(addDays(today, -5), '口座引落', 5000, 'X'), xfer(addDays(today, -5), 'テスト銀行', '口座引落', 5000)]);
r = computeCardSchedule(3);
check('支出が1か月分しか無ければ推定しない（skipped に残る）', !acctEntry(r, '口座引落') && r.skipped.includes('口座引落'));

console.log('== (c) サイクルあり口座は従来どおり ==');
const cardDate = new Date(today.getFullYear(), today.getMonth() - 1, 10);
load([exp(cardDate, '三井住友カード', 3000, 'カード店')]);
const cyc = getCardBillingCycle('三井住友カード');
r = computeCardSchedule(2);
e = acctEntry(r, '三井住友カード');
check('確認済みルールのサイクルが付く', cyc && cyc.known === true && e && e.cycle && e.cycle.known === true);
check('item は利用期間（from<end）を持ち est は付かない', e && e.items.length && e.items.every((it) => it.from < it.end && it.est === undefined));

console.log('== (d) 90日見通しの二重計上防止 ==');
function runOutlook(rows, fixed) {
  load(rows);
  settings.manualFixedCosts = new Map();
  (fixed || []).forEach((m, i) => settings.manualFixedCosts.set('f' + i, m));
  return computeOutlook90();
}
const rentRows = [...pastRent(), ...rentSet(D1), ...rentSet(D2)];
const rentFixed = { matchType: 'store', matchValue: 'SMBC（家賃（セーフテイ', category: '', label: '家賃', amount: RENT_TOTAL, cashPaid: true };
const noFixed = runOutlook(rentRows, []);
const withFixed = runOutlook(rentRows, [rentFixed]);
check('見通しが成立する', !!noFixed && noFixed.startBal === 100000);
const sched = acctEntry(computeCardSchedule(6), '口座引落');
const within = sched.items.filter((it) => it.settle > today && it.settle <= addDays(today, 90));
check('口座引落の引落イベントが予定どおり立つ', noFixed.events.filter((x) => x.label === '口座引落の引落').length === within.length && within.length >= 3, noFixed.events.map((x) => x.label + x.amount).join(','));
check('手動の家賃（一致取引の口座＝引落予定の口座）はスキップ：推移が完全一致', JSON.stringify(withFixed.pts) === JSON.stringify(noFixed.pts));
check('手動の家賃イベントは立たない', !withFixed.events.some((x) => x.label === '家賃'));
check('家賃の支出イベントは引落予定の分だけ（毎回1回ずつ・合計額も一致）', (() => { const ev = withFixed.events.filter((x) => x.label === '口座引落の引落' || x.label === '家賃'); return ev.length === within.length && ev.reduce((s, x) => s + x.amount, 0) === -within.reduce((s, it) => s + it.amount, 0); })());
// 一致しない場合は従来どおり
const otherFixed = { matchType: 'store', matchValue: '存在しない店', category: '', label: '別固定費', amount: 10000, cashPaid: true };
const withOther = runOutlook(rentRows, [otherFixed]);
check('一致する取引が無い手動固定費は従来どおりイベント化', withOther.events.some((x) => x.label === '別固定費') && withOther.endBal < noFixed.endBal);
const noneFixed = { matchType: 'none', matchValue: '', category: '', label: '一致なし固定費', amount: 10000, cashPaid: true };
const withNone = runOutlook(rentRows, [noneFixed]);
check('matchType=none も従来どおりイベント化', withNone.events.some((x) => x.label === '一致なし固定費'));
// 一致する取引の支払口座が現金口座（引落予定に入っていない口座）なら従来どおり
const cashRent = [...pastRent().filter((x) => x.type === 'transfer'), exp(addDays(today, -20), 'テスト銀行', RENT_TOTAL, STORE, '家賃')];
const withCashPaid = runOutlook(cashRent, [rentFixed]);
check('一致取引の支払口座が引落予定の口座でなければ手動固定費はスキップされない', withCashPaid.events.some((x) => x.label === '家賃'), withCashPaid.events.map((x) => x.label).join(','));

console.log('== 結果: pass ' + pass + ' / fail ' + fail + ' ==');
if (fail) process.exit(1);
`;
vm.runInContext(testSrc, sandbox);
