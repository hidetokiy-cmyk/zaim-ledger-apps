// CI テスト一括実行：tests/ci/ の検証を順に実行し、1つでも落ちたら exit 1。
// 各テストは合成フィクスチャだけで完結する（実データ・ネットワーク不要）。
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');

const TESTS = [
  'unit_design_tokens.js',
  'unit_forecast_h1.js',
  'unit_forecast_h2.js',
  'unit_salary_model.js',
  'unit_subscriptions_m3.js',
  'unit_card_cycle_m4.js',
  'unit_outlook_m2.js',
  'boot_smoke.js',
];

let failed = 0;
for (const t of TESTS) {
  console.log('\n######## ' + t + ' ########');
  const r = spawnSync(process.execPath, [path.join(__dirname, t)], { stdio: 'inherit' });
  if (r.status !== 0) { failed++; console.log('>> FAILED: ' + t + ' (exit ' + r.status + ')'); }
}
console.log('\n==== CI テスト結果: ' + (TESTS.length - failed) + '/' + TESTS.length + ' ファイル成功 ====');
process.exit(failed ? 1 : 0);
