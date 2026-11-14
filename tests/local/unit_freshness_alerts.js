// S5 状態注入テスト：鮮度・警告の定型化（freshnessAlerts / 状態バー / 他タブ帯 / 同期ヘルスバナー）。
// 同期失敗状態は jsdom で自然には再現しにくいため、settings と localStorage に状態を注入して起動し、
// 異常時と正常時で表示の段階付け（lv-error / lv-warn）と出し分けが切り替わることを assert する。
// 使い方: node unit_freshness_alerts.js
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (cond, label) => { console.log((cond ? '  PASS ' : '  FAIL ') + label); cond ? pass++ : fail++; };
const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();

async function boot(mutateSettings, lastSyncAt) {
  const settingsObj = JSON.parse(JSON.stringify(baseSettings));
  mutateSettings(settingsObj);
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
      window.localStorage.setItem('zaimLedgerCsvCache', JSON.stringify({ fileName: 'zaim-full.csv', text: csv, savedAt: new Date().toISOString(), sourceDownloadedAt: null }));
      window.localStorage.setItem('zaimLedgerSettings', JSON.stringify({ v: 1, obj: settingsObj, base: null, dirty: false }));
      if (lastSyncAt) window.localStorage.setItem('zaimLedgerLastSync', String(lastSyncAt));
    } });
  const doc = dom.window.document;
  for (let i = 0; i < 40; i++) { await sleep(500); if (doc.querySelector('#assetsHistoryChart svg')) break; }
  await sleep(1500);
  return { doc, server, errors };
}
const lines = (root, sel) => [...root.querySelectorAll(sel)].map((e) => e.textContent.replace(/\s+/g, ' ').trim());

(async () => {
  const now = Date.now();
  // ===== ケースA：異常を注入（同期スクリプト10日停止・トークン期限切れ・未一致口座2件・最終同期5日前） =====
  {
    const { doc, server, errors } = await boot((s) => {
      s.syncHeartbeat = { at: iso(now - 10 * DAY), ok: true, warnings: [], version: 'test', tokenExpiresAt: iso(now - DAY) };
      s.zaimScrapeInfo = { ...(s.zaimScrapeInfo || {}), unmatched: ['テスト口座A', 'テスト口座B'] };
    }, now - 5 * DAY);
    console.log('== ケースA（異常注入） errors:', JSON.stringify(errors.slice(0, 2)));
    const banner = doc.getElementById('syncHealthBanner');
    ok(!!banner, 'A1: 同期ヘルスバナーが表示される');
    if (banner) {
      ok(banner.classList.contains('has-error'), 'A2: バナーに has-error（error を含むと赤帯に昇格）');
      ok(lines(banner, '.alert-line.lv-error').some((t) => t.includes('トークンの期限が切れています')), 'A3: トークン期限切れが lv-error 行で出る');
      ok(lines(banner, '.alert-line.lv-warn').some((t) => t.includes('更新されていません')), 'A4: 同期停止が lv-warn 行で出る');
    }
    const strip = doc.getElementById('freshStrip');
    ok(!!strip, 'A5: ホームの状態バーが存在する');
    if (strip) {
      ok(lines(strip, '.alert-line.lv-warn').some((t) => t.includes('連携で一致しない口座：2件')), 'A6: 未一致口座が状態バーに lv-warn 行で出る');
      ok(lines(strip, '.alert-line.lv-warn').some((t) => t.includes('最終同期が5日前で止まっています')), 'A7: 最終同期の停止が状態バーに lv-warn 行で出る');
      ok(strip.textContent.includes('最終同期：') && strip.textContent.includes('データの最終日：'), 'A8: 正常系の1行（最終同期・データ最終日）も併記される');
    }
    ['freshStripClosing', 'freshStripAnalysis', 'freshStripLedger'].forEach((id) => {
      const s = doc.getElementById(id);
      ok(!!s && !s.hidden && lines(s, '.alert-line.lv-warn').some((t) => t.includes('連携で一致しない口座：2件')), `A9: 他タブの帯（${id}）が異常時に表示される`);
    });
    server.close();
  }
  // ===== ケースB：正常（生存記録は新鮮・未一致なし・最終同期は今） =====
  {
    const { doc, server } = await boot((s) => {
      s.syncHeartbeat = { at: iso(now), ok: true, warnings: [], version: 'test', tokenExpiresAt: null };
      s.zaimScrapeInfo = { ...(s.zaimScrapeInfo || {}), unmatched: [] };
    }, now);
    console.log('== ケースB（正常）');
    ok(!doc.getElementById('syncHealthBanner'), 'B1: 正常時は同期ヘルスバナーが出ない');
    const strip = doc.getElementById('freshStrip');
    ok(!!strip && !strip.querySelector('.alert-line.lv-error'), 'B2: 状態バーに lv-error 行が出ない');
    ok(!!strip && !strip.textContent.includes('一致しない'), 'B3: 状態バーに未一致口座の警告が出ない');
    ['freshStripClosing', 'freshStripAnalysis', 'freshStripLedger'].forEach((id) => {
      const s = doc.getElementById(id);
      // データ最終日の古さ（フィクスチャ依存）だけは実行日によって warn になりうるため、それ以外の異常が出ないことだけを見る
      ok(!!s && !s.querySelector('.alert-line.lv-error') && ![...s.querySelectorAll('.alert-line')].some((e) => /一致しない|最終同期が/.test(e.textContent)), `B4: 他タブの帯（${id}）に同期・突合の異常が出ない`);
    });
    server.close();
  }
  console.log(`== 結果: pass ${pass} / fail ${fail} ==`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
