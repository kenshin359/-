# 海外送金 確認システム

仕向送金申込書を銀行に通す前に、金額・受取人・口座・送金目的の食い違いを機械的に洗い出すためのツール。
標準ライブラリだけで動く（PDF読み取り機能のみ `pymupdf` を使う）。

## なぜ作るか

海外送金の事故は、複雑な判断ミスではなく単純な一致確認の抜けで起きる。

- 口座番号の1桁違い ― 着金せずに戻ってくるか、最悪は他人の口座に入る
- BICの取り違え ― `DHBKHKHH`（DBS香港）と `DBSSSGSG`（DBSシンガポール）は別法人
- 金額の桁違い ― INVOICEと照らせば必ず分かるが、照らさなければ絶対に分からない
- 送金直前に「振込先が変わりました」というメールが来る ― 送金詐欺の典型的な形

いずれも、正しい値を別に持っておいて突き合わせれば止められる。このツールはその突き合わせを機械にやらせる。

## 使い方

```bash
cd overseas-remittance-check

# 1. 申込書PDFから直接読んだ値と、入力したJSONを突き合わせる（転記ミスの検出）
python3 scripts/extract_pdf.py 申込書.pdf --check data/OMT20260901100481.json

# 2. 内容を検証する
python3 scripts/verify_remittance.py data/OMT20260901100481.json

# JSONで受け取りたいとき
python3 scripts/verify_remittance.py data/OMT20260901100481.json --json

# 3. Excelブックにまとめる（回覧・承認用）
python3 scripts/build_check_sheet.py data/OMT20260901100481.json \
    --pdf samples/remittance.pdf -o 送金チェック_OMT20260901100481.xlsx
```

終了コードは `0`=問題なし、`1`=要確認あり、`2`=送金停止。CIや承認フローに組み込める。

## Excel出力

`build_check_sheet.py` は検証結果を5枚のシートにまとめる。回覧と承認に使う。

| シート | 内容 |
|---|---|
| サマリー | 送金の基本情報、🔴🟡🔵の件数、円貨相当額の試算（レートは書き換えられる） |
| 照合結果 | ①申込書と先方提出シート ②申込書PDFと入力データ の突き合わせ |
| 検証結果 | 検出した指摘の一覧（オートフィルタ付き） |
| 実行前チェック | 送金前に人が潰す項目。完了欄はドロップダウン、進捗は自動集計 |
| 商材別輸入要件 | 商材ごとのHSコード候補と必要な手続 |

**一致判定はExcelの数式で行っている。** セルの値を書き換えれば判定もその場で変わるので、
このブック自体を確認ツールとして使える。表記ゆれ（空白・カンマ・ピリオド・ハイフン・スラッシュ）は
無視して比較し、金額は数値に直して比較する。

## 検証の流れ

```
申込書PDF ──[extract_pdf.py]──> 読み取り値 ┐
                                          ├─> 突き合わせて転記ミスを検出
data/*.json（人が入力） ───────────────────┘
        │
        ├─ config/beneficiaries.json  … 受取人マスタ（前回と同じ口座か）
        ├─ config/bank_directory.json … BIC辞書（BICと銀行名・国が整合するか）
        ├─ config/risk_screening.json … 制裁・規制地域
        ├─ config/products.json       … 商材マスタ（送金理由が品目を網羅するか）
        └─ invoice（JSON内）          … 金額・通貨・品目の照合
        ↓
    [verify_remittance.py]
        ↓
    🔴 送金停止 / 🟡 要確認 / 🔵 参考
```

## 検査項目

