// UX再構築 Stage S2（ホームの3帯再編）の検証（jsdom実起動・実データ）。
// assert する内容：
//   1. #tabOverview 直下の要素 ID の出現順が帯構成どおり（状態バー→統合ヒーロー→引落要約→
//      今月（お金の流れ）→先読み・点検（見通し／今日の確認／ポイント／ポータル／予定と契約／
//      日別／期間比較）→台帳に聞く）。M8 でポイント／ポータルを見通し・今日の確認の下へ移動。
//   2. 統合ヒーローの内包（総資産→今日使える額→heroMini（現金・預金／予測残高））。
//   3. 今日の確認の内包（ドキュメント→フェーズ→気づきフィード→自動点検）と phaseMeta の移設。
//   4. 引落：旧 cardSchedulePanel が存在しないこと、詳細（cardScheduleMeta/Body）が
//      debitSummaryCard 内の展開領域にあること、トグルの開閉が効くこと。
//   5. ポータルから引落ダイジェストと自己言及注記が消え、給与リンクが残っていること。
//   6. 描画エラーが無いこと、引落要約に合計行が出ること。
// Usage: node boot_home_bands.js
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
const settingsObj = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = http.createServer((req, res) => { const name = decodeURIComponent(new URL(req.url, 'http://x').pathname.split('/').pop()) || 'index.html'; const p = path.join(ROOT, name); if (fs.existsSync(p) && fs.statSync(p).isFile()) { res.writeHead(200); res.end(fs.readFileSync(p)); } else { res.writeHead(404); res.end(''); } });
let pass = 0, fail = 0;
const ok = (cond, label) => { console.log((cond ? '  PASS ' : '  FAIL ') + label); cond ? pass++ : fail++; };
(async () => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
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
  for (let i = 0; i < 40; i++) { await sleep(500); if (doc.querySelector('#assetsHistoryChart svg')) break; }
  await sleep(1500);

  ok(errors.length === 0, `描画エラーなし (errors=${JSON.stringify(errors.slice(0, 2))})`);

  // --- 1. 帯構成（直下の出現順） ---
  const kids = [...doc.getElementById('tabOverview').children].filter((e) => e.id).map((e) => e.id);
  const EXPECTED = ['freshStrip', 'heroUnified', 'debitSummaryCard', 'overviewGroupFlow', 'outlookCard',
    'todayCheckCard', 'pointsCard', 'portalCard', 'overviewGroupSchedule', 'calPanel', 'periodComparePanel', 'askWrap'];
  ok(JSON.stringify(kids) === JSON.stringify(EXPECTED), `帯構成の出現順: ${kids.join(' > ')}`);

  // --- 2. 統合ヒーロー ---
  const heroKids = [...doc.getElementById('heroUnified').children].filter((e) => e.id).map((e) => e.id);
  ok(JSON.stringify(heroKids) === JSON.stringify(['assetsHeroCard', 'heroCard', 'heroMini']), `ヒーロー内包順: ${heroKids.join(' > ')}`);
  const miniKids = [...doc.getElementById('heroMini').children].filter((e) => e.id).map((e) => e.id);
  ok(JSON.stringify(miniKids) === JSON.stringify(['heroBalCard', 'heroFcCard']), `heroMini 内包順: ${miniKids.join(' > ')}`);
  ok(/¥[\d,]+/.test(doc.getElementById('assetsHeroValue').textContent), `総資産の値: ${doc.getElementById('assetsHeroValue').textContent}`);
  ok(doc.getElementById('heroValue').textContent.trim().length > 0, `今日使える額の値: ${doc.getElementById('heroValue').textContent}`);

  // --- 3. 今日の確認 ---
  const tc = doc.getElementById('todayCheckCard');
  const tcKids = [...tc.querySelectorAll(':scope > .today-sec')].map((e) => e.id);
  ok(JSON.stringify(tcKids) === JSON.stringify(['docCoverCard', 'phaseBandCard', 'insightFeedPanel', 'autoCheckCard']), `今日の確認の節の順: ${tcKids.join(' > ')}`);
  const head = tc.querySelector(':scope > .panel-head');
  ok(!!head && head.querySelector('.section-title').textContent.trim() === '今日の確認' && !!head.querySelector('#phaseMeta'), '統合カードの見出しに phaseMeta が移設されている');
  ok(doc.getElementById('phaseChecks').children.length > 0, 'フェーズチェックが描画されている');

  // --- 4. 引落 ---
  ok(!doc.getElementById('cardSchedulePanel'), '旧 cardSchedulePanel は存在しない');
  const detail = doc.getElementById('debitDetail');
  ok(!!detail && detail.contains(doc.getElementById('cardScheduleBody')) && detail.contains(doc.getElementById('cardScheduleMeta')), '詳細（meta/body）が要約カードの展開領域内にある');
  ok(detail.classList.contains('hidden'), '詳細は初期状態で閉じている');
  const sumBody = doc.getElementById('debitSummaryBody');
  ok(/合計/.test(sumBody.textContent) && /¥[\d,]+/.test(sumBody.textContent), `引落要約に合計行: ${sumBody.textContent.replace(/\s+/g, ' ').slice(0, 90)}`);
  ok(/あと\d+日|今日/.test(doc.getElementById('debitSummaryMeta').textContent), `引落メタ（あと何日）: ${doc.getElementById('debitSummaryMeta').textContent}`);
  ok(doc.getElementById('cardScheduleBody').children.length > 0, '詳細（全件）が描画されている');
  const toggle = doc.getElementById('debitDetailToggle');
  toggle.click();
  ok(!detail.classList.contains('hidden') && toggle.getAttribute('aria-expanded') === 'true', 'トグルで詳細が開く');
  toggle.click();
  ok(detail.classList.contains('hidden') && toggle.getAttribute('aria-expanded') === 'false', 'トグルで詳細が閉じる');

  // --- 5. ポータル ---
  const portalText = doc.getElementById('portalBody').textContent;
  ok(!/次回の引落/.test(portalText) && !/カード引落の予定/.test(portalText), 'ポータルに引落ダイジェストと自己言及注記が無い');
  ok(/給与明細シミュレータ/.test(portalText), 'ポータルに給与明細へのリンクが残っている');

  console.log(`== 結果: pass ${pass} / fail ${fail} ==`);
  server.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
