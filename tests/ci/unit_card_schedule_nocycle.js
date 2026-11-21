// 締め日サイクルのない「カード類」口座（家賃の「口座引落」など）の引落予定のユニット検証。
// 時刻は 2026-11-21（土）に固定する（実データの形：将来の支出行は25日付、実際の引落は27日＝土日祝なら翌営業日）。
//   (a) 引落日は支出行の日付ではなく、資金移動（現金口座→その口座）の日の最頻値（典型日）＋翌営業日寄せで決まる。
//       金額・件数はその月の将来支出行の合算。将来行のない月は直近の実績月の合計（est=true）。
//   (b) その月に資金移動済み（settle の10日前以降に transfer-in）ならその月はスキップ。
//   (c) 将来行が無い場合の実績推定でも典型日は資金移動から。資金移動が無ければ支出日の最頻値で代替。
//   (d) サイクルあり口座（確認済みルールのカード）の item は従来どおり。
//   (e) 90日見通し：手動固定費（cashPaid・matchType=store）が、引落予定に入った口座の取引に一致するときは二重計上しない。
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
// ---- 時刻固定：2026-11-21（土）10:00 ----
const RealDate = Date;
const FIXED = new RealDate(2026, 10, 21, 10, 0, 0).getTime();
class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(FIXED); else super(...a); }
  static now() { return FIXED; }
}
globalThis.Date = FakeDate;

let pass = 0, fail = 0;
const check = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS', name); } else { fail++; console.log('  FAIL', name, extra || ''); } };
settings.accountMeta.set('テスト銀行', { cash: true });
settings.accountMeta.set('口座引落', { card: true });
settings.accountMeta.set('三井住友カード', { card: true });
const today = startOfDay(new Date());
const STORE = 'SMBC（家賃（セーフテイ・テスト）';
const RENT = [['家賃', 75000], ['管理費', 9000], ['町内会費', 200], ['トラブルサポート', 1000], ['手数料', 440]];   // 合計 85,640
const RENT_TOTAL = 85640;
const D = (y, m, d) => new Date(y, m - 1, d);
const ymd = (d) => d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
function exp(date, from, amount, store, sub) {
  return { date, type: 'expense', fromAccount: from, toAccount: '', amount, category: '住まい', subCategory: sub || '', store: store || '', item: '', memo: '', includeInCalculation: true, balanceAdjustment: false };
}
function xfer(date, from, to, amount) {
  return { date, type: 'transfer', fromAccount: from, toAccount: to, amount, category: '', subCategory: '', store: '', item: '', memo: '', includeInCalculation: true, balanceAdjustment: false };
}
function rentSet(date) { return RENT.map(([sub, a]) => exp(date, '口座引落', a, STORE, sub)); }
// 実データの形：過去の支出行は 6/26, 7/27, 8/27, 9/25, 10/23（ばらつく）。
// 資金移動は 7/27, 8/27, 9/28（9/27が日曜のため翌営業日）, 10/27。
// 振替額は家賃合計とずらし（200,000）、締め日サイクルの当てはまりが悪く「推定できない」口座を再現する。
const PAST_EXP_DATES = [D(2026, 6, 26), D(2026, 7, 27), D(2026, 8, 27), D(2026, 9, 25), D(2026, 10, 23)];
const PAST_XFER_DATES = [D(2026, 7, 27), D(2026, 8, 27), D(2026, 9, 28), D(2026, 10, 27)];
function pastExp() { return PAST_EXP_DATES.flatMap((d) => rentSet(d)); }
function pastXfer() { return PAST_XFER_DATES.map((d) => xfer(d, 'テスト銀行', '口座引落', 200000)); }
// 将来の支出行は記帳用の定期入力で25日付（11/25に12月分、12/25に1月分）
function futureExp() { return [...rentSet(D(2026, 11, 25)), ...rentSet(D(2026, 12, 25))]; }
function load(rows) { state.transactions = rows; rebuildTxIndex(); }
function acctEntry(res, name) { return res.cards.find((c) => c.account === name); }
const sameDay = (a, b) => a && b && +startOfDay(a) === +startOfDay(b);

