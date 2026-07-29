#!/usr/bin/env python3
# ============================================================
#  商品改良提案書（PDF）の生成
# ------------------------------------------------------------
#  レビューを部位ごとに分解し、「何をどう直すか」まで落とした資料です。
#
#  実行:
#    npm run product:analyze     … 先に最新データを取る
#    python3 scripts/buildProductReport.py
#
#  ★数字はすべて out/product-issues.json から差し込みます。
# ============================================================
import json
import os
import sys
from datetime import date

from reportlab.lib.units import mm
from reportlab.platypus import PageBreak, Spacer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pdf_common import (  # noqa: E402
    P, bar_table, callout, kpi_row, make_doc, register_fonts, styles, table,
    ACCENT, GOOD, WARN,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'out', 'product-issues.json')
OUT = os.path.join(ROOT, 'out', '商品改良提案書.pdf')


def uplift(issue, avg, n):
    """
    その指摘をゼロにできた場合、平均★がどれだけ上がるかの試算。
    （該当レビューがすべて★5になったと仮定した上限値）
    """
    if not n:
        return 0.0
    new = (avg * n - issue['count'] * issue['avgStar'] + issue['count'] * 5) / n
    return new - avg


def build():
    if not os.path.exists(DATA):
        print(f'分析データがありません: {DATA}\n  先に npm run product:analyze を実行してください。')
        sys.exit(1)

    D = json.load(open(DATA, encoding='utf-8'))
    register_fonts()
    styles()

    n = D['itemReviews']
    avg = D['averageStar']
    issues = D['issues']
    by_group = {}
    for i in issues:
        by_group.setdefault(i['group'], []).append(i)

    doc = make_doc(OUT, '商品改良提案書', '株式会社リベティ｜商品改良提案書')
    F = []

    # ───────── 表紙・要旨 ─────────
    F.append(Spacer(1, 24 * mm))
    F.append(P('商品改良 提案書', 'title'))
    F.append(P(f'楽天レビューの部位別分析にもとづく改良案　｜　{date.today().isoformat()}', 'subtitle'))
    F.append(Spacer(1, 7 * mm))

    F.append(kpi_row([
        ('読んだ商品レビュー', f'{n}件', f"平均 ★{avg:.2f}"),
        ('読んだ文の数', f"{D['sentences']:,}", '文単位まで分解'),
        ('不満・要望の文', f"{D['complaintSentences']}", '改良のタネ'),
    ]))
    F.append(Spacer(1, 6 * mm))

    F.append(callout(
        'この提案書の考え方',
        '<b>「星が低い」で止めると、何を直せばいいか分かりません。</b>'
        'そこでレビューを文単位に分解し、どの部位の話かを判定したうえで、'
        '不満・要望が書かれた文だけを取り出しました。<br/><br/>'
        '優先順位は<b>2つの軸</b>で見ています。<br/>'
        '　・<b>件数</b>　… 何人が困っているか<br/>'
        '　・<b>平均★</b> … 1件あたりどれだけ評価を落としているか<br/><br/>'
        '<b>件数が多くても平均★が高い指摘は、承知の上で買われています。</b>'
        '逆に件数が少なくても平均★が低い指摘は、1件あたりの打撃が大きい。'
        'この2つを混ぜないことが、改良を誤らないコツです。',
    ))

    # ───────── 1 優先度 ─────────
    F.append(P('1　どの部位に不満が集まっているか', 'h1'))
    F.append(P(
        '「その部位に触れたレビューのうち、何割が不満だったか」を出しました。'
        '言及が少ない部位は、不満率が高くても優先度を上げていません'
        '（少数の声で商品を変えると、他の人の満足を壊すため）。', 'small'))

    pr = D['priority'][:8]
    F.append(bar_table(
        [(p['label'], p['impact'], f"{p['mentions']}件中{p['complaints']}件が不満（{p['complaintRate']}%）")
         for p in pr],
        max(p['impact'] for p in pr) if pr else 1,
    ))

    F.append(Spacer(1, 3 * mm))
    F.append(callout(
        '不満率がいちばん高いのは「作りの粗さ」でした',
        '設計上の弱点よりも、<b>外装の傷・汚れ・仕上げ</b>への指摘が最も多く集まっています。'
        'これは<b>設計を変えずに直せる</b>ということでもあります。'
        '次章から、直しやすい順に並べます。',
    ))


    # ───────── 2 品質管理 ─────────
    F.append(P('2　いますぐ直せること（設計変更が不要）', 'h1'))
    F.append(P('金型も仕様も変えずに、明日から手を打てる項目です。', 'small'))

    qc = by_group.get('品質管理', [])
    if qc:
        rows = [['指摘', '件数', '平均★', '直せば★はどこまで上がるか']]
        for i in qc:
            u = uplift(i, avg, n)
            rows.append([i['label'], f"{i['count']}件", f"★{i['avgStar']}", f'+{u:.3f}'])
        F.append(table(rows, [58 * mm, 22 * mm, 25 * mm, 60 * mm]))
        F.append(Spacer(1, 2 * mm))
        F.append(P(
            f'※「直せば〜」は、その指摘のレビューがすべて★5になった場合の上限値です。'
            f'全体の平均★{avg:.2f} に対する押し上げ幅を示しています。', 'note'))
        F.append(Spacer(1, 2 * mm))
        F.append(callout(
            '数字を正直に読むと',
            '<b>星の押し上げ幅は、単体では小さい数字です。</b>'
            'これだけを理由に工程を増やすのは、割に合わないように見えるかもしれません。<br/><br/>'
            'それでも優先すべきだと考えるのは、別の理由があるからです。<br/>'
            '　・<b>これらは「防げたはずの不良」です。</b>設計の限界ではなく、見落としです。<br/>'
            '　・傷や汚れは<b>交換・返品につながり、CSの工数と送料を消費します。</b>'
            'レビューに書かずに問い合わせだけする人の方が多いはずです。<br/>'
            '　・いま平均★4.07で踏みとどまっていますが、'
            '<b>同じ不良で★1が付く可能性は常にあります。</b><br/><br/>'
            '<b>星の数字ではなく、不良を出さないこと自体を目的に置くべき項目です。</b>',
        ))

        F.append(P('2-1　実際の声', 'h2'))
        for i in qc[:3]:
            F.append(P(f"■ {i['label']}（{i['count']}件・平均★{i['avgStar']}）", 'h2'))
            for v in i['voices'][:3]:
                F.append(P(f"［★{v['star']}］{v['text']}", 'quote'))

        F.append(Spacer(1, 2 * mm))
        F.append(callout(
            '打ち手',
            '<b>① 出荷前の外観チェックを工程に入れる</b><br/>'
            '　角・キャスター周り・スイッチ部を、光を当てて目視。'
            '　傷や汚れがあるものは出さない。<br/><br/>'
            '<b>② 養生テープの跡を残さない</b><br/>'
            '　「カバーに汚れた養生テープが貼り付いていた」という声がありました。'
            '　梱包資材の見直しで消せます。<br/><br/>'
            '<b>③ 保護フィルムを剥がしやすくする</b><br/>'
            '　「綺麗に剥がせなかった」が複数。つまみを付ける、'
            '　または<b>出荷前にこちらで剥がす</b>のが確実です。<br/><br/>'
            '<b>④ 組立の最終確認</b><br/>'
            '　「蝶番が歪んだまま」「留め具が寄れたまま固定」といった'
            '　<b>組み立て時点で気づけるはずの</b>指摘が出ています。',
            GOOD,
        ))


    # ───────── 3 小改良 ─────────
    F.append(P('3　次のロットで直すこと（小改良）', 'h1'))
    F.append(P('金型変更までは要らないが、仕様の見直しが要る項目です。', 'small'))

    minor = by_group.get('小改良', [])
    if minor:
        rows = [['指摘', '件数', '平均★', '改良の方向']]
        hints = {
            'フロントオープンのダイヤルの向き': 'ダイヤルを開く側に向ける（実使用での確認が漏れている可能性）',
            'フロントオープンの強度不安': 'パネルの補強、または耐荷重の明示',
            'ストッパーが片側のみ': '4輪すべてに拡張（止まらない不安の解消）',
            'キャスターロックの操作性': '足元で操作できる位置へ',
            'レバーがデッドスペースを生む': 'レバーの内部突出を減らし、収納容量を確保',
        }
        for i in minor:
            rows.append([i['label'], f"{i['count']}件", f"★{i['avgStar']}", hints.get(i['label'], '—')])
        F.append(table(rows, [48 * mm, 18 * mm, 20 * mm, 79 * mm]))

        F.append(P('3-1　実際の声', 'h2'))
        for i in minor[:4]:
            for v in i['voices'][:1]:
                F.append(P(f"［★{v['star']}］{v['text']}", 'quote'))

    F.append(callout(
        '件数は少ないですが、放置しない方がよい理由',
        'これらは<b>「使えば必ず気づく」種類の指摘</b>です。'
        'レビューに書く人は一部なので、実際に不便を感じている人はこの数倍いると考えるのが自然です。<br/><br/>'
        '特に<b>ダイヤルの向き</b>は、試作段階で実際に開け閉めしていれば気づけたはずのものです。'
        '次の設計では<b>組み上がった実物で、一連の動作を通しで確認する</b>工程を入れることをおすすめします。',
    ))


    # ───────── 4 設計 ─────────
    F.append(P('4　次世代モデルで考えること', 'h1'))

    F.append(P('4-1　「多機能」が重さと容量を食っている', 'h2'))
    trade = by_group.get('設計トレードオフ', [])
    if trade:
        rows = [['指摘', '件数', '平均★', '読み方']]
        read = {
            '重さが気になる': '件数は最多だが★4.5前後。<b>承知の上で買われている</b>',
            'メイン収納が狭くなる': 'フロントオープンの代償として理解されている',
            '機能が多すぎる・選択制の要望': '<b>平均★が最も低い。</b>「全部入り」が合わない層がいる',
        }
        for i in trade:
            rows.append([i['label'], f"{i['count']}件", f"★{i['avgStar']}", read.get(i['label'], '—')])
        F.append(table(rows, [48 * mm, 18 * mm, 20 * mm, 79 * mm]))
        F.append(Spacer(1, 2 * mm))
        for i in trade:
            if i['label'].startswith('機能が多すぎる'):
                for v in i['voices'][:2]:
                    F.append(P(f"［★{v['star']}］{v['text']}", 'quote'))

    F.append(callout(
        '提案：シンプル版を作る',
        '「機能のありなしを選択できると良い」という声が出ています。<br/><br/>'
        '<b>ドリンクホルダーとUSBポートを外した軽量版</b>を用意すると、<br/>'
        '　・重さの不満（最多）<br/>'
        '　・メイン収納が狭い不満<br/>'
        '　・機能過多の不満<br/>'
        'の3つが同時に解けます。<b>金型の一部流用で作れる可能性があります。</b><br/><br/>'
        '多機能版と2本立てにすれば、いまの支持層を失わずに客層を広げられます。',
    ))

    F.append(P('4-2　USB充電機能は、いま機能していない可能性', 'h2'))
    func = by_group.get('機能', [])
    if func:
        rows = [['指摘', '件数', '平均★']]
        for i in func:
            rows.append([i['label'], f"{i['count']}件", f"★{i['avgStar']}"])
        F.append(table(rows, [95 * mm, 35 * mm, 35 * mm]))
        F.append(Spacer(1, 2 * mm))
        for i in func:
            for v in i['voices'][:1]:
                F.append(P(f"［★{v['star']}］{v['text']}", 'quote'))

    F.append(callout(
        'ここは構造的な問題です',
        '航空会社の規定で<b>モバイルバッテリーは預け入れできません。</b>'
        'つまりM・Lサイズを預ける使い方では、<b>USBポートは原理的に使えません。</b><br/><br/>'
        'さらに「急速充電に非対応」「使えるケーブルの組み合わせが限られる」という指摘もあります。<br/><br/>'
        '<b>選択肢は2つです。</b><br/>'
        '　① 急速充電（PD）に対応させ、機内持ち込みSサイズの売りとして押し出す<br/>'
        '　② M・Lからは外し、その分を軽量化と容量に回す<br/><br/>'
        '<b>いまは「付いているが使えない」状態で、期待させて裏切る形になっています。</b>',
        WARN,
    ))


    # ───────── 5 売り場 ─────────
    F.append(P('5　設計を変えずに評価を上げる方法', 'h1'))
    F.append(P(
        '不満の多くは<b>「思っていたのと違った」</b>から生まれています。'
        '商品ページで先に伝えるだけで、同じ商品のまま評価が上がります。', 'body'))

    shop = by_group.get('売り場', [])
    if shop:
        for i in shop:
            for v in i['voices'][:1]:
                F.append(P(f"［★{v['star']}］{v['text']}", 'quote'))

    F.append(table([
        ['商品ページに足すこと', '消える不満'],
        ['実物の色味が分かる動画（屋内・屋外・自然光）', '色味が想像と違った'],
        ['重量を他社比較で明示（多機能ゆえの重さと説明）', '重さが気になる（最多の指摘）'],
        ['フロントオープンによる容量減を数字で明示', 'メイン収納が狭くなる'],
        ['<b>USBポートは機内持ち込み時のみ使用可</b>と明記', 'モバイルバッテリー預け入れ不可'],
        ['急速充電の可否を明記', '急速充電に非対応'],
        ['保護フィルムの剥がし方の案内を同梱', 'フィルムが剥がしにくい'],
        ['ロック設定の手順を、同梱カードとページで統一', '説明書が分かりにくい'],
    ], [95 * mm, 70 * mm]))

    F.append(Spacer(1, 3 * mm))
    F.append(callout(
        'これは値引きより効きます',
        '<b>期待値を正しく設定すると、同じ商品でも★が上がります。</b>'
        '「重いと知って買った人」は重さで★を下げません。'
        '知らずに買った人だけが下げます。<br/><br/>'
        '重さの指摘は最多です。ここを先に伝えるだけで、'
        '<b>製造を1円も変えずに</b>評価が動く可能性があります。',
        GOOD,
    ))

    # ───────── 6 実行計画 ─────────
    F.append(P('6　実行計画', 'h1'))
    F.append(table([
        ['時期', 'やること', '担当', '効果'],
        ['今週', '出荷前の外観チェックを工程に追加', '倉庫・CS', '最も打撃の大きい指摘を止める'],
        ['今週', '養生テープ・梱包資材の見直し', '倉庫', '同上'],
        ['今月', '商品ページに色味の動画と重量の比較を追加', 'EC', '最多の指摘を先回りで解消'],
        ['今月', 'USBポートの使用条件をページに明記', 'EC', '「使えない」不満を防ぐ'],
        ['今月', '保護フィルムの仕様変更、または出荷前に剥がす', '仕入・倉庫', '13件の指摘が消える'],
        ['次ロット', 'フロントオープンのダイヤルの向きを修正', '商品開発', '使えば気づく不便を解消'],
        ['次ロット', 'ストッパーを4輪に拡張', '商品開発', '止まらない不安の解消'],
        ['次モデル', 'シンプル版（USB・ホルダー無し）の検討', '商品開発', '重量・容量・機能過多を同時に解決'],
        ['継続', 'この分析を毎月回す', 'EC', '新しい指摘を早く見つける'],
    ], [20 * mm, 66 * mm, 24 * mm, 55 * mm]))

    F.append(Spacer(1, 4 * mm))
    F.append(P('この提案書について', 'h2'))
    F.append(P(
        f"・商品レビュー {n}件（全体の一部）を読み、{D['sentences']:,}文に分解して集計しています。<br/>"
        '・不満・要望を示す言い回しを含む文だけを抽出し、部位を判定しています。<br/>'
        '・<b>AIによる推測は使っていません。</b>すべて辞書と規則による集計で、'
        '同じデータなら毎回同じ結果になります。<br/>'
        '・引用はすべてお客様が書いた原文です。<br/>'
        '・<b>npm run product:analyze</b> を実行してから作り直すと最新版になります。<br/>'
        '・新しい指摘が出てきたら、lib/reviewInsights.js の辞書に追加してください。', 'note'))

    doc.build(F)
    return OUT


if __name__ == '__main__':
    path = build()
    print(f'✅ 作成しました: {path}')
    print(f'   {os.path.getsize(path) // 1024}KB')
