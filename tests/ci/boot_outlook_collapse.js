// 90日の見通しの折り畳みボタンが、カード全体のクリック（資金繰り予測への遷移）に
// 伝播しないことの検証（jsdom 実起動・合成フィクスチャ＋ソース確認）。
//   修正前は、折り畳みボタンのクリックが #outlookCard のクリックハンドラに伝播し、
//   折り畳むたびに分析タブの資金繰り予測へ画面が飛んでいた。
//   - 伝播止めは .panel-collapse を作る3か所（概要パネル／グラフのグループ／概要のグループ）すべてに入れる
//   - キーボード（Enter/空白）でもカード側の keydown に伝播させない
// Usage: node boot_outlook_collapse.js
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
  ok((html.match(/btn\.addEventListener\("click", \(e\) => \{\n\s+e\.stopPropagation\(\);/g) || []).length === 3, 'S1: 折り畳みボタンのクリックハンドラ3か所すべてに stopPropagation がある');
  ok((html.match(/btn\.addEventListener\("keydown", \(e\) => e\.stopPropagation\(\)\);/g) || []).length === 3, 'S2: 折り畳みボタンの keydown 伝播止めが3か所ある');
  ok(/wiRow\.addEventListener\("click", \(e\) => e\.stopPropagation\(\)\)/.test(html), 'S3: what-if 行の伝播止めは従来どおり残っている');

  // ===== ブート確認（合成フィクスチャ） =====
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
      window.localStorage.setItem('zaimLedgerCsvCache', JSON.stringify({ fileName: 'zaim-fixture.csv', text: fixture.csvText, savedAt: new Date().toISOString(), sourceDownloadedAt: null }));
      window.localStorage.setItem('zaimLedgerSettings', JSON.stringify({ v: 1, obj: fixture.settings, base: null, dirty: false }));
    } });
  const doc = dom.window.document, win = dom.window;
  for (let i = 0; i < 40; i++) { await sleep(500); if (doc.getElementById('assetsHeroValue')) break; }
  await sleep(1500);
  ok(errors.length === 0, 'B0: JS エラーなし');

  const card = doc.getElementById('outlookCard');
  const btn = card && card.querySelector('.panel-collapse');
  ok(!!btn, 'B1: 90日の見通しに折り畳みボタンがある');
  const activeTab = () => doc.querySelector('.tab-btn.active') && doc.querySelector('.tab-btn.active').dataset.tab;
  ok(activeTab() === 'home', 'B2: 初期タブはホーム');

  btn.click(); await sleep(300);
  ok(card.classList.contains('collapsed'), 'B3: クリックで折り畳まれる');
  ok(activeTab() === 'home' && !doc.getElementById('tabOverview').classList.contains('hidden'), 'B4: 折り畳んでも資金繰り予測へ遷移しない');
  ok((win.localStorage.getItem('zaimLedgerCollapsed') || '').includes('outlookCard'), 'B5: 折り畳み状態が保存される');

  btn.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(300);
  ok(activeTab() === 'home', 'B6: ボタン上の Enter でも遷移しない');

  btn.click(); await sleep(300);
  ok(!card.classList.contains('collapsed'), 'B7: もう一度押すと開く');
  ok(activeTab() === 'home', 'B8: 開いても遷移しない');

  server.close();
  console.log(`\n=== boot_outlook_collapse: ${pass} pass, ${fail} fail ===`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
