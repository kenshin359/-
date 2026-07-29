#!/usr/bin/env python3
# ============================================================
#  SNS運用ノウハウ ハンドブック（PDF）の生成
# ------------------------------------------------------------
#  担当者の退職に備え、SNS運用の型を紙に残すための資料を作ります。
#
#  実行:
#    python3 scripts/buildSnsHandbook.py
#    python3 scripts/buildSnsHandbook.py --analysis=out/video-analysis.json
#
#  ★動画解析（scripts/analyzeVideos.py）の結果があれば、
#    実測値を差し込みます。無ければ空欄のまま出力します。
# ============================================================
import json
import os
import sys
from datetime import date

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'out', 'SNS運用ハンドブック.pdf')

FONT_REG = '/usr/share/fonts/opentype/ipafont-gothic/ipagp.ttf'
FONT_ALT = '/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf'

INK = colors.HexColor('#1a1a19')
INK2 = colors.HexColor('#52514e')
MUTED = colors.HexColor('#898781')
ACCENT = colors.HexColor('#2a78d6')
WARN = colors.HexColor('#d03b3b')
LINE = colors.HexColor('#d8d7d0')
BAND = colors.HexColor('#f1f1ed')
# ★この環境には日本語の太字フォントが無い（IPAゴシックは Regular のみ）。
#   <b> を書いても見た目が変わらないため、強調は「色」で表現する。
#   印刷しても濃さの差として残るよう、十分に暗い色を選んでいる。
EMPH = '#123c78'


def arg(name, default=None):
    for a in sys.argv[1:]:
        if a.startswith(f'--{name}='):
            return a[len(name) + 3:]
    return default


def register_fonts():
    path = FONT_REG if os.path.exists(FONT_REG) else FONT_ALT
    pdfmetrics.registerFont(TTFont('JP', path))
    pdfmetrics.registerFont(TTFont('JP-B', path))  # IPAにボールドが無いため同じ字形を使う
    return 'JP'


def styles():
    ss = getSampleStyleSheet()
    base = dict(fontName='JP', textColor=INK, leading=15.5)
    return {
        'title': ParagraphStyle('t', **{**base, 'fontSize': 21, 'leading': 28, 'spaceAfter': 4}),
        'subtitle': ParagraphStyle('st', **{**base, 'fontSize': 10.5, 'leading': 16, 'textColor': INK2}),
        'h1': ParagraphStyle('h1', **{**base, 'fontSize': 15, 'leading': 21, 'spaceBefore': 14, 'spaceAfter': 7}),
        'h2': ParagraphStyle('h2', **{**base, 'fontSize': 11.5, 'leading': 17, 'spaceBefore': 10, 'spaceAfter': 4}),
        'body': ParagraphStyle('b', **{**base, 'fontSize': 9.5, 'leading': 15.5, 'spaceAfter': 5, 'alignment': TA_LEFT}),
        'small': ParagraphStyle('s', **{**base, 'fontSize': 8.5, 'leading': 13, 'textColor': INK2}),
        'note': ParagraphStyle('n', **{**base, 'fontSize': 8.5, 'leading': 13, 'textColor': MUTED}),
        'cell': ParagraphStyle('c', **{**base, 'fontSize': 8.8, 'leading': 13.5}),
        'cellh': ParagraphStyle('ch', **{**base, 'fontSize': 8.8, 'leading': 13.5, 'textColor': colors.white}),
    }


S = None


def emph(text):
    """<b>〜</b> を色付きに変換する（日本語の太字フォントが無いため）"""
    return str(text).replace('<b>', f'<font color="{EMPH}">').replace('</b>', '</font>')


def P(text, kind='body'):
    return Paragraph(emph(text), S[kind])


