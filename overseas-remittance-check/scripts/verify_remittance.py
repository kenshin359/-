#!/usr/bin/env python3
"""海外送金申込書の検証ツール。

仕向送金申込書の内容を、受取人マスタ・BIC辞書・商材マスタ・INVOICEと突き合わせ、
送金を実行する前に潰しておくべき点を洗い出す。標準ライブラリだけで動く。

    python3 scripts/verify_remittance.py data/OMT20260901100481.json
    python3 scripts/verify_remittance.py data/OMT20260901100481.json --json

終了コード: 0=問題なし / 1=要確認あり / 2=送金停止（重大な不一致）
"""

import argparse
import datetime
import json
import re
import sys
import unicodedata
from pathlib import Path

CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"

# 深刻度。数字が大きいほど重い。
INFO, WARN, BLOCK = 0, 1, 2
LABEL = {INFO: "🔵 参考", WARN: "🟡 要確認", BLOCK: "🔴 送金停止"}

# 国名表記からISO 3166-1 alpha-2へ。申込書は国名を英語のフリーテキストで持つため、
# BICの国コードと突き合わせるには正規化が要る。
COUNTRY_CODES = {
    "JAPAN": "JP", "日本": "JP",
    "HONG KONG": "HK", "HONGKONG": "HK", "香港": "HK",
    "CHINA": "CN", "PEOPLES REPUBLIC OF CHINA": "CN", "中国": "CN",
    "TAIWAN": "TW", "台湾": "TW",
    "SINGAPORE": "SG", "シンガポール": "SG",
    "KOREA": "KR", "SOUTH KOREA": "KR", "韓国": "KR",
    "VIETNAM": "VN", "VIET NAM": "VN", "ベトナム": "VN",
    "THAILAND": "TH", "タイ": "TH",
    "UNITED STATES": "US", "USA": "US", "アメリカ": "US",
    "UNITED KINGDOM": "GB", "イギリス": "GB",
    "GERMANY": "DE", "ドイツ": "DE",
    "UNITED ARAB EMIRATES": "AE", "UAE": "AE",
    "MALAYSIA": "MY", "INDIA": "IN", "INDONESIA": "ID",
}


class Finding:
    def __init__(self, code, severity, title, detail, action=None):
        self.code = code
        self.severity = severity
        self.title = title
        self.detail = detail
        self.action = action

    def to_dict(self):
        return {
            "code": self.code,
            "severity": {INFO: "INFO", WARN: "WARN", BLOCK: "BLOCK"}[self.severity],
            "title": self.title,
            "detail": self.detail,
            "action": self.action,
        }


# ---------------------------------------------------------------- 正規化ヘルパ

def norm_text(value):
    """全角/半角・大文字小文字・記号ゆれを吸収して比較用の文字列にする。

    住所や会社名は人が手で打ち直すため、'CO., LTD.' と 'CO.,LTD' のような差が普通に出る。
    そこを不一致として騒ぐと本当の不一致が埋もれるので、記号と空白は落として比べる。
    """
    if value is None:
        return ""
    s = unicodedata.normalize("NFKC", str(value)).upper()
    return re.sub(r"[^A-Z0-9぀-ヿ一-鿿]", "", s)


def norm_account(value):
    """口座番号の比較用。ハイフン・スペースを除去する。"""
    if value is None:
        return ""
    return re.sub(r"[\s\-]", "", unicodedata.normalize("NFKC", str(value)).upper())


def country_code(name):
    if not name:
        return None
    key = unicodedata.normalize("NFKC", str(name)).upper().strip().rstrip(".,")
    if re.fullmatch(r"[A-Z]{2}", key):
        return key
    return COUNTRY_CODES.get(key) or COUNTRY_CODES.get(key.replace(" ", ""))


def contains_keyword(haystack, keyword):
    """住所文字列に地名キーワードが含まれるか。

    'CHINA' が 'INDOCHINA' に化けるような部分一致の暴発を避けるため、
    英字キーワードは単語境界で見る。日本語は境界が取れないので単純包含。
    """
    if re.fullmatch(r"[A-Za-z .'\-]+", keyword):
        return re.search(r"\b" + re.escape(keyword.upper()) + r"\b", haystack.upper()) is not None
    return keyword in haystack


def iban_is_valid(value):
    """IBANのmod-97チェック（ISO 13616）。"""
    s = re.sub(r"\s", "", value.upper())
    if not re.fullmatch(r"[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}", s):
        return False
    rearranged = s[4:] + s[:4]
    digits = "".join(str(int(c, 36)) for c in rearranged)
    return int(digits) % 97 == 1


