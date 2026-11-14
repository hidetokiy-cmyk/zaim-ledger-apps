// L4・L5・L6（欠点修正）のブート検証（jsdom 実起動・合成フィクスチャ）。
//   L6：ポイントの「データなし」と「残高ゼロ」が区別できること
//     - ケースA（ポイントのデータが一切ない）：カードを隠さず「ポイントのデータがありません」を出す
//     - ケースB（残高ゼロのプログラムがある）：従来どおり 0 pt の行を表示し、「データなし」は出さない
//   L4：ホーム状態行の各項目が .fresh-part（折り返し禁止）で包まれること／タグ類の CSS に nowrap があること
//   L5：ヒートマップの軸ラベルが 12.5px になっていること（SVG が描画されていれば DOM でも確認）
// Usage: node boot_points_l6.js
const fs = require('fs'); const path = require('path'); const http = require('http');
const { JSDOM, VirtualConsole } = require('jsdom');
const { buildFixture } = require('./fixtures_make');
const ROOT = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf-8');
const fixture = buildFixture(new Date(2026, 10, 14));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (cond, label) => { console.log((cond ? '  PASS ' : '  FAIL ') + label); cond ? pass++ : fail++; };

async function boot(mutateSettings) {
  const settingsObj = JSON.parse(JSON.stringify(fixture.settings));
  if (mutateSettings) mutateSettings(settingsObj);
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
      window.localStorage.setItem('zaimLedgerSettings', JSON.stringify({ v: 1, obj: settingsObj, base: null, dirty: false }));
    } });
  const doc = dom.window.document;
  for (let i = 0; i < 40; i++) { await sleep(500); if (doc.getElementById('assetsHeroValue')) break; }
  await sleep(1500);
  return { doc, server, errors };
}

(async () => {
  // ===== ケースA：ポイントのデータが一切ない =====
  {
    const { doc, server, errors } = await boot(null);
    console.log('== ケースA（データなし） errors:', JSON.stringify(errors.slice(0, 2)));
    ok(errors.length === 0, 'A0: JS エラーなし');
    const card = doc.getElementById('pointsCard');
    const body = doc.getElementById('pointsBody');
    ok(!!card && !card.classList.contains('hidden'), 'L6-A1: データなしでもカードは隠れない');
    ok(!!body && body.textContent.includes('ポイントのデータがありません'), 'L6-A2: 「ポイントのデータがありません」と表示される');
    ok(doc.getElementById('pointsMeta').textContent.trim() === '', 'L6-A3: 合計表示は出ない');
    // L4：状態行の項目が .fresh-part で包まれる
    const parts = doc.querySelectorAll('#freshStrip .fresh-part');
    ok(parts.length >= 1, 'L4-1: 状態行の項目が .fresh-part で包まれる（' + parts.length + '件）');
    ok([...parts].every((e) => e.textContent.trim().length > 0), 'L4-2: .fresh-part の中身は項目テキストそのもの');
    server.close();
  }
  // ===== ケースB：残高ゼロのプログラムがある =====
  {
    const { doc, server, errors } = await boot((s) => {
      s.pendingPointExpiry = { programs: [{ name: 'テストポイント', totalPoints: 0, expiry: [] }], scrapedAt: new Date().toISOString() };
    });
    console.log('== ケースB（残高ゼロ） errors:', JSON.stringify(errors.slice(0, 2)));
    ok(errors.length === 0, 'B0: JS エラーなし');
    const card = doc.getElementById('pointsCard');
    const body = doc.getElementById('pointsBody');
    ok(!!card && !card.classList.contains('hidden'), 'L6-B1: カードが表示される');
    ok(!!body && body.textContent.includes('テストポイント') && body.textContent.includes('0 pt'), 'L6-B2: 残高ゼロのプログラムが 0 pt の行で表示される');
    ok(!!body && !body.textContent.includes('ポイントのデータがありません'), 'L6-B3: 「データなし」は出ない（残高ゼロと区別できる）');
    server.close();
  }
  // ===== ソースレベルの確認（L4 の CSS・L5 のラベルサイズ） =====
  ok(/\.sub-tag-up \{[^}]*white-space: nowrap/.test(html), 'L4-3: .sub-tag-up（倍率タグ）に nowrap');
  ok(/\.sub-tag-down \{[^}]*white-space: nowrap/.test(html), 'L4-4: .sub-tag-down に nowrap');
  ok(/\.fresh-strip \.fresh-part \{ white-space: nowrap; \}/.test(html), 'L4-5: .fresh-part の CSS がある');
  const heatmapSrc = html.slice(html.indexOf('function renderHeatmap'), html.indexOf('function renderHeatmap') + 4000);
  ok(!/"font-size": 9/.test(heatmapSrc), 'L5-1: ヒートマップに 9px ラベルが残っていない');
  ok((heatmapSrc.match(/"font-size": 12\.5/g) || []).length === 2, 'L5-2: 曜日・月の両ラベルが 12.5px');

  console.log(`== 結果: pass ${pass} / fail ${fail} ==`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
