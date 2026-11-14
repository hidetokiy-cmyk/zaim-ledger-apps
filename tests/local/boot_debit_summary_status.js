// 【配置メモ】この検証は H3（引落要約への確定／見込みタグ）が前提。H3 は未マージ
// （ローカルブランチ fix-h3-debit-summary-status）のため、main では要約タグの
// assert が落ちるのが正常。H3 のマージ後に通常のローカル検証へ戻る。
// H3（欠点修正）の検証：引落要約（renderDebitSummary）の各行に、詳細パネルと同じ
// 締め済み判定（computeCardSchedule の item.closed）に基づくタグが付くこと。
//   - 締め済みの引落行には「締め済み」タグ、未締めの行には「見込み」タグが付く
//   - タグの有無は詳細パネル（cardScheduleBody）の各カード先頭行のタグと一致する
//   - 金額・日付・口座名・合計はタグ以外 main と同一（行テキストからタグ文言を除いて比較可能）
// SNAPSHOT=1 のときは要約の行構造を JSON で標準出力に出す（変更前後の比較用）。
// MOCK_TODAY=YYYY-MM-DD を付けるとページ内の「今日」を固定する（締め日が未来＝見込みの行を踏むため）。
// Usage: node boot_debit_summary_status.js
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
      if (process.env.MOCK_TODAY) {
        const [yy, mm, dd] = process.env.MOCK_TODAY.split('-').map(Number);
        const RealDate = window.Date;
        const fixed = new RealDate(yy, mm - 1, dd, 12, 0, 0).getTime();
        window.Date = class extends RealDate {
          constructor(...args) { super(...(args.length ? args : [fixed])); }
          static now() { return fixed; }
        };
      }
      window.localStorage.setItem('zaimLedgerCsvCache', JSON.stringify({ fileName: 'zaim-full.csv', text: csv, savedAt: new Date().toISOString(), sourceDownloadedAt: null }));
      window.localStorage.setItem('zaimLedgerSettings', JSON.stringify({ v: 1, obj: settingsObj, base: null, dirty: false }));
    } });
  const doc = dom.window.document;
  for (let i = 0; i < 40; i++) { await sleep(500); if (doc.querySelector('#assetsHistoryChart svg')) break; }
  await sleep(1500);

  ok(errors.length === 0, `描画エラーなし (errors=${JSON.stringify(errors.slice(0, 2))})`);

  // 要約の行（合計行と「他N件」行を除く＝カード行）
  const sumBody = doc.getElementById('debitSummaryBody');
  const rows = [...sumBody.querySelectorAll('.pt-row')];
  const cardRows = rows.filter((r) => !r.classList.contains('pt-total') && !/^他 \d+ 件/.test(r.textContent));
  ok(cardRows.length > 0, `要約にカード行がある (${cardRows.length}行)`);

  const snapshot = cardRows.map((r) => {
    const tag = r.querySelector('.bal-tag');
    return { text: r.textContent.replace(/\s+/g, ' ').trim(), tag: tag ? tag.textContent.trim() : null, tagWarn: tag ? tag.classList.contains('bal-tag-warn') : null };
  });
  if (process.env.SNAPSHOT) { console.log('SNAPSHOT ' + JSON.stringify(snapshot)); }

  // 詳細パネルの先頭行（各カードの items[0]）のタグを口座名ごとに拾う
  const detailTags = new Map();
  [...doc.getElementById('cardScheduleBody').querySelectorAll('.sub-row')].forEach((r) => {
    const nameEl = r.querySelector('.sub-name');
    if (!nameEl) return;
    const acct = nameEl.textContent.replace(/締め済み|利用期間の途中/g, '').trim();
    if (!detailTags.has(acct)) detailTags.set(acct, nameEl.querySelector('.bal-tag') ? nameEl.querySelector('.bal-tag').textContent.trim() : null);
  });

  let tagged = 0;
  snapshot.forEach((s) => {
    if (s.tag) tagged++;
    ok(s.tag === '締め済み' || s.tag === '見込み', `要約行にタグ: ${s.text}`);
    // 詳細の「締め済み」と要約の「締め済み」、「利用期間の途中」と要約の「見込み」が対応する
    const acct = Object.keys(Object.fromEntries(detailTags)).find((a) => s.text.includes(a));
    if (acct) {
      const d = detailTags.get(acct);
      ok((d === '締め済み') === (s.tag === '締め済み'), `詳細と要約の判定が一致 (${acct}: 詳細=${d} / 要約=${s.tag})`);
    }
  });
  ok(tagged === snapshot.length, `全カード行にタグが付いている (${tagged}/${snapshot.length})`);
  const totalRow = rows.find((r) => r.classList.contains('pt-total'));
  ok(!!totalRow && !totalRow.querySelector('.bal-tag'), '合計行にはタグを付けない');

  console.log(`== 結果: pass ${pass} / fail ${fail} ==`);
  server.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
