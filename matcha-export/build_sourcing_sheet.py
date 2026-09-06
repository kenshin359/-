# -*- coding: utf-8 -*-
"""抹茶輸出：業者選定ワークシート生成スクリプト

仕入先（日本）とバイヤー（輸出先）の選定・比較・採算試算を1冊にまとめる。
相場値は2026年新茶シーズンの公開情報レンジをプリセットしている。
実数値は必ずRFQ（見積依頼）で各社から取得して上書きすること。
"""
import os
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "抹茶輸出_業者選定シート.xlsx")

NAVY = "1F3864"
GREEN = "2E7D32"
GREY = "F2F2F2"
YELLOW = "FFF2CC"
ORANGE = "FCE4D6"

H = Font(bold=True, color="FFFFFF", size=11)
HFILL = PatternFill("solid", fgColor=NAVY)
SUB = Font(bold=True, size=11, color=NAVY)
NOTE = Font(size=9, italic=True, color="666666")
INPUT_FILL = PatternFill("solid", fgColor=YELLOW)
CALC_FILL = PatternFill("solid", fgColor=ORANGE)
THIN = Side(style="thin", color="BFBFBF")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)


def header(ws, row, labels, widths=None):
    for i, lab in enumerate(labels, start=1):
        c = ws.cell(row=row, column=i, value=lab)
        c.font = H
        c.fill = HFILL
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border = BOX
    if widths:
        for i, w in enumerate(widths, start=1):
            ws.column_dimensions[get_column_letter(i)].width = w
    ws.row_dimensions[row].height = 32


def title(ws, text, note=None, span=8):
    ws["A1"] = text
    ws["A1"].font = Font(bold=True, size=14, color=NAVY)
    if note:
        ws["A2"] = note
        ws["A2"].font = NOTE
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=span)
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=span)


def body(ws, start_row, rows, fills=None):
    for r, data in enumerate(rows, start=start_row):
        for i, v in enumerate(data, start=1):
            c = ws.cell(row=r, column=i, value=v)
            c.border = BOX
            c.alignment = Alignment(vertical="top", wrap_text=True)
            if fills and i in fills:
                c.fill = fills[i]
    return start_row + len(rows)


wb = Workbook()

# =====================================================================
# 0. 使い方 / 前提
# =====================================================================
ws = wb.active
ws.title = "0_使い方と前提"
title(ws, "抹茶 輸出事業：業者選定ワークシート",
      "黄色セル＝あなたが入力する欄／オレンジ＝自動計算。相場値は2026年新茶シーズンの公開情報レンジ。契約前に必ず実見積で上書きすること。", span=6)

ws["A4"] = "シート構成"
ws["A4"].font = SUB
header(ws, 5, ["シート", "目的", "先にやること"], [22, 52, 52])
body(ws, 6, [
    ("1_選定基準", "仕入先を7軸でスコアリングし、感覚でなく点数で絞る", "重みを自社方針に合わせて調整"),
    ("2_仕入先候補", "日本側の候補を類型別に整理。MOQ・価格をRFQで埋める", "候補を10社リストアップ→RFQ送付"),
    ("3_RFQテンプレ", "見積依頼メールの雛形（日本語／英語）。ここを送れば比較可能な回答が返る", "コピペして送付"),
    ("4_相場レンジ2026", "碾茶・抹茶の価格相場と2026年の市況（判断の物差し）", "見積が高いか安いか照合"),
    ("5_バイヤー候補", "輸出先バイヤーの類型別 必要量・単価・年間金額", "自社が狙う型を1つ決める"),
    ("6_採算シミュ", "仕入→FOB→CIF→卸 の粗利計算。数量ケース別", "仕入単価を入れて成立性を確認"),
], fills={1: PatternFill("solid", fgColor=GREY)})

