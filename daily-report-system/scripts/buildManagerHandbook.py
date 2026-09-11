#!/usr/bin/env python3
# ============================================================
#  管理職育成マニュアル（PDF）の生成
# ------------------------------------------------------------
#  店長・マネージャーを育てるための教科書です。全8章。
#  各章は7つのパート（ゴール／むずかしい言葉／手順／必ず守ること／
#  目安／チェックリスト／合格の判定）で、研修ハンドブックと同じ形です。
#  むずかしい言葉には必ず『かんたんに言うと』と『たとえると』を付けます。
#
#  入力: config/manager-handbook.json
#  出力: out/管理職育成マニュアル.pdf
#
#  実行:
#    npm run handbook:manager
#    python3 scripts/buildManagerHandbook.py --store=梅田店 --name=高山
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
    # 1章＝見開き2ページなので1ページあたりに余りが出る。
    # その余白を行間と記入欄に回して、読みやすさと書き込みやすさを上げる。
    H.set_room(1.8)
    meta = cfg['meta']
    doc = H.make_doc(out, meta['title'], f'{meta["company"]}｜{meta["title"]}', meta['company'])
    F = []

    # ───────── 表紙・目次 ─────────
    H.cover(F, meta, cfg['chapters'])
    F.append(Spacer(1, 4 * mm))
    for title, body in cfg['legend']:
        F.append(H.callout(title, body, H.WARN if '守る' in title else H.ACCENT))
        F.append(Spacer(1, 2 * mm))
    F.append(H.P(cfg['legend_note'], 'note'))
    F.append(Spacer(1, 3 * mm))
    F.append(H.callout(
        'この本の進め方',
        '1か月に1〜2章ずつ、6か月で1周します。読むだけでは身につかないので、'
        '各章の<b>6.チェックリストを上司が◯×で判定</b>し、'
        '<b>7.合格の判定が3つとも◯</b>になったら次へ進みます。'
        '巻末②の育成計画シートに、毎月ひとつずつ仕事を渡していく計画を書いてください。', H.OK))
    F.append(PageBreak())

    # ───────── 全8章 ─────────
    for c in cfg['chapters']:
        H.chapter(F, c, split=True)

    # ───────── 巻末 ─────────
    F.append(H.P('巻末①　管理職の1か月カレンダー（いつ何をするか）', 'h1'))
    F.append(H.P('「何をやればいいか分からない」をなくすための表です。'
                 'この順でやれば、月末にあわてません。', 'small'))
    F.append(H.table([['いつ', 'やること', 'ポイント']]
                     + [[a, b, c] for a, b, c in cfg['calendar']],
                     [26 * mm, H.W - 26 * mm - 44 * mm, 44 * mm]))
    F.append(Spacer(1, 4 * mm))
    F.append(H.callout('まず1つだけやるなら',
                       '<b>毎日5分、数字を見ること</b>です。'
                       '見ていれば、悪くなったときに小さいうちに気づけます。'
                       '見ていないと、月末に「なぜ足りないのか」が分からなくなります。'))
    F.append(PageBreak())

    F.append(H.P('巻末②　次の管理職を育てる計画（6か月）', 'h1'))
    F.append(H.P('候補者を1人決めて、毎月ひとつずつ自分の仕事を渡します。'
                 '「できたら渡す」ではなく、<b>渡してから育てる</b>のがコツです。', 'small'))
    F.append(H.table([['候補者', '', '開始日', '']],
                     [22 * mm, H.W * 0.4 - 22 * mm, 20 * mm, H.W * 0.6 - 20 * mm],
                     header=False, zebra=False, row_h=9 * mm))
    F.append(Spacer(1, 2 * mm))
    F.append(H.table([['いつ', '渡す仕事', '到達基準（数字）', '判定（◯×・日付）']]
                     + [[a, b, c, d] for a, b, c, d in cfg['succession']],
                     [20 * mm, (H.W - 20 * mm) * 0.34, (H.W - 20 * mm) * 0.40,
                      (H.W - 20 * mm) * 0.26], row_h=12 * mm))
    F.append(Spacer(1, 3 * mm))
    F.append(H.callout('渡すときの約束',
                       '渡した仕事は、<b>やり方ではなく結果を見ます</b>。'
                       '週1回の1on1で進み具合を聞き、つまずいていたら手順を一緒に直します。'
                       'ただし<b>安全・お金・契約の最終判断は渡しません</b>（ここは責任者が持ちます）。',
                       H.WARN))
    F.append(PageBreak())

    F.append(H.P('巻末③　1on1の型（15分の進め方）', 'h1'))
    F.append(H.P('週1回15分。話す割合は「相手8割・自分2割」。'
                 'この表のとおりに進めれば、話すことに困りません。', 'small'))
    F.append(H.table([['時間', 'やること', '質問の例']]
                     + [[a, b, c] for a, b, c in cfg['one_on_one']],
                     [20 * mm, H.W * 0.36, H.W - 20 * mm - H.W * 0.36]))
    F.append(Spacer(1, 4 * mm))
    F.append(KeepTogether([
        H.P('言いにくいことの伝え方（× → ◯）', 'h2'),
        H.P('「事実 → 影響 → お願い」の順で言うと、角が立たずに伝わります。', 'small'),
        H.table([['× この言い方はしない', '◯ こう言う']]
                + [[a, b] for a, b in cfg['phrases']], [H.W / 2, H.W / 2])]))
    F.append(PageBreak())

    F.append(H.P('巻末④　数字の読み方 早見表', 'h1'))
    F.append(H.P('会議で出てくる言葉です。意味と計算式だけ分かれば大丈夫です。', 'small'))
    F.append(H.table([['言葉', 'かんたんに言うと', '計算式・目安']]
                     + [[a, b, c] for a, b, c in cfg['numbers']],
                     [30 * mm, H.W * 0.40, H.W - 30 * mm - H.W * 0.40]))
    F.append(PageBreak())

    F.append(H.P('巻末⑤　理解度テスト（全15問）', 'h1'))
    F.append(H.P('1周し終えたら書いて答えます。12問以上で合格。'
                 '間違えた章はチェックリストに戻ります。', 'small'))
    F.append(H.table([['#', '問題', '答え（記入欄）']]
                     + [[str(i), q, ''] for i, (q, _) in enumerate(cfg['test'], 1)],
                     [10 * mm, H.W * 0.52, H.W - 10 * mm - H.W * 0.52], row_h=11 * mm, align=[0]))
    F.append(PageBreak())

    F.append(H.P('巻末⑥　理解度テスト 解答（上司用）', 'h1'))
    F.append(H.table([['#', '問題', '解答']]
                     + [[str(i), q, a] for i, (q, a) in enumerate(cfg['test'], 1)],
                     [10 * mm, H.W * 0.42, H.W - 10 * mm - H.W * 0.42], align=[0]))
    F.append(Spacer(1, 4 * mm))
    F.append(H.P(f'作成: {date.today():%Y年%m月%d日}　／　管理: {meta["manager"]}さん'
                 f'　／　文面の修正は config/manager-handbook.json を直して作り直します。', 'note'))

    doc.build(F)


def main():
    cfg_path = H.arg('config', os.path.join(ROOT, 'config', 'manager-handbook.json'))
    cfg = json.load(open(cfg_path, encoding='utf-8'))
    if H.arg('store'):
        cfg['meta']['company'] = H.arg('store')
    if H.arg('name'):
        cfg['meta']['manager'] = H.arg('name')
    out = H.arg('out', os.path.join(ROOT, 'out', '管理職育成マニュアル.pdf'))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    build(cfg, out)
    print(f'できました: {out}')
    print(f'  全{len(cfg["chapters"])}章＋巻末6点（1か月カレンダー・6か月育成計画・1on1の型・'
          f'言いにくいことの伝え方・数字の早見表・理解度テスト{len(cfg["test"])}問と解答）')


if __name__ == '__main__':
    main()