console.log('== 前提 ==');
check('時刻固定が効いている（今日＝2026-11-21）', ymd(today) === '2026-11-21', ymd(today));
check('2026-12-27(日)は非営業日・12-28(月)は営業日、9-27(日)は非営業日、11-27(金)は営業日',
  !isBusinessDay(D(2026, 12, 27)) && isBusinessDay(D(2026, 12, 28)) && !isBusinessDay(D(2026, 9, 27)) && isBusinessDay(D(2026, 11, 27)));
load([...pastExp(), ...pastXfer()]);
check('getCardBillingCycle(口座引落) が null', getCardBillingCycle('口座引落') == null, JSON.stringify(getCardBillingCycle('口座引落')));

console.log('== (a) 引落日は資金移動の典型日（27日・土日祝なら翌営業日）。将来行の日付（25日）は使わない ==');
load([...pastExp(), ...pastXfer(), ...futureExp()]);
let r = computeCardSchedule(3);
let e = acctEntry(r, '口座引落');
check('口座引落が cards に入り skipped には入らない', !!e && !r.skipped.includes('口座引落'), JSON.stringify(r.skipped));
check('cycle は null、引落元は振替元（テスト銀行）', e && e.cycle === null && e.source === 'テスト銀行');
check('1件目：11/25の行は 11/27（金）に出る（25日ではない）', e && sameDay(e.items[0].settle, D(2026, 11, 27)), e && ymd(e.items[0].settle));
check('1件目：金額＝その月の将来行の合計 85,640、n＝5、est=false、closed=false', e && e.items[0].amount === RENT_TOTAL && e.items[0].n === 5 && e.items[0].est === false && e.items[0].closed === false, e && JSON.stringify(e.items[0]));
check('2件目：12/27(日) は翌営業日の 12/28（月）、将来行の合計、est=false', e && sameDay(e.items[1].settle, D(2026, 12, 28)) && e.items[1].amount === RENT_TOTAL && e.items[1].est === false, e && ymd(e.items[1].settle));
check('3件目（将来行のない月）：1/27（水）、直近の実績月（10月）の合計、est=true', e && sameDay(e.items[2].settle, D(2027, 1, 27)) && e.items[2].amount === RENT_TOTAL && e.items[2].n === 5 && e.items[2].est === true, e && JSON.stringify(e.items[2]));
check('どの item も 25日ではない', e && e.items.every((it) => it.settle.getDate() !== 25));
e = acctEntry(computeCardSchedule(2), '口座引落');
check('既定の maxItems=2 では将来行の2か月分（est なし）', e && e.items.length === 2 && e.items.every((it) => it.est === false));
// その月の将来行は日付が違っても1件に合算される
load([...pastExp(), ...pastXfer(), exp(D(2026, 11, 25), '口座引落', 1000, 'A'), exp(D(2026, 11, 26), '口座引落', 500, 'B'), exp(D(2026, 12, 25), '口座引落', 300, 'C')]);
e = acctEntry(computeCardSchedule(2), '口座引落');
check('月ごとの合算（11月＝1,500・2件、12月＝300・1件）', e && e.items[0].amount === 1500 && e.items[0].n === 2 && e.items[1].amount === 300 && e.items[1].n === 1, e && JSON.stringify(e.items));
// 「集計に含めない」行（連携取込の集計行など、内訳行と重複する行）は金額・件数に数えない（ラム追加の検証）
const exclRow = (date, amount) => ({ ...exp(date, '口座引落', amount, STORE, ''), aggSetting: 'exclude' });
load([...pastExp(), ...pastXfer(), ...futureExp(), exclRow(D(2026, 10, 23), RENT_TOTAL), exclRow(D(2026, 11, 25), RENT_TOTAL), exclRow(D(2026, 12, 25), RENT_TOTAL)]);
e = acctEntry(computeCardSchedule(3), '口座引落');
check('集計に含めない行があっても金額 85,640・n=5 のまま（将来行・実績月とも二重計上しない）', e && e.items.length === 3 && e.items.every((it) => it.amount === RENT_TOTAL && it.n === 5), e && JSON.stringify(e.items));