ws["A14"] = "進め方の順番（推奨）"
ws["A14"].font = SUB
steps = [
    "① 狙う市場を1つ決める（推奨：ドイツ＝有機B2Bが厚い／中国はプレミアム小売のみ）",
    "② 狙うバイヤー類型を1つ決める（シート5）→ 必要量とグレードが確定する",
    "③ その条件で日本側の仕入先に一斉RFQ（シート3）→ 10社に送って5社返ってくる想定",
    "④ 回答をシート2に転記 → シート1でスコアリング → 上位3社にサンプル発注",
    "⑤ サンプルを残留農薬分析（EU向けは必須）→ 通ったロットの供給業者だけが候補",
    "⑥ シート6で採算検証 → 成立する1社と初回契約",
]
r = 15
for s in steps:
    ws.cell(row=r, column=1, value=s).alignment = Alignment(wrap_text=True)
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=3)
    ws.row_dimensions[r].height = 18
    r += 1

ws["A23"] = "最重要の注意"
ws["A23"].font = Font(bold=True, size=11, color="C00000")
warn = [
    "・2026年産の碾茶は前年比で大幅高（鹿児島の一番碾茶 平均 6,013円/kg → 13,910円/kg）。昨年の価格感覚で事業計画を作ると必ず赤字になる。",
    "・EU向けは残留農薬（MRL）が最大の関門。抹茶は葉を丸ごと摂取するため浸出液検査の茶より厳しく出る。「EU向け対応茶園ロット」を指名で買うこと。",
    "・中国向けはGACC（海外製造企業）登録＋産地/放射性物質証明の運用が品目・時期で変動。JETROと現地輸入者の二重確認が必須。",
    "・MOQは「量」だけでなく「支払条件（前払い比率）」「同一ロット継続供給の可否」までセットで確認する。ここを詰めないと2回目が買えない。",
]
r = 24
for s in warn:
    ws.cell(row=r, column=1, value=s).alignment = Alignment(wrap_text=True)
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=3)
    ws.row_dimensions[r].height = 30
    r += 1

# =====================================================================
# 1. 選定基準
# =====================================================================
ws = wb.create_sheet("1_選定基準")
title(ws, "仕入先 選定基準スコアシート",
      "各社を1〜5点で採点。重み×点数の合計で比較する。重み(C列)は自社方針に合わせて変更可（合計100）。", span=9)

header(ws, 4, ["#", "評価軸", "重み", "何を見るか（5点の状態）", "A社", "B社", "C社", "D社", "E社"],
       [4, 20, 7, 46, 9, 9, 9, 9, 9])

criteria = [
    (1, "輸出実績・書類対応", 25, "COA(成分分析表)・残留農薬分析証明・原産地証明・有機/ハラル証明を自社で出せる。輸出通関の経験が複数国ある。ここが弱い先は候補から外す。"),
    (2, "供給の継続性", 20, "同一グレード・同一品質を12ヶ月以上、契約数量で押さえられる。2026年の品薄下で「来年も同じ味を出せるか」が最大の差。"),
    (3, "MOQ・ロット柔軟性", 15, "初回は5〜10kgのテストを受け、成長に応じて段階的に増やせる。いきなり100kg以上を要求されない。"),
    (4, "価格と価格改定ルール", 15, "kg単価が相場レンジ内。かつ改定のタイミングと根拠（新茶入札結果連動など）が事前に開示される。"),
    (5, "品質の再現性", 10, "色(a値)・粒度(D50)・水分・旨味の規格値を数値で提示できる。ロット間のブレを数値で管理している。"),
    (6, "産地・ストーリー", 10, "単一産地/単一農園の指定が可能。産地名を対外的に使う許諾が得られる（欧州の販促で効く）。"),
    (7, "対応速度・言語", 5, "英語または現地語で48時間以内に返信。サンプルが2週間以内に届く。"),
]
r = 5
for c in criteria:
    ws.cell(row=r, column=1, value=c[0]).border = BOX
    ws.cell(row=r, column=2, value=c[1]).border = BOX
    wc = ws.cell(row=r, column=3, value=c[2])
    wc.border = BOX
    wc.fill = INPUT_FILL
    ws.cell(row=r, column=4, value=c[3]).alignment = Alignment(wrap_text=True, vertical="top")
    ws.cell(row=r, column=4).border = BOX
    for col in range(5, 10):
        cell = ws.cell(row=r, column=col)
        cell.border = BOX
        cell.fill = INPUT_FILL
        cell.alignment = Alignment(horizontal="center")
    ws.row_dimensions[r].height = 42
    r += 1

