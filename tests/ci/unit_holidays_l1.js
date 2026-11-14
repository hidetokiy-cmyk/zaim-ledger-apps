// L1（欠点修正）のユニット検証：内蔵の日本の祝日カレンダーが規則ベースで正しく算出されること。
// 内閣府「国民の祝日」一覧（syukujitsu.csv）の公式日付と、対象年の集合が完全一致することを確認する。
//   - 2019：即位に伴う特例（5/1 天皇の即位の日・10/22 即位礼正殿の儀、4/30・5/2 は国民の休日で自動生成）、
//     天皇誕生日なし（2/23 を出さない）
//   - 2020・2021：五輪特例（海の日・スポーツの日・山の日の移動）が従来どおり壊れていないこと
//   - 2026・2027：将来年の実カレンダー（振替休日・国民の休日・春分/秋分の公式計算）
// Usage: node unit_holidays_l1.js [index.html path]
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const REPO_ROOT = path.join(__dirname, '..', '..');
const htmlPath = process.argv[2] || path.join(REPO_ROOT, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf-8');
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const main = scripts.find((s) => s.includes('function computeJpHolidays'));
if (!main) { console.error('main script not found'); process.exit(2); }

const declStart = new Map();
{
  const re = /^( {0,2})(?:function\s+([A-Za-z_$][\w$]*)\s*\()|^ {0,2}(?:(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=)/gm;
  let m;
  while ((m = re.exec(main))) {
    const name = m[2] || m[3];
    const idx = m.index + (m[1] ? m[1].length : (m[0].match(/^ */) || [''])[0].length);
    if (!declStart.has(name)) declStart.set(name, { idx, isFunc: !!m[2] });
  }
}
function extractDecl(name) {
  const info = declStart.get(name);
  if (!info) return null;
  let depthB = 0, sawBrace = false;
  for (let i = info.idx; i < main.length; i++) {
    const ch = main[i];
    if (ch === '{') { depthB++; sawBrace = true; }
    else if (ch === '}') { depthB--; if (info.isFunc && sawBrace && depthB === 0) return main.slice(info.idx, i + 1); }
    else if (ch === ';' && !info.isFunc && depthB === 0) return main.slice(info.idx, i + 1);
  }
  return null;
}

const WANTED = ['startOfDay', 'parseCsvDate', 'nthWeekday', 'shunbunDay', 'shubunDay', 'dkey', 'holidayCache', 'computeJpHolidays', 'isJpHoliday', 'isBusinessDay'];
const parts = [];
for (const name of WANTED) {
  const code = extractDecl(name);
  if (!code) { console.error('extract failed:', name); process.exit(2); }
  parts.push(code);
}
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(parts.join('\n'), sandbox);

// 内閣府「国民の祝日」一覧の公式日付（2026-11 時点の syukujitsu.csv から転記）
const OFFICIAL_2019 = ["2019-01-01","2019-01-14","2019-02-11","2019-03-21","2019-04-29","2019-04-30","2019-05-01","2019-05-02","2019-05-03","2019-05-04","2019-05-05","2019-05-06","2019-07-15","2019-08-11","2019-08-12","2019-09-16","2019-09-23","2019-10-14","2019-10-22","2019-11-03","2019-11-04","2019-11-23"];
const OFFICIAL_2020 = ["2020-01-01","2020-01-13","2020-02-11","2020-02-23","2020-02-24","2020-03-20","2020-04-29","2020-05-03","2020-05-04","2020-05-05","2020-05-06","2020-07-23","2020-07-24","2020-08-10","2020-09-21","2020-09-22","2020-11-03","2020-11-23"];
const OFFICIAL_2021 = ["2021-01-01","2021-01-11","2021-02-11","2021-02-23","2021-03-20","2021-04-29","2021-05-03","2021-05-04","2021-05-05","2021-07-22","2021-07-23","2021-08-08","2021-08-09","2021-09-20","2021-09-23","2021-11-03","2021-11-23"];
const OFFICIAL_2026 = ["2026-01-01","2026-01-12","2026-02-11","2026-02-23","2026-03-20","2026-04-29","2026-05-03","2026-05-04","2026-05-05","2026-05-06","2026-07-20","2026-08-11","2026-09-21","2026-09-22","2026-09-23","2026-10-12","2026-11-03","2026-11-23"];
const OFFICIAL_2027 = ["2027-01-01","2027-01-11","2027-02-11","2027-02-23","2027-03-21","2027-03-22","2027-04-29","2027-05-03","2027-05-04","2027-05-05","2027-07-19","2027-08-11","2027-09-20","2027-09-23","2027-10-11","2027-11-03","2027-11-23"];

let pass = 0, fail = 0;
const check = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS', name); } else { fail++; console.log('  FAIL', name, extra || ''); } };

for (const [year, official] of [[2019, OFFICIAL_2019], [2020, OFFICIAL_2020], [2021, OFFICIAL_2021], [2026, OFFICIAL_2026], [2027, OFFICIAL_2027]]) {
  const mine = sandbox.computeJpHolidays(year);
  const offSet = new Set(official);
  const missing = official.filter((k) => !mine.has(k));
  const extra = [...mine].filter((k) => !offSet.has(k));
  check(`${year}年：公式一覧と完全一致（${official.length}件）`, missing.length === 0 && extra.length === 0,
    'missing=' + JSON.stringify(missing) + ' extra=' + JSON.stringify(extra));
}

// 個別の要点（集合一致の内訳として明示しておく）
const h2019 = sandbox.computeJpHolidays(2019);
check('2019-05-01（天皇の即位の日）が祝日', h2019.has('2019-05-01'));
check('2019-10-22（即位礼正殿の儀）が祝日', h2019.has('2019-10-22'));
check('2019-04-30・05-02（国民の休日）が自動生成される', h2019.has('2019-04-30') && h2019.has('2019-05-02'));
check('2019-02-23（天皇誕生日）は祝日でない', !h2019.has('2019-02-23'));
check('2026-09-22（国民の休日）が祝日', sandbox.computeJpHolidays(2026).has('2026-09-22'));
check('2027-03-22（春分の日の振替休日）が祝日', sandbox.computeJpHolidays(2027).has('2027-03-22'));
check('給与日・引落日の前提：2026-11-25 は営業日', sandbox.isBusinessDay(new Date(2026, 10, 25)) === true);
check('給与日・引落日の前提：2027-01-01 は営業日でない', sandbox.isBusinessDay(new Date(2027, 0, 1)) === false);

console.log('== 結果: pass ' + pass + ' / fail ' + fail + ' ==');
if (fail) process.exit(1);