console.log('== (b) その月に資金移動済みならスキップ ==');
load([...pastExp(), ...pastXfer(), xfer(D(2026, 11, 20), 'テスト銀行', '口座引落', 200000), ...futureExp()]);
e = acctEntry(computeCardSchedule(3), '口座引落');
check('11/20に資金移動済み（11/27の10日前以降）→ 11月はスキップ、1件目は 12/28', e && sameDay(e.items[0].settle, D(2026, 12, 28)), e && e.items.map((it) => ymd(it.settle)).join(','));
check('スキップ後も典型日は27日（1/27）', e && sameDay(e.items[1].settle, D(2027, 1, 27)), e && e.items.map((it) => ymd(it.settle)).join(','));
// 10日より前の資金移動ではスキップしない（11/16 → 11/27 の11日前）
load([...pastExp(), ...pastXfer(), xfer(D(2026, 11, 16), 'テスト銀行', '口座引落', 200000), ...futureExp()]);
e = acctEntry(computeCardSchedule(3), '口座引落');
check('11/16の資金移動（settleの11日前）ではスキップしない', e && sameDay(e.items[0].settle, D(2026, 11, 27)), e && e.items.map((it) => ymd(it.settle)).join(','));

console.log('== (c) 将来行が無い場合の実績推定でも典型日は資金移動の日付 ==');
// 支出日の最頻値を 23 日に寄せ、資金移動（27日）と食い違わせる
const expDates23 = [D(2026, 6, 26), D(2026, 7, 25), D(2026, 8, 24), D(2026, 9, 23), D(2026, 10, 23)];
load([...expDates23.flatMap((d) => rentSet(d)), ...pastXfer()]);
r = computeCardSchedule(3);
e = acctEntry(r, '口座引落');
check('cards に入り skipped には入らない', !!e && !r.skipped.includes('口座引落'));
check('1件目：支出日の最頻値（23日）ではなく資金移動の27日 → 11/27', e && sameDay(e.items[0].settle, D(2026, 11, 27)), e && ymd(e.items[0].settle));
check('金額＝直近の実績月（10月）の合計 85,640、n＝5、est=true', e && e.items[0].amount === RENT_TOTAL && e.items[0].n === 5 && e.items[0].est === true && e.items[0].closed === false, e && JSON.stringify(e.items[0]));
check('3件：11/27、12/28（日曜→翌営業日）、1/27', e && e.items.length === 3 && sameDay(e.items[1].settle, D(2026, 12, 28)) && sameDay(e.items[2].settle, D(2027, 1, 27)), e && e.items.map((it) => ymd(it.settle)).join(','));
// 資金移動が無い口座は、従来どおり支出日の最頻値で代替（23日。11/23は勤労感謝の日なので翌営業日の 11/24）
load(expDates23.flatMap((d) => rentSet(d)));
r = computeCardSchedule(2);
e = acctEntry(r, '口座引落');
check('資金移動が無ければ支出日の最頻値（23日）→ 11/23は祝日で 11/24', e && sameDay(e.items[0].settle, D(2026, 11, 24)) && e.items[0].est === true, e && ymd(e.items[0].settle));
check('資金移動が無いので引落元は null', e && e.source === null);
// 休眠口座・単発利用は拾わない
load([exp(addDays(today, -100), '口座引落', 5000, 'X'), exp(addDays(today, -130), '口座引落', 5000, 'X'), xfer(addDays(today, -100), 'テスト銀行', '口座引落', 5000)]);
r = computeCardSchedule(3);
check('最後の支出が62日より前なら推定しない（skipped に残る）', !acctEntry(r, '口座引落') && r.skipped.includes('口座引落'));
load([exp(addDays(today, -5), '口座引落', 5000, 'X'), xfer(addDays(today, -5), 'テスト銀行', '口座引落', 5000)]);
r = computeCardSchedule(3);
check('支出が1か月分しか無ければ推定しない（skipped に残る）', !acctEntry(r, '口座引落') && r.skipped.includes('口座引落'));

