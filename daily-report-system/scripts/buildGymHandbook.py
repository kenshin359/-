#!/usr/bin/env python3
# ============================================================
#  トレーナー研修ハンドブック（PDF）の生成
# ------------------------------------------------------------
#  SNS研修ハンドブックと同じ体裁で、パーソナルジムの新人研修用に作ります。
#  各章の構成は固定：
#    1.ゴール 2.用語・前提 3.手順 4.必ず守る社内ルール（固定）
#    5.運用の目安（状況で変更可） 6.チェックリスト 7.独り立ち判定
#  描画の部品は scripts/handbook_common.py（新人研修・管理職育成と共通）。
#
#  入力: config/gym-handbook.json（文面はすべてここ）
#  出力: out/トレーナー研修ハンドブック.pdf
#
#  実行:
#    npm run handbook:gym
#    python3 scripts/buildGymHandbook.py --store=梅田店
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


def build(cfg, out):
    H.init()
    meta = cfg['meta']
    doc = H.make_doc(out, meta['title'], f'{meta["company"]}｜{meta["title"]}', meta['company'])
    F = []

    # ───────── 表紙・目次 ─────────
    H.cover(F, meta, cfg['chapters'])
    F.append(Spacer(1, 4 * mm))
    for title, body in cfg['legend']:
        F.append(H.callout(title, body, H.WARN if '固定' in title else H.ACCENT))
        F.append(Spacer(1, 2 * mm))
    F.append(H.P(cfg['legend_note'], 'note'))
    F.append(PageBreak())

    # ───────── 研修スケジュールと1日の流れ ─────────
    F.append(KeepTogether([
        H.P('研修スケジュール（30日でLv2＝ひとりで店に立てる状態へ）', 'h2'),
        H.table([['期間', 'この期間でやること（対応する章）', 'この期間の到達基準']]
                + [[a, b, c] for a, b, c in cfg['schedule']],
                [22 * mm, 78 * mm, H.W - 100 * mm])]))
    F.append(KeepTogether([
        H.P('1日の流れ（どの章がどこで効くか）', 'h2'),
        H.table([['時間帯', 'やること', '章']]
                + [[a, b, c] for a, b, c in cfg['flow']],
                [24 * mm, H.W - 44 * mm, 20 * mm], align=[2])]))
    F.append(Spacer(1, 4 * mm))
    F.append(H.callout('この研修の進め方',
                       '①→⑧の順に進めます。<b>②安全管理だけは初日に必ず終わらせます</b>。'
                       '各章は「手順どおりにやってみる → チェックリストを研修担当が◯×で判定 → '
                       '独り立ち判定3つが全て◯」で先へ進みます。'
                       '分からないまま長時間止まらず、早めに相談してください。'))
    F.append(PageBreak())

    # ───────── 全8章 ─────────
    for c in cfg['chapters']:
        H.chapter(F, c, labels=H.LABELS_STANDARD)

    # ───────── 巻末資料 ─────────
    F.append(H.P('巻末資料①　研修チェック表（本人・研修担当）', 'h1'))
    F.append(H.P('章ごとに、本人が「できる」と思うか／研修担当が◯×で判定したかを記録します。'
                 '独り立ち判定は各章の7を使います。', 'small'))
    F.append(H.table([['章', 'この章のゴール', '本人', '担当', '判定日']]
                     + [[f'{c["no"]} {c["title"]}', c['lead'], '', '', '']
                        for c in cfg['chapters']],
                     [40 * mm, H.W - 40 * mm - 54 * mm, 14 * mm, 14 * mm, 26 * mm],
                     row_h=11 * mm, align=[2, 3]))
    F.append(Spacer(1, 4 * mm))
    F.append(H.callout('独り立ち（Lv2到達）の条件',
                       '全8章のチェックリストが◯で埋まり、②安全管理・⑤トレーニング指導・'
                       '⑧事務・記録の<b>独り立ち判定3つが全て□→◯</b>になったら、'
                       '責任者が単独シフトに入れる判断をします。'
                       '30日で届かない場合は、本人ではなく<b>教育計画を作り直します</b>。', H.OK))
    F.append(PageBreak())

    F.append(H.P('巻末資料②　言い方の型（この言い方はしない／こう言う）', 'h1'))
    F.append(H.P('料金・返金・医療にかかわる言い方は、店の信頼と法律に直結します。'
                 '迷ったら「確認してから答える」が正解です。', 'small'))
    F.append(H.table([['× この言い方はしない', '◯ こう言う']]
                     + [[a, b] for a, b in cfg['phrases']], [H.W / 2, H.W / 2]))

    F.append(H.P('巻末資料③　緊急時の動き（ケガ・体調不良）', 'h1'))
    F.append(H.table([['順', 'やること', 'いつまでに']]
                     + [[a, b, c] for a, b, c in cfg['emergency']],
                     [12 * mm, H.W - 46 * mm, 34 * mm], align=[0]))
    F.append(Spacer(1, 3 * mm))
    F.append(H.callout('迷ったときの原則',
                       '<b>止める・呼ぶ・残す</b>の3つです。セッションを止める、'
                       '迷ったら救急と責任者を呼ぶ、起きたことを文字で残す。'
                       '「大丈夫そうだから報告しない」が一番危険です。', H.WARN))
    F.append(PageBreak())

    F.append(H.P('巻末資料④　まとめテスト（全20問）', 'h1'))
    F.append(H.P('研修の最後に、書いて答えます。8割（16問）以上で合格。'
                 '間違えた章はチェックリストに戻ってやり直します。', 'small'))
    F.append(H.table([['#', '問題', '答え（記入欄）']]
                     + [[str(i), q, ''] for i, (q, _) in enumerate(cfg['test'], 1)],
                     [10 * mm, 88 * mm, H.W - 98 * mm], row_h=10 * mm, align=[0]))
    F.append(PageBreak())

    F.append(H.P('巻末資料⑤　まとめテスト 解答（研修担当用）', 'h1'))
    F.append(H.table([['#', '問題', '解答']]
                     + [[str(i), q, a] for i, (q, a) in enumerate(cfg['test'], 1)],
                     [10 * mm, 72 * mm, H.W - 82 * mm], align=[0]))
    F.append(Spacer(1, 4 * mm))
    F.append(H.P(f'作成: {date.today():%Y年%m月%d日}　／　管理: {meta["manager"]}さん'
                 f'　／　文面の修正は config/gym-handbook.json を直して作り直します。', 'note'))

    doc.build(F)


def main():
    cfg_path = H.arg('config', os.path.join(ROOT, 'config', 'gym-handbook.json'))
    cfg = json.load(open(cfg_path, encoding='utf-8'))
    if H.arg('store'):
        cfg['meta']['company'] = H.arg('store')
    if H.arg('name'):
        cfg['meta']['manager'] = H.arg('name')
    out = H.arg('out', os.path.join(ROOT, 'out', 'トレーナー研修ハンドブック.pdf'))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    build(cfg, out)
    print(f'できました: {out}')
    print(f'  全{len(cfg["chapters"])}章＋巻末資料5点（チェック表・言い方の型・緊急時の動き・'
          f'まとめテスト{len(cfg["test"])}問・解答）')
    print('  文面を直すときは config/gym-handbook.json を編集して作り直してください。')


if __name__ == '__main__':
    main()
