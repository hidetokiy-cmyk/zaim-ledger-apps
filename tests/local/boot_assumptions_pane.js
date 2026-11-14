// S4 統合検証：手入力欄（給与・配当）が設定モーダル「予測の前提」ペインへ移設され、
// 設定ペインからの保存が localStorage と資金繰り予測へ正しく反映されることを確認する（jsdom実起動・実データ）。
// Usage: SETTINGS=/path/settings.json node boot_assumptions_pane.js
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
  let pass = 0, fail = 0;
  const check = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS', name); } else { fail++; console.log('  FAIL', name, extra || ''); } };
  console.log('== errors:', JSON.stringify(errors.slice(0, 3)));
  check('JSエラーなし', errors.length === 0, errors.join(' | '));

  console.log('== 構造：移設先と移設元 ==');
  const navBtn = doc.querySelector('#settingsNav .settings-nav-btn[data-pane="assumptions"]');
  check('設定ナビに「予測の前提」ボタンがある', !!navBtn && navBtn.textContent.includes('予測の前提'));
  const pane = doc.querySelector('.settings-pane[data-pane="assumptions"]');
  check('「予測の前提」ペインがある', !!pane);
  const salInput = doc.getElementById('salaryNetInput');
  check('給与入力欄が設定ペイン内にある', !!pane && !!salInput && pane.contains(salInput));
  const divList = doc.getElementById('forecastDivList');
  check('配当リストが設定ペイン内にある', !!pane && !!divList && pane.contains(divList));
  check('ペインに保存先の明示（この端末のみ）がある', !!pane && txt(pane).includes('保存先：この端末のみ'));
  const fcPanel = doc.getElementById('forecastPanel');
  check('資金繰り予測パネルに給与入力欄はもう無い', !!fcPanel && !fcPanel.querySelector('#salaryNetInput') && !fcPanel.querySelector('#divAddBtn'));
  const editBtn = doc.getElementById('forecastAssumpEditBtn');
  check('資金繰り予測パネルに「前提を設定で変更する」がある', !!editBtn && fcPanel.contains(editBtn));
  check('前提の要約（forecastBasisBox）は資金繰り予測側に残る', !!doc.getElementById('forecastBasisBox') && fcPanel.contains(doc.getElementById('forecastBasisBox')));

  console.log('== 設定ペインから保存（資金繰り予測サブタブを経由しない） ==');
  doc.getElementById('gearBtn').click();
  await sleep(300);
  navBtn.click();
  await sleep(300);
  check('ペインが表示される', !!pane && !pane.classList.contains('hidden'));
  check('給与入力欄に保存済みの初期値 202129 が入る', salInput.value === '202129', salInput.value);
  salInput.value = '210000';
  doc.getElementById('salaryNetSaveBtn').click();
  await sleep(300);
  check('localStorage zaimLedgerSalaryNet = 210000', dom.window.localStorage.getItem('zaimLedgerSalaryNet') === '210000', String(dom.window.localStorage.getItem('zaimLedgerSalaryNet')));
  check('保存メッセージが出る', txt(doc.getElementById('salaryNetMsg')).includes('保存しました'), txt(doc.getElementById('salaryNetMsg')));

  doc.getElementById('divName').value = 'テスト投信';
  doc.getElementById('divAmount').value = '12000';
  doc.getElementById('divMonths').value = '3,9';
  doc.getElementById('divAddBtn').click();
  await sleep(300);
  let divs = [];
  try { divs = JSON.parse(dom.window.localStorage.getItem('zaimLedgerDividends') || '[]'); } catch (e) {}
  check('localStorage zaimLedgerDividends に1件入る', divs.length === 1 && divs[0].name === 'テスト投信' && divs[0].amount === 12000 && JSON.stringify(divs[0].months) === '[3,9]', JSON.stringify(divs));
  check('配当リストに表示される', txt(divList).includes('テスト投信'), txt(divList).slice(0, 200));

  console.log('== 予測への反映 ==');
  doc.getElementById('settingsClose').click();
  await sleep(200);
  doc.querySelector('.tab-btn[data-tab="analysis"]').click();
  await sleep(800);
  doc.querySelector('.substab-btn[data-substab="forecast"]').click();
  await sleep(1500);
  const basis = txt(doc.getElementById('forecastBasisBox'));
  console.log('  forecastBasisBox:', basis.slice(0, 400));
  check('前提欄に「¥210,000（契約手取りの前提・手入力）」', basis.includes('¥210,000（契約手取りの前提・手入力）'), basis.slice(0, 300));

  console.log(`== 結果: pass ${pass} / fail ${fail} ==`);
  server.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
