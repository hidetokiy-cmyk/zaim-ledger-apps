// Full Zaim-vs-app verification harness (2026-11-14).
// Usage: SETTINGS=/tmp/settings_bootX.json node full_verify.js
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
  const txt = (el) => el ? el.textContent.replace(/\s+/g, ' ').trim() : '(missing)';
  for (let i = 0; i < 40; i++) { await sleep(500); if (doc.querySelector('#assetsHistoryChart svg')) break; }
  await sleep(1500);
  console.log('== errors:', JSON.stringify(errors.slice(0, 3)));
  console.log('== reconcileSummary:', txt(doc.getElementById('reconcileSummary')));
  const rb = doc.getElementById('reconcileBody');
  if (rb) {
    rb.querySelectorAll('tr').forEach((tr) => console.log('  ROW:', [...tr.querySelectorAll('th,td')].map((c) => c.textContent.trim()).join(' | ')));
    const note = rb.querySelector('.cash-note');
    if (note) console.log('  NOTE:', txt(note));
  }
  const all = doc.body.textContent.replace(/\s+/g, ' ');
  const m = all.match(/純資産（前払費用・預け金を含む・④と同じ値）¥[\d,]+/);
  console.log('== bsNetAssets:', m ? m[0] : 'NOT FOUND');
  const ta = all.match(/総資産[^¥]{0,30}¥[\d,]+/);
  console.log('== totalAssetsHero:', ta ? ta[0] : 'n/a');
  console.log('== period(default):', txt(doc.getElementById('periodCurrentLabel')),
    '| revenue:', txt(doc.getElementById('revenueVal')), '| cost:', txt(doc.getElementById('costVal')), '| profit:', txt(doc.getElementById('profitVal')));
  const pct = doc.getElementById('periodCompareTable');
  if (pct) pct.querySelectorAll('tr').forEach((tr) => console.log('  CMP:', [...tr.querySelectorAll('th,td')].map((c) => c.textContent.trim()).join(' | ')));
  // ---- jump to October via the period strip chip ----
  const chips = [...doc.querySelectorAll('#periodStrip .period-chip')];
  console.log('== chips:', chips.map((c) => c.textContent.trim()).join(' / '));
  const oct = chips.find((c) => /10月/.test(c.textContent));
  if (oct) {
    oct.click();
    await sleep(1500);
    console.log('== period(Oct):', txt(doc.getElementById('periodCurrentLabel')),
      '| revenue:', txt(doc.getElementById('revenueVal')), '| cost:', txt(doc.getElementById('costVal')), '| profit:', txt(doc.getElementById('profitVal')));
    const nav = txt(doc.getElementById('catNav'));
    console.log('== catNav(Oct):', nav.slice(0, 1200));
    const fm = nav.match(/食費[^¥]{0,24}¥[\d,]+/);
    console.log('== food(Oct):', fm ? fm[0] : 'NOT FOUND in catNav');
  } else console.log('== October chip NOT FOUND');
  // ---- balance groups (for excluded accounts' computed balances) ----
  const bg = txt(doc.getElementById('balanceGroups'));
  console.log('== balanceGroups len:', bg.length);
  for (const name of ['三井住友カード', '楽天カード', 'SBI 証券']) {
    const re = new RegExp(name.replace(/ /g, '\\s?') + '(?!\\s?Olive)(?! 楽天銀行)[^¥]{0,28}−?¥[\\d,]+', 'g');
    console.log('== bal:', name, '->', (bg.match(re) || []).slice(0, 3).join(' ; ') || 'not in balanceGroups');
  }
  // ---- points card ----
  const pc = doc.getElementById('pointsCard');
  console.log('== pointsCard hidden:', pc ? pc.classList.contains('hidden') : 'missing');
  console.log('== pointsMeta:', txt(doc.getElementById('pointsMeta')));
  console.log('== pointsBody:', txt(doc.getElementById('pointsBody')).slice(0, 900));
  console.log('== pointsNote:', txt(doc.getElementById('pointsNote')));
  server.close(); process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