ws.cell(row=r, column=2, value="重み合計").font = SUB
ws.cell(row=r, column=3, value="=SUM(C5:C11)").font = SUB
ws.cell(row=r, column=4, value="↓ 加重スコア（100点満点）").font = SUB
for col in range(5, 10):
    L = get_column_letter(col)
    cell = ws.cell(row=r, column=col, value=f"=SUMPRODUCT($C$5:$C$11,{L}5:{L}11)/5")
    cell.font = Font(bold=True)
    cell.fill = CALC_FILL
    cell.border = BOX
    cell.number_format = "0.0"

ws.cell(row=r + 2, column=1, value="判定の目安： 80点以上＝本命 ／ 65〜79＝サンプル取得して継続検討 ／ 65未満＝見送り。ただし①輸出書類が出せない先は総合点に関わらず失格。").font = NOTE
ws.merge_cells(start_row=r + 2, start_column=1, end_row=r + 2, end_column=9)

# =====================================================================
# 2. 仕入先候補
# =====================================================================
ws = wb.create_sheet("2_仕入先候補")
title(ws, "日本側 仕入先候補リスト（RFQ管理表）",
      "類型ごとの一般的な条件をプリセット。社名・MOQ・単価は必ず実見積で上書きすること（下段の空欄行に記入）。", span=10)

header(ws, 4, ["類型", "産地・調達元の例", "想定MOQ（初回）", "想定MOQ（継続/月）",
               "kg単価の目安(円)", "輸出書類", "向くグレード", "メリット", "リスク・確認点"],
       [16, 24, 16, 16, 18, 14, 16, 30, 34])

tiers = [
    ("① 抹茶専門の輸出商社／輸出支援業者",
     "京都・西尾・鹿児島の複数産地を束ねる",
     "1kg（サンプル）〜5kg",
     "10〜50kg",
     "20,000〜60,000",
     "◎ 一式代行",
     "全グレード",
     "最短で始められる。書類・通関・小分けまで面倒を見る。初回テストに最適。",
     "利幅が薄い／産地を指定できない場合がある／中間マージン分だけ原価が上がる"),
    ("② 老舗茶問屋（京都・宇治系）",
     "宇治・和束・南山城（京都府南部）",
     "5〜10kg",
     "20〜100kg",
     "35,000〜150,000",
     "○ 実績あり",
     "セレモニアル／ギフト",
     "「宇治」ブランドが使える。欧州・中国のプレミアム帯で最強の看板。",
     "2026年は数量確保が最難関。新規は後回しにされやすい。価格が最も高い。"),
    ("③ 碾茶大産地の製茶メーカー",
     "愛知・西尾／三重・伊勢",
     "10〜25kg",
     "100kg〜",
     "18,000〜45,000",
     "◎ 輸出慣れ",
     "ラテ用／製菓用",
     "供給が安定し、量が出る。業務用のボリュームゾーンを取るならここ。",
     "小ロットは相手にされにくい。ブランドストーリーは弱い。"),
    ("④ 有機（JAS/EU有機）碾茶メーカー",
     "鹿児島・宮崎・京都の有機認証茶園",
     "5〜20kg",
     "50〜200kg",
     "30,000〜80,000",
     "◎ 認証込み",
     "欧州向け主力",
     "EU向けの本命。有機＋残留農薬クリアの両方を最初から満たす。",
     "2026年は有機一番碾茶が14,000〜18,000円/kg（原料時点）で高騰。数量が細い。"),
    ("⑤ 茶農家と直契約＋挽き屋に委託",
     "単一農園を指定、石臼/ボールミル委託",
     "碾茶で50kg〜",
     "200kg〜",
     "原料+加工で変動",
     "△ 自社対応",
     "単一農園プレミアム",
     "原価を最も圧縮でき、ストーリーも作れる。差別化の最終形。",
     "農薬管理・検査・在庫・加工手配を自社で背負う。初年度には非推奨。"),
    ("⑥ OEM／小ロット製造受託",
     "静岡・京都・鹿児島のOEM対応メーカー",
     "数十kg〜（品目による）",
     "応相談",
     "見積都度",
     "○ 相談可",
     "自社ブランド商品",
     "パッケージ込みで自社ブランドが作れる。小売展開向き。",
     "包材の別途MOQが大きい（数千枚単位）。初期在庫リスクが跳ねる。"),
]
r = body(ws, 5, tiers)
for rr in range(5, r):
    ws.row_dimensions[rr].height = 58

