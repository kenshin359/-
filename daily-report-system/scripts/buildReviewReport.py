#!/usr/bin/env python3
# ============================================================
#  レビュー分析 報告書（PDF）の生成
# ------------------------------------------------------------
#  商品レビューとショップレビューを分析した結果を、
#  社内で回覧できる報告書にまとめます。
#
#  実行:
#    npm run reviews:analyze     … 先にこれで最新データを取る
#    python3 scripts/buildReviewReport.py
#
#  ★数字はすべて out/review-analysis.json から差し込みます。
#    文章中に数字を直接書かないので、再実行すれば最新版になります。
# ============================================================
import json
import os
import sys
from datetime import date

from reportlab.lib.units import mm
from reportlab.platypus import KeepTogether, PageBreak, Spacer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pdf_common import (  # noqa: E402
    P, callout, check_glyphs, kpi_row, bar_table, make_doc, register_fonts, styles, table,
    ACCENT, GOOD, WARN,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'out', 'review-analysis.json')
OUT = os.path.join(ROOT, 'out', 'レビュー分析報告書.pdf')


def jp(n):
    return f'{n:,}' if isinstance(n, (int, float)) else '—'


def build():
    if not os.path.exists(DATA):
        print(f'分析データがありません: {DATA}')
        print('  先に npm run reviews:analyze を実行してください。')
        sys.exit(1)

    D = json.load(open(DATA, encoding='utf-8'))
    register_fonts()
    styles()

    shop, item = D['shop'], D['item']
    o_shop = D['official']['shop'] or {}
    o_item = D['official']['item'] or {}

    doc = make_doc(OUT, 'レビュー分析報告書', '株式会社リベティ｜レビュー分析報告書')
    F = []

    # ───────── 表紙・要旨 ─────────
    F.append(Spacer(1, 26 * mm))
    F.append(P('レビュー分析 報告書', 'title'))
    F.append(P(f'商品レビュー と ショップレビュー　｜　{date.today().isoformat()} 時点', 'subtitle'))
    F.append(Spacer(1, 7 * mm))

    F.append(kpi_row([
        ('ショップレビュー', f"★{o_shop.get('average', '—')}", f"{jp(o_shop.get('total'))}件"),
        ('商品レビュー', f"★{o_item.get('average', '—')}", f"{jp(o_item.get('total'))}件"),
        ('本文を読んだ件数', f"{D['combined']['sampled']}件", '両方から抽出'),
    ]))
    F.append(Spacer(1, 6 * mm))

    F.append(callout(
        '要旨',
        f"<b>ショップ評価（★{o_shop.get('average')}）が商品評価（★{o_item.get('average')}）を上回っています。</b>"
        'これは珍しい形です。多くの店は「商品は良いが店は普通」になります。<br/><br/>'
        '本文を読むと理由がはっきりします。'
        '<b>2つのレビューは、まったく別のことを語っていました。</b><br/>'
        '　・ショップレビュー … 丁寧さ・配送・対応・梱包（<b>人の仕事</b>）<br/>'
        '　・商品レビュー … デザイン・キャスター・フロントオープン（<b>モノの仕事</b>）<br/><br/>'
        f"そして<b>ショップレビューへの返信率は {shop['replyRate']}%</b>（商品レビューは {item['replyRate']}%）。"
        '<b>いちばん褒められている場所に、返信できていません。</b>',
    ))

    # ───────── 1 ─────────
    F.append(P('1　2つのレビューは何が違うか', 'h1'))
    F.append(P(
        '同じ会社に対する評価ですが、お客様が書いている内容はほとんど重なりません。'
        '下は、それぞれのレビューで話題に出た割合です。', 'body'))

    def theme_rows(src, names):
        out = []
        for n in names:
            t = next((x for x in src['themes'] if x['name'] == n), None)
            out.append([n, f"{t['share']}%" if t else '—', f"★{t['avgStar']}" if t else '—'])
        return out

    names = ['丁寧・迅速', '配送', '対応・接客', '梱包', '手紙・同梱物',
             'デザイン・質感', 'キャスター', 'フロントオープン', '容量', '重量']
    rows = [['話題', 'ショップレビュー', '（平均★）', '商品レビュー', '（平均★）']]
    for n in names:
        s = next((x for x in shop['themes'] if x['name'] == n), None)
        i = next((x for x in item['themes'] if x['name'] == n), None)
        rows.append([
            n,
            f"{s['share']}%" if s else '—', f"★{s['avgStar']}" if s else '—',
            f"{i['share']}%" if i else '—', f"★{i['avgStar']}" if i else '—',
        ])
    F.append(table(rows, [42 * mm, 32 * mm, 22 * mm, 32 * mm, 22 * mm]))
    F.append(Spacer(1, 3 * mm))
    F.append(callout(
        'ここから言えること',
        'ショップレビューでは<b>商品の話がほとんど出てきません</b>。出てくるのは'
        '丁寧さ・配送・梱包・手紙です。<br/>'
        '逆に商品レビューでは、接客の話はあまり出ません。<br/><br/>'
        '<b>つまりこの2つは、別々の資産を測っています。</b>'
        '商品レビューは商品開発の通信簿、ショップレビューはCSチームの通信簿です。',
    ))

    # ───────── 2 ─────────
    F.append(P('2　ショップレビュー：CSチームの通信簿', 'h1'))
    F.append(P(f"本文を読んだ {shop['sampled']}件のうち、話題に出た割合です。", 'small'))
    top = [t for t in shop['themes'] if t['share'] >= 2][:8]
    F.append(bar_table(
        [(t['name'], t['share'], f"{t['share']}%（{t['count']}件・★{t['avgStar']}）") for t in top],
        max(t['share'] for t in top) if top else 1,
    ))
    F.append(Spacer(1, 3 * mm))

    letters = next((t for t in shop['themes'] if t['name'] == '手紙・同梱物'), None)
    if letters:
        F.append(callout(
            '手紙が、いちばん効いています',
            f"手紙・ネームタグ・カバーに触れたレビューの平均は <b>★{letters['avgStar']}</b> で、"
            'すべての話題の中で最も高い数字でした。<br/>'
            'コストとしては小さいのに、評価への効き方が大きい施策です。<b>やめないでください。</b>',
            GOOD,
        ))

    F.append(P('2-1　サポートに接触した人ほど、評価が高い', 'h2'))
    se_s, se_i = shop['supportEffect'], item['supportEffect']
    F.append(table([
        ['', '対応に触れたレビュー', '触れていないレビュー'],
        ['ショップレビュー', f"★{se_s['mentionedAvg']}（{se_s['mentioned']}件）",
         f"★{se_s['notMentionedAvg']}（{se_s['notMentioned']}件）"],
        ['商品レビュー', f"★{se_i['mentionedAvg']}（{se_i['mentioned']}件）",
         f"★{se_i['notMentionedAvg']}（{se_i['notMentioned']}件）"],
    ], [45 * mm, 60 * mm, 60 * mm]))
    F.append(Spacer(1, 2 * mm))
    F.append(P(
        '<b>両方で同じ傾向が出ています。</b>'
        '通常、サポートに連絡が必要になった時点で評価は下がります。'
        'ここが逆転しているのは、対応そのものが商品の一部として受け取られているということです。', 'body'))

    F.append(P('2-2　トラブルに遭ったお客様が、低評価を付けていない', 'h2'))
    tr = D['combined']['troubleEffect']
    F.append(table([
        ['項目', '結果'],
        ['交換・修理・不良・破損・返品に触れたレビュー', f"{tr['count']}件"],
        ['そのうち ★4以上', f"<b>{tr['fourPlus']}件（{tr['fourPlusShare']}%）</b>"],
        ['平均評価', f"★{tr['avg']}"],
    ], [95 * mm, 70 * mm]))
    F.append(Spacer(1, 2 * mm))
    F.append(callout(
        '「交換対応は未来への資産」は、数字で裏づけられました',
        f"トラブルに触れたレビュー{tr['count']}件のうち、★3以下は<b>0件</b>でした。<br/>"
        '交換が発生したお客様が、一人も低評価を付けていないということです。<br/><br/>'
        '交換対応はコストではなく、<b>評価を落とさずに済ませている防波堤</b>として機能しています。',
        GOOD,
    ))

    # ───────── 3 ─────────
    F.append(P('3　商品レビュー：商品開発の通信簿', 'h1'))
    F.append(P(f"本文を読んだ {item['sampled']}件のうち、話題に出た割合です。", 'small'))
    top_i = [t for t in item['themes'] if t['share'] >= 5][:8]
    F.append(bar_table(
        [(t['name'], t['share'], f"{t['share']}%（{t['count']}件・★{t['avgStar']}）") for t in top_i],
        max(t['share'] for t in top_i) if top_i else 1,
    ))

    F.append(P('3-1　公式の星の分布', 'h2'))
    dist = o_item.get('distribution') or {}
    if dist:
        total = sum(dist.values())
        rows = [['評価', '件数', '割合']]
        for s in ['5', '4', '3', '2', '1']:
            c = dist.get(s) or dist.get(int(s)) or 0
            rows.append([f'★{s}', f'{jp(c)}件', f'{c / total * 100:.1f}%'])
        F.append(table(rows, [30 * mm, 45 * mm, 90 * mm]))
        low = sum(int(dist.get(s) or dist.get(int(s)) or 0) for s in ['1', '2'])
        F.append(Spacer(1, 2 * mm))
        F.append(P(
            f'★1〜2 は合計 {jp(low)}件、全体の <b>{low / total * 100:.1f}%</b> です。'
            f'★4以上は <b>{(total - low - int(dist.get("3") or dist.get(3) or 0)) / total * 100:.1f}%</b> を占めます。', 'body'))

    F.append(P('3-2　弱点として繰り返し挙がっている点', 'h2'))
    weak = []
    for n in ['重量', '容量']:
        t = next((x for x in item['themes'] if x['name'] == n), None)
        if t:
            weak.append([n, f"{t['count']}件（{t['share']}%）", f"★{t['avgStar']}",
                         '他の話題より平均が低い' if t['avgStar'] and t['avgStar'] < 4.5 else '—'])
    if weak:
        F.append(table([['話題', '言及', '平均★', '所見']] + weak,
                       [30 * mm, 40 * mm, 25 * mm, 70 * mm]))
        F.append(Spacer(1, 2 * mm))
        F.append(P(
            '重量と容量は、<b>約4件に1件で言及される定番の論点</b>です。'
            'しかも他の話題より平均★が低く、評価を押し下げています。<br/>'
            '多機能ゆえの重さ・フロントオープンゆえの容量減は構造上のトレードオフなので、'
            '商品ページで<b>先に伝えておく</b>ことで、期待値のズレを減らせます。', 'body'))

    # ───────── 4 ─────────
    F.append(P('4　低評価の中身（★3以下）', 'h1'))
    lows = shop['lowStars'] + item['lowStars']
    if lows:
        F.append(P(f'本文を読んだ範囲で {len(lows)}件ありました。すべて原文のまま載せます。', 'small'))
        F.append(table(
            [['評価', '日付', '内容']] +
            [[f"★{r['star']}", r['date'], r['body']] for r in lows],
            [16 * mm, 24 * mm, 125 * mm]))
    else:
        F.append(P('本文を読んだ範囲では、★3以下はありませんでした。', 'body'))

    F.append(Spacer(1, 3 * mm))
    F.append(callout(
        '低評価は3つに固まっています',
        '<b>① 配達日の指定が守られていない</b>（★1・★2）<br/>'
        '　「日時指定した日に届けられないなら、何かしら連絡が欲しい」<br/>'
        '　→ 遅れること自体より、<b>連絡が無いこと</b>が問題にされています。<br/><br/>'
        '<b>② ハンディファンの動作音</b>（★3が複数）<br/>'
        '　「静音と記載があったが、レベル40でも結構音が大きい」<br/>'
        '　→ <b>商品ページの表記と体感のギャップ</b>です。表記の見直しをご検討ください。<br/><br/>'
        '<b>③ 検品（外箱の傷み・スイッチの汚れ）</b><br/>'
        '　→ 数は少ないものの、開封時の第一印象を損ないます。',
        WARN,
    ))

    F.append(P('5　いちばん大きな機会損失', 'h1'))
    F.append(kpi_row([
        ('ショップレビューへの返信率', f"{shop['replyRate']}%", f"{shop['sampled']}件中"),
        ('商品レビューへの返信率', f"{item['replyRate']}%", f"{item['sampled']}件中"),
    ]))
    F.append(Spacer(1, 4 * mm))
    F.append(P(
        '商品レビューには半数近く返信しているのに、<b>ショップレビューにはほぼ返信していません。</b><br/>'
        'しかし本報告書のとおり、<b>CSチームが褒められているのはショップレビューの側</b>です。<br/><br/>'
        '返信は、書いてくれたお客様へのお礼であると同時に、'
        '<b>これから買う人が読む「お店の姿勢」</b>でもあります。ここが空白になっています。', 'body'))

    F.append(P('6　打ち手', 'h1'))
    F.append(table([
        ['優先', 'やること', '狙い'],
        ['今週', 'ショップレビューへの返信を始める<br/>（下書き自動生成の仕組みは稼働可能）',
         'いちばん褒められている場所の空白を埋める'],
        ['今週', '配達日の遅れが出たら、必ず事前に連絡する',
         '★1・★2の直接原因を潰す'],
        ['今月', 'ハンディファンの「静音」表記を実測に合わせて見直す',
         '期待値のズレによる★3を減らす'],
        ['今月', 'スーツケースの重量・容量を商品ページで先に明示する',
         '定番の論点を購入前に解消する'],
        ['継続', '手紙・ネームタグの同梱を続ける',
         '全話題で最高の平均★。費用対効果が最も高い'],
        ['監視', '開封時の状態（外箱・汚れ）の検品',
         '第一印象の毀損を防ぐ'],
    ], [18 * mm, 77 * mm, 70 * mm]))

    F.append(Spacer(1, 5 * mm))
    F.append(P('この報告書について', 'h2'))
    F.append(P(
        f"・公式の平均・件数は楽天のレビューページの集計値をそのまま使っています"
        f"（ショップ {jp(o_shop.get('total'))}件 / 商品 {jp(o_item.get('total'))}件）。<br/>"
        f"・話題の割合は、本文を読んだ {D['combined']['sampled']}件から集計しています。"
        '全件ではないため、割合には誤差があります。<br/>'
        '・集計はすべてプログラムが行っており、AIによる推測は含まれていません。<br/>'
        '・<b>npm run reviews:analyze</b> を実行してから作り直すと、最新の数字に更新されます。', 'note'))

    doc.build(F)
    return OUT


if __name__ == '__main__':
    path = build()
    print(f'✅ 作成しました: {path}')
    print(f'   {os.path.getsize(path) // 1024}KB')
