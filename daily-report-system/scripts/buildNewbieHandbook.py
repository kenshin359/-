#!/usr/bin/env python3
# ============================================================
#  新人スタッフ 研修マニュアル（PDF・週別／レベル別）の生成
# ------------------------------------------------------------
#  入社1週目〜12週目を1ページずつに分け、毎週の目標数字を
#  「店の月間目標からの逆算」で置いています。むずかしい言葉には
#  かならず『かんたんな説明』と『たとえ』を付けます。
#
#  入力: config/newbie-handbook.json（文面はすべてここ）
#  出力: out/新人スタッフ研修マニュアル.pdf
#
#  実行:
#    npm run handbook:newbie
#    python3 scripts/buildNewbieHandbook.py --store=梅田店
# ============================================================
import json
import os
import sys
from datetime import date

from reportlab.lib.units import mm
from reportlab.platypus import KeepTogether, PageBreak, Spacer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import handbook_common as H  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def week_page(F, w):
    """1週ぶん（1ページ）。"""
    F.append(KeepTogether([
        H.P(f'第{w["no"]}週（入社 {w["days"]}）　{w["level"]}', 'h1'),
        H.callout('ひとことで言うと', w['oneline']),
    ]))

    F.append(H.P('1. 今週のゴール', 'h2'))
    F.append(H.bullets(w['goals']))

    F.append(KeepTogether([
        H.P('2. 今週の数字（月間目標から逆算した、今週のぶん）', 'h2'),
        H.table([['何を', 'いくつ', '数え方']] + [[a, b, c] for a, b, c in w['numbers']],
                [H.W * 0.36, 24 * mm, H.W * 0.64 - 24 * mm], align=[1])]))

    F.append(KeepTogether([H.P('3. やること（この順で）', 'h2'), H.numbered(w['todos'])]))

    F.append(H.P('4. できた？（金曜に研修担当が◯×をつける）', 'h2'))
    F.append(H.checkboxes(w['checks'], judge=True))

    F.append(Spacer(1, 1.5 * mm))
    F.append(KeepTogether([H.P('つまずいたら', 'h2'), H.trouble_table(w['trouble'])]))
    F.append(KeepTogether([H.P('むずかしい言葉', 'h2'), H.words_table(w['words'])]))

    F.append(KeepTogether([
        H.P('今週のふりかえり（金曜に本人と研修担当で書く）', 'h2'),
        H.table([['できたこと（数字で）', ''],
                 ['来週やること（1つだけ）', ''],
                 ['研修担当のサイン／日付', '']],
                [40 * mm, H.W - 40 * mm], header=False, zebra=False, row_h=8 * mm)]))
    F.append(PageBreak())


