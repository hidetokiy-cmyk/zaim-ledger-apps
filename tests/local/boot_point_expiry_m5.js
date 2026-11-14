// M5 状態注入テスト：ポイント期限の年表示・失効済み表示・scrapedAt の鮮度監視。
// pendingPointExpiry はルーティーンが書く読み取り専用データで、実 settings の有無に左右されずに
// 検証するため、settings に注入して起動する（unit_freshness_alerts と同じ方式）。
// 使い方: node tests/local/boot_point_expiry_m5.js（ZAIM_CSV / ZAIM_SETTINGS が必要）
const fs = require('fs'); const path = require('path'); const http = require('http');

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
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const yLabel = (d) => `${d.getFullYear()}年${d.getMonth() + 1}/${d.getDate()}`;

async function boot(mutateSettings) {
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
    } });
  const doc = dom.window.document;
  for (let i = 0; i < 40; i++) { await sleep(500); if (doc.querySelector('#assetsHistoryChart svg')) break; }
  await sleep(1500);
  return { doc, server, errors };
}

(async () => {
  const now = new Date();
  const past = new Date(now.getTime() - 10 * DAY);
  const future = new Date(now.getTime() + 400 * DAY);
  const programs = [
    { name: 'テストポイントA', totalPoints: 500, expiry: [{ date: ymd(past), points: 200 }, { date: ymd(future), points: 300 }] },
    { name: 'テストポイントB', totalPoints: 100, expiry: [{ date: ymd(future), points: 100 }] },
  ];
  const lines = (root, sel) => [...root.querySelectorAll(sel)].map((e) => e.textContent.replace(/\s+/g, ' ').trim());

  // ===== ケースA：期限切れ＋未来期限、scrapedAt は新鮮 =====
  {
    const { doc, server, errors } = await boot((s) => {
      s.pendingPointExpiry = { programs, scrapedAt: new Date().toISOString() };
    });
    console.log('== ケースA（失効済み・年表示） errors:', JSON.stringify(errors.slice(0, 2)));
    const body = doc.getElementById('pointsBody');
    ok(!!body && body.children.length > 0, 'A1: ポイントカードが描画される');
    const rows = lines(body, '.pt-row');
    const rowA = rows.find((t) => t.includes('テストポイントA'));
    ok(!!rowA && rowA.includes(`${yLabel(past)}に 200 pt 失効済み`), `A2: 過去の期限は年付きで「失効済み」になる: ${rowA || '(行なし)'}`);
    ok(!!rowA && !rowA.includes('までに 200 pt'), 'A3: 失効済みの分が未来の期限として出ない');
    const rowB = rows.find((t) => t.includes('テストポイントB'));
    ok(!!rowB && rowB.includes(`${yLabel(future)} までに 100 pt 失効`), `A4: 未来の期限は年付きで出る: ${rowB || '(行なし)'}`);
    const expA = [...body.querySelectorAll('.pt-row')].find((r) => r.textContent.includes('テストポイントA'));
    const expElA = expA && expA.querySelector('.pt-exp');
    ok(!!expElA && expElA.classList.contains('soon'), 'A5: 失効済みの期限行に警告様式（soon）が付く');
    const strip = doc.getElementById('freshStrip');
    ok(!!strip && !lines(strip, '.alert-line').some((t) => t.includes('ポイント期限の取得')), 'A6: scrapedAt が新しい時は鮮度警告が出ない');
    server.close();
  }

  // ===== ケースB：scrapedAt が5日前（鮮度警告） =====
  {
    const { doc, server, errors } = await boot((s) => {
      s.pendingPointExpiry = { programs, scrapedAt: new Date(Date.now() - 5 * DAY).toISOString() };
    });
    console.log('== ケースB（scrapedAt 停止） errors:', JSON.stringify(errors.slice(0, 2)));
    const strip = doc.getElementById('freshStrip');
    ok(!!strip && lines(strip, '.alert-line.lv-warn').some((t) => t.includes('ポイント期限の取得が5日前で止まっています')), 'B1: scrapedAt が3日以上古いと状態バーに警告が出る');
    server.close();
  }

  console.log(`== 結果: pass ${pass} / fail ${fail} ==`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