ws.cell(row=r + 1, column=1, value="▼ 実際のRFQ回答をここに記入（10社に送って5社返る想定。返信が遅い先は継続取引でも遅い）").font = SUB
header(ws, r + 2, ["社名", "産地", "初回MOQ", "継続MOQ", "提示kg単価(円)", "書類可否", "グレード", "サンプル入手日", "所感・次アクション"],
       None)
blank_start = r + 3
for rr in range(blank_start, blank_start + 10):
    for cc in range(1, 10):
        cell = ws.cell(row=rr, column=cc)
        cell.border = BOX
        cell.fill = INPUT_FILL
ws.freeze_panes = "A5"

# =====================================================================
# 3. RFQテンプレ
# =====================================================================
ws = wb.create_sheet("3_RFQテンプレ")
title(ws, "見積依頼（RFQ）テンプレート",
      "この項目を明示して送ると、各社から比較可能な形式で回答が返る。曖昧に問い合わせると「応相談」しか返ってこない。", span=4)

ws["A4"] = "【必ず聞く12項目】"
ws["A4"].font = SUB
header(ws, 5, ["#", "質問項目", "なぜ聞くか"], [4, 44, 56])
qs = [
    (1, "グレード別のkg単価（税抜・FOB/EXWの別を明記）", "EXWとFOBを混ぜて比較すると3〜8%ずれる"),
    (2, "初回MOQと、継続取引時の最小月間ロット", "初回だけ緩いケースが多く、2回目で詰む"),
    (3, "価格の有効期限と改定ルール", "新茶入札連動なら年1回、原料連動なら随時。2026年は改定リスクが高い"),
    (4, "COA（成分分析表）の提出可否と項目", "水分・粒度・色調・総カテキン。欧州バイヤーが必ず要求する"),
    (5, "残留農薬分析の実績（EU基準・分析機関名・直近の証明書）", "EU向けの生命線。「取れます」でなく「直近ロットの証明書」を見る"),
    (6, "有機認証の種別（有機JAS／EU有機／USDA）と認証番号", "JASだけではEUで有機表示できない"),
    (7, "産地の特定可否（単一農園／単一産地／ブレンド）と産地名の対外使用許諾", "販促で産地名を出せるかは契約事項。後から揉める"),
    (8, "年間の供給可能数量と、同一品質での継続供給の可否", "2026年の品薄下では最重要。ここで多くの先が脱落する"),
    (9, "包装形態（缶／アルミ／窒素充填の有無）と賞味期限設定", "窒素充填なしは船便で色落ちする"),
    (10, "支払条件（前払い比率・T/T・L/C可否）と初回取引の条件", "新規は全額前払いが多い。資金繰りに直撃する"),
    (11, "サンプルの提供可否・費用・納期", "2週間以内に出せない先は本番も遅い"),
    (12, "リードタイム（発注→出荷）と繁忙期の変動", "新茶期は2〜3ヶ月待ちになることがある"),
]
r = body(ws, 6, qs)

