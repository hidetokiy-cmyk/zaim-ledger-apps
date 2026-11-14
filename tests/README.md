# 家計元帳 テスト

金額を扱うアプリなので、マージ前に計算の正しさを守る関門としてテストを repo 内に置く（H5）。
テストは2層に分かれる。

## CI で回るもの（tests/ci/）

合成フィクスチャだけで完結するテスト。個人データもネットワークも不要で、
PR と main への push で GitHub Actions（`.github/workflows/test.yml`）が自動実行する。

| ファイル | 内容 |
|---|---|
| `unit_design_tokens.js` | デザイントークン（CSS変数）の定義値と基幹クラスの参照、タップ領域・文字サイズの底上げ（UX再構築 S1/S6） |
| `unit_forecast_h1.js` | H1：資金繰り予測の平均母集団から進行中の会計月を外すこと、完了月不足時のフォールバック |
| `unit_forecast_h2.js` | H2：カード決済の「基礎額」が予測の固定費に計上され、実績集計と一致すること |
| `unit_forecast_h4.js` | H4：資金繰り予測のメモ化（同一入力で実計算が再実行されないこと、入力変更で再計算されること） |
| `unit_salary_model.js` | 給与前提（契約手取り）の初期値・フォールバック、未設定フラグ（M1）、定期券（交通費精算）の検出と補完、予測への反映 |
| `unit_subscriptions_m3.js` | M3：サブスクの代表額（直近3件の中央値）と隔月判定（periodMonths）、予測の固定費への反映 |
| `unit_card_cycle_m4.js` | M4：カード締め日推定の全出金モデル化と、既知ルールの口座名の空白ゆれ吸収 |
| `unit_outlook_m2.js` | M2：90日見通しの前提統一（前払費用の按分を日割り支出から除く、配当を受取月の収入に数える） |
| `unit_contrast_m9.js` | M9：ダークモードの通常テキスト用トークンが両背景で WCAG 4.5:1 以上（ライトは現行達成トークンの回帰ガード） |
| `boot_smoke.js` | jsdom 実起動のスモーク：合成データでアプリが起動し、ヒーロー・状態バー・引落要約が描画されること |
| `fixtures_make.js` | 合成フィクスチャ生成器（上記が共用）。anchor 日を固定すれば決定的 |
| `run_all.js` | 一括実行ランナー（`npm --prefix tests test`） |

### フィクスチャの設計（fixtures_make.js）

- 口座は「現金／テスト銀行／テストカード／テストビューカード／預け金」の合成口座のみ。
- asOf は 2026-11-14 に固定。旧 `unit_forecast_h2` は「最新の sync settings」を読むため、
  検証データが同期のたびに変わって基礎額の平均がずれ、ドリフトで FAIL していた。
  固定フィクスチャ化でこの種のドリフトでは落ちない形になった。
  同様に旧 `unit_salary_model` の「実行日が 2026-11-14 であること」依存も asOf 固定で解消した。
- H2 の期待値（基礎額の平均）の窓は、予測本体（H1 以降）と同じ「完了月の直近 windowSize 件」で
  計算する。旧版は進行中月を含む窓で計算しており、実データでは両窓の合計が偶然一致して
  見えなかった差が、フィクスチャ（決済のない完了月を含む）で表面化したため定義を本体に合わせた。

### ローカルでの実行

```sh
npm --prefix tests ci   # 初回のみ（jsdom のインストール）
npm --prefix tests test
```

## ローカル専用（tests/local/）

実データ（zaim-ledger-settings の settings.json や実 CSV）を読む検証。個人データを
public repo に置けないため CI では回さない。データの場所は環境変数で渡す。

```sh
npm --prefix tests ci   # jsdom が必要（boot 系）
export ZAIM_CSV=/path/to/zaim-full.csv
export ZAIM_SETTINGS=/path/to/settings.json
node tests/local/full_verify.js
node tests/local/boot_home_bands.js
python3 tests/local/regress79.py
```

| ファイル | 内容 | 備考 |
|---|---|---|
| `full_verify.js` | 実データ全体の検算（残高突合・損益・ポイント等） | 決算前の最終確認はこれ |
| `boot_verify.js` | jsdom 実起動の基本描画確認 | |
| `boot_home_bands.js` | ホーム3帯再編（S2）の描画順・統合ヒーロー・引落要約 | |
| `boot_assumptions_pane.js` | 設定モーダル「予測の前提」ペイン（S4）の保存反映 | |
| `boot_external_points.js` | Zaim外ポイント（externalPoints）の表示統合 | |
| `unit_freshness_alerts.js` | 鮮度・警告表示（S5）の状態注入テスト | 実 settings を土台に状態を注入する方式のためローカル専用 |
| `boot_home_dedup_m7.js` | 月次チェック結果の重複排除（M7）：ホームでは表紙の残り作業数のみ、結果は決算タブに一本化 | |
| `boot_point_expiry_m5.js` | ポイント期限（M5）の年表示・失効済み表示・scrapedAt 鮮度監視の状態注入テスト | 同上 |
| `boot_debit_summary_status.js` | H3（引落要約の確定／見込みタグ）の検証 | H3 はマージ済み。実データ依存のため local に置く |
| `regress79.py` | 過去79決済の引落再計算（Python 移植モデル） | 59/79 は Python 移植側の既知問題で、H5 の範囲外（別テーマ） |

### repo に入れていない検証（実額スナップショット）

次の3本は、assert の期待値そのものが実データの金額（実績給与・実際の引落額）で、
public repo に置くと個人の財務データの公開になるため、repo には入れていない。
従来の置き場 `~/workspace/chartcheck/run/` に残置し、ローカルでのみ実行する
（カード名などの商品名はアプリ本体 `index.html` の CARD_KNOWN_CYCLES で公開済みの範囲）。

| ファイル（run/ 側） | 内容 |
|---|---|
| `unit_outlook_fix.js` | 給与推定・カード予定表の実データ絶対値 |
| `boot_outlook_fix.js` | 90日見通し・カード予定表の描画（実額 assert を含む） |
| `boot_salary_model.js` | 給与モデルの描画側確認（実額 assert を含む） |

なお `boot_outlook_fix` / `boot_salary_model` 相当の描画確認では、残高突合の assert が
データ側の既知の突合差異（口座付け替えに伴うもの）で1件落ちることがある。
アプリの不具合ではない。

## ルール

- repo に実データ（実 settings、実 CSV、実名入りの画像など）を置かない。フィクスチャは合成データのみ。
- 新しい検証は、合成フィクスチャで書けるなら `tests/ci/` に置いて CI の関門に加える。
  実データでしか意味がないものは `tests/local/` に置き、この README の表に行を足す。
- `~/workspace/chartcheck/run/` は移行前の置き場として残置してある（そちらの README 参照）。
  今後の正はこの repo の `tests/`。
