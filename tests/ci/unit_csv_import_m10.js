// M10（欠点修正）のユニット検証：CSV 取り込みの部分欠落を無言で落とさないこと。
//   (a) 正常な CSV は従来どおり取り込まれ、parseWarnings は null（行数・金額も不変）。
//   (b) 金額を解釈できないセルは 0 として扱い、件数つきで警告に出る。
//   (c) マイナスの振替は従来どおり除外するが、件数つきで警告に出る。
//   (d) 日付認識失敗の既存警告はそのまま残る。空欄・「-」は正常として警告しない。
// PapaParse は CDN 読み込みのため、テストでは引用符対応の最小スタブで置き換える。
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const REPO_ROOT = path.join(__dirname, '..', '..');
const htmlPath = process.argv[2] || path.join(REPO_ROOT, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf-8');
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const main = scripts.find((s) => s.includes('function parseZaimCSV'));
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
  'startOfDay', 'addDays', 'dkey', 'nthWeekday', 'shunbunDay', 'shubunDay', 'holidayCache', 'computeJpHolidays', 'isJpHoliday', 'isBusinessDay',
  'adjustedCycleStart', 'cycleBoundsForKey', 'getCycleBounds',
  'findCol', 'parseAmount', 'clean', 'parseCsvDate', 'mapAggSetting', 'canonAcct', 'VOID_ACCOUNT', 'parseZaimCSV',
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
  const settings = { accountRenames: new Map() };
  const Papa = {
    parse(text, opts) {
      const lines = [];
      let cur = [''], inQ = false, field = 0;
      const pushLine = () => { lines.push(cur); cur = ['']; field = 0; };
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQ) {
          if (ch === '"') { if (text[i + 1] === '"') { cur[field] += '"'; i++; } else inQ = false; }
          else cur[field] += ch;
        } else if (ch === '"') inQ = true;
        else if (ch === ',') { cur.push(''); field++; }
        else if (ch === '\\n') pushLine();
        else if (ch !== '\\r') cur[field] += ch;
      }
      if (cur.length > 1 || cur[0] !== '') pushLine();
      const fields = lines[0];
      const data = [];
      for (let i = 1; i < lines.length; i++) {
        if (opts.skipEmptyLines && lines[i].every((c) => c === '')) continue;
        const o = {};
        fields.forEach((f, j) => { o[f] = lines[i][j]; });
        data.push(o);
      }
      return { data, meta: { fields } };
    },
  };
`, sandbox);
vm.runInContext([...new Set(extracted.values())].join('\n'), sandbox);

const testSrc = `
let pass = 0, fail = 0;
const check = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS', name); } else { fail++; console.log('  FAIL', name, extra || ''); } };

const HEAD = '日付,カテゴリ,カテゴリの内訳,支払元,入金先,お店,品目,収入,支出,振替,残高調整,集計の設定,メモ';
const line = (date, cat, from, to, inc, exp, trn, bal) => [date, cat, '', from, to, 'テスト店', '', inc, exp, trn, bal, '', ''].join(',');

console.log('== (a) 正常な CSV：警告なし・行数と金額は不変 ==');
{
  const csv = [HEAD,
    line('2026-11-01', '給与', '', 'テスト銀行', 200000, 0, 0, 0),
    line('2026-11-02', '食費', 'テストカード', '', 0, 1500, 0, 0),
    line('2026-11-03', '', 'テスト銀行', 'テストカード', 0, 0, 3000, 0),
    line('2026-11-04', '', 'テストカード', '', 0, 0, 0, -500),
    line('2026-11-05', '食費', 'テストカード', '', 0, -200, 0, 0),
  ].join('\\n');
  const rows = parseZaimCSV(csv);
  check('5行すべて取り込まれる', rows.length === 5, String(rows.length));
  check('parseWarnings は null', rows.parseWarnings === null, String(rows.parseWarnings));
  const byType = {};
  rows.forEach((r) => { byType[r.type] = r.amount; });
  check('収入 200000', byType.income === 200000, String(byType.income));
  check('支出 1500', byType.expense === 1500, String(byType.expense));
  check('振替 3000', byType.transfer === 3000, String(byType.transfer));
  check('残高調整 -500（符号保持）', byType.balance === -500, String(byType.balance));
}

console.log('== (b) 金額解釈不能：0 として扱い警告に出る ==');
{
  const csv = [HEAD,
    line('2026-11-01', '食費', 'テストカード', '', 0, '未定', 0, 0),
    line('2026-11-02', '食費', 'テストカード', '', 'abc', 800, 0, 0),
    line('2026-11-03', '給与', '', 'テスト銀行', 100000, 0, 0, 0),
  ].join('\\n');
  const rows = parseZaimCSV(csv);
  check('解釈不能のみの行は落ち、他2行は残る', rows.length === 2, String(rows.length));
  check('支出 800 の行は収入セル解釈不能でも取り込まれる', rows.some((r) => r.type === 'expense' && r.amount === 800));
  check('警告に金額解釈不能 2件', !!rows.parseWarnings && rows.parseWarnings.includes('金額を解釈できない行（2件）'), String(rows.parseWarnings));
}

console.log('== (c) マイナスの振替：除外し警告に出る ==');
{
  const csv = [HEAD,
    line('2026-11-01', '', 'テスト銀行', 'テストカード', 0, 0, -1000, 0),
    line('2026-11-02', '給与', '', 'テスト銀行', 100000, 0, 0, 0),
  ].join('\\n');
  const rows = parseZaimCSV(csv);
  check('負の振替は取り込まれない', rows.length === 1 && rows[0].type === 'income', String(rows.length));
  check('警告にマイナスの振替 1件', !!rows.parseWarnings && rows.parseWarnings.includes('マイナスの振替（1件）'), String(rows.parseWarnings));
}

console.log('== (d) 既存の日付警告と、空欄・「-」の無警告 ==');
{
  const csv = [HEAD,
    line('不明', '食費', 'テストカード', '', 0, 500, 0, 0),
    line('2026-11-02', '食費', 'テストカード', '', '', '-', '', ''),
    line('2026-11-03', '給与', '', 'テスト銀行', 100000, 0, 0, 0),
  ].join('\\n');
  const rows = parseZaimCSV(csv);
  check('有効なのは給与の1行', rows.length === 1, String(rows.length));
  check('日付の既存警告が出る', !!rows.parseWarnings && rows.parseWarnings.includes('日付を認識できず'), String(rows.parseWarnings));
  check('空欄・「-」は金額解釈不能として数えない', !!rows.parseWarnings && !rows.parseWarnings.includes('金額を解釈できない'), String(rows.parseWarnings));
}

console.log('== 結果: pass ' + pass + ' / fail ' + fail + ' ==');
if (fail) process.exit(1);
`;
vm.runInContext(testSrc, sandbox);
