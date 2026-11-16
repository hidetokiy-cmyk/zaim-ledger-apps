// 資金繰り予測のハイブリッド化（直近月は90日見通しの実スケジュールで上書き）の検証。
//   - 見通しが届く月は代表値ではなく見通しの日次シミュレーションで計算される
//   - 上書き後は残高チェーン（開始残高＋各月の収支＝月末残高）が一致する
//   - パネルの注記に「引落予定ベース」が出る
// 日付をフィクスチャのアンカー（2026-11-14）に固定して決定的に検証する。
// Usage: node boot_forecast_hybrid.js
const fs = require('fs'); const path = require('path'); const http = require('http');
const { JSDOM, VirtualConsole } = require('jsdom');
const { buildFixture } = require('./fixtures_make');
const ROOT = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf-8');
const fixture = buildFixture(new Date(2026, 10, 14));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (cond, label) => { console.log((cond ? '  PASS ' : '  FAIL ') + label); cond ? pass++ : fail++; };

(async () => {
  // ===== ソースレベルの確認 =====
  ok(/typeof computeOutlook90 === "function"/.test(html), 'S1: 見通しが無い環境向けの typeof ガードがある');
  ok(/result\.basis\.hybridMonths = hybridMonths/.test(html), 'S2: basis.hybridMonths にハイブリッド月数を記録する');
  ok(/引落予定ベース/.test(html), 'S3: パネル注記と相談文に「引落予定ベース」の文言がある');
  ok(/\(開始−1日, 終了−1日\]/.test(html) || /終了−1日/.test(html), 'S4: 会計月の区間定義（終了日の給与は翌月度）のコメントがある');

  // ===== ブート確認（合成フィクスチャ＋日付固定） =====
  const server = http.createServer((req, res) => { const name = decodeURIComponent(new URL(req.url, 'http://x').pathname.split('/').pop()) || 'index.html'; const p = path.join(ROOT, name); if (fs.existsSync(p) && fs.statSync(p).isFile()) { res.writeHead(200); res.end(fs.readFileSync(p)); } else { res.writeHead(404); res.end(''); } });
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
      // 「今日」をフィクスチャのアンカー日に固定する（見通しと予測の窓を一致させる）
      const FIXED = new window.Date(2026, 10, 14, 12, 0, 0).getTime();
      const RealDate = window.Date;
      window.Date = class extends RealDate {
        constructor(...a) { super(...(a.length ? a : [FIXED])); }
        static now() { return FIXED; }
      };
      Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: (t) => { window.__copiedText = t; return Promise.resolve(); } } });
      window.localStorage.setItem('zaimLedgerCsvCache', JSON.stringify({ fileName: 'zaim-fixture.csv', text: fixture.csvText, savedAt: new Date().toISOString(), sourceDownloadedAt: null }));
      window.localStorage.setItem('zaimLedgerSettings', JSON.stringify({ v: 1, obj: fixture.settings, base: null, dirty: false }));
    } });
  const doc = dom.window.document;
  for (let i = 0; i < 40; i++) { await sleep(500); if (doc.getElementById('assetsHeroValue')) break; }
  await sleep(1500);
  ok(errors.length === 0, 'B0: JS エラーなし' + (errors.length ? '（' + errors[0] + '）' : ''));

  const tabBtn = doc.querySelector('.tab-btn[data-tab="analysis"]');
  ok(!!tabBtn, 'B1: 分析タブがある');
  tabBtn.click(); await sleep(1200);

  const note = (doc.getElementById('forecastDataNote') || {}).textContent || '';
  ok(/引落予定ベース/.test(note), 'B2: 予測パネルの注記に「引落予定ベース」が出る（ハイブリッドが効いている）');

  // 相談用サマリー（クリップボード経由）で残高チェーンと代表値区間を検証する
  const copyBtn = doc.getElementById('forecastCopyBtn');
  ok(!!copyBtn, 'B3: 相談用コピーボタンがある');
  copyBtn.click(); await sleep(800);
  const text = dom.window.__copiedText || '';
  ok(text.length > 0, 'B4: 相談用サマリーが生成される');
  ok(/引落予定ベース/.test(text), 'B5: 相談用サマリーにも「引落予定ベース」が出る');
  const startM = text.match(/現金・預金残高：(−?)¥([\d,]+)/);
  const startBal = startM ? (startM[1] ? -1 : 1) * Number(startM[2].replace(/,/g, '')) : null;
  const monthLines = Array.from(text.matchAll(/^- (.+?)：収支 ([+−])¥([\d,]+).*?→ 残高 ¥(-?[\d,]+)/gm))
    .map((m) => ({ label: m[1], net: (m[2] === '−' ? -1 : 1) * Number(m[3].replace(/,/g, '')), bal: Number(m[4].replace(/,/g, '')) }));
  ok(monthLines.length === 6, 'B6: サマリーに6か月分の行がある（実際: ' + monthLines.length + '）');
  if (startBal != null && monthLines.length === 6) {
    let prev = startBal, chainOk = true;
    for (const m of monthLines) { if (Math.abs(prev + m.net - m.bal) > 1) chainOk = false; prev = m.bal; }
    ok(chainOk, 'B7: 残高チェーン（開始残高＋各月の収支＝月末残高）が全月で一致する');
    ok(monthLines[4].net === monthLines[5].net, 'B8: 見通しの届かない月（3・4月度）は代表値のまま同額');
    ok(monthLines[0].net !== monthLines[4].net, 'B9: 直近月（11月度）の収支は代表値と異なる（実スケジュール反映）');
  }

  console.log(`=== boot_forecast_hybrid: ${pass} pass, ${fail} fail ===`);
  server.close(); dom.window.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
