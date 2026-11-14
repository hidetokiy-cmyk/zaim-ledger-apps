// 合成フィクスチャ生成器（CI テスト専用）。
// 個人データは一切含まない。anchor（asOf 日）を固定すれば完全に決定的な内容になり、
// 実際の Zaim CSV と同じ形式のテキストと、settings 相当のオブジェクトを返す。
//
// シナリオ（anchor = 2026-11-14 の場合）:
//   - 会計月 2026-03〜2026-10（進行中は 2026-10）の給与・食費・カード決済・サブスク
//   - 給与 210,000（毎月25日、テスト銀行）
//   - 食費は完了月で月 49,000〜61,000、進行中月は途中分 12,000 のみ（H1 の検証用）
//   - テストカードの決済（銀行→カード振替）: 30,000 / 30,000 / 45,000 / 30,000 / 30,000 / 30,000
//     → サブスク 1,500 を差し引いた残額の中央値 28,500 が「基礎額」になる（H2 の検証用）
//   - サブスク: テストサブスク 1,500/月（テストカード払い、毎月15日）
//   - 定期券: 5月と11月に テストビューカード→預け金 66,970 の振替、
//     11/25 に −66,970 の収入行（メモに「定期券」）= passReimbursementMap の検出対象
// Usage: const { buildFixture } = require('./fixtures_make'); const fx = buildFixture(new Date(2026, 10, 14));
'use strict';

const HEADER = '日付,方法,カテゴリ,カテゴリの内訳,支払元,入金先,品目,メモ,お店,通貨,収入,支出,振替,残高調整,通貨変換前の金額,集計の設定';

function csvField(v) {
  const s = String(v == null ? '' : v);
  return /[",\n ]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvRow(fields) { return fields.map(csvField).join(','); }
function ymd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function meta(flags) {
  return Object.assign({
    cash: false, card: false, deposit: false, investment: false, prepaid: false,
    unpaid: false, financing: false, group: '', dormant: false, principalOnly: false, liquidExcluded: false,
  }, flags);
}

function buildFixture(anchor) {
  const rows = [];
  const push = (date, method, o) => {
    rows.push(csvRow([
      ymd(date), method, o.category || '-', o.subCategory || '-', o.from || '-', o.to || '-',
      o.item || '', o.memo || '', o.store || '-', 'JPY',
      o.income || 0, o.expense || 0, o.transfer || 0, 0, o.amount || 0, '常に集計に含める',
    ]));
  };

  // anchor の月を末尾として 8 か月分（暦月）を生成する
  const months = [];
  for (let i = 7; i >= 0; i--) months.push(new Date(anchor.getFullYear(), anchor.getMonth() - i, 1));

  const EXPENSE_TOTALS = [52000, 58000, 49000, 61000, 55000, 57000, 53000, null]; // 末月は下で個別指定
  const SETTLEMENTS = { 2: 30000, 3: 30000, 4: 45000, 5: 30000, 6: 30000, 7: 30000 }; // months の index -> 決済額（10日）

  months.forEach((m0, i) => {
    const y = m0.getFullYear(), mo = m0.getMonth();
    const last = i === months.length - 1;
    // 給与（25日）
    push(new Date(y, mo, 25), 'income', { category: '給与', to: 'テスト銀行', income: 210000, amount: 210000 });
    // 食費（5日・15日、テスト銀行払い）
    if (last) {
      push(new Date(y, mo, 5), 'payment', { category: '食費', from: 'テスト銀行', expense: 12000, amount: 12000 });
      push(new Date(y, mo, 15), 'payment', { category: '食費', from: 'テスト銀行', expense: 30000, amount: 30000 }); // anchor より後＝未来行（実績集計から除外される）
    } else {
      const total = EXPENSE_TOTALS[i];
      const e1 = Math.round(total * 0.6);
      push(new Date(y, mo, 5), 'payment', { category: '食費', from: 'テスト銀行', expense: e1, amount: e1 });
      push(new Date(y, mo, 15), 'payment', { category: '食費', from: 'テスト銀行', expense: total - e1, amount: total - e1 });
    }
    // カード決済（10日、テスト銀行→テストカード）
    if (SETTLEMENTS[i] != null) {
      push(new Date(y, mo, 10), 'transfer', { from: 'テスト銀行', to: 'テストカード', transfer: SETTLEMENTS[i], amount: SETTLEMENTS[i] });
    }
    // サブスク（15日、テストカード払い）
    if (i >= 1) {
      push(new Date(y, mo, 15), 'payment', { category: '通信費', from: 'テストカード', store: 'テストサブスク', expense: 1500, amount: 1500 });
    }
    // 定期券（5月・11月）: ビュー系カード→預け金 の振替 66,970
    if (mo === 4 || mo === 10) {
      push(new Date(y, mo, mo === 10 ? 8 : 10), 'transfer', { from: 'テストビューカード', to: '預け金', transfer: 66970, amount: 66970 });
    }
    // 定期券の精算（11/25、給与カテゴリの負の収入行。メモの「定期券」で検出される）
    if (mo === 10) {
      push(new Date(y, mo, 25), 'income', { category: '給与', to: '預け金', memo: '定期券（11/10-5/9）', income: -66970, amount: -66970 });
    }
  });

  const settings = {
    prepaidAccounts: [],
    furusatoKeyword: 'ふるさと納税',
    accountMeta: {
      '現金': meta({ cash: true }),
      'テスト銀行': meta({ cash: true, deposit: true }),
      'テストカード': meta({ card: true }),
      'テストビューカード': meta({ card: true }),
      '預け金': meta({ cash: true, deposit: true }),
    },
    balanceExcludedAccounts: [],
    manualFixedCosts: {},
    monthClose: {},
    yearClose: {},
    accountBalanceAsOfDate: ymd(anchor),
    zaimScrapeInfo: null,
    securitiesHistory: [],
  };

  return { csvText: HEADER + '\n' + rows.join('\n') + '\n', settings };
}

module.exports = { buildFixture };