def load_config(name):
    with open(CONFIG_DIR / name, encoding="utf-8") as f:
        return json.load(f)


# ---------------------------------------------------------------- 検証本体

class RemittanceVerifier:
    def __init__(self, tx, beneficiaries, banks, risk, products):
        self.tx = tx
        self.beneficiaries = beneficiaries
        self.banks = banks
        self.risk = risk
        self.products = products
        self.findings = []

    def add(self, code, severity, title, detail, action=None):
        self.findings.append(Finding(code, severity, title, detail, action))

    def run(self):
        self.check_required_fields()
        self.check_beneficiary_master()
        self.check_bic()
        self.check_account_format()
        self.check_routing_and_country()
        self.check_sanctions()
        self.check_amount()
        self.check_charges()
        self.check_purpose_and_products()
        self.check_dates()
        self.check_compliance()
        self.findings.sort(key=lambda f: (-f.severity, f.code))
        return self.findings

    # -- A. 必須項目 ------------------------------------------------------
    def check_required_fields(self):
        """空欄のまま銀行に出すと差し戻される項目、および欠けると資金が追跡できない項目。"""
        tx = self.tx
        required = [
            ("creditor.name", tx.get("creditor", {}).get("name"), "受取人名"),
            ("creditor_account", tx.get("creditor_account"), "受取人口座"),
            ("creditor_agent.bic", tx.get("creditor_agent", {}).get("bic"), "送金先銀行BIC"),
            ("creditor_agent.name", tx.get("creditor_agent", {}).get("name"), "送金先銀行名"),
            ("amount.value", tx.get("amount", {}).get("value"), "送金金額"),
            ("amount.currency", tx.get("amount", {}).get("currency"), "送金通貨"),
            ("value_date", tx.get("value_date"), "送金指定日"),
        ]
        for path, value, label in required:
            if value in (None, "", 0):
                self.add("A-REQ", BLOCK, f"必須項目が空欄：{label}",
                         f"{path} が未入力。この状態では送金できない。",
                         "申込書に入力して再出力する。")

        # FATF勧告16（送金人情報）。名前・住所・口座番号のいずれかが欠けると
        # 中継銀行の段階で照会・返金になりやすい。
        debtor = tx.get("debtor") or {}
        missing = [lbl for lbl, v in (
            ("送金人名", debtor.get("name")),
            ("送金人住所", debtor.get("street")),
            ("送金人国名", debtor.get("country")),
            ("引落口座番号", (tx.get("debit") or {}).get("account_number")),
        ) if not v]
        if missing:
            self.add("A-TR16", BLOCK, "送金人情報が不足している",
                     "FATF勧告16で電信送金に付すことが求められる送金人情報が欠けている："
                     + "、".join(missing),
                     "欠けている項目を埋める。中継銀行で止められる原因になる。")

        # 空欄でも受理はされるが、後で照合や説明に困る項目。
        soft = [
            ("application_date", tx.get("application_date"), "お申込日",
             "受付・承認の記録が残らない。銀行への提出前に日付を入れる。"),
            ("creditor.country_of_residence", (tx.get("creditor") or {}).get("country_of_residence"),
             "受取人本店所在国または居住国",
             "受取人国名(HONG KONG)は入っているがこの欄は空。銀行によっては記入を求められる。"),
            ("purpose.port_of_destination", (tx.get("purpose") or {}).get("port_of_destination"),
             "仕向地 (PORT OF DESTINATION)",
             "船積地(CHINA SHENZHEN)は入っているのに陸揚港が空。輸入取引の実態確認で聞かれる項目。"),
            ("end_to_end_identification", tx.get("end_to_end_identification"), "参照番号",
             "INVOICE番号を入れておくと、着金側で入金消込ができ、先方の『入金が確認できない』問い合わせを防げる。"),
            ("debtor_reference_no", tx.get("debtor_reference_no"), "お客様整理番号",
             "受取人には通知されない自社用の整理番号。INVOICE番号や発注番号を入れておくと後日の突合が楽になる。"),
        ]
        for path, value, label, why in soft:
            if value in (None, ""):
                self.add("A-OPT", WARN, f"空欄：{label}", why, "入力を検討する。")

    # -- B. 受取人マスタ照合 ----------------------------------------------
    def check_beneficiary_master(self):
        """登録済みの受取人情報と一字一句突き合わせる。

        振込先の口座番号やBICが『前回と違う』ことを検知するのが目的。
        送金詐欺は、正規のやり取りの途中で口座だけ差し替える形で起きる。
        """
        tx = self.tx
        want_id = tx.get("expected_beneficiary_id")
        master = next((b for b in self.beneficiaries["beneficiaries"] if b["id"] == want_id), None)
        if master is None:
            self.add("B-MASTER", BLOCK, "受取人マスタに登録がない",
                     f"expected_beneficiary_id={want_id!r} に該当する登録が config/beneficiaries.json にない。",
                     "初回取引なら、登録済みの電話番号へこちらから架電して口座情報を口頭確認し、"
                     "マスタに登録してから送金する。")
            return

        creditor = tx.get("creditor") or {}
        agent = tx.get("creditor_agent") or {}

        comparisons = [
            ("受取人名", creditor.get("name"), master["name"], BLOCK),
            ("受取人口座", tx.get("creditor_account"), master["account_number"], BLOCK),
            ("BIC(SWIFT)", agent.get("bic"), master["bic"], BLOCK),
            ("送金先銀行名", agent.get("name"), master["bank_name"], WARN),
            ("受取人国名", creditor.get("country"), master["country"], WARN),
        ]
        for label, actual, expected, sev in comparisons:
            norm = norm_account if "口座" in label else norm_text
            if norm(actual) != norm(expected):
                self.add("B-DIFF", sev, f"マスタと不一致：{label}",
                         f"申込書＝{actual!r} / マスタ＝{expected!r}",
                         "先方からのメールを根拠にしないこと。登録済みの電話番号へこちらから架電し、"
                         "口頭で正しい情報を確認してからマスタと申込書の両方を直す。")

        # 住所は表記ゆれが大きいので、番地の数字が一致するかで見る。
        addr_actual = norm_text(f"{creditor.get('street','')} {creditor.get('town','')}")
        addr_master = norm_text(master["address"])
        if addr_actual and addr_actual not in addr_master and addr_master not in addr_actual:
            a_nums = set(re.findall(r"\d+", addr_actual))
            m_nums = set(re.findall(r"\d+", addr_master))
            sev = WARN if a_nums & m_nums else BLOCK
            self.add("B-ADDR", sev, "マスタと不一致：受取人住所",
                     f"申込書＝{creditor.get('street')} {creditor.get('town')} / マスタ＝{master['address']}",
                     "住所は着金の可否には直結しないが、受取人そのものが入れ替わっていないかの確認材料になる。")

        if not master.get("verification", {}).get("verified"):
            self.add("B-VERIFY", BLOCK, "受取人口座が未検証のまま",
                     f"{master['name']} の口座情報は、電話での口頭確認が済んでいない"
                     f"（config/beneficiaries.json の verification.verified が false）。",
                     f"登録済みの番号（{master.get('contact_phone')}）へこちらから架電し、"
                     "受取人名・口座番号・BICを読み上げて一致を確認する。"
                     "確認できたら verified / verified_at / verified_by / method を記録して再実行する。")

        if master.get("address_note"):
            self.add("B-NOTE", INFO, "受取人住所に関する申し送り", master["address_note"])

    # -- C. BIC妥当性 ------------------------------------------------------
    def check_bic(self):
        agent = self.tx.get("creditor_agent") or {}
        bic = (agent.get("bic") or "").strip().upper()
        if not bic:
            return

        if not re.fullmatch(r"[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?", bic):
            self.add("C-FMT", BLOCK, "BICの形式が不正",
                     f"{bic!r} はBICの形式（英字6桁＋英数2桁＋任意の支店3桁）を満たさない。",
                     "銀行名から正しいBICを引き直す。")
            return

        # 8桁目が 0 のBICはテスト用で、実際の送金には使えない。
        if len(bic) >= 8 and bic[7] == "0":
            self.add("C-TEST", BLOCK, "テスト用BICが指定されている",
                     f"{bic} は8桁目が 0 で、テスト環境用のBIC。実送金には使えない。",
                     "本番用のBICに差し替える。")

        bic_country = bic[4:6]
        dest_country = country_code(agent.get("country"))
        if dest_country and bic_country != dest_country:
            self.add("C-COUNTRY", BLOCK, "BICの国コードと送金先国名が食い違う",
                     f"BIC {bic} の国コードは {bic_country} だが、送金先国名は "
                     f"{agent.get('country')}（{dest_country}）。",
                     "どちらかが誤り。BICを取り違えている可能性が高い。")

        entry = self.banks["bics"].get(bic[:8])
        if entry is None:
            self.add("C-UNKNOWN", WARN, "BIC辞書に未登録",
                     f"{bic} は config/bank_directory.json に登録がなく、銀行名との自動照合ができない。",
                     "SWIFT公式（swift.com/bsl）または銀行窓口で銀行名・所在地を確認し、辞書に追記する。")
        else:
            if norm_text(entry["bank_name"]) != norm_text(agent.get("name")):
                self.add("C-NAME", BLOCK, "BICと送金先銀行名が一致しない",
                         f"BIC {bic[:8]} の正式名は {entry['bank_name']!r} だが、"
                         f"申込書は {agent.get('name')!r}。",
                         "銀行を取り違えている恐れがある。"
                         + (f" 補足：{entry['note']}" if entry.get("note") else ""))
            if len(bic) == 8:
                self.add("C-8CHAR", INFO, "BICは8桁で指定されている",
                         f"{bic}（本店宛）。11桁を要求されたら {bic}XXX とする。"
                         "先方提出資料にもその旨の記載がある。")

    # -- D. 口座番号の形式 --------------------------------------------------
    def check_account_format(self):
        acct_raw = self.tx.get("creditor_account") or ""
        acct = norm_account(acct_raw)
        if not acct:
            return

        if acct != str(acct_raw).strip():
            self.add("D-CHARS", WARN, "口座番号に空白か記号が混じっている",
                     f"入力値 {acct_raw!r} → 除去後 {acct}。",
                     "銀行によっては記号を含めるとエラーになる。数字のみで入力する。")

        agent = self.tx.get("creditor_agent") or {}
        cc = country_code(agent.get("country")) or ((agent.get("bic") or "")[4:6] or None)

        if cc in self.banks["iban_countries"]:
            if not iban_is_valid(acct):
                self.add("D-IBAN", BLOCK, "IBANのチェックディジットが合わない",
                         f"{cc} はIBAN必須国だが、{acct} はmod-97検証を通らない。",
                         "IBANを再確認する。1文字の打ち間違いでも検出される。")
            else:
                self.add("D-IBAN-OK", INFO, "IBANのチェックディジット照合に成功", f"{acct}")
            return

        rule = self.banks["account_format_rules"].get(cc)
        if rule:
            if rule.get("digits_only") and not acct.isdigit():
                self.add("D-DIGIT", BLOCK, "口座番号に数字以外が含まれる",
                         f"{cc} の口座番号は数字のみのはずだが {acct!r}。", rule.get("note"))
            elif not (rule["min_len"] <= len(acct) <= rule["max_len"]):
                self.add("D-LEN", WARN, "口座番号の桁数が想定範囲外",
                         f"{acct}（{len(acct)}桁）。{cc} の想定は "
                         f"{rule['min_len']}〜{rule['max_len']}桁。",
                         (rule.get("note") or "") + " 桁の脱落・重複がないか原本と照合する。")
            else:
                self.add("D-OK", INFO, "口座番号の形式は想定どおり",
                         f"{acct}（{len(acct)}桁、{cc}）。"
                         "ただし形式が正しいことと、その口座が実在し受取人本人のものであることは別。")

    # -- E. 送金経路と国 ----------------------------------------------------
    def check_routing_and_country(self):
        tx = self.tx
        creditor = tx.get("creditor") or {}
        agent = tx.get("creditor_agent") or {}
        purpose = tx.get("purpose") or {}

        cc_creditor = country_code(creditor.get("country"))
        cc_bank = country_code(agent.get("country"))
        cc_origin = country_code(purpose.get("origin"))

        if cc_creditor and cc_bank and cc_creditor != cc_bank:
            self.add("E-XBORDER", WARN, "受取人の所在国と受取銀行の所在国が違う",
                     f"受取人＝{creditor.get('country')} / 受取銀行＝{agent.get('country')}。",
                     "実態として問題ないこともあるが、銀行のAML審査で理由を聞かれる。説明を用意しておく。")

        if cc_origin and cc_creditor and cc_origin != cc_creditor:
            offshore = self.risk["offshore_payment_jurisdictions"]["country_codes"]
            extra = ("受取人所在地はオフショア決済に使われやすい地域にあたる。"
                     if cc_creditor in offshore else "")
            self.add("E-THIRD", WARN, "商品の原産地と支払先の国が違う（第三国決済）",
                     f"原産地＝{purpose.get('origin')}／船積地＝{purpose.get('port_of_loading')} "
                     f"に対し、支払先は {creditor.get('country')} の {creditor.get('name')}。{extra}",
                     "違法な形態ではないが、銀行のAML照会と税務調査で最も説明を求められる点。"
                     "売買契約書またはINVOICE上に『支払先＝この受取人』と明記された書面を用意し、"
                     "契約当事者と入金先が一致していることを示せるようにしておく。")

        if not tx.get("intermediary_agent"):
            self.add("E-INTER", INFO, "経由銀行の指定なし",
                     "USD建てのため、実際には米国内のコルレス銀行を経由する。"
                     "経由銀行の手数料（1件あたり概ね15〜25USD）が差し引かれることがある。",
                     "全額着金が必要な取引かどうかを確認する（下の手数料負担の項目を参照）。")

    # -- F. 制裁・規制スクリーニング ----------------------------------------
    def _screening_text(self):
        """スクリーニング対象の文字列を集める。

        JSON全体を文字列化して走査すると、`not_russia_ukraine_belarus` のような
        フィールド名自身に地名が入っているせいで誤検知する。人が実際に入力した
        値だけを対象にする。
        """
        tx = self.tx
        parts = []
        for section in ("creditor", "ultimate_creditor", "debtor", "ultimate_debtor",
                        "applicant", "creditor_agent", "intermediary_agent", "purpose"):
            block = tx.get(section) or {}
            if isinstance(block, dict):
                parts += [str(v) for k, v in block.items()
                          if isinstance(v, str) and not k.startswith("_")]
        for key in ("remittance_information", "instruction_for_debtor_agent",
                    "end_to_end_identification", "debtor_reference_no"):
            if isinstance(tx.get(key), str):
                parts.append(tx[key])
        return " | ".join(parts)

    def check_sanctions(self):
        """申込書に印字された表明と、実際に入力された国・地名が矛盾していないか。"""
        tx = self.tx
        blob = self._screening_text()

        for kw in self.risk["prohibited"]["keywords"]:
            if contains_keyword(blob, kw):
                self.add("F-PROHIB", BLOCK, "禁止・凍結措置の対象地域を示す語を検出",
                         f"受取人・銀行・送金目的の入力値に {kw!r} が含まれている。",
                         "外為法上の支払等の禁止・資産凍結措置に該当しないか確認するまで送金しない。")

        for kw in self.risk["restricted"]["keywords"]:
            if contains_keyword(blob, kw):
                self.add("F-RESTRICT", BLOCK, "要許可・要申告の地域を示す語を検出",
                         f"受取人・銀行・送金目的の入力値に {kw!r} が含まれている。"
                         "申込書には『ロシア、ウクライナ、ベラルーシに関連する取引に該当しません』"
                         "という表明が入っており、記載内容と矛盾する可能性がある。",
                         "取引の実態を確認し、該当する場合は銀行へ別途申告する。")

        cc = country_code((tx.get("creditor") or {}).get("country"))
        if cc in self.risk["high_risk_jurisdictions"]["country_codes"]:
            self.add("F-FATF", WARN, "受取人所在国が高リスク管轄に該当",
                     f"{cc} はFATFの強化監視対象に挙がることがある国・地域。",
                     "銀行から追加資料（契約書・INVOICE・取引経緯）を求められる前提で準備する。")

        decl = tx.get("declarations") or {}
        for key, label in (
            ("not_north_korea_iran", "北朝鮮・イラン規制に非該当"),
            ("not_north_korea_payment_ban", "北朝鮮向け支払禁止措置に非該当"),
            ("not_russia_ukraine_belarus", "ロシア・ウクライナ・ベラルーシ関連に非該当"),
            ("consent", "内容への同意"),
        ):
            if not decl.get(key):
                self.add("F-DECL", BLOCK, f"表明・同意が未チェック：{label}",
                         "申込書のこの欄にチェックが入っていない。", "内容を確認のうえチェックする。")

    # -- G. 金額 ------------------------------------------------------------
    def check_amount(self):
        """INVOICEとの金額照合。桁の打ち間違いは実害が最も大きい誤りなので、専用に見る。"""
        tx = self.tx
        amount = (tx.get("amount") or {}).get("value")
        currency = (tx.get("amount") or {}).get("currency")
        inv = tx.get("invoice") or {}

        if amount is None:
            return  # 金額そのものが未入力。A-REQ で既に送金停止として報告済み。

        if inv.get("total") is None:
            self.add("G-NOINV", BLOCK, "INVOICEとの金額照合ができていない",
                     f"申込書の送金額は {currency} {amount:,.2f} だが、"
                     "照合相手のINVOICE金額が未入力（invoice.total が null）。",
                     "INVOICE（またはProforma Invoice）の現物を見て、"
                     "invoice.number / date / currency / total / products を data のJSONに入力し、再実行する。"
                     "金額の突合を省いたまま実行してよい送金はない。")
            return

        if inv.get("currency") and inv["currency"] != currency:
            self.add("G-CUR", BLOCK, "通貨がINVOICEと違う",
                     f"申込書＝{currency} / INVOICE＝{inv['currency']}。",
                     "どちらかが誤り。")

        diff = round(float(amount) - float(inv["total"]), 2)
        if diff == 0:
            self.add("G-OK", INFO, "INVOICE金額と一致",
                     f"{currency} {amount:,.2f} ＝ INVOICE {inv['total']:,.2f}")
        else:
            # 桁ズレは金額差が大きく、原因も対処も違うので別建てで知らせる。
            ratio = float(amount) / float(inv["total"]) if inv["total"] else 0
            hint = ""
            for factor, name in ((10, "10倍"), (100, "100倍"), (0.1, "1/10"), (0.01, "1/100")):
                if abs(ratio - factor) < 0.02 * factor:
                    hint = f" 比率がちょうど{name}で、桁の打ち間違いの可能性が高い。"
                    break
            self.add("G-DIFF", BLOCK, "INVOICE金額と一致しない",
                     f"申込書＝{currency} {amount:,.2f} / INVOICE＝{inv['total']:,.2f} "
                     f"（差額 {diff:+,.2f}）。{hint}",
                     "金額を訂正するか、差額の理由（一部前払・値引・相殺など）を書面で残す。")

        if inv.get("beneficiary_account") and norm_account(inv["beneficiary_account"]) != norm_account(tx.get("creditor_account")):
            self.add("G-ACCT", BLOCK, "INVOICE記載の口座と申込書の口座が違う",
                     f"INVOICE＝{inv['beneficiary_account']} / 申込書＝{tx.get('creditor_account')}",
                     "口座の差し替えを疑う。電話での口頭確認が済むまで送金しない。")

    def check_charges(self):
        """海外銀行手数料の負担区分。全額着金が要る取引でBEN指定だと、必ず不足が起きる。"""
        tx = self.tx
        charges = tx.get("foreign_bank_charges")
        amount = (tx.get("amount") or {}).get("value")
        currency = (tx.get("amount") or {}).get("currency")
        if amount is None:
            return

        if charges == "CREDITOR":
            self.add("H-BEN", WARN, "海外銀行手数料が受取人負担になっている",
                     f"受取人負担(CREDITOR/BEN)のため、受取人の着金額は {currency} {amount:,.2f} を下回る"
                     "（経由銀行と受取銀行の手数料が差し引かれる）。",
                     "輸入代金の全額決済なら、通常は送金人負担(DEBTOR/OUR)を選ぶ。"
                     "受取人負担のままだと、先方から不足分の追送金を求められる。")
        elif charges == "DEBTOR":
            self.add("H-OUR", INFO, "海外銀行手数料は送金人負担",
                     f"送金人負担(DEBTOR/OUR)のため、受取人には {currency} {amount:,.2f} が満額届く。"
                     "海外銀行手数料は自社の別途負担になる。")
        else:
            self.add("H-NONE", WARN, "海外銀行手数料の負担区分が未選択",
                     "受取人負担／送金人負担のどちらにもチェックがない。",
                     "選択しないと銀行の既定（多くはSHA）で処理され、着金額が想定と変わる。")

        if tx.get("settlement_method") == "直物" and not tx.get("fx_contract_no"):
            self.add("H-FX", INFO, "為替予約なしの直物取引",
                     f"予約番号が空欄のため、円貨の引落額は実行日の相場で決まる。"
                     f"送金額 {currency} {amount:,.2f} は、1ドル150円なら約{amount*150/10000:,.0f}万円、"
                     f"155円なら約{amount*155/10000:,.0f}万円で、5円動くと約"
                     f"{amount*5/10000:,.0f}万円の差が出る。",
                     "引落口座の残高がこの水準を上回っているか、実行日前に確認する。")

    # -- I. 送金目的と商材 --------------------------------------------------
    def check_purpose_and_products(self):
        """『送金理由(DETAILS)』が、実際にINVOICEへ載っている商材を網羅しているか。"""
        tx = self.tx
        purpose = tx.get("purpose") or {}
        details = (purpose.get("details") or "").upper()
        inv_products = (tx.get("invoice") or {}).get("products") or []

        if not details:
            self.add("I-NODETAIL", WARN, "送金理由(DETAILS)が空欄",
                     "輸入代金であれば品目を記載する。", "商品名を入力する。")
            return

        listed, missing = [], []
        for p in self.products["products"]:
            hit = any(kw in details for kw in p["keywords_en"])
            (listed if hit else missing).append(p)

        if inv_products:
            # INVOICEの品目が分かっているなら、そこに載っているものだけを対象にする。
            inv_blob = " ".join(str(x) for x in inv_products).upper()
            missing = [p for p in missing
                       if any(kw in inv_blob for kw in p["keywords_en"]) or p["name_ja"] in inv_blob]
            if missing:
                self.add("I-MISSING", BLOCK, "送金理由がINVOICEの品目を網羅していない",
                         f"送金理由は「{purpose.get('details')}」だが、INVOICEには "
                         + "、".join(f"{p['name_ja']}({p['name_en']})" for p in missing)
                         + " も含まれている。",
                         "送金理由に全品目を記載する。記載と実態がずれていると、"
                         "外為法上の告知内容の誤りになり、通関書類との突合でも齟齬が出る。")
        elif missing and listed:
            self.add("I-SCOPE", WARN, "送金理由が単一品目のみ",
                     f"送金理由は「{purpose.get('details')}」で、取扱商材のうち "
                     + "、".join(p["name_ja"] for p in listed) + " しか含まれていない。"
                     "取扱商材には他に " + "、".join(p["name_ja"] for p in missing) + " がある。",
                     "この送金が本当にスーツケースだけの代金なら問題ない。"
                     "他の商材も含む合算払いなら、送金理由に全品目を書く必要がある。"
                     "INVOICEの品目欄と必ず突き合わせること。")

        if purpose.get("category") != "輸入":
            self.add("I-CAT", WARN, "送金目的の区分を確認",
                     f"送金目的は「{purpose.get('category')}」。物品代金の支払なら「輸入」が該当する。")

        if not purpose.get("purpose_code") and not purpose.get("imf_code"):
            self.add("I-CODE", INFO, "送金理由コード・国際収支項目番号が空欄",
                     "銀行側で補記されることが多い欄。"
                     "輸入代金の一般的な国際収支項目番号は 110（一般商品）系。",
                     "銀行から指定があれば従う。")

    # -- J. 日付 ------------------------------------------------------------
    def check_dates(self):
        tx = self.tx
        try:
            value_date = datetime.date.fromisoformat(tx["value_date"])
        except (KeyError, TypeError, ValueError):
            return

        printed = tx.get("printed_at")
        base = datetime.date.fromisoformat(printed[:10]) if printed else datetime.date.today()

        if value_date < base:
            self.add("J-PAST", BLOCK, "送金指定日が過去日",
                     f"送金指定日 {value_date} は申込時点 {base} より前。",
                     "日付を訂正する。")

        if value_date.weekday() >= 5:
            self.add("J-WEEKEND", WARN, "送金指定日が土日",
                     f"{value_date} は{'土日'[value_date.weekday()-5]}曜日で銀行休業日。",
                     "翌営業日に変更する。")
        else:
            self.add("J-DATE", INFO, "送金指定日は平日",
                     f"{value_date}（{'月火水木金土日'[value_date.weekday()]}曜日）。"
                     f"申込時点 {base} から中{(value_date - base).days - 1}日。")

        if tx.get("status") and tx["status"] != "承認済み":
            self.add("J-STATUS", WARN, f"ステータスが「{tx['status']}」",
                     f"送金指定日 {value_date} に実行するには、それまでに社内承認を通す必要がある。"
                     "当日扱いには銀行の受付時限もある。",
                     "承認者と期限を確認する。")

    # -- K. 法令・記録 ------------------------------------------------------
    def check_compliance(self):
        tx = self.tx
        amount = (tx.get("amount") or {}).get("value") or 0
        currency = (tx.get("amount") or {}).get("currency")

        # 国外送金等調書は100万円超が対象。USD建てでも円換算で判定する。
        if currency != "JPY" and amount > 0:
            self.add("K-REPORT", INFO, "国外送金等調書の対象になる規模",
                     f"{currency} {amount:,.2f} は円換算で100万円を大きく超えるため、"
                     "金融機関から税務署へ国外送金等調書が提出される。"
                     "この申込書自体が同法3条の告知書を兼ねている。",
                     "申告内容（送金目的・受取人）と、法人税・消費税の申告内容が"
                     "整合していることを確認しておく。")

        if tx.get("fefta_license", "").startswith("不要"):
            self.add("K-FEFTA", INFO, "外為法上の許可は「不要」で申告",
                     "一般消費財の輸入代金支払であれば通常は許可不要。",
                     "受取人・仕向地が制裁対象に該当しないことが前提。上の制裁スクリーニング結果を併せて確認する。")

        if (tx.get("declarations") or {}).get("attachment") == "あり":
            self.add("K-ATTACH", WARN, "添付ファイル「あり」の中身を確認",
                     "申込書には添付ファイルありと記載されている。"
                     "通常はINVOICEやProforma Invoiceが添付される。",
                     "添付されている書類が、この送金額・受取人・品目と一致しているかを実物で確認する。"
                     "本ツールは添付書類そのものを検証していない。")