def table(rows, widths, header=True, zebra=True, row_h=None):
    """1行目を見出しとする表"""
    data = []
    for i, row in enumerate(rows):
        data.append([
            Paragraph(emph(c), S['cellh'] if (header and i == 0) else S['cell']) for c in row
        ])
    heights = None
    if row_h:
        # 記入欄は手で書ける高さを確保する（見出し行だけは通常の高さ）
        heights = [None] + [row_h] * (len(data) - 1) if header else [row_h] * len(data)
    t = Table(data, colWidths=widths, rowHeights=heights, repeatRows=1 if header else 0)
    cmds = [
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ('RIGHTPADDING', (0, 0), (-1, -1), 5),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LINEBELOW', (0, 0), (-1, -1), 0.4, LINE),
    ]
    if header:
        cmds += [('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#3d3d3a'))]
    if zebra:
        for i in range(1 if header else 0, len(data)):
            if i % 2 == (1 if header else 0):
                cmds.append(('BACKGROUND', (0, i), (-1, i), colors.HexColor('#fafaf7')))
    t.setStyle(TableStyle(cmds))
    return t


def callout(title, body, color=ACCENT):
    inner = [[Paragraph(f'<font color="{EMPH}">{title}</font>', S['cell'])], [Paragraph(emph(body), S['cell'])]]
    t = Table(inner, colWidths=[165 * mm])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), BAND),
        ('LINEBEFORE', (0, 0), (0, -1), 2.5, color),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (0, 0), 7),
        ('BOTTOMPADDING', (0, -1), (-1, -1), 7),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))
    return t


def checklist(items, cols=1):
    rows = [[f'□　{it}'] for it in items]
    t = Table([[Paragraph(emph(r[0]), S['cell'])] for r in rows], colWidths=[165 * mm])
    t.setStyle(TableStyle([
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LINEBELOW', (0, 0), (-1, -2), 0.3, LINE),
    ]))
    return t


def blanks(n=3, label=''):
    """記入用の空欄"""
    rows = [[Paragraph(label if i == 0 and label else '', S['cell']), Paragraph('', S['cell'])] for i in range(n)]
    t = Table(rows, colWidths=[40 * mm, 125 * mm], rowHeights=[9 * mm] * n)
    t.setStyle(TableStyle([
        ('LINEBELOW', (0, 0), (-1, -1), 0.4, LINE),
        ('VALIGN', (0, 0), (-1, -1), 'BOTTOM'),
        ('LEFTPADDING', (0, 0), (-1, -1), 2),
    ]))
    return t


def load_analysis():
    p = arg('analysis') or os.path.join(ROOT, 'out', 'video-analysis.json')
    if os.path.exists(p):
        try:
            return json.load(open(p, encoding='utf-8'))
        except Exception:
            return None
    return None