console.log('== (d) サイクルあり口座は従来どおり ==');
load([exp(D(2026, 10, 10), '三井住友カード', 3000, 'カード店')]);
const cyc = getCardBillingCycle('三井住友カード');
r = computeCardSchedule(2);
e = acctEntry(r, '三井住友カード');
check('確認済みルールのサイクルが付く', cyc && cyc.known === true && e && e.cycle && e.cycle.known === true);
check('item は利用期間（from<end）を持ち est は付かない', e && e.items.length && e.items.every((it) => it.from < it.end && it.est === undefined));

console.log('== (e) 90日見通しの二重計上防止 ==');
function runOutlook(rows, fixed) {
  load(rows);
  settings.manualFixedCosts = new Map();
  (fixed || []).forEach((m, i) => settings.manualFixedCosts.set('f' + i, m));
  return computeOutlook90();
}
const rentRows = [...pastExp(), ...pastXfer(), ...futureExp()];
const rentFixed = { matchType: 'store', matchValue: 'SMBC（家賃（セーフテイ', category: '', label: '家賃', amount: RENT_TOTAL, cashPaid: true };
const noFixed = runOutlook(rentRows, []);
const withFixed = runOutlook(rentRows, [rentFixed]);
check('見通しが成立する', !!noFixed && noFixed.startBal === 100000);
const sched = acctEntry(computeCardSchedule(6), '口座引落');
const within = sched.items.filter((it) => it.settle > today && it.settle <= addDays(today, 90));
check('口座引落の引落イベントが 11/27・12/28・1/27 に立つ', (() => { const ev = noFixed.events.filter((x) => x.label === '口座引落の引落'); return ev.length === 3 && sameDay(ev[0].date, D(2026, 11, 27)) && sameDay(ev[1].date, D(2026, 12, 28)) && sameDay(ev[2].date, D(2027, 1, 27)); })(), noFixed.events.map((x) => x.label + ymd(x.date)).join(','));
check('手動の家賃（一致取引の口座＝引落予定の口座）はスキップ：推移が完全一致', JSON.stringify(withFixed.pts) === JSON.stringify(noFixed.pts));
check('手動の家賃イベントは立たない', !withFixed.events.some((x) => x.label === '家賃'));
check('家賃の支出イベントは引落予定の分だけ（毎回1回ずつ・合計額も一致）', (() => { const ev = withFixed.events.filter((x) => x.label === '口座引落の引落' || x.label === '家賃'); return ev.length === within.length && ev.reduce((s, x) => s + x.amount, 0) === -within.reduce((s, it) => s + it.amount, 0); })());
const otherFixed = { matchType: 'store', matchValue: '存在しない店', category: '', label: '別固定費', amount: 10000, cashPaid: true };
const withOther = runOutlook(rentRows, [otherFixed]);
check('一致する取引が無い手動固定費は従来どおりイベント化', withOther.events.some((x) => x.label === '別固定費') && withOther.endBal < noFixed.endBal);
const noneFixed = { matchType: 'none', matchValue: '', category: '', label: '一致なし固定費', amount: 10000, cashPaid: true };
const withNone = runOutlook(rentRows, [noneFixed]);
check('matchType=none も従来どおりイベント化', withNone.events.some((x) => x.label === '一致なし固定費'));
const cashRent = [...pastXfer(), exp(D(2026, 11, 1), 'テスト銀行', RENT_TOTAL, STORE, '家賃')];
const withCashPaid = runOutlook(cashRent, [rentFixed]);
check('一致取引の支払口座が引落予定の口座でなければ手動固定費はスキップされない', withCashPaid.events.some((x) => x.label === '家賃'), withCashPaid.events.map((x) => x.label).join(','));

console.log('== 結果: pass ' + pass + ' / fail ' + fail + ' ==');
if (fail) process.exit(1);
`;
vm.runInContext(testSrc, sandbox);
