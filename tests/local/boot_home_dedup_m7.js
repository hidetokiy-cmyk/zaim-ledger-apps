// M7 検証（jsdom実起動・実データ）：月次チェック結果の重複排除（1情報1ホーム）。
// assert する内容：
//   1. 気づきフィードに月次チェックの項目が出ない（.feed-src に「月次チェック」が無い）、
//      フィードのメタにも月次チェック件数が出ない。
//   2. フェーズ帯にチェック項目（.x-check）が出ない（フェーズ表示のみ）。
//   3. 表紙カードには「決算までの残り作業」の件数表示が残る（ホームで唯一の月次チェック由来表示）。
//   4. 自動点検カードの注記から月次チェックが外れている。
//   5. 決算タブの月次チェックパネルには従来どおり全項目が出る（結果のホームは決算タブ）。
// Usage: node tests/local/boot_home_dedup_m7.js（ZAIM_CSV / ZAIM_SETTINGS が必要）
const fs = require('fs'); const path = require('path'); const http = require('http');

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

  // --- 1. 気づきフィード ---
  const srcs = [...doc.querySelectorAll('#insightFeedList .feed-src')].map((e) => e.textContent.trim());
  ok(!srcs.includes('月次チェック'), `フィードに出所「月次チェック」の項目が無い（出所: ${[...new Set(srcs)].join(' / ')}）`);
  ok(!doc.getElementById('insightFeedMeta').textContent.includes('月次チェック'), 'フィードのメタに月次チェック件数が出ない');

  // --- 2. フェーズ帯 ---
  const phase = doc.getElementById('phaseChecks');
  ok(!!phase && phase.querySelectorAll('.x-check').length === 0, 'フェーズ帯にチェック項目が出ない');
  ok(!!phase && /フェーズ：/.test(phase.textContent), 'フェーズ帯にフェーズ表示は残る');

  // --- 3. 表紙カード（唯一の月次チェック由来表示） ---
  ok(/決算までの残り作業/.test(doc.getElementById('docCoverLife').textContent), `表紙カードに残り作業が出る: ${doc.getElementById('docCoverLife').textContent.replace(/\s+/g, ' ').trim()}`);

  // --- 4. 自動点検カードの注記 ---
  const autoNote = [...doc.querySelectorAll('#autoCheckCard .cash-note')].map((e) => e.textContent.trim());
  ok(autoNote.some((t) => t === '健康診断・異常値の結果'), `自動点検の注記が「健康診断・異常値の結果」: ${autoNote.join(' / ')}`);

  // --- 5. 決算タブの月次チェック（結果のホーム） ---
  const mcList = doc.getElementById('monthCheckList');
  ok(!!mcList && mcList.querySelectorAll('.x-check').length > 0, `決算タブの月次チェックに項目が出る（${mcList ? mcList.querySelectorAll('.x-check').length : 0}件）`);
  ok(/月次チェック/.test(doc.getElementById('monthCheckMeta').textContent) || doc.getElementById('monthCheckMeta').textContent.length > 0, '決算タブの月次チェックにメタが出る');

  console.log(`== 結果: pass ${pass} / fail ${fail} ==`);
  server.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
