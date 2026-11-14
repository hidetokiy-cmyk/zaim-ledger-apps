// 引落要約タグの折り返し防止（欠点修正の残件）の検証（jsdom 実起動・合成フィクスチャ＋ソース確認）。
//   実アプリの最終確認（2026-11-15）で、引落要約の「締め済み」タグが狭幅で
//   「締め済／み」と単語の途中で折れる粗を観察。タグに nowrap を付けて防ぐ。
//   - 指定は引落要約（#debitSummaryBody）内に限定し、共用クラス .bal-tag 自体は変えない
//   - ソース確認＋実スタイル（computed style）で、要約内のタグだけに nowrap が効くことを見る
//   ※ 合成フィクスチャではカードの締め日推定が立たず要約に実タグ行が出ないため、
//     カスケードの確認は要約コンテナ内に挿入した同クラスの要素で行う（L4 のソース確認と同じ水準）。
// Usage: node boot_debit_tag_nowrap.js
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
  ok(/#debitSummaryBody \.bal-tag \{ white-space: nowrap; \}/.test(html), 'S1: #debitSummaryBody .bal-tag に nowrap の指定がある');
  const shared = html.match(/\.bal-tag \{([^}]*)\}/);
  ok(!!shared && !/white-space/.test(shared[1]), 'S2: 共用クラス .bal-tag 自体には white-space を足していない（要約内だけに限定）');
  ok(/x\.it\.closed \? el\("span", \{ class: "bal-tag" \}, \["締め済み"\]\)/.test(html), 'S3: 要約の締め済みタグは従来どおり .bal-tag で描画される（JS 側は無変更）');

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
  const doc = dom.window.document;
  for (let i = 0; i < 40; i++) { await sleep(500); if (doc.getElementById('assetsHeroValue')) break; }
  await sleep(1500);
  ok(errors.length === 0, 'B0: JS エラーなし');

  const sumBody = doc.getElementById('debitSummaryBody');
  ok(!!sumBody && sumBody.children.length > 0, 'B1: 引落要約カードが描画される');

  // 実タグ行が出るデータ条件ではそのまま確認し、出ない条件（フィクスチャ）では
  // 要約コンテナ内に同クラスの要素を挿入してカスケードを確認する。
  const realTags = [...doc.querySelectorAll('#debitSummaryBody .bal-tag')];
  if (realTags.length) {
    ok(realTags.every((t) => dom.window.getComputedStyle(t).whiteSpace === 'nowrap'), 'B2: 要約の実タグ（' + realTags.length + '件）の white-space が nowrap');
  } else {
    const probe = doc.createElement('span');
    probe.className = 'bal-tag';
    probe.textContent = '締め済み';
    sumBody.appendChild(probe);
    ok(dom.window.getComputedStyle(probe).whiteSpace === 'nowrap', 'B2: 要約内の .bal-tag は white-space: nowrap になる（カスケード確認）');
    probe.remove();
  }

  const detailBody = doc.getElementById('cardScheduleBody');
  ok(!!detailBody, 'B3: 詳細パネル（要約外）のコンテナがある');
  if (detailBody) {
    const probe2 = doc.createElement('span');
    probe2.className = 'bal-tag';
    probe2.textContent = '締め済み';
    detailBody.appendChild(probe2);
    ok(dom.window.getComputedStyle(probe2).whiteSpace !== 'nowrap', 'B4: 要約外の .bal-tag には nowrap が効いていない（要約内限定）');
    probe2.remove();
  }

  server.close();
  console.log(`== 結果: pass ${pass} / fail ${fail} ==`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