ws.cell(row=r + 1, column=1, value="【日本語 メール雛形】").font = SUB
jp = """件名：抹茶（業務用）お取引・お見積のご相談／〇〇株式会社

〇〇製茶株式会社 ご担当者様

突然のご連絡失礼いたします。〇〇株式会社の〇〇と申します。
弊社は日本産抹茶の〇〇（国名）向け輸出を計画しており、
貴社の〇〇（有機碾茶／宇治産抹茶 等）に関心を持ちご連絡いたしました。

■ 想定条件
・仕向地：〇〇（国・都市）
・用途：〇〇（カフェのラテ用／小売用セレモニアル／製菓用）
・グレード：〇〇
・初回数量：〇〇kg／継続想定：月〇〇kg
・希望包装：1kg アルミ窒素充填（要相談）
・希望納期：〇年〇月

■ ご教示いただきたい事項
① グレード別kg単価（EXW／FOBの別を明記ください）
② 初回MOQおよび継続取引時の最小月間ロット
③ COA・残留農薬分析証明（EU基準）のご提出可否と直近の分析実績
④ 有機認証の種別と認証番号（該当する場合）
⑤ 年間供給可能数量と、同一品質での継続供給の可否
⑥ 産地の特定可否および産地名の対外使用可否
⑦ 支払条件・リードタイム
⑧ サンプル（各グレード100g程度）ご提供の可否・費用

お手数ですが、ご対応可能な範囲でご回答いただけますと幸いです。
何卒よろしくお願い申し上げます。"""
ws.cell(row=r + 2, column=1, value=jp).alignment = Alignment(wrap_text=True, vertical="top")
ws.merge_cells(start_row=r + 2, start_column=1, end_row=r + 2, end_column=3)
ws.row_dimensions[r + 2].height = 400

ws.cell(row=r + 4, column=1, value="【英語 メール雛形（海外バイヤー／欧州側への打診用）】").font = SUB
en = """Subject: Wholesale inquiry - Japanese ceremonial / latte grade matcha (organic available)

Dear [Name],

I am [Name] from [Company], an exporter of Japanese matcha based in Japan.
We source directly from [region] and are currently expanding into the [Germany / EU] market.

What we can offer:
- Single-origin Japanese matcha, ceremonial / latte / culinary grades
- Organic certified (JAS + EU organic), certificate no. [xxx]
- EU MRL-compliant lots, residue analysis certificate issued per lot
- Packaging: 1kg aluminium pouch, nitrogen-flushed; private label available
- MOQ: [x] kg for first order, [x] kg/month for ongoing supply
- Lead time: [x] weeks from order

Could you let me know:
1) Your current monthly matcha volume and the grade you use
2) Your target landed price per kg
3) Certifications and documents you require (COA, organic, residue report)
4) Whether you would like a [100g] sample of each grade

I would be glad to send samples at our cost.

Best regards,"""
ws.cell(row=r + 5, column=1, value=en).alignment = Alignment(wrap_text=True, vertical="top")
ws.merge_cells(start_row=r + 5, start_column=1, end_row=r + 5, end_column=3)
ws.row_dimensions[r + 5].height = 330

# =====================================================================
# 4. 相場レンジ
# =====================================================================
ws = wb.create_sheet("4_相場レンジ2026")
title(ws, "価格相場と2026年の市況（見積が妥当か判断する物差し）",
      "公開情報から整理したレンジ。個社見積がこのレンジを大きく外れる場合は理由を必ず確認すること。", span=6)

ws["A4"] = "■ 原料（碾茶）の市況 ─ ここが事業計画の前提"
ws["A4"].font = SUB
header(ws, 5, ["項目", "2024年", "2025年", "2026年", "備考"], [30, 16, 16, 20, 44])
body(ws, 6, [
    ("鹿児島 一番碾茶 平均落札価格", "—", "6,013円/kg", "13,910円/kg", "前年比 約2.3倍。世界的な抹茶需要と生産転換の遅れが原因"),
    ("鹿児島 有機 一番碾茶", "—", "—", "14,000〜18,000円/kg", "有機は特に逼迫。EU向けの主原料がここ"),
    ("鹿児島 一番茶全体 平均", "基準", "—", "2024年比 約2.9倍", "煎茶から碾茶への転作で煎茶も連鎖高"),
    ("市況の特徴", "—", "—", "秋冬番茶が一番茶より高値", "茶業史上まれな逆転。原料の奪い合いが起きている"),
])

ws["A12"] = "■ 完成品（抹茶）の卸価格レンジ"
ws["A12"].font = SUB
header(ws, 13, ["グレード", "用途", "1kg購入時", "25kg以上", "100kg以上", "備考"], [22, 24, 18, 18, 18, 34])
body(ws, 14, [
    ("カリナリー（製菓用）", "焼菓子・アイス・製造原料", "18,000〜25,000円", "-10〜15%", "-15〜25%", "価格勝負。中国産と直接競合するため日本産の妙味は薄い"),
    ("ラテ／プレミアム", "カフェのラテ・ドリンク", "28,000〜50,000円", "-10%", "-15〜20%", "最も数が出る主戦場。欧州カフェの標的はここ"),
    ("セレモニアル", "薄茶・小売・ギフト", "50,000〜150,000円", "-15%", "-20%", "中国プレミアム小売・欧州専門店。粗利率が最も高い"),
])