# ---------------------------------------------------------------- 出力

def render_text(tx, findings):
    out = []
    amount = tx.get("amount") or {}
    amount_str = (f"{amount.get('currency')} {amount['value']:,.2f}"
                  if amount.get("value") is not None else "(未入力)")
    out.append("=" * 74)
    out.append("  海外送金 事前チェック結果")
    out.append("=" * 74)
    out.append(f"  受付番号   : {tx.get('reference_no')}")
    out.append(f"  ステータス : {tx.get('status')}")
    out.append(f"  送金金額   : {amount_str}")
    out.append(f"  受取人     : {(tx.get('creditor') or {}).get('name')}"
               f" ({(tx.get('creditor') or {}).get('country')})")
    out.append(f"  受取銀行   : {(tx.get('creditor_agent') or {}).get('name')}"
               f" / {(tx.get('creditor_agent') or {}).get('bic')}")
    out.append(f"  送金指定日 : {tx.get('value_date')}")
    out.append("=" * 74)

    counts = {INFO: 0, WARN: 0, BLOCK: 0}
    for f in findings:
        counts[f.severity] += 1

    for sev in (BLOCK, WARN, INFO):
        group = [f for f in findings if f.severity == sev]
        if not group:
            continue
        out.append("")
        out.append(f"{LABEL[sev]}  ({len(group)}件)")
        out.append("-" * 74)
        for i, f in enumerate(group, 1):
            out.append(f"{i}. [{f.code}] {f.title}")
            out.append(f"   {f.detail}")
            if f.action:
                out.append(f"   → {f.action}")
            out.append("")

    out.append("=" * 74)
    if counts[BLOCK]:
        verdict = f"判定: 送金不可。🔴{counts[BLOCK]}件を解消してから再実行すること。"
    elif counts[WARN]:
        verdict = f"判定: 条件付き可。🟡{counts[WARN]}件を確認のうえ承認すること。"
    else:
        verdict = "判定: 問題なし。"
    out.append(f"  {verdict}")
    out.append(f"  🔴{counts[BLOCK]}件 / 🟡{counts[WARN]}件 / 🔵{counts[INFO]}件")
    out.append("=" * 74)
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser(description="海外送金申込書の事前チェック")
    ap.add_argument("transaction", help="送金データJSON（data/*.json）")
    ap.add_argument("--json", action="store_true", help="結果をJSONで出力する")
    args = ap.parse_args()

    with open(args.transaction, encoding="utf-8") as f:
        tx = json.load(f)

    verifier = RemittanceVerifier(
        tx,
        load_config("beneficiaries.json"),
        load_config("bank_directory.json"),
        load_config("risk_screening.json"),
        load_config("products.json"),
    )
    findings = verifier.run()

    if args.json:
        print(json.dumps({
            "reference_no": tx.get("reference_no"),
            "findings": [f.to_dict() for f in findings],
        }, ensure_ascii=False, indent=2))
    else:
        print(render_text(tx, findings))

    worst = max((f.severity for f in findings), default=INFO)
    return {INFO: 0, WARN: 1, BLOCK: 2}[worst]


if __name__ == "__main__":
    sys.exit(main())