def build():
    global S
    register_fonts()
    S = styles()
    A = load_analysis()

    def header_footer(canvas, doc):
        canvas.saveState()
        canvas.setFont('JP', 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(20 * mm, 287 * mm, '株式会社リベティ｜SNS運用ハンドブック')
        canvas.drawRightString(190 * mm, 287 * mm, f'{date.today().isoformat()}')
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.4)
        canvas.line(20 * mm, 285 * mm, 190 * mm, 285 * mm)
        canvas.drawCentredString(105 * mm, 12 * mm, f'— {doc.page} —')
        canvas.restoreState()

    doc = BaseDocTemplate(
        OUT, pagesize=A4,
        leftMargin=20 * mm, rightMargin=20 * mm, topMargin=24 * mm, bottomMargin=20 * mm,
        title='リベティ SNS運用ハンドブック', author='株式会社リベティ',
    )
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f')
    doc.addPageTemplates([PageTemplate(id='p', frames=[frame], onPage=header_footer)])

    F = []

    # ───────── 表紙 ─────────
    F.append(Spacer(1, 40 * mm))
    F.append(P('SNS運用ハンドブック', 'title'))
    F.append(P('株式会社リベティ｜リール・ショート動画の型と引き継ぎ', 'subtitle'))
    F.append(Spacer(1, 8 * mm))
    F.append(callout(
        'この資料の目的',
        'SNS運用の型が担当者一人の頭の中にある状態を解消し、'
        '<b>担当者が代わっても同じ品質で作り続けられるようにする</b>ことです。<br/><br/>'
        '第1部は「調べて分かったこと」、第2部は「担当者から聞き取ること」に分かれています。'
        '<b>第2部が本体です。</b>ここが埋まって初めて引き継ぎが成立します。',
    ))
    F.append(Spacer(1, 6 * mm))

    F.append(P('対象アカウント', 'h2'))
    F.append(table([
        ['アカウント', '想定される役割', '確認が必要なこと'],
        ['@libetee_official', 'ブランド本体。商品と会社の顔', '主目的は認知か販売か'],
        ['@libetee_travel', '旅の切り口。使用シーンで見せる', 'ブランド本体との出し分け基準'],
        ['@gadgetee_official', 'ガジェット系。別ブランドの可能性', '商材の範囲と担当者'],
    ], [46 * mm, 62 * mm, 57 * mm]))
    F.append(Spacer(1, 4 * mm))
    F.append(callout(
        '【要注意】この資料の限界（先に書いておきます）',
        'Instagramは<b>ログインしないと投稿内容を読めない仕組み</b>のため、'
        'この資料の作成時点で実際の投稿を1本も見ることができていません。<br/><br/>'
        'したがって「御社が実際にどう編集しているか」は<b>推測では書きません</b>。'
        '代わりに、<b>動画ファイルさえあれば編集の癖を数値で出せる道具</b>を用意しました（第3部）。'
        'MP4を渡していただければ、カット割り・テロップ位置・尺・色が数字になります。',
        WARN,
    ))

    F.append(PageBreak())

    # ───────── 第1部 ─────────
    F.append(P('第1部　リールの型（調べて分かったこと）', 'h1'))
    F.append(P(
        'ここは一般論です。御社固有の型ではありません。'
        '<b>第2部の聞き取りで、御社の実際の型に上書きしてください。</b>', 'small'))

    F.append(P('1-1　冒頭3秒で勝負が決まる', 'h2'))
    F.append(P(
        'リールは視聴者の約45%が最初の3秒で「見るか離脱するか」を判断するとされ、'
        'この冒頭が全体の成否を大きく左右します。ここで離脱されると視聴完了率が下がり、'
        'アルゴリズムの評価も下がるという二重の損失になります。', 'body'))

    F.append(P('1-2　冒頭の型 7パターン', 'h2'))
    F.append(table([
        ['型', '中身', 'リベティで使える例'],
        ['ショック型', '意外な絵・音でつかむ', 'スーツケースを階段から落とす'],
        ['問いかけ型', '「〜で困ってません？」', '「機内持ち込み、毎回詰め直してない？」'],
        ['ビフォーアフター型', '変化を最初に見せる', '荷物パンパン → 圧縮バッグ後'],
        ['ターゲット指定型', '「〇〇な人へ」', '「出張が多い人だけ見て」'],
        ['数字提示型', '具体的な数字', '「4,000件レビュー★4.54」'],
        ['無音→音爆発型', '静寂からの音', 'キャスター音の静かさ演出'],
        ['カメラ急接近型', '寄りの動き', 'フロントオープンに寄る'],
    ], [30 * mm, 55 * mm, 80 * mm]))

    F.append(P('1-3　テンポの目安', 'h2'))
    F.append(table([
        ['区間', '一般的な目安', '狙い'],
        ['冒頭0〜2秒', '<b>2カット</b>入れる', '動きで指を止める'],
        ['中盤', '<b>3秒に1カット</b>', '飽きさせない'],
        ['テロップ', '常時表示', '音を出さない視聴者に届ける'],
        ['尺', '15〜30秒', '完全視聴率を取りにいく'],
    ], [32 * mm, 45 * mm, 88 * mm]))
    F.append(Spacer(1, 3 * mm))
    F.append(callout(
        '数字は目標ではなく「測る物差し」です',
        'この表の数字に無理に合わせる必要はありません。'
        '大事なのは<b>「伸びた動画」と「伸びなかった動画」で数字がどう違ったか</b>を見ることです。'
        '第3部の道具で自社の動画を測れば、御社にとっての正解が出ます。',
    ))

    F.append(P('1-4　CapCutで押さえる設定項目', 'h2'))
    F.append(P(
        'CapCutは同じ機能でも設定値の組み合わせで見た目が大きく変わります。'
        '引き継ぎで最も抜けやすいのが<b>この数値</b>です。', 'body'))
    F.append(table([
        ['項目', '記録すべきこと', 'なぜ重要か'],
        ['フォント', '書体名／サイズ／太さ', '書体が変わるとブランドが変わって見える'],
        ['文字の縁取り', '色／太さ（ストローク）', '背景に負けないための必須設定'],
        ['文字の影', '有無／濃さ／方向', '可読性と質感を決める'],
        ['文字の位置', '画面下から何%か', 'UIに隠れない位置が決まっている'],
        ['文字の出現', 'アニメーション名／秒数', '「らしさ」が一番出る場所'],
        ['切り替え効果', 'トランジション名', '多用すると安っぽくなる'],
        ['速度', '倍速の使いどころ', '間延び防止'],
        ['BGM', '曲／音量／使用箇所', '著作権の管理対象でもある'],
        ['書き出し', '解像度／fps／ビットレート', '画質が落ちる原因の大半がここ'],
    ], [30 * mm, 60 * mm, 75 * mm]))

    F.append(PageBreak())

    # ───────── 第2部 ─────────
    F.append(P('第2部　引き継ぎ聞き取りシート（本体）', 'h1'))
    F.append(callout(
        '担当者が在籍しているうちに、このページを埋めてください',
        '退職後には二度と手に入らない情報です。'
        '<b>1時間、担当者と画面を一緒に見ながら埋めるのが最も確実です。</b><br/>'
        '空欄のまま退職されると、同じ品質に戻すのに数か月かかります。',
        WARN,
    ))

    F.append(P('2-1　まず確保するもの（物理的な引き継ぎ）', 'h2'))
    F.append(checklist([
        'CapCutのアカウントとパスワード（担当者個人のものになっていないか）',
        'CapCutのプロジェクトファイル（テンプレート・下書きを含む）',
        '使用しているフォントのファイル、または名前の一覧',
        'BGMのリスト（どこから取得したか・商用利用可否を含む）',
        '撮影素材の保管場所（クラウドのURLとアクセス権）',
        'Instagram 3アカウントのログイン情報と2段階認証の移管',
        '外注先・協力者の連絡先',
        '投稿予約に使っているツール（あれば）',
        'ハッシュタグの定型リスト',
        '過去の投稿データ（インサイトの書き出し）',
    ]))
    F.append(Spacer(1, 3 * mm))
    F.append(P(
        '※ <b>アカウントが担当者個人名義になっていないか</b>を最優先で確認してください。'
        '個人名義のまま退職されると、アカウントごと失う可能性があります。', 'small'))

    F.append(PageBreak())
    F.append(P('2-2　編集の設定値（担当者に書いてもらう）', 'h2'))
    F.append(table([
        ['項目', '記入欄'],
        ['よく使うフォント名', ''],
        ['文字サイズ（標準）', ''],
        ['縁取りの色・太さ', ''],
        ['影の設定', ''],
        ['文字の標準位置', ''],
        ['文字の出現アニメーション', ''],
        ['よく使うトランジション', ''],
        ['標準の尺', ''],
        ['書き出し設定', ''],
        ['BGMの入手先', ''],
    ], [55 * mm, 110 * mm], row_h=11 * mm))

    F.append(P('2-3　言葉にしにくい判断（ここが一番価値がある）', 'h2'))
    F.append(P('担当者が「なんとなく」でやっていることを、言葉にしてもらいます。', 'small'))
    F.append(table([
        ['質問', '回答欄'],
        ['伸びる動画と伸びない動画の違いは、<br/>どこで分かりますか', ''],
        ['冒頭の1カット目は、どう決めていますか', ''],
        ['「これはボツ」と判断する基準は', ''],
        ['3アカウントの投稿は、何で振り分けていますか', ''],
        ['絶対にやらないと決めていることは', ''],
        ['過去いちばん伸びた投稿と、その理由', ''],
        ['過去いちばん失敗した投稿と、その理由', ''],
        ['参考にしている他社アカウントは', ''],
        ['撮影で必ず押さえるカットは', ''],
        ['次にやろうと思っていたことは', ''],
    ], [70 * mm, 95 * mm], row_h=14 * mm))

    F.append(PageBreak())

    # ───────── 第3部 ─────────
    F.append(P('第3部　動画を数値化する道具', 'h1'))
    F.append(P(
        '「担当者の頭の中」を、動画ファイルから数字として取り出す道具を用意しました。'
        '記憶や口伝に頼らず、<b>実物から型を復元できます。</b>', 'body'))

    F.append(P('3-1　使い方', 'h2'))
    F.append(table([
        ['手順', '内容'],
        ['1', '過去のリール動画（MP4）を <b>data/videos/</b> に入れる<br/>'
              '※ Instagramの投稿は端末に保存できます。CapCutの書き出しでも可'],
        ['2', '<b>python3 scripts/analyzeVideos.py</b> を実行'],
        ['3', 'out/video-analysis.json に結果が出る'],
        ['4', '<b>python3 scripts/buildSnsHandbook.py</b> でこの資料に実測値が入る'],
    ], [15 * mm, 150 * mm]))

    F.append(P('3-2　出てくる数字と、その読み方', 'h2'))
    F.append(table([
        ['数字', '意味', '見るポイント'],
        ['冒頭2秒のカット数', 'フックの作り込み', '0なら動きが足りない可能性'],
        ['10秒あたりカット数', '全体のテンポ', '伸びた動画と比べる'],
        ['平均カット長', 'リズム', '長すぎると離脱'],
        ['テロップの位置', '上/中央/下のどこか', '下すぎるとUIに隠れる'],
        ['よく使う色', 'ブランドカラーの実態', '3アカウントで違うか'],
        ['無音区間', 'タメの作り方', '意図的な無音は強い演出'],
        ['音量(LUFS)', 'BGMの張り方', 'ばらつくと視聴体験が悪化'],
        ['尺', '完全視聴率に直結', '伸びた動画の尺に寄せる'],
    ], [38 * mm, 52 * mm, 75 * mm]))

    # 実測値があれば差し込む
    F.append(P('3-3　実測値', 'h2'))
    if A and A.get('summary', {}).get('videos'):
        s = A['summary']
        F.append(P(f"解析した動画: <b>{s['videos']}本</b>", 'body'))
        zone = '／'.join(f'{k}:{v}本' for k, v in (s.get('telop_zone') or []))
        F.append(table([
            ['項目', '実測値'],
            ['平均の尺', f"{s.get('avg_duration_sec')} 秒"],
            ['平均カット数', f"{s.get('avg_cuts')} カット"],
            ['10秒あたりカット数', f"{s.get('avg_cuts_per_10sec')} カット"],
            ['<b>冒頭2秒のカット数</b>', f"<b>{s.get('avg_cuts_in_first_2sec')} カット</b>"],
            ['平均カット長', f"{s.get('avg_cut_len_sec')} 秒"],
            ['縦動画の割合', f"{s.get('vertical_ratio')} %"],
            ['テロップの位置', zone or '—'],
        ], [55 * mm, 110 * mm]))
    else:
        F.append(callout(
            'まだ動画を解析していません',
            'data/videos/ にMP4を入れて <b>python3 scripts/analyzeVideos.py</b> を実行し、'
            'この資料を作り直すと、ここに御社の実測値が入ります。<br/><br/>'
            '<b>10本ほどあれば傾向が見えます。</b>'
            'できれば「伸びた動画5本」と「伸びなかった動画5本」を分けて入れてください。'
            '違いが数字で出ます。',
        ))

    F.append(PageBreak())

    # ───────── 第4部 ─────────
    F.append(P('第4部　投稿前チェックリスト', 'h1'))
    F.append(P('新しい担当者が、これを見れば最低限の品質を保てるようにするものです。', 'small'))

    F.append(P('4-1　編集', 'h2'))
    F.append(checklist([
        '縦型（9:16）で書き出したか',
        '冒頭2秒に動きがあるか（カットまたはズーム）',
        '音を消しても内容が分かるか（テロップだけで伝わるか）',
        'テロップが画面下のUIに隠れていないか',
        'フォント・縁取りが他の投稿と揃っているか',
        '尺は15〜30秒に収まっているか',
        'BGMは商用利用が許可されたものか',
    ]))

    F.append(P('4-2　内容（リベティ固有）', 'h2'))
    F.append(checklist([
        '価格や仕様に間違いがないか',
        '「永久保証」に触れる場合、<b>部品代は無償／送料はお客様負担</b>と正しく言えているか',
        '在庫がある商品か（欠品中の商品を出していないか）',
        '安全に関わる表現（発熱・電池など）に問題がないか',
        '景表法上、言い切りすぎていないか（「必ず」「絶対」）',
    ]))
    F.append(Spacer(1, 3 * mm))
    F.append(callout(
        '在庫と投稿は必ず突き合わせてください',
        '欠品中の商品でバズると、機会損失が最大化します。'
        '販売ダッシュボードの「在庫切れの疑い」を投稿前に見る運用をおすすめします。',
    ))

    F.append(P('4-3　投稿後に記録すること', 'h2'))
    F.append(P('これを続けると、3か月後には自社の勝ちパターンが数字で分かります。', 'small'))
    F.append(table([
        ['記録項目', '意味'],
        ['投稿日時', '時間帯の当たりを見つける'],
        ['冒頭の型（7パターンのどれか）', '型ごとの勝率が出る'],
        ['再生数／視聴維持率', '基本指標'],
        ['保存数', '<b>最重要。</b>保存はアルゴリズム評価が高い'],
        ['プロフィール遷移数', '購買につながる指標'],
        ['商品の売上（翌日〜3日）', 'SNSが売上に効いたかの確認'],
    ], [60 * mm, 105 * mm]))

    F.append(Spacer(1, 5 * mm))
    F.append(callout(
        'この資料の更新のしかた',
        'この資料は <b>scripts/buildSnsHandbook.py</b> から自動生成されています。'
        '内容を直すときはPDFではなくスクリプトを編集し、作り直してください。'
        '動画を解析し直せば、第3部の実測値も自動で更新されます。',
    ))

    F.append(Spacer(1, 4 * mm))
    F.append(P('出典（第1部の一般論の根拠）', 'h2'))
    F.append(P(
        '・株式会社オアソビ「Instagramリールの視聴維持率を60％超えさせる冒頭1秒の構成テンプレート10選」<br/>'
        '・tatap「Instagramリール徹底攻略｜アルゴリズムと勝ちパターンの全貌」<br/>'
        '・ここ知り動画「CapCutでテロップを入れる方法｜自動字幕・フォント設定」<br/>'
        '・CapCut公式 テンプレート／機能ページ', 'note'))

    doc.build(F)
    return OUT


if __name__ == '__main__':
    path = build()
    print(f'✅ 作成しました: {path}')
    print(f'   {os.path.getsize(path) // 1024}KB')
