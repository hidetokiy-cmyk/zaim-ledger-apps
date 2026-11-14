// UX再構築 Stage S1（デザイントークン導入）の検証。
// 前提：S1 は「見た目不変」が条件。次を assert する。
//   1. :root に計画どおりのトークンが定義されている（名前と値）。
//   2. 基幹クラスがトークンを参照している。
//   3.（S1 完了時に検証済み・PR #27）新 CSS の var() を解決すると変更前と完全一致すること、
//      および <style> 外が無変更であること。この2つは S1 一回限りの保証であり、
//      S2 以降は並び・値の変更自体が目的なので、ここでは assert しない。
//   なお --fs-display は S2 のヒーロー統合で計画目標値 clamp(40px, 9vw, 56px) に変更された。
// Usage: node unit_design_tokens.js
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const next = fs.readFileSync(ROOT + '/index.html', 'utf-8');

let pass = 0, fail = 0;
const ok = (cond, label) => { console.log((cond ? '  PASS ' : '  FAIL ') + label); cond ? pass++ : fail++; };

const styleOf = (html) => { const m = html.match(/<style>([\s\S]*?)<\/style>/); return m ? m[1] : ''; };
const cssNext = styleOf(next);
ok(!!cssNext, 'style ブロックを抽出できる');

// --- 1. トークン定義 ---
const EXPECTED = {
  '--fs-display': 'clamp(40px, 9vw, 56px)',
  '--fs-num-lg': '29.5px',
  '--fs-num-md': '20px',
  '--fs-title': '17.5px',
  '--fs-body': '15.5px',
  '--fs-sub': '13.5px',
  '--fs-cap': '12.5px',
  '--sp-1': '4px', '--sp-2': '8px', '--sp-3': '12px', '--sp-4': '16px', '--sp-5': '20px', '--sp-6': '24px',
  '--lh-body': '1.6', '--lh-note': '1.5', '--lh-num': '1.2',
  '--radius-card': '8px', '--radius-chip': '999px',
};
const tokens = {};
for (const m of cssNext.matchAll(/(--(?:fs|sp|lh|radius)-[a-z0-9-]+)\s*:\s*([^;]+);/g)) tokens[m[1]] = m[2].trim();
for (const [name, val] of Object.entries(EXPECTED)) ok(tokens[name] === val, `トークン ${name} = ${val}`);

// --- 2. 基幹クラスの参照 ---
const REFERENCES = [
  ['.cash-note', ['var(--fs-sub)', 'var(--sp-2)', 'var(--lh-note)']],
  ['.section-title', ['var(--fs-title)']],
  ['.summary-value', ['var(--fs-num-lg)']],
  ['.summary-value-row', ['var(--sp-2)']],
  ['.summary-grid', ['var(--sp-5)']],
  ['.panel', ['var(--sp-6)', 'var(--sp-5)']],
  ['.panel-head', ['var(--sp-5)', 'var(--sp-3)']],
  ['.card', ['var(--radius-card)']],
  ['.hero-card', ['var(--sp-6)', 'var(--sp-4)']],
  ['.hero-label', ['var(--fs-cap)']],
  ['.hero-value', ['var(--fs-display)', 'var(--sp-1)']],
  ['.hero-track', ['var(--radius-chip)', 'var(--sp-4)']],
  ['.hero-foot', ['var(--fs-cap)', 'var(--sp-3)']],
  ['.hero-mini', ['var(--sp-3)', 'var(--sp-4)']],
  ['.hero-mini-card', ['var(--sp-4)']],
  ['.hero-mini-sub', ['var(--fs-cap)']],
  ['.hero-spark', ['var(--sp-2)']],
];
const ruleOf = (css, sel) => {
  // 同一セレクタの複数ルール（.card 等）をすべて集める。行頭アンカーで
  // 「.summary-grid-secondary .summary-value」のような複合セレクタの誤検出を防ぐ。
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('^\\s*' + esc + '\\s*\\{[^}]*\\}', 'gm');
  return [...css.matchAll(re)].map((m) => m[0]).join('\n');
};
for (const [sel, refs] of REFERENCES) {
  const rule = ruleOf(cssNext, sel);
  for (const r of refs) ok(rule.includes(r), `${sel} が ${r} を参照`);
}

// --- 3. S1 一回限りの不変保証（var 解決後の CSS 一致／<style> 外の無変更）は PR #27 で
//        検証済み。S2 以降は対象外のため assert しない（ファイル冒頭の注記参照）。

// --- 4. S6（タップ領域と小文字の底上げ）の決着 ---
// 12px は原則廃止：画面 CSS に残るのは支出カレンダー .cal-cell .v（7列グリッドの幅制約による例外）のみ。
const fs12 = [...cssNext.matchAll(/font-size:\s*12px/g)].length;
const calV = (cssNext.match(/\.cal-cell \.v \{ font-size: 12px;/) || []).length;
ok(fs12 === 1 && calV === 1, `font-size:12px の残存は .cal-cell .v の例外1件のみ（実際 ${fs12} 件）`);
ok(!/font-size:\s*10px/.test(cssNext.replace(/\.cal-cell \.v \{ font-size: 10px; \}/, '')), 'font-size:10px はカレンダーの例外以外に無い');
// .sub-meta / .summary-label は「補足・ラベル」として --fs-sub に統一（S1 申し送りの決着）。
for (const sel of ['.sub-meta', '.summary-label']) {
  ok(ruleOf(cssNext, sel).includes('var(--fs-sub)'), `${sel} が var(--fs-sub) を参照（14.5px の決着）`);
}
// モバイルの min-height は 44px に統一（40px / 38px / 36px の底上げは残さない）。
ok(!/min-height:\s*(36|38|40)px/.test(cssNext), 'min-height 36/38/40px の底上げが残っていない');
ok(/\.period-nav-btn, \.btn, \.btn-sidebar \{ min-height: 44px; \}/.test(cssNext), '縦画面の主要ボタンが min-height 44px');
ok(/\.btn, \.btn-sidebar, \.period-nav-btn, \.side-btn \{ min-height: 44px; \}/.test(cssNext), '横画面の主要ボタンが min-height 44px');
// 小さいアイコンボタンは当たり判定だけ 44px に拡張（::after）。
for (const sel of ['.gear-btn::after', '.saved-filter-chip .del::after', '.chart-export-btn::after']) {
  ok(cssNext.includes(sel), `${sel}（当たり判定の拡張）がある`);
}

console.log(`== 結果: pass ${pass} / fail ${fail} ==`);
process.exit(fail ? 1 : 0);