| 記号 | 内容 |
|---|---|
| `A-REQ` / `A-TR16` / `A-OPT` | 必須項目の欠落。`A-TR16` はFATF勧告16が求める送金人情報 |
| `B-DIFF` / `B-ADDR` / `B-VERIFY` | 受取人マスタとの照合。口座・BIC・受取人名の差し替えを検出 |
| `C-FMT` / `C-TEST` / `C-COUNTRY` / `C-NAME` | BICの形式・テストBIC・国コード・銀行名の整合 |
| `D-IBAN` / `D-DIGIT` / `D-LEN` | 口座番号の形式。IBAN国はmod-97でチェックディジットまで検証 |
| `E-XBORDER` / `E-THIRD` | 受取人所在国と銀行所在国のずれ、原産地と支払先国のずれ（第三国決済） |
| `F-PROHIB` / `F-RESTRICT` / `F-FATF` / `F-DECL` | 制裁・規制地域のスクリーニングと表明欄のチェック漏れ |
| `G-DIFF` / `G-CUR` / `G-ACCT` / `G-NOINV` | INVOICEとの金額・通貨・口座の照合。10倍/100倍の桁ズレは名指しで指摘 |
| `H-BEN` / `H-OUR` / `H-NONE` / `H-FX` | 海外銀行手数料の負担区分と為替予約の有無 |
| `I-MISSING` / `I-SCOPE` | 送金理由がINVOICEの品目を網羅しているか |
| `J-PAST` / `J-WEEKEND` / `J-STATUS` | 送金指定日と承認状況 |
| `K-REPORT` / `K-FEFTA` / `K-ATTACH` | 国外送金等調書、外為法許可、添付書類 |

## 新しい送金を検証するとき

1. `data/` に送金データJSONを作る（既存のものをコピーして書き換えるのが早い）
2. 受取人が初めてなら `config/beneficiaries.json` に登録する
   - **口座情報は必ず、登録済みの電話番号へこちらから架電して口頭で確認する。**
     メールに書かれた口座番号をコピーして登録しない。送金詐欺はそこを突いてくる
   - 確認できたら `verification` に日付・担当者・方法を記録する。未記録だと `B-VERIFY` で止まる
3. INVOICEを見て `invoice` を埋める。埋めないと `G-NOINV` で止まる（金額照合を省いた送金は通さない設計）
4. `extract_pdf.py --check` で転記ミスがないことを確認する
5. `verify_remittance.py` を実行し、🔴 をすべて解消してから承認に回す

## 口座情報の変更連絡が来たとき

**メールだけを根拠に `config/beneficiaries.json` を書き換えない。**

1. 登録済みの電話番号（メールに書かれた番号ではない）へこちらから架電する
2. 受取人名・口座番号・BICを読み上げて一致を確認する
3. 確認できてからマスタを更新し、`verification` に日付・担当者・方法を記録する
4. 変更の経緯が分かるよう、旧口座情報はコメントで残す

## テスト

```bash
python3 -m unittest discover -s tests -v
```

PDF読み取りのテストは `samples/remittance.pdf` を置いたときだけ動く。
申込書やINVOICEは口座番号を含む取引書類なので、`samples/` はGit管理から外してある。

## 範囲外のこと

このツールが**やらないこと**を理解して使うこと。

- 個人・団体名の制裁リスト照合（銀行のフィルタと財務省・外務省の告示で別途確認する）
- 受取人が実在し、その口座が本当にその会社のものかの確認（電話での口頭確認でしか担保できない）
- 添付されたINVOICEやB/Lそのものの真正性の確認
- 税務・法務・通関に関する判断

`config/products.json` に書いた法令の記載は社内の一次スクリーニング用の目安であり、法的助言ではない。
確定させるには所管部署・税関の事前教示制度・専門家への確認が要る。

## 環境上の注意：ファイル名と LibreOffice

`LANG` が未設定（POSIXロケール）の環境では、日本語のファイル名を外部コマンドに渡した時点で
`?` に化ける。LibreOffice はその存在しないファイルを開こうとして延々と待つため、
「なぜか終わらない」という形で止まる。数式の再計算をかけるときは、
一度ASCII名にコピーしてから実行し、あとで戻すのが確実。

```bash
cp 送金チェック_OMT20260901100481.xlsx /tmp/recalc_target.xlsx
python3 <recalc.pyのパス> /tmp/recalc_target.xlsx 600
cp /tmp/recalc_target.xlsx 送金チェック_OMT20260901100481.xlsx
```

`build_check_sheet.py` は、出力ファイル名に非ASCII文字が含まれる場合にその旨を警告する。