def build(cfg, out):
    H.init()
    meta = cfg['meta']
    doc = H.make_doc(out, meta['title'], f'{meta["company"]}｜{meta["title"]}', meta['company'])
    F = []

    # ───────── 表紙 ─────────
    H.cover(F, meta)
    F.append(H.P('この本の使い方', 'h2'))
    F.append(H.numbered(cfg['howto']))
    F.append(Spacer(1, 3 * mm))
    F.append(KeepTogether([
        H.P('レベルの意味（今どこにいるか）', 'h2'),
        H.table([['レベル', 'どんな状態', 'たとえると', 'いつごろ']]
                + [[a, b, c, d] for a, b, c, d in cfg['levels']],
                [16 * mm, H.W * 0.42, H.W * 0.3, 24 * mm], align=[0, 3])]))
    F.append(PageBreak())

    # ───────── 逆算のページ ─────────
    bc = cfg['backcalc']
    F.append(H.P('いちばん大事な考え方：目標から「逆算」する', 'h1'))
    F.append(H.callout('ひとことで言うと', bc['story']))
    F.append(Spacer(1, 2 * mm))
    F.append(KeepTogether([
        H.P('やってみる（例）', 'h2'),
        H.table([['計算すること', '例', 'かんたんな説明']] + [[a, b, c] for a, b, c in bc['steps']],
                [H.W * 0.34, H.W * 0.22, H.W * 0.44])]))
    F.append(Spacer(1, 2 * mm))
    F.append(H.callout('セッションの本数も同じです', bc['note']))
    F.append(Spacer(1, 3 * mm))
    F.append(KeepTogether([
        H.P('逆算ワークシート（自分の店の数字で書いてみる）', 'h2'),
        H.table([[label, ''] for label in bc['worksheet']],
                [H.W * 0.55, H.W * 0.45], header=False, zebra=True, row_h=9 * mm)]))
    F.append(Spacer(1, 3 * mm))
    F.append(KeepTogether([
        H.P('12週間の地図（全体を1枚で）', 'h2'),
        H.table([['週', 'レベル', 'この週でできるようになること']]
                + [[f'第{w["no"]}週', w['level'], w['oneline']] for w in cfg['weeks']],
                [14 * mm, 20 * mm, H.W - 34 * mm], align=[0, 1])]))
    F.append(PageBreak())

    # ───────── 週ページ ─────────
    for w in cfg['weeks']:
        week_page(F, w)

    # ───────── 巻末 ─────────
    F.append(H.P('巻末①　レベルが上がる条件', 'h1'))
    F.append(H.P('「なんとなく上がる」ではなく、数字で決めます。'
                 '条件に届かないときは、もう1週間おなじところをやります。', 'small'))
    F.append(H.table([['レベル', '上がるための条件（数字）', 'いつ判定する']]
                     + [[a, b, c] for a, b, c in cfg['level_up']],
                     [26 * mm, H.W - 26 * mm - 30 * mm, 30 * mm]))
    F.append(Spacer(1, 4 * mm))
    F.append(H.callout('うまくいかないときの考え方',
                       '条件に届かないのは<b>本人のせいではなく、計画が合っていない</b>と考えます。'
                       '研修担当と責任者で、教える順番・量・期間を組み直してください。'
                       '30日でLv2に届かないときは、<b>計画を作り直す</b>のが決まりです。', H.OK))
    F.append(PageBreak())

    F.append(H.P('巻末②　1週間ふりかえりシート（コピーして使う）', 'h1'))
    F.append(H.P('毎週金曜に、本人と研修担当で5分だけ使います。', 'small'))
    for label in ['今週できたこと（数字で）', 'できなかったこと', 'つまずいた理由',
                  '来週やること（1つだけ）', '研修担当から（良い点1つ・直す点1つ）']:
        F.append(H.P(label, 'h2'))
        F.append(H.write_lines(2))
    F.append(PageBreak())

    F.append(H.P('巻末③　むずかしい言葉の一覧', 'h1'))
    F.append(H.P('この本に出てくる言葉です。分からなくなったらここに戻ってください。', 'small'))
    F.append(H.words_table(cfg['glossary']))
    F.append(Spacer(1, 3 * mm))
    F.append(H.P(f'作成: {date.today():%Y年%m月%d日}　／　管理: {meta["manager"]}さん'
                 f'　／　文面の修正は config/newbie-handbook.json を直して作り直します。', 'note'))

    doc.build(F)


def main():
    cfg_path = H.arg('config', os.path.join(ROOT, 'config', 'newbie-handbook.json'))
    cfg = json.load(open(cfg_path, encoding='utf-8'))
    if H.arg('store'):
        cfg['meta']['company'] = H.arg('store')
    if H.arg('name'):
        cfg['meta']['manager'] = H.arg('name')
    out = H.arg('out', os.path.join(ROOT, 'out', '新人スタッフ研修マニュアル.pdf'))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    build(cfg, out)
    print(f'できました: {out}')
    print(f'  全{len(cfg["weeks"])}週（1週1ページ）＋逆算の説明＋巻末3点'
          f'（レベル条件・ふりかえりシート・言葉の一覧{len(cfg["glossary"])}語）')


if __name__ == '__main__':
    main()
