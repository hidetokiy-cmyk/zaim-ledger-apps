#!/usr/bin/env python3
"""79件回帰：新モデル（サイクル内のカード口座からの全流出＝支出＋振替）で過去の実績引落を再計算し、
実際の決済振替と照合する。窓計算はアプリの cardCycleClosingDateForSettlement と同じ式。
使い方: python3 regress79.py
"""
import csv, json, sys
from datetime import date, timedelta

import os
CSV = os.environ.get('ZAIM_CSV') or sys.exit('ZAIM_CSV を指定してください（tests/README.md 参照）')
SET = os.environ.get('ZAIM_SETTINGS') or sys.exit('ZAIM_SETTINGS を指定してください（tests/README.md 参照）')
TODAY = date(2026, 11, 14)

KNOWN = {
    '三井住友カード': ('eom', 1),
    '三井住友カード Olive': ('eom', 1),
    '楽天カード': ('eom', 1),
    'ビューカード スタンダードJ': (5, 1),
    'イオンカードセレクト': (10, 1),
    'リクルートカード': (15, 1),
}

s = json.load(open(SET, encoding='utf-8'))
meta = s.get('accountMeta') or {}
excluded = set(s.get('balanceExcludedAccounts') or [])
cash_accts = {n for n, m in meta.items() if m.get('cash') or m.get('deposit')} - excluded

def amt(v):
    try: return int(float(str(v).replace(',', '')))
    except Exception: return 0

rows = []
for r in csv.DictReader(open(CSV, encoding='utf-8-sig')):
    d = r['日付'].strip()
    if not d: continue
    y, m, dd = map(int, d.split('-'))
    dt = date(y, m, dd)
    inc, exp, tr, bal = amt(r['収入']), amt(r['支出']), amt(r['振替']), amt(r['残高調整'])
    if inc != 0: typ, a = 'income', inc
    elif exp != 0: typ, a = 'expense', exp
    elif tr > 0: typ, a = 'transfer', tr
    elif bal != 0: typ, a = 'balance', bal
    else: continue
    frm = (r['支払元'] or '').strip(); to = (r['入金先'] or '').strip()
    if frm == '不存在取消' or to == '不存在取消': continue
    rows.append({'date': dt, 'type': typ, 'amount': a, 'from': frm, 'to': to,
                 'store': (r['お店'] or '').strip(), 'item': (r['品目'] or '').strip(), 'memo': (r['メモ'] or '').strip()})

def last_day(y, m):  # m: 1-based
    return (date(y + (m == 12), (m % 12) + 1, 1) - timedelta(days=1)).day

def closing_for_settlement(settle, closing, lag):
    y, m0 = settle.year, settle.month - 1 - lag
    while m0 < 0: m0 += 12; y -= 1
    while m0 > 11: m0 -= 12; y += 1
    if closing == 'eom': return date(y, m0 + 1, last_day(y, m0 + 1))
    return date(y, m0 + 1, min(closing, last_day(y, m0 + 1)))

def js_month_minus1(d, closing='eom'):
    # 修正後のアプリと同じ：窓の開始は前回の締め日そのもの
    y, m0 = d.year, d.month - 2
    while m0 < 0: m0 += 12; y -= 1
    if closing == 'eom': return date(y, m0 + 1, last_day(y, m0 + 1))
    return date(y, m0 + 1, min(closing, last_day(y, m0 + 1)))

total = 0; matched = 0; mismatches = []
per_card = {}
for card, (closing, lag) in KNOWN.items():
    settlements = [r for r in rows if r['type'] in ('transfer', 'balance') and r['to'] == card
                   and r['from'] in cash_accts and r['date'] <= TODAY]
    settlements.sort(key=lambda r: r['date'])
    ok = 0
    for st in settlements:
        end = closing_for_settlement(st['date'], closing, lag)
        start = js_month_minus1(end, closing)
        ssum = sum(r['amount'] for r in rows if r['type'] in ('expense', 'transfer')
                   and r['from'] == card and start < r['date'] <= end)
        total += 1
        if ssum == st['amount']: ok += 1; matched += 1
        else:
            mismatches.append({'card': card, 'settle': str(st['date']), 'actual': st['amount'],
                               'model': ssum, 'diff': ssum - st['amount'], 'window': f'{start}..{end}'})
    per_card[card] = (ok, len(settlements))

print('== per card (match/total):')
for c, (ok, n) in per_card.items(): print(f'  {c}: {ok}/{n}')
print(f'== TOTAL: {matched}/{total}')
print('== mismatches:')
for m in mismatches: print(' ', m)