ws["A19"] = "■ MOQの実勢"
ws["A19"].font = SUB
header(ws, 20, ["相手先の種類", "初回MOQ", "継続MOQ", "値引きの目安"], [30, 22, 22, 40])
body(ws, 21, [
    ("大手商社・大手製茶メーカー", "100kg〜", "月 数百kg〜数t", "ボリューム前提。小口は門前払いになりやすい"),
    ("抹茶専門の輸出支援業者", "1kg（サンプル）〜5kg", "月 10〜50kg", "小口対応の代わりに単価は高め"),
    ("中堅製茶・OEMメーカー", "数十kg", "月 50〜200kg", "10〜50kgで5〜10%、100kg超で15〜25%が目安"),
])

ws["A26"] = "■ 数量の換算（見積を数量に翻訳する係数）"
ws["A26"].font = SUB
header(ws, 27, ["係数", "値", "意味"], [30, 22, 60])
body(ws, 28, [
    ("抹茶ラテ1杯の使用量", "2g（1.5〜2.5g）", "この2gが全ての数量計算の起点"),
    ("抹茶1kgあたりの杯数", "約500杯", "2g/杯換算。1.5gなら約660杯"),
    ("カフェ1店 月間使用量（15杯/日）", "約0.9kg", "小規模店。ここがMOQ 1kgの根拠"),
    ("カフェ1店 月間使用量（50杯/日）", "約3kg", "抹茶を推している店の標準"),
    ("カフェ1店 月間使用量（100杯/日）", "約6kg", "抹茶専門店・繁盛店"),
])

# =====================================================================
# 5. バイヤー候補
# =====================================================================
ws = wb.create_sheet("5_バイヤー候補")
title(ws, "輸出先バイヤー：類型別の必要量・単価・年間金額",
      "「誰に売るか」で必要量とグレードが決まり、それが日本側のMOQ要件を決める。まずこの表から狙う型を1つ選ぶこと。", span=9)

header(ws, 4, ["バイヤー類型", "主な地域", "1社あたり月間購入量", "希望グレード",
               "想定卸単価(円/kg)", "1社 年間購入額(円)", "獲得難易度", "見つけ方", "コメント"],
       [24, 18, 20, 18, 20, 20, 12, 30, 34])

