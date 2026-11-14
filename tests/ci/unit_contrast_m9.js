// M9：ダークモードの文字色コントラスト検証。
// ダーク側の通常テキスト用トークンが、本文背景（--paper）とカード背景（--paper-raised）の
// 両方に対して WCAG 4.5:1 以上であることを assert する。
// ライト側は見た目を変えないため、現行で 4.5:1 を満たすトークンの回帰ガードのみ行う
// （--gold と --accent はライトでは従来値のままで対象外。--accent はカード背景では 4.78:1）。
// Usage: node unit_contrast_m9.js
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const html = fs.readFileSync(ROOT + '/index.html', 'utf-8');

let pass = 0, fail = 0;
const ok = (cond, label) => { console.log((cond ? '  PASS ' : '  FAIL ') + label); cond ? pass++ : fail++; };

const styleOf = (h) => { const m = h.match(/<style>([\s\S]*?)<\/style>/); return m ? m[1] : ''; };
const css = styleOf(html);
ok(!!css, 'style ブロックを抽出できる');

function blockVars(selectorRe) {
  const m = css.match(selectorRe);
  const vars = {};
  if (!m) return vars;
  for (const mm of m[1].matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9A-Fa-f]{6})\s*;/g)) vars[mm[1]] = mm[2];
  return vars;
}
const light = blockVars(/:root\s*\{([\s\S]*?)\n  \}/);
const dark = blockVars(/html\[data-theme="dark"\]\s*\{([\s\S]*?)\n  \}/);
ok(Object.keys(light).length > 10, `:root の色変数を抽出できる（${Object.keys(light).length}件）`);
ok(Object.keys(dark).length > 10, `ダークの色変数を抽出できる（${Object.keys(dark).length}件）`);

function lum(hex) {
  const h = hex.replace('#', '');
  const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(parseInt(h.slice(0, 2), 16)) + 0.7152 * f(parseInt(h.slice(2, 4), 16)) + 0.0722 * f(parseInt(h.slice(4, 6), 16));
}
function ratio(fg, bg) {
  let l1 = lum(fg), l2 = lum(bg);
  if (l1 < l2) { const t = l1; l1 = l2; l2 = t; }
  return (l1 + 0.05) / (l2 + 0.05);
}

// ダーク：通常テキスト用トークンは両背景で 4.5:1 以上
for (const name of ['--ink', '--ink-soft', '--ink-faint', '--red', '--green', '--gold', '--accent']) {
  for (const bgName of ['--paper', '--paper-raised']) {
    const r = ratio(dark[name], dark[bgName]);
    ok(r >= 4.5, `ダーク ${name} ${dark[name]} on ${bgName} = ${r.toFixed(2)}:1 (>= 4.5)`);
  }
}
// ダーク：サイドバー上の文字色はサイドバー背景で 4.5:1 以上
for (const name of ['--side-mute', '--sidebar-soft', '--sidebar-ink']) {
  const r = ratio(dark[name], dark['--sidebar']);
  ok(r >= 4.5, `ダーク ${name} ${dark[name]} on --sidebar = ${r.toFixed(2)}:1 (>= 4.5)`);
}
// --red と --red-rgb の同値性（警告帯の地色が文字色とずれないこと）
{
  const hex = dark['--red'];
  const rgb = [0, 2, 4].map((i) => parseInt(hex.slice(1 + i, 3 + i), 16)).join(',');
  const m = css.match(/html\[data-theme="dark"\]\s*\{[\s\S]*?--red-rgb:\s*([0-9,]+);/);
  ok(!!m && m[1].replace(/\s/g, '') === rgb, `ダーク --red-rgb が --red と同値（${m ? m[1] : 'なし'}）`);
}
// ライト：現行で満たしているトークンの回帰ガード
for (const name of ['--ink', '--ink-soft', '--ink-faint', '--red', '--green']) {
  for (const bgName of ['--paper', '--paper-raised']) {
    const r = ratio(light[name], light[bgName]);
    ok(r >= 4.5, `ライト ${name} ${light[name]} on ${bgName} = ${r.toFixed(2)}:1 (>= 4.5)`);
  }
}
for (const name of ['--side-mute', '--sidebar-soft']) {
  const r = ratio(light[name], light['--sidebar']);
  ok(r >= 4.5, `ライト ${name} ${light[name]} on --sidebar = ${r.toFixed(2)}:1 (>= 4.5)`);
}

console.log(`== 結果: pass ${pass} / fail ${fail} ==`);
process.exit(fail ? 1 : 0);
