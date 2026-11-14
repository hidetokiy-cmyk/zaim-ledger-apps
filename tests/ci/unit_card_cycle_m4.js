// M4（欠点修正）のユニット検証：カード締め日・支払日の推定モデルと既知ルールの照合。
//   (a) 推定の利用額は「全出金合計」（支出＋振替）。利用が振替レッグ中心のカードでも
//       締め日を推定できること（従来の支出のみモデルでは purchases が不足して推定不能）。
//   (b) 既知ルールは口座名の空白ゆれ（全角空白・空白の重なり）でも効くこと。
//       一方で、似て非なる別口座（楽天カード 楽天銀行カード(JCB)）には効かないこと。
// 取引はオブジェクトを直接組み立てて state に入れる（CSV を経由しない）。
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
  'blankAccountMeta', 'getAccountMeta', 'accountMetaCache', 'accountMetaRev', 'accountFlagSet', 'liveAccountSet',
  'CF_CASH_ACCOUNTS', 'CF_INVESTMENT_ACCOUNTS', 'CF_FINANCING_ACCOUNTS', 'forecastIsCashAccount',
  'CARD_KNOWN_CYCLES', 'normalizeCardAccountName', 'CARD_KNOWN_CYCLES_BY_NORM', 'CARD_CYCLE_CLOSING_DAYS', 'CARD_CYCLE_LAGS', 'CARD_CYCLE_FIT_THRESHOLD',
  'cardCycleClosingDate', 'cardCycleClosingDateForSettlement', 'cardSettleDate',
  'collectCardRawData', 'inferCardBillingCycle', 'cardCycleCacheTx', 'cardCycleCache', 'getCardBillingCycle',
];
const extracted = new Map();
for (const name of WANTED) {
  const code = extractDecl(name);
  if (!code) { console.error('extract failed:', name); process.exit(2); }
  extracted.set(name, code);
}

const sandbox = { console, process, localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } };
vm.createContext(sandbox);
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
  settings.accountMeta.set('現金', { cash: true });
  settings.accountMeta.set('テストカードX', { card: true });
`, sandbox);
vm.runInContext([...new Set(extracted.values())].join('\n'), sandbox);

const testSrc = `
let pass = 0, fail = 0;
const check = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS', name); } else { fail++; console.log('  FAIL', name, extra || ''); } };

function row(y, m, d, type, fromAccount, toAccount, amount) {
  return { date: new Date(y, m - 1, d), type, fromAccount, toAccount, amount, category: '食費', subCategory: '', store: 'テスト店', item: '', memo: '', includeInCalculation: true, balanceAdjustment: false };
}
// テストカードX：10日締め・翌月2日払い。利用は未払費用への振替レッグが中心で、
// 支出行は1件だけ（サイクルBの ¥500）。決済は現金からの振替。
const rows = [
  // サイクルA（8/11〜9/10）: 振替 3,000 + 2,000（締め日当日） = 5,000 → 10/2 決済
  row(2026, 8, 15, 'transfer', 'テストカードX', '未払費用', 3000),
  row(2026, 9, 10, 'transfer', 'テストカードX', '未払費用', 2000),
  row(2026, 10, 2, 'transfer', '現金', 'テストカードX', 5000),
  // サイクルB（9/11〜10/10）: 振替 4,000（締め日翌日） + 1,000 + 支出 500 = 5,500 → 11/2 決済
  row(2026, 9, 11, 'transfer', 'テストカードX', '未払費用', 4000),
  row(2026, 10, 1, 'expense', 'テストカードX', '', 500),
  row(2026, 10, 8, 'transfer', 'テストカードX', '未払費用', 1000),
  row(2026, 11, 2, 'transfer', '現金', 'テストカードX', 5500),
  // サイクルC（10/11〜11/10）: 振替 2,500 → 12/2 決済（実行日によっては将来行として落ちる）
  row(2026, 10, 25, 'transfer', 'テストカードX', '未払費用', 2500),
  row(2026, 12, 2, 'transfer', '現金', 'テストカードX', 2500),
];
state.transactions = rows;

console.log('== (a) 全出金モデルで推定できる ==');
const raw = collectCardRawData('テストカードX');
check('利用（purchases）は振替＋支出の全件 = 6', raw.purchases.length === 6, String(raw.purchases.length));
check('決済（settlements）は2件以上', raw.settlements.length >= 2, String(raw.settlements.length));
const cyc = getCardBillingCycle('テストカードX');
check('サイクルが推定できる（従来の支出のみモデルでは null）', !!cyc, String(cyc));
check('締め日 = 10日', cyc && cyc.closingDay === 10, cyc && String(cyc.closingDay));
check('ラグ = 1', cyc && cyc.lag === 1, cyc && String(cyc.lag));
check('誤差率 score = 0（全出金合計と完全一致）', cyc && cyc.score === 0, cyc && String(cyc.score));
check('推定なので known は付かない', cyc && !cyc.known);

console.log('== (b) 既知ルールの空白ゆれ ==');
const exact = getCardBillingCycle('ビューカード スタンダードJ');
check('完全一致：known・5日締め・翌月4日', !!exact && exact.known === true && exact.closingDay === 5 && exact.settlementDayOfMonth === 4);
const fullWidth = getCardBillingCycle('ビューカード　スタンダードJ');
check('全角空白でも known が効く', !!fullWidth && fullWidth.known === true && fullWidth.closingDay === 5, fullWidth && String(fullWidth.known));
const doubleSpace = getCardBillingCycle('ビューカード  スタンダードJ');
check('空白の重なりでも known が効く', !!doubleSpace && doubleSpace.known === true && doubleSpace.closingDay === 5);
const lookalike = getCardBillingCycle('楽天カード 楽天銀行カード(JCB) XXXX-XXXX-XXXX-1894');
check('別口座（楽天銀行カード）には known が効かない', !lookalike || !lookalike.known, lookalike && String(lookalike.known));
check('normalize は空白だけを除く', normalizeCardAccountName('ビューカード スタンダードJ') === 'ビューカードスタンダードJ');

console.log('== 結果: pass ' + pass + ' / fail ' + fail + ' ==');
if (fail) process.exit(1);
`;
vm.runInContext(testSrc, sandbox);
