// Zaim外ポイント（settings.externalPoints）表示の統合検証（jsdom実起動・実データ）。
// Usage: node boot_external_points.js
//   ベース設定は実 settings（2026-11-14 16:45 同期分、pendingPointExpiry 7プログラム入り）を読み、
//   メモリ上で externalPoints のバリエーションを作って4ケース起動する。
//   none : externalPoints 無し → ポイントカードが変更前ベースラインと完全一致すること（後方互換）
//   empty: externalPoints = [] → none と完全一致すること
//   with : JRE POINT シード → JRE 行（残高・最直近失効・ラム確認日つき）が追加され、合計が +7,684 になること
//   dup  : Zaim側と同名（Vポイント=スクレイプ行／ふるなびポイント=口座残高行）を含む
//          → Zaim側が優先され重複表示されず、JRE 行だけが追加されること
const fs = require('fs'); const path = require('path'); const http = require('http');

// 実データの場所は環境変数で渡す（個人データを repo に置かない）。
// 例: ZAIM_CSV=.../zaim-full.csv ZAIM_SETTINGS=.../settings.json
const CSV_PATH = process.env.ZAIM_CSV;
const SETTINGS_PATH = process.env.ZAIM_SETTINGS;
if (!CSV_PATH || !SETTINGS_PATH) { console.error('ZAIM_CSV と ZAIM_SETTINGS を指定してください（tests/README.md 参照）'); process.exit(2); }
const { JSDOM, VirtualConsole } = require('jsdom');
const path2 = require('path');
const ROOT = path2.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf-8');
const csv = fs.readFileSync(CSV_PATH, 'utf-8');
const baseSettings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
delete baseSettings.externalPoints;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = http.createServer((req, res) => { const name = decodeURIComponent(new URL(req.url, 'http://x').pathname.split('/').pop()) || 'index.html'; const p = path.join(ROOT, name); if (fs.existsSync(p) && fs.statSync(p).isFile()) { res.writeHead(200); res.end(fs.readFileSync(p)); } else { res.writeHead(404); res.end(''); } });

const JRE = { name: 'JRE POINT', balance: 7684, expiring: [{ points: 1000, date: '2027-03-31' }, { points: 1030, date: '2027-09-30' }], updatedAt: '2026-11-14' };
// 変更前（origin/main）の実データ・実コードで取得したベースライン（full_verify.js 出力）を、
// このスクリプトの flat()（空白全除去）と同じ正規化に揃えたもの
const BASE_BODY = 'ふるなびポイント4,200ptWAONPOINT5/31までに11,357pt失効11,357ptVポイント11/11までに6,387pt失効6,387ptdポイント12/31までに50pt失効191ptAmazonマイポイント11/4までに68pt失効68ptAmazonギフト券0pt楽天ポイント0pt電子マネーWAONポイント0pt合計22,203pt';
const BASE_NOTE = '有効期限は Zaim のポイント口座ページで取得した実績値です（11/13 取得）。残高は Zaim 同期時点（2026/11/14）のものです。';

