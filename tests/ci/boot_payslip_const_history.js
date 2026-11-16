// 給与明細シミュレータ（payslip.html）の定数履歴方式のブートテスト（jsdom 実起動・合成データ）。
// 変更点 {from, consts} が「その月以降に適用」されること、旧形式データ（changes 無し）が
// そのまま読めること、10月分の手取りが従来通り 216,381 になることを確認する。
const fs = require('fs'); const path = require('path');
const { JSDOM } = require('jsdom');
const ROOT = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'payslip.html'), 'utf-8');
let pass = 0, fail = 0;
const ok = (c, l) => { console.log((c ? '  PASS ' : '  FAIL ') + l); c ? pass++ : fail++; };

function boot(seed) {
  const dom = new JSDOM(html, { url: 'https://localhost/payslip.html', runScripts: 'dangerously', beforeParse(w) { if (seed != null) w.localStorage.setItem('payslipSim.v1', JSON.stringify(seed)); } });
  return dom.window;
}
const legacy = { v: 1, ym: '2026-10', consts: {}, months: { '2026-10': { ot1: '5:48', ot2: '3:20', late: '0:29', absent: '0' }, '2026-09': { ot1: '4:31', ot2: '0:47', late: '2:20', absent: '0' } } };

let w = boot(legacy), d = w.document;
const res = () => d.querySelector('.res').textContent;
const stored = () => JSON.parse(w.localStorage.getItem('payslipSim.v1'));
ok(d.querySelector('#ymLabel').textContent === '2026年10月', 'opens at 2026-10');
ok(res().includes('216,381'), 'Oct net = 216,381');
ok(d.querySelector('#c_std').value === '240000', 'Oct std field = 240000 (default)');
ok(d.querySelector('#chgMark').textContent === '' && d.querySelector('#delChange').disabled, 'no change point UI at Oct');
d.querySelector('#prev').click();
ok(res().includes('206,860'), 'Sep net = 206,860 (reference)');
const std = d.querySelector('#c_std'); std.value = '134000'; std.dispatchEvent(new w.Event('input', { bubbles: true }));
let s = stored();
ok(Array.isArray(s.changes) && s.changes.length === 1 && s.changes[0].from === '2026-09' && s.changes[0].consts.std === '134000' && Object.keys(s.changes[0].consts).length === 6, 'change point saved at 2026-09 with all 6 keys');
ok(d.querySelector('#chgMark').textContent === 'この月から定数を変更' && !d.querySelector('#delChange').disabled, 'marker + delete enabled at change month');
d.querySelector('#next').click();
ok(d.querySelector('#c_std').value === '134000' && !res().includes('216,381'), 'Oct inherits Sep change point');
std.value = '240000'; std.dispatchEvent(new w.Event('input', { bubbles: true }));
ok(stored().changes.length === 2 && res().includes('216,381'), 'Oct own change point restores 216,381');
d.querySelector('#delChange').click();
ok(stored().changes.length === 1 && d.querySelector('#c_std').value === '134000', 'delete falls back to previous change point');
d.querySelector('#resetConst').click();
ok(stored().changes.length === 0 && res().includes('216,381'), 'reset clears all change points');

w = boot({ v: 1, ym: '2026-09', consts: {}, months: legacy.months, changes: [{ from: 'bad', consts: {} }, null, { from: '2026-09', consts: { std: '134000' } }] });
d = w.document;
ok(d.querySelector('#c_std').value === '134000' && d.querySelector('#c_base').value === '242000', 'corrupt changes ignored, partial change falls back to defaults');

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