buyers = [
    ("個人カフェ／コーヒーショップ",
     "独・仏・英・伊・西", "1〜6kg", "ラテ用",
     "40,000〜60,000", "48万〜430万", "低",
     "Instagram・現地の抹茶コミュニティ・カフェ展示会で直接接触",
     "最初の実績作りに最適。数は必要だが決裁が速く、1〜2ヶ月で初回受注が取れる"),
    ("抹茶専門カフェ／チェーン(小)",
     "ロンドン・パリ・ベルリン・ミラノ", "10〜40kg", "セレモニアル+ラテ",
     "45,000〜80,000", "540万〜3,840万", "中",
     "現地の抹茶専門店を10店リスト化し個別打診",
     "本命の入口。品質へのこだわりが強く、単一産地・宇治ブランドが効く"),
    ("有機食品ディストリビューター",
     "ドイツ（ハンブルク）・オランダ", "50〜300kg", "有機ラテ／カリナリー",
     "25,000〜40,000", "1,500万〜1.4億", "高",
     "BIOFACH（ニュルンベルク）等の有機見本市に出展・訪問",
     "欧州最大のロット。ただしEU有機＋MRL証明が完璧でないと門前払い"),
    ("茶専門輸入商（欧州）",
     "独・蘭・仏", "100〜500kg", "全グレード",
     "22,000〜45,000", "2,600万〜2.7億", "高",
     "既存の日本茶輸入商にサンプル送付、または現地パートナー経由",
     "既に日本側の取引先を持つため、価格か希少性のどちらかで勝つ必要がある"),
    ("パティスリー／製菓メーカー",
     "仏・伊・独", "20〜200kg", "カリナリー",
     "20,000〜30,000", "480万〜7,200万", "中",
     "製菓原料の展示会（SIRHA、ISM）",
     "価格勝負になりやすく、中国産に負けやすい。日本産で戦うなら色の濃さで差別化"),
    ("中国 プレミアム小売／越境EC",
     "上海・北京・深圳・杭州・成都", "20〜100kg", "セレモニアル",
     "60,000〜120,000", "1,440万〜1.4億", "中",
     "天猫国際・京東国際の代理運営業者＋小紅書のKOC施策",
     "日本産の勝ち筋はここ一択。「宇治」の看板と儀式性で高単価が取れる"),
    ("中国 新式茶飲チェーン（業務用）",
     "全土", "500kg〜数t", "ラテ用",
     "12,000〜20,000", "7,200万〜数億", "非常に高",
     "現地代理商経由。直接アプローチはほぼ通らない",
     "量は最大だが貴州省等の中国産と価格競争になり、日本産では基本的に採算が合わない。狙わない判断が正しい"),
    ("ホテル／レストラン（HORECA）",
     "欧州主要都市", "3〜15kg", "セレモニアル",
     "50,000〜90,000", "180万〜1,620万", "中",
     "現地のHORECA卸を経由するのが早い",
     "単価は高いが数量が読みにくい。ディストリビューター経由で束ねるのが定石"),
]
r = body(ws, 5, buyers)
for rr in range(5, r):
    ws.row_dimensions[rr].height = 62
ws.freeze_panes = "A5"

ws.cell(row=r + 1, column=1, value="推奨：初年度は「個人カフェ（実績作り）→ 抹茶専門カフェ（本命）」の2段構え。有機ディストリビューターは認証と分析証明が揃ってから当てる。中国は越境ECのプレミアム小売に絞り、業務用チェーンは狙わない。").font = Font(bold=True, color=GREEN)
ws.merge_cells(start_row=r + 1, start_column=1, end_row=r + 1, end_column=9)
ws.row_dimensions[r + 1].height = 34

# =====================================================================
# 6. 採算シミュ
# =====================================================================
ws = wb.create_sheet("6_採算シミュ")
title(ws, "採算シミュレーション（仕入 → FOB → CIF → 卸）",
      "黄色セルを書き換えると全て再計算される。仕入単価は必ず実見積の値を入れること。", span=6)

ws["A4"] = "■ 前提（入力）"
ws["A4"].font = SUB
header(ws, 5, ["項目", "値", "単位", "メモ"], [30, 16, 12, 60])
assum = [
    ("① 抹茶 仕入単価（EXW）", 40000, "円/kg", "シート2のRFQ回答を入れる。ラテ用プレミアムの中央値を初期値に設定"),
    ("② 初回発注量", 30, "kg", "シート5で選んだバイヤー類型の月間量×3ヶ月分が目安"),
    ("③ 小分け・包装費", 1200, "円/kg", "1kgアルミ窒素充填パウチ＋ラベル"),
    ("④ 残留農薬・成分分析費", 80000, "円/ロット", "EU向けは必須。ロットあたり定額なので小ロットほど重い"),
    ("⑤ 認証・書類費", 30000, "円/ロット", "原産地証明・衛生証明・有機同等性証明など"),
    ("⑥ 国内輸送・通関", 25000, "円/ロット", "工場→港"),
    ("⑦ 国際輸送（航空／混載）", 1500, "円/kg", "抹茶は定温・小口のため航空が現実的。船便なら大幅減"),
    ("⑧ 輸入関税・現地通関", 8, "%", "CIF価格に対して。EUの緑茶は低率だがHSコードで変動"),
    ("⑨ 現地倉庫・国内配送", 600, "円/kg", ""),
    ("⑩ 目標卸売単価", 60000, "円/kg", "シート5の類型別レンジから設定"),
]
r = 6
for a in assum:
    ws.cell(row=r, column=1, value=a[0]).border = BOX
    c = ws.cell(row=r, column=2, value=a[1])
    c.border = BOX
    c.fill = INPUT_FILL
    c.number_format = "#,##0"
    ws.cell(row=r, column=3, value=a[2]).border = BOX
    ws.cell(row=r, column=4, value=a[3]).alignment = Alignment(wrap_text=True)
    ws.cell(row=r, column=4).border = BOX
    r += 1

