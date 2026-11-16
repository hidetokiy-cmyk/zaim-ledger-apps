// 端末間共有（給与シミュレータ・給与前提・配当前提）のブートテスト（index.html 側）。
// GitHub API をインメモリのフェイクで差し替え、次を確認する：
//   B: クラウドの envelope が端末（localStorage）へ復元される（給与・配当・給与シミュレータ）
//   C: 給与シミュレータを触っていないブラウザが設定を保存し直しても、クラウドの共有データが消えない
//   D: クラウドに settings.json が無い状態で、端末の旧データ（未スタンプ）が初回同期で移行される
const fs = require('fs'); const path = require('path'); const http = require('http');
const { JSDOM, VirtualConsole } = require('jsdom');
const { buildFixture } = require('./fixtures_make');
const ROOT = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf-8');
const fixture = buildFixture(new Date(2026, 10, 14));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (cond, label) => { console.log((cond ? '  PASS ' : '  FAIL ') + label); cond ? pass++ : fail++; };
const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// settings.json だけを持つインメモリ GitHub（Contents API の sha 必須ルールを再現する）
function makeGitHub(initialObj) {
  const state = { obj: initialObj || null, sha: initialObj ? 'sha0' : null, seq: 0, puts: [], gets: 0 };
  const enc = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64');
  const fetch = async (url, opts) => {
    const u = String(url);
    if (!u.includes('api.github.com')) throw new Error('unexpected fetch: ' + u);
    const method = (opts && opts.method) || 'GET';
    if (u.includes('/contents/settings.json')) {
      if (method === 'GET') {
        state.gets++;
        if (!state.obj) return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
        return { ok: true, status: 200, json: async () => ({ sha: state.sha, content: enc(state.obj) }), text: async () => '' };
      }
      if (method === 'PUT') {
        const body = JSON.parse(opts.body);
        if (state.obj && body.sha !== state.sha) return { ok: false, status: 422, json: async () => ({}), text: async () => '' };
        state.obj = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8'));
        state.sha = 'sha' + (++state.seq);
        state.puts.push(state.obj);
        return { ok: true, status: 200, json: async () => ({ content: { sha: state.sha } }), text: async () => '' };
      }
    }
    if (u.includes('/contents/') && method === 'GET') return { ok: true, status: 200, json: async () => [], text: async () => '' };
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };
  return { state, fetch };
}

async function boot(gh, seeds) {
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
      window.Element.prototype.getBoundingClientRect = function () { const vb = this.getAttribute && this.getAttribute('viewBox'); if (vb) { const p = vb.split(/\s+/).map(Number); return { left: 0, top: 0, width: p[2], height: p[3], right: p[2], bottom: p[3], x: 0, y: 0 }; } return { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0 }; };
      window.fetch = gh.fetch;
      window.localStorage.setItem('zaimLedgerSync', JSON.stringify({ repo: 'o/r', mode: 'plain', token: 'test-token' }));
      window.localStorage.setItem('zaimLedgerCsvCache', JSON.stringify({ fileName: 'zaim-fixture.csv', text: fixture.csvText, savedAt: new Date().toISOString(), sourceDownloadedAt: null }));
      seeds(window.localStorage);
    } });
  const doc = dom.window.document;
  for (let i = 0; i < 40; i++) { await sleep(500); if (doc.getElementById('assetsHeroValue')) break; }
  await sleep(3500);   // 起動時フェッチ＋競合解消＋デバウンス保存まで落ち着かせる
  return { dom, doc, server, errors };
}

