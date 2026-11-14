// M11 状態注入テスト：settings の型検証の共通化。
// 実 settings を土台に特定フィールドだけ壊れた値へ差し替えて起動し、
//   (a) 壊れた項目が既定値に戻り、バナーで項目名つきで知らされること
//   (b) 正常な settings では修復が起きず、注記も出ないこと
// を検証する（boot_point_expiry_m5 と同じ方式）。
// 使い方: node tests/local/boot_settings_validation_m11.js（ZAIM_CSV / ZAIM_SETTINGS が必要）
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
  const overrideKey = Object.keys(baseSettings.accountBalanceOverride || {})[0];

  // ===== ケースA：複数フィールドが壊れている =====
  {
    const { doc, server, errors } = await boot((s) => {
      s.prepaidAccounts = ['前払費用', 42];                             // 要素の型が違う
      s.balanceExcludedAccounts = '現金';                               // 文字列（従来は Set が1文字ずつに分解）
      if (overrideKey) s.accountBalanceOverride[overrideKey] = 'abc';   // 数値でない残高
      s.categoryBudgets = { '食費': -5000, '交通': 'abc' };             // どちらも不正値
      s.securitiesScrapeInfo = { importedAt: '解釈できない日時' };      // 日時が解釈不能
      s.accountRenames = { '旧口座': 123 };                             // 値が文字列でない
    });
    console.log('== ケースA（壊れた settings） errors:', JSON.stringify(errors.slice(0, 2)));
    ok(errors.length === 0, 'A1: JS エラーなく起動する');
    const banner = doc.getElementById('syncHealthBanner');
    ok(!!banner, 'A2: 同期ヘルスバナーが表示される');
    const text = banner ? banner.textContent : '';
    ok(text.includes('既定値に戻しました'), 'A3: 修復した旨がバナーに出る');
    for (const label of ['前払費用の口座', '残高の対象外口座', '口座残高の上書き', 'カテゴリ予算', '証券の取込情報', '口座名の変更']) {
      ok(text.includes(label), `A4: 項目名「${label}」が注記に含まれる`);
    }
    ok(doc.getElementById('prepaidAccountsInput').value === '前払費用', 'A5: 前払費用の口座は不正な要素だけ落ちて反映される');
    ok(!doc.getElementById('dashboardView').textContent.includes('NaN'), 'A6: 描画に NaN が混入しない（不正な上書き値を落とした）');
    server.close();
  }

  // ===== ケースB：正常な settings は素通り =====
  {
    const { doc, server, errors } = await boot(() => {});
    console.log('== ケースB（正常な settings） errors:', JSON.stringify(errors.slice(0, 2)));
    ok(errors.length === 0, 'B1: JS エラーなく起動する');
    const banner = doc.getElementById('syncHealthBanner');
    ok(!banner || !banner.textContent.includes('既定値に戻しました'), 'B2: 修復の注記は出ない');
    ok(doc.getElementById('prepaidAccountsInput').value === (baseSettings.prepaidAccounts || []).join(', '), 'B3: 前払費用の口座がそのまま反映される');
    server.close();
  }

  console.log(`== 結果: pass ${pass} / fail ${fail} ==`);
  process.exit(fail ? 1 : 0);
})();