ws["A17"] = "■ 原価積み上げ（自動計算）"
ws["A17"].font = SUB
header(ws, 18, ["項目", "総額(円)", "kg単価(円)", "計算式の意味"], [30, 18, 18, 60])
calc = [
    ("商品原価", "=B6*B7", "=B19/$B$7", "仕入単価 × 数量"),
    ("包装費", "=B8*B7", "=B20/$B$7", "小分け・窒素充填"),
    ("ロット固定費（分析＋認証＋国内輸送通関）", "=B9+B10+B11", "=B21/$B$7", "数量に関係なく発生。小ロットの採算を最も圧迫する"),
    ("国際輸送費", "=B12*B7", "=B22/$B$7", "航空混載想定"),
    ("＝ CIF 相当", "=SUM(B19:B22)", "=B23/$B$7", "現地港着けまでの総原価"),
    ("関税・現地通関", "=B23*B13/100", "=B24/$B$7", "CIF × 関税率"),
    ("現地倉庫・配送", "=B14*B7", "=B25/$B$7", ""),
    ("＝ 総原価（着地）", "=B23+B24+B25", "=B26/$B$7", "この kg単価が損益分岐点"),
]
r = 19
for c in calc:
    ws.cell(row=r, column=1, value=c[0]).border = BOX
    for i, f in enumerate(c[1:3], start=2):
        cell = ws.cell(row=r, column=i, value=f)
        cell.border = BOX
        cell.fill = CALC_FILL
        cell.number_format = "#,##0"
    ws.cell(row=r, column=4, value=c[3]).alignment = Alignment(wrap_text=True)
    ws.cell(row=r, column=4).border = BOX
    r += 1
for col in (1, 2, 3):
    ws.cell(row=23, column=col).font = Font(bold=True)
    ws.cell(row=26, column=col).font = Font(bold=True)

ws["A28"] = "■ 損益（自動計算）"
ws["A28"].font = SUB
header(ws, 29, ["項目", "金額", "備考"], [30, 20, 60])
pl = [
    ("売上（卸）", "=B15*B7", "目標卸売単価 × 数量"),
    ("総原価", "=B26", "上の積み上げ"),
    ("粗利", "=B30-B31", ""),
    ("粗利率", "=IF(B30=0,0,B32/B30)", "20%を切ると値引き交渉やクレーム対応で消える。30%以上を狙う"),
    ("損益分岐の卸単価", "=B26/B7", "この単価を割ると赤字"),
    ("必要な最低卸単価（粗利30%確保）", "=B34/0.7", "この値がシート5の相場レンジ内なら事業として成立する"),
]
r = 30
for p in pl:
    ws.cell(row=r, column=1, value=p[0]).border = BOX
    cell = ws.cell(row=r, column=2, value=p[1])
    cell.border = BOX
    cell.fill = CALC_FILL
    cell.font = Font(bold=True)
    cell.number_format = "0.0%" if "率" in p[0] else "#,##0"
    ws.cell(row=r, column=3, value=p[2]).alignment = Alignment(wrap_text=True)
    ws.cell(row=r, column=3).border = BOX
    r += 1

ws.cell(row=r + 1, column=1, value="読み方：ロット固定費（分析・認証・通関で約13.5万円）は数量に関係なく乗るため、10kgでは kg当たり13,500円、100kgなら1,350円。小ロットで始めるほど原価率が跳ね上がる構造なので、\n「テスト輸出は赤字前提の投資」と割り切り、2回目以降で50kg以上に乗せる計画を最初から立てておくこと。").alignment = Alignment(wrap_text=True)
ws.merge_cells(start_row=r + 1, start_column=1, end_row=r + 1, end_column=4)
ws.row_dimensions[r + 1].height = 40

wb.save(OUT)
print("saved:", OUT)
