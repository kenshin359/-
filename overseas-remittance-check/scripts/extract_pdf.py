#!/usr/bin/env python3
"""百十四銀行の仕向送金申込書（帳票ID OMT0107）から、金銭に直結する項目を読み取る。

用途は2つ。

1. 転記ミスの検出（--check）
   人が data/*.json に打ち込んだ値と、PDFから直接読んだ値を突き合わせる。
   検証ツール本体がどれだけ厳密でも、入力の時点で数字を1桁写し間違えていれば
   その誤りごと「正しい」と判定してしまう。そこを塞ぐための工程。

2. 新規データの下書き（--json）
   読み取れた項目をJSONで吐く。人が確認して data/ に保存する。

読み取り対象は、間違えると金が別の場所へ行く項目に絞っている。
住所の細目などは対象外なので、出力をそのまま完成品として扱わないこと。

    python3 scripts/extract_pdf.py 申込書.pdf
    python3 scripts/extract_pdf.py 申込書.pdf --check data/OMT20260901100481.json
    python3 scripts/extract_pdf.py 申込書.pdf --json

終了コード: 0=一致 / 1=要確認 / 2=不一致あり
"""

import argparse
import json
import re
import sys
import unicodedata

try:
    import pymupdf
except ImportError:  # pragma: no cover
    sys.exit("pymupdf が必要です:  pip install pymupdf")


# 帳票OMT0107は固定レイアウトなので、値のセルを座標で直接指定する。
# ラベル文字列を手がかりにするより、同じ帳票である限り安定する。
# (ページ番号, x0, y0, x1, y1) 単位はpt。
FIELD_RECTS = {
    "reference_no":      (0, 480,  62, 600,  75),
    "status":            (0, 480,  74, 600,  88),
    "branch":            (0,  70,  86, 300, 100),
    "application_date":  (0, 336,  86, 440, 100),
    "value_date":        (0, 480,  86, 600, 100),
    "customer_no":       (0,  70,  98, 300, 112),
    "settlement_method": (0, 305, 108, 345, 124),
    "fx_contract_no":    (0, 515, 108, 600, 124),
    "debit_account":     (0,  95, 148, 300, 163),
    "amount_currency":   (0,  95, 186, 140, 197),
    "amount_value":      (0, 140, 186, 290, 197),
    "fee_handling":      (0,  80, 208, 140, 222),
    "yen_equivalent":    (0, 240, 205, 263, 226),
    "payment_instruction": (0, 140, 235, 245, 250),
    "debtor_name":       (0, 128, 300, 480, 315),
    "debtor_country":    (0, 128, 324, 300, 338),
    "creditor_name":     (0, 128, 598, 480, 612),
    "creditor_country":  (0, 128, 617, 300, 632),

    "creditor_account":  (1, 128, 181, 300, 196),
    "bic":               (1, 128, 193, 300, 208),
    "bank_name":         (1, 128, 228, 480, 242),
    "bank_country":      (1, 128, 248, 300, 263),
    "purpose_details":   (1, 128, 533, 300, 548),
    "purpose_origin":    (1, 385, 533, 600, 548),
    "port_of_loading":   (1, 128, 545, 300, 560),
    "port_of_destination": (1, 128, 557, 300, 573),
    "end_to_end_identification": (1, 128, 600, 600, 616),
}

# チェックボックスは□と☑がベクタ図形として描かれており、文字としては取れない。
# ラベルの直左にある約9pt四方を高解像度で描画し、黒画素の割合で判定する。
# ☑は□よりインクが明確に多い。
CHECKBOXES = {
    "purpose_category": [
        ("輸入",         1, 143.0, 525.2, 534.2),
        ("資本",         1, 174.9, 525.2, 534.2),
        ("仲介貿易",     1, 207.3, 525.2, 534.2),
        ("その他貿易外", 1, 257.7, 525.2, 534.2),
    ],
    "foreign_bank_charges": [
        ("受取人負担(CREDITOR)", 0, 314.8, 247.9, 256.9),
        ("送金人負担(DEBTOR)",   0, 466.0, 247.9, 256.9),
    ],
    "fefta_license": [
        ("必要(NECESSARY)",     1, 141.2, 573.3, 582.3),
        ("不要(NOT NECESSARY)", 1, 141.2, 582.2, 591.2),
    ],
    "consent": [
        ("上記内容に同意し、承諾いたします。", 1, 138.2, 735.3, 742.3),
    ],
    "attachment": [
        ("あり", 1, 138.2, 747.8, 754.8),
        ("なし", 1, 167.0, 747.8, 754.8),
    ],
}

