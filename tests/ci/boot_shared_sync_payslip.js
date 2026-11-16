// 端末間共有（給与シミュレータ）のブートテスト（payslip.html 側）。
// GitHub API をインメモリのフェイクで差し替え、次を確認する：
//   P1: クラウドの payslipSim が空の端末に取り込まれて計算に反映される／編集すると
//       他のキー（manualFixedCosts・externalPoints）を保持したまま書き戻される
//   P2: トークンが暗号化されている場合はロック解除 UI が出て、解除後に同期される
//   P3: パスフレーズを間違えると同期されない
const fs = require('fs'); const path = require('path');
const { JSDOM } = require('jsdom');
const { webcrypto } = require('crypto');
const ROOT = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'payslip.html'), 'utf-8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (cond, label) => { console.log((cond ? '  PASS ' : '  FAIL ') + label); cond ? pass++ : fail++; };
const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const waitFor = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 6000)) { if (fn()) return true; await sleep(100); } return !!fn(); };

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
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };
  return { state, fetch };
}

// index.html の encryptToken と同じ方式（PBKDF2/SHA-256 + AES-GCM）でトークンを暗号化する
async function makeTokenEnc(token, pass) {
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const base = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  const key = await webcrypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const ct = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token)));
  const b64 = (u8) => Buffer.from(u8).toString('base64');
  return { v: 1, iter: 310000, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}

function boot(gh, sync, payslipSeed) {
  const dom = new JSDOM(html, { url: 'https://localhost/payslip.html', runScripts: 'dangerously', beforeParse(w) {
    if (sync) w.localStorage.setItem('zaimLedgerSync', JSON.stringify(sync));
    if (payslipSeed) w.localStorage.setItem('payslipSim.v1', JSON.stringify(payslipSeed));
    w.fetch = gh.fetch;
    try { Object.defineProperty(w, 'crypto', { value: webcrypto }); } catch (e) { /* subtle が使える環境では不要 */ }
  } });
  return dom.window;
}

const CLOUD_AT = '2026-11-16T10:00:00.000Z';
const cloudObj = () => ({ v: 1,
  manualFixedCosts: { m1: { label: '家賃', amount: 85640 } },
  externalPoints: [{ name: 'JRE POINT', balance: 7684, expiring: [], updatedAt: '2026-11-14' }],
  payslipSim: { data: { consts: {}, changes: [], months: { '2026-10': { ot1: '5:48', ot2: '3:20', late: '0:29', absent: '0' } } }, updatedAt: CLOUD_AT } });
const emptySeed = { v: 1, ym: '2026-10', consts: {}, changes: [], months: {} };

(async () => {
  // ===== P1: 平文トークン — 取り込みと書き戻し =====
  const gh1 = makeGitHub(cloudObj());
  const orig = cloudObj();
  const w1 = boot(gh1, { repo: 'o/r', mode: 'plain', token: 't' }, emptySeed);
  const d1 = w1.document;
  ok(await waitFor(() => d1.querySelector('.res').textContent.includes('216,381')), 'P1-1: クラウドの勤怠で10月の手取りが 216,381 になる');
  const s1 = JSON.parse(w1.localStorage.getItem('payslipSim.v1'));
  ok(s1.updatedAt === CLOUD_AT && s1.months['2026-10'].ot1 === '5:48', 'P1-2: 端末の保存にもクラウドの内容とスタンプが入る');
  ok(d1.getElementById('syncState').textContent === '共有中', 'P1-3: 共有状態が表示される');
  const ot1 = d1.getElementById('ot1');
  ot1.value = '6:48'; ot1.dispatchEvent(new w1.Event('input', { bubbles: true }));
  ok(await waitFor(() => gh1.state.puts.length >= 1), 'P1-4: 編集すると保存（PUT）される');
  const put1 = gh1.state.puts[gh1.state.puts.length - 1] || {};
  ok(put1.payslipSim && put1.payslipSim.data.months['2026-10'].ot1 === '6:48', 'P1-5: 編集内容が payslipSim に載る');
  ok(put1.payslipSim && Date.parse(put1.payslipSim.updatedAt) > Date.parse(CLOUD_AT), 'P1-6: updatedAt が進む');
  ok(deepEq(put1.manualFixedCosts, orig.manualFixedCosts) && deepEq(put1.externalPoints, orig.externalPoints), 'P1-7: 他のキー（manualFixedCosts・externalPoints）はそのまま保持される');

  // ===== P2: 暗号化トークン — ロック解除して同期 =====
  const enc = await makeTokenEnc('t', 'pass-1234');
  const gh2 = makeGitHub(cloudObj());
  const w2 = boot(gh2, { repo: 'o/r', mode: 'enc', tokenEnc: enc }, emptySeed);
  const d2 = w2.document;
  await sleep(800);
  ok(d2.getElementById('unlockRow').hidden === false, 'P2-1: ロック中は解除 UI が出る');
  ok(gh2.state.gets === 0, 'P2-2: 解除前は同期しない');
  ok(d2.getElementById('syncState').textContent === '共有：ロック中', 'P2-3: ロック中と表示される');
  d2.getElementById('unlockPass').value = 'pass-1234';
  d2.getElementById('unlockBtn').click();
  ok(await waitFor(() => d2.querySelector('.res').textContent.includes('216,381')), 'P2-4: 解除するとクラウドの内容で計算される');
  ok(d2.getElementById('unlockRow').hidden === true, 'P2-5: 解除 UI が閉じる');

  // ===== P3: パスフレーズ違い =====
  const gh3 = makeGitHub(cloudObj());
  const w3 = boot(gh3, { repo: 'o/r', mode: 'enc', tokenEnc: enc }, emptySeed);
  const d3 = w3.document;
  await sleep(500);
  d3.getElementById('unlockPass').value = 'wrong-pass';
  d3.getElementById('unlockBtn').click();
  await sleep(800);
  ok(d3.getElementById('unlockMsg').textContent === 'パスフレーズが違います', 'P3-1: 間違えると知らされる');
  ok(gh3.state.gets === 0 && d3.getElementById('unlockRow').hidden === false, 'P3-2: 同期されず UI は開いたまま');

  console.log(`\n=== boot_shared_sync_payslip: ${pass} pass, ${fail} fail ===`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