(async () => {
  // ===== B: クラウド → 端末への復元 =====
  const CLOUD_AT = '2026-11-16T10:00:00.000Z';
  const cloudPayslip = { data: { consts: {}, changes: [], months: { '2026-10': { ot1: '5:48', ot2: '3:20', late: '0:29', absent: '0' } } }, updatedAt: CLOUD_AT };
  const cloudSalary = { set: true, value: 195000, updatedAt: CLOUD_AT };
  const cloudDividends = { list: [{ name: 'テスト配当', amount: 12000, months: [6, 12] }], updatedAt: CLOUD_AT };
  const cloudExternal = [{ name: 'JRE POINT', balance: 7684, expiring: [], updatedAt: '2026-11-14' }];
  const ghB = makeGitHub({ ...fixture.settings, payslipSim: cloudPayslip, salaryNetAssumption: cloudSalary, dividendAssumptions: cloudDividends, externalPoints: cloudExternal, pendingPointExpiry: { programs: [], scrapedAt: '2026-11-16T00:00:00.000Z' } });
  const OLD = '2026-11-01T00:00:00.000Z';
  const b = await boot(ghB, (ls) => {
    ls.setItem('zaimLedgerSettings', JSON.stringify({ v: 1, obj: fixture.settings, base: null, dirty: false }));
    ls.setItem('zaimLedgerSalaryNet', '180000'); ls.setItem('zaimLedgerSalaryNetAt', OLD);
    ls.setItem('zaimLedgerDividends', '[]'); ls.setItem('zaimLedgerDividendsAt', OLD);
    ls.setItem('payslipSim.v1', JSON.stringify({ v: 1, ym: '2026-10', consts: {}, changes: [], months: {}, updatedAt: OLD }));
  });
  const wB = b.dom.window;
  ok(b.errors.length === 0, 'B0: JS エラーなし' + (b.errors.length ? '（' + b.errors[0] + '）' : ''));
  ok(wB.localStorage.getItem('zaimLedgerSalaryNet') === '195000', 'B1: 給与前提がクラウドの値に復元される');
  ok(wB.localStorage.getItem('zaimLedgerSalaryNetAt') === CLOUD_AT, 'B2: 給与前提のスタンプもクラウド側になる');
  ok(deepEq(JSON.parse(wB.localStorage.getItem('zaimLedgerDividends')), cloudDividends.list), 'B3: 配当前提がクラウドの内容に復元される');
  const pB = JSON.parse(wB.localStorage.getItem('payslipSim.v1'));
  ok(pB.months['2026-10'] && pB.months['2026-10'].ot1 === '5:48' && pB.updatedAt === CLOUD_AT, 'B4: 給与シミュレータのデータがクラウドから端末に入る');
  ok(pB.ym === '2026-10', 'B5: 表示月（端末側の状態）は保持される');
  ok(ghB.state.obj.salaryNetAssumption.value === 195000 && ghB.state.obj.payslipSim.updatedAt === CLOUD_AT, 'B6: 復元後もクラウド側の共有データはそのまま');

  // ===== C: 無関係な設定保存で共有データが消えない =====
  const kw = b.doc.getElementById('furusatoKeywordInput');
  kw.value = 'ふるさと納税（テスト）';
  kw.dispatchEvent(new wB.Event('input', { bubbles: true }));
  await sleep(3000);
  ok(ghB.state.puts.length >= 1, 'C1: 設定の保存（PUT）が発生する');
  ok(ghB.state.puts.every((o) => deepEq(o.payslipSim, cloudPayslip)), 'C2: どの保存でも payslipSim がクラウドの内容のまま保持される');
  ok(ghB.state.puts.every((o) => o.salaryNetAssumption && o.salaryNetAssumption.value === 195000), 'C3: どの保存でも給与前提が保持される');
  ok(ghB.state.puts.every((o) => Array.isArray(o.externalPoints) && o.externalPoints[0] && o.externalPoints[0].balance === 7684), 'C4: externalPoints も保持される');
  const lastPut = ghB.state.puts[ghB.state.puts.length - 1];
  ok(lastPut.furusatoKeyword === 'ふるさと納税（テスト）', 'C5: 保存した変更自体も同じ PUT に載っている');
  b.server.close();

  // ===== D: クラウドが空＋端末に旧データ → 初回同期で移行 =====
  const ghD = makeGitHub(null);
  const d = await boot(ghD, (ls) => {
    ls.setItem('zaimLedgerSettings', JSON.stringify({ v: 1, obj: fixture.settings, base: null, dirty: true }));
    ls.setItem('zaimLedgerSalaryNet', '210000');   // スタンプ無し（旧データ）
    ls.setItem('zaimLedgerDividends', JSON.stringify([{ name: '移行配当', amount: 5000, months: [3] }]));
    ls.setItem('payslipSim.v1', JSON.stringify({ v: 1, ym: '2026-11', consts: {}, changes: [], months: { '2026-11': { ot1: '1:00' } } }));
  });
  const wD = d.dom.window;
  ok(d.errors.length === 0, 'D0: JS エラーなし' + (d.errors.length ? '（' + d.errors[0] + '）' : ''));
  ok(!!ghD.state.obj, 'D1: settings.json が初回保存される');
  const oD = ghD.state.obj || {};
  ok(oD.salaryNetAssumption && oD.salaryNetAssumption.set === true && oD.salaryNetAssumption.value === 210000 && typeof oD.salaryNetAssumption.updatedAt === 'string', 'D2: 給与前提が移行される（スタンプ付き）');
  ok(oD.dividendAssumptions && oD.dividendAssumptions.list.length === 1 && oD.dividendAssumptions.list[0].name === '移行配当', 'D3: 配当前提が移行される');
  ok(oD.payslipSim && oD.payslipSim.data.months['2026-11'].ot1 === '1:00' && typeof oD.payslipSim.updatedAt === 'string', 'D4: 給与シミュレータのデータが移行される（スタンプ付き）');
  ok(typeof wD.localStorage.getItem('zaimLedgerSalaryNetAt') === 'string', 'D5: 端末側にもスタンプが残る');
  d.server.close();

  console.log(`\n=== boot_shared_sync_index: ${pass} pass, ${fail} fail ===`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