# 空欄の□でも枠線ぶんのインクがある。実測では未チェック約0.06〜0.12、
# チェック済み約0.16〜0.22 に分かれるため、その間に閾値を置く。
INK_CHECKED = 0.132
INK_AMBIGUOUS = (0.124, 0.140)  # この帯に入ったら人の目で確認させる


def words_in(page, x0, y0, x1, y1):
    """矩形に中心が入る単語を、左から順に連結して返す。"""
    out = []
    seen = set()
    for wx0, wy0, wx1, wy1, text, *_ in page.get_text("words"):
        cx, cy = (wx0 + wx1) / 2, (wy0 + wy1) / 2
        if x0 <= cx <= x1 and y0 <= cy <= y1:
            key = (round(wx0, 1), round(wy0, 1), text)
            if key in seen:
                continue  # 太字は同じ文字が二重に描かれている
            seen.add(key)
            out.append((wx0, text))
    return " ".join(t for _, t in sorted(out)) or None


def ink_ratio(page, x, y0, y1, dpi=600):
    """ラベル直左のチェックボックス領域の黒画素率。"""
    rect = pymupdf.Rect(x - 9.5, y0 - 1.0, x - 0.5, y1 + 1.0)
    pm = page.get_pixmap(dpi=dpi, clip=rect, colorspace=pymupdf.csGRAY)
    samples = pm.samples
    if not samples:
        return 0.0
    return sum(1 for v in samples if v < 128) / len(samples)


def extract(path):
    doc = pymupdf.open(path)
    result, warnings = {}, []

    for name, (pi, x0, y0, x1, y1) in FIELD_RECTS.items():
        if pi >= len(doc):
            warnings.append(f"{name}: ページ{pi+1}が存在しない")
            result[name] = None
            continue
        result[name] = words_in(doc[pi], x0, y0, x1, y1)

    checks = {}
    for group, options in CHECKBOXES.items():
        marked, ratios = [], {}
        for label, pi, x, y0, y1 in options:
            r = ink_ratio(doc[pi], x, y0, y1)
            ratios[label] = round(r, 3)
            if INK_AMBIGUOUS[0] < r < INK_AMBIGUOUS[1]:
                warnings.append(
                    f"チェックボックス『{group}／{label}』の判定が微妙（インク率 {r:.3f}）。"
                    "PDFを目視して確認すること。")
            if r >= INK_CHECKED:
                marked.append(label)
        checks[group] = {"marked": marked, "ink_ratios": ratios}
        # 選択肢が複数あるのに全部同じインク量なら、そもそも判別できていない。
        if len(options) > 1 and max(ratios.values()) - min(ratios.values()) < 0.02:
            warnings.append(
                f"『{group}』はどの選択肢もインク量がほぼ同じで、チェックの有無を判別できない: {ratios}")
        if len(marked) > 1 and group != "attachment":
            warnings.append(f"『{group}』で複数の選択肢にチェックが付いている: {marked}")
        if not marked:
            warnings.append(f"『{group}』にチェックが1つも付いていない")

    doc.close()
    result["_checkboxes"] = checks
    result["_warnings"] = warnings
    return result


# ------------------------------------------------------------- 転記チェック

def norm(v):
    if v is None:
        return ""
    return re.sub(r"[\s,]", "", unicodedata.normalize("NFKC", str(v)).upper())


def norm_date(v):
    """2026/09/03 と 2026-09-03 を同じものとして扱う。"""
    if v is None:
        return ""
    return re.sub(r"[^0-9]", "", str(v))


def norm_amount(v):
    if v is None:
        return ""
    try:
        return f"{float(re.sub(r'[^0-9.]', '', str(v))):.2f}"
    except ValueError:
        return norm(v)