async function boot(port, settingsObj) {
  const vc = new VirtualConsole(); const errors = [];
  vc.on('jsdomError', (e) => errors.push(String(e.detail && e.detail.message || e.message)));
  vc.on('error', (...a) => errors.push(a.join(' ')));
  const dom = new JSDOM(html, { url: `http://127.0.0.1:${port}/index.html`, runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) {
      window.matchMedia = window.matchMedia || ((q) => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
      window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
      window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      window.URL.createObjectURL = window.URL.createObjectURL || (() => 'blob:test');
      window.URL.revokeObjectURL = window.URL.revokeObjectURL || (() => {});
      window.HTMLElement.prototype.scrollIntoView = function () {};
      window.prompt = () => null; window.confirm = () => true; window.alert = () => {};
      window.fetch = () => Promise.reject(new Error('fetch disabled'));
      window.Element.prototype.getBoundingClientRect = function () { const vb = this.getAttribute && this.getAttribute('viewBox'); if (vb) { const p = vb.split(/\s+/).map(Number); return { left: 0, top: 0, width: p[2], height: p[3], right: p[2], bottom: p[3], x: 0, y: 0 }; } return { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0 }; };
      window.localStorage.setItem('zaimLedgerCsvCache', JSON.stringify({ fileName: 'zaim-full.csv', text: csv, savedAt: new Date().toISOString(), sourceDownloadedAt: null }));
      window.localStorage.setItem('zaimLedgerSettings', JSON.stringify({ v: 1, obj: settingsObj, base: null, dirty: false }));
    } });
  const doc = dom.window.document;
  const flat = (el) => el ? el.textContent.replace(/\s+/g, '') : '(missing)';
  for (let i = 0; i < 40; i++) { await sleep(500); if (doc.querySelector('#assetsHistoryChart svg') && doc.getElementById('pointsBody').children.length) break; }
  await sleep(1200);
  const body = doc.getElementById('pointsBody');
  const rows = body ? [...body.querySelectorAll('.pt-row')].map((r) => r.textContent.replace(/\s+/g, '')) : [];
  const out = {
    errors,
    hidden: doc.getElementById('pointsCard').classList.contains('hidden'),
    meta: flat(doc.getElementById('pointsMeta')),
    body: flat(body),
    note: doc.getElementById('pointsNote') ? doc.getElementById('pointsNote').textContent.trim() : '(missing)',
    rows,
  };
  dom.window.close();
  return out;
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  let pass = 0, fail = 0;
  const check = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS', name); } else { fail++; console.log('  FAIL', name, extra || ''); } };

  console.log('== case none（externalPoints 無し）==');
  const none = await boot(port, JSON.parse(JSON.stringify(baseSettings)));
  check('JSエラーなし', none.errors.length === 0, none.errors.join(' | '));
  check('カード表示', none.hidden === false);
  check('本体がベースラインと完全一致', none.body === BASE_BODY, none.body);
  check('メタ 合計 22,203 pt', none.meta === '合計22,203pt', none.meta);
  check('ノートがベースラインと完全一致', none.note === BASE_NOTE, none.note);

  console.log('== case empty（externalPoints = []）==');
  const emptySettings = JSON.parse(JSON.stringify(baseSettings)); emptySettings.externalPoints = [];
  const empty = await boot(port, emptySettings);
  check('JSエラーなし', empty.errors.length === 0, empty.errors.join(' | '));
  check('本体がベースラインと完全一致', empty.body === BASE_BODY, empty.body);
  check('ノートがベースラインと完全一致', empty.note === BASE_NOTE, empty.note);

  console.log('== case with（JRE POINT シード）==');
  const withSettings = JSON.parse(JSON.stringify(baseSettings)); withSettings.externalPoints = [JRE];
  const wth = await boot(port, withSettings);
  check('JSエラーなし', wth.errors.length === 0, wth.errors.join(' | '));
  const jreRows = wth.rows.filter((r) => r.includes('JREPOINT'));
  check('JRE 行が1行だけある', jreRows.length === 1, wth.rows.join(' / '));
  check('JRE 行：残高 7,684 pt', jreRows.length === 1 && jreRows[0].includes('7,684pt'), jreRows[0] || '');
  check('JRE 行：最直近失効 3/31 までに 1,000 pt 失効', jreRows.length === 1 && jreRows[0].includes('3/31までに1,000pt失効'), jreRows[0] || '');
  check('JRE 行：ラム確認 11/14', jreRows.length === 1 && jreRows[0].includes('ラム確認11/14'), jreRows[0] || '');
  check('合計が 29,887 pt（22,203 + 7,684）', wth.meta === '合計29,887pt' && wth.body.endsWith('合計29,887pt'), wth.meta + ' / ' + wth.body.slice(-30));
  check('Zaim 側の行は不変（先頭がベースライン通り）', wth.body.startsWith(BASE_BODY.replace('合計22,203pt', '')), wth.body);
  check('ノートに Zaim 外の補足が付く', wth.note.startsWith(BASE_NOTE) && wth.note.includes('Zaim 外のポイントは'), wth.note);

  console.log('== case dup（Zaim 同名は Zaim 優先）==');
  const dupSettings = JSON.parse(JSON.stringify(baseSettings));
  dupSettings.externalPoints = [
    { name: 'Vポイント', balance: 99999, expiring: [{ points: 99999, date: '2026-12-01' }], updatedAt: '2026-11-14' },
    { name: 'ふるなびポイント', balance: 88888, expiring: [], updatedAt: '2026-11-14' },
    JRE,
  ];
  const dup = await boot(port, dupSettings);
  check('JSエラーなし', dup.errors.length === 0, dup.errors.join(' | '));
  const vRows = dup.rows.filter((r) => r.startsWith('Vポイント'));
  check('Vポイントは Zaim 側の1行のみ（6,387 pt・偽残高なし）', vRows.length === 1 && vRows[0].includes('6,387pt') && !dup.body.includes('99,999'), dup.rows.join(' / '));
  const fRows = dup.rows.filter((r) => r.startsWith('ふるなびポイント'));
  check('ふるなびポイントは Zaim 側の1行のみ（4,200 pt・偽残高なし）', fRows.length === 1 && fRows[0].includes('4,200pt') && !dup.body.includes('88,888'), dup.rows.join(' / '));
  check('JRE 行は追加される', dup.rows.filter((r) => r.includes('JREPOINT')).length === 1, dup.rows.join(' / '));
  check('合計は 29,887 pt（重複分は加算されない）', dup.meta === '合計29,887pt', dup.meta);

  console.log(`\n== RESULT: ${pass} passed, ${fail} failed ==`);
  server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); server.close(); process.exit(2); });