def compare(pdf_data, tx):
    """PDFの読み取り値と、人が入力したJSONを突き合わせる。"""
    checks = pdf_data["_checkboxes"]
    marked = {g: checks[g]["marked"] for g in checks}

    charge_map = {"受取人負担(CREDITOR)": "CREDITOR", "送金人負担(DEBTOR)": "DEBTOR"}
    charges_pdf = next((charge_map[m] for m in marked["foreign_bank_charges"]), None)

    pairs = [
        ("受付番号",       pdf_data["reference_no"],     tx.get("reference_no"), norm),
        ("ステータス",     pdf_data["status"],           tx.get("status"), norm),
        ("送金指定日",     pdf_data["value_date"],       tx.get("value_date"), norm_date),
        ("顧客番号",       pdf_data["customer_no"],      tx.get("customer_no"), norm),
        ("送金通貨",       pdf_data["amount_currency"],  (tx.get("amount") or {}).get("currency"), norm),
        ("送金金額",       pdf_data["amount_value"],     (tx.get("amount") or {}).get("value"), norm_amount),
        ("受取人名",       pdf_data["creditor_name"],    (tx.get("creditor") or {}).get("name"), norm),
        ("受取人国名",     pdf_data["creditor_country"], (tx.get("creditor") or {}).get("country"), norm),
        ("受取人口座",     pdf_data["creditor_account"], tx.get("creditor_account"), norm),
        ("BIC(SWIFT)",     pdf_data["bic"],              (tx.get("creditor_agent") or {}).get("bic"), norm),
        ("送金先銀行名",   pdf_data["bank_name"],        (tx.get("creditor_agent") or {}).get("name"), norm),
        ("送金先国名",     pdf_data["bank_country"],     (tx.get("creditor_agent") or {}).get("country"), norm),
        ("送金理由",       pdf_data["purpose_details"],  (tx.get("purpose") or {}).get("details"), norm),
        ("原産地",         pdf_data["purpose_origin"],   (tx.get("purpose") or {}).get("origin"), norm),
        ("船積地",         pdf_data["port_of_loading"],  (tx.get("purpose") or {}).get("port_of_loading"), norm),
        ("海外銀行手数料", charges_pdf,                  tx.get("foreign_bank_charges"), norm),
        ("送金目的",       (marked["purpose_category"] or [None])[0],
                           (tx.get("purpose") or {}).get("category"), norm),
    ]

    mismatches, matched = [], []
    for label, from_pdf, from_json, normalizer in pairs:
        if normalizer(from_pdf) == normalizer(from_json):
            matched.append((label, from_pdf))
        else:
            mismatches.append((label, from_pdf, from_json))
    return matched, mismatches


def main():
    ap = argparse.ArgumentParser(description="仕向送金申込書PDFの読み取りと転記チェック")
    ap.add_argument("pdf")
    ap.add_argument("--check", metavar="DATA_JSON",
                    help="この送金データJSONとPDFの内容を突き合わせる")
    ap.add_argument("--json", action="store_true", help="読み取り結果をJSONで出力")
    args = ap.parse_args()

    data = extract(args.pdf)

    if args.json:
        print(json.dumps(data, ensure_ascii=False, indent=2))
        return 0

    print("=" * 74)
    print("  申込書PDFの読み取り結果")
    print("=" * 74)
    for k, v in data.items():
        if not k.startswith("_"):
            print(f"  {k:24s}: {v if v is not None else '(空欄)'}")
    print("-" * 74)
    for group, info in data["_checkboxes"].items():
        print(f"  {group:24s}: {info['marked'] or '(未チェック)'}")
        print(f"  {'':24s}  インク率 {info['ink_ratios']}")

    if data["_warnings"]:
        print("-" * 74)
        print("  読み取り上の注意")
        for w in data["_warnings"]:
            print(f"   ・{w}")

    if not args.check:
        print("=" * 74)
        print("  ※ 読み取り対象は金銭に直結する項目のみ。住所の細目等は含まれない。")
        print("=" * 74)
        return 1 if data["_warnings"] else 0

    with open(args.check, encoding="utf-8") as f:
        tx = json.load(f)
    matched, mismatches = compare(data, tx)

    print("=" * 74)
    print(f"  転記チェック（PDF ⇔ {args.check}）")
    print("=" * 74)
    for label, value in matched:
        print(f"  ✅ {label:16s} {value if value is not None else '(空欄)'}")
    for label, from_pdf, from_json in mismatches:
        print(f"  ❌ {label:16s} PDF={from_pdf!r} / JSON={from_json!r}")
    print("-" * 74)
    if mismatches:
        print(f"  判定: 不一致 {len(mismatches)}件。JSONの入力を直してから検証を実行すること。")
    else:
        print(f"  判定: 全{len(matched)}項目が一致。転記ミスなし。")
    print("=" * 74)
    return 2 if mismatches else (1 if data["_warnings"] else 0)


if __name__ == "__main__":
    sys.exit(main())
