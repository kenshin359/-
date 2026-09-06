#!/usr/bin/env python3
"""検証エンジンのテスト。標準ライブラリの unittest だけで動く。

    python3 -m unittest discover -s tests -v
"""

import copy
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import verify_remittance as vr  # noqa: E402

BASE_TX = json.loads((ROOT / "data" / "OMT20260901100481.json").read_text(encoding="utf-8"))


def verify(tx, beneficiaries=None):
    v = vr.RemittanceVerifier(
        tx,
        beneficiaries or vr.load_config("beneficiaries.json"),
        vr.load_config("bank_directory.json"),
        vr.load_config("risk_screening.json"),
        vr.load_config("products.json"),
    )
    return v.run()


def codes(findings, severity=None):
    return {f.code for f in findings if severity is None or f.severity == severity}


def verified_master():
    """口座の口頭確認が済んだ状態のマスタ。B-VERIFY を消して他の検査を見たいとき用。"""
    b = vr.load_config("beneficiaries.json")
    b["beneficiaries"][0]["verification"] = {
        "verified": True, "verified_at": "2026-08-20",
        "verified_by": "テスト", "method": "登録済電話へのコールバック",
    }
    return b


class TestHelpers(unittest.TestCase):
    def test_norm_text_absorbs_punctuation_and_width(self):
        self.assertEqual(vr.norm_text("REK, CO., LTD."), vr.norm_text("REK CO.,LTD"))
        self.assertEqual(vr.norm_text("ＤＢＳ ＢＡＮＫ"), vr.norm_text("DBS BANK"))

    def test_norm_text_still_separates_different_names(self):
        self.assertNotEqual(vr.norm_text("HUGH TRADING LIMITED"),
                            vr.norm_text("HUGH TRADING LIMITE"))

    def test_norm_account_strips_separators(self):
        self.assertEqual(vr.norm_account("799-6993 1316469"), "79969931316469")

    def test_country_code(self):
        self.assertEqual(vr.country_code("HONG KONG"), "HK")
        self.assertEqual(vr.country_code("香港"), "HK")
        self.assertEqual(vr.country_code("HK"), "HK")
        self.assertIsNone(vr.country_code("ATLANTIS"))

    def test_iban_check_digits(self):
        self.assertTrue(vr.iban_is_valid("DE89 3704 0044 0532 0130 00"))
        self.assertTrue(vr.iban_is_valid("GB82WEST12345698765432"))
        # 1文字だけ書き換えると落ちる、というのがIBAN検査の目的。
        self.assertFalse(vr.iban_is_valid("DE89370400440532013001"))
        self.assertFalse(vr.iban_is_valid("GB82WEST12345698765433"))

    def test_contains_keyword_respects_word_boundary(self):
        self.assertTrue(vr.contains_keyword("SHIPPED FROM CHINA SHENZHEN", "CHINA"))
        # 部分一致で暴発しないこと。
        self.assertFalse(vr.contains_keyword("INDOCHINA TRADING", "CHINA"))


class TestActualApplication(unittest.TestCase):
    """今回の申込書 OMT20260901100481 そのものに対する期待値。"""

    def setUp(self):
        self.findings = verify(copy.deepcopy(BASE_TX))

    def test_master_fields_all_match(self):
        # 受取人名・口座・BIC はマスタと完全一致しているはず。
        self.assertNotIn("B-DIFF", codes(self.findings))
        self.assertNotIn("B-ADDR", codes(self.findings))

    def test_bic_passes_all_structural_checks(self):
        for code in ("C-FMT", "C-TEST", "C-COUNTRY", "C-NAME", "C-UNKNOWN"):
            self.assertNotIn(code, codes(self.findings), f"{code} が出てはいけない")

    def test_account_format_ok(self):
        self.assertIn("D-OK", codes(self.findings))

    def test_no_false_sanctions_hit_from_declaration_field_names(self):
        # declarations の not_russia_ukraine_belarus というキー名で誤検知しないこと。
        self.assertNotIn("F-RESTRICT", codes(self.findings))
        self.assertNotIn("F-PROHIB", codes(self.findings))

    def test_third_country_payment_flagged(self):
        # 原産地CHINA / 支払先HONG KONG のずれは必ず拾う。
        self.assertIn("E-THIRD", codes(self.findings, vr.WARN))

    def test_product_scope_flagged(self):
        # 送金理由が SUITCASE のみ＝他4商材が入っていないことを警告する。
        self.assertIn("I-SCOPE", codes(self.findings, vr.WARN))

    def test_missing_invoice_blocks(self):
        self.assertIn("G-NOINV", codes(self.findings, vr.BLOCK))

    def test_unverified_beneficiary_blocks(self):
        self.assertIn("B-VERIFY", codes(self.findings, vr.BLOCK))

    def test_charges_are_our(self):
        self.assertIn("H-OUR", codes(self.findings))
        self.assertNotIn("H-BEN", codes(self.findings))

    def test_value_date_is_a_weekday(self):
        self.assertIn("J-DATE", codes(self.findings))
        self.assertNotIn("J-WEEKEND", codes(self.findings))
        self.assertNotIn("J-PAST", codes(self.findings))


class TestTamperDetection(unittest.TestCase):
    """口座の差し替え（送金詐欺）を検知できることの確認。"""

    def test_changed_account_number_blocks(self):
        tx = copy.deepcopy(BASE_TX)
        tx["creditor_account"] = "79969931316460"  # 末尾1桁だけ差し替え
        f = verify(tx, verified_master())
        self.assertIn("B-DIFF", codes(f, vr.BLOCK))

    def test_changed_bic_blocks(self):
        tx = copy.deepcopy(BASE_TX)
        tx["creditor_agent"]["bic"] = "DBSSSGSG"
        tx["creditor_agent"]["name"] = "DBS BANK LTD"
        tx["creditor_agent"]["country"] = "SINGAPORE"
        f = verify(tx, verified_master())
        self.assertIn("B-DIFF", codes(f, vr.BLOCK))

    def test_bic_country_mismatch_blocks(self):
        # BICだけシンガポールに差し替え、国名は香港のまま＝典型的な取り違え。
        tx = copy.deepcopy(BASE_TX)
        tx["creditor_agent"]["bic"] = "DBSSSGSG"
        f = verify(tx, verified_master())
        self.assertIn("C-COUNTRY", codes(f, vr.BLOCK))
        self.assertIn("C-NAME", codes(f, vr.BLOCK))

    def test_beneficiary_name_change_blocks(self):
        tx = copy.deepcopy(BASE_TX)
        tx["creditor"]["name"] = "HUGH TRADING CO LIMITED"
        f = verify(tx, verified_master())
        self.assertIn("B-DIFF", codes(f, vr.BLOCK))

    def test_malformed_bic_blocks(self):
        tx = copy.deepcopy(BASE_TX)
        tx["creditor_agent"]["bic"] = "DHBK-HKHH"
        f = verify(tx, verified_master())
        self.assertIn("C-FMT", codes(f, vr.BLOCK))

    def test_test_bic_blocks(self):
        tx = copy.deepcopy(BASE_TX)
        tx["creditor_agent"]["bic"] = "DHBKHKH0"
        f = verify(tx, verified_master())
        self.assertIn("C-TEST", codes(f, vr.BLOCK))


class TestAmountChecks(unittest.TestCase):
    def _with_invoice(self, total, **kw):
        tx = copy.deepcopy(BASE_TX)
        tx["invoice"].update({
            "number": "HT-2026-0819", "date": "2026-08-19",
            "currency": "USD", "total": total,
        })
        tx["invoice"].update(kw)
        return tx

    def test_matching_invoice_passes(self):
        f = verify(self._with_invoice(238537.00), verified_master())
        self.assertIn("G-OK", codes(f))
        self.assertNotIn("G-DIFF", codes(f))

    def test_amount_mismatch_blocks(self):
        f = verify(self._with_invoice(238557.00), verified_master())
        self.assertIn("G-DIFF", codes(f, vr.BLOCK))

    def test_digit_shift_is_called_out(self):
        # INVOICE 23,853.70 に対し送金 238,537.00 ＝ 10倍の打ち間違い。
        f = verify(self._with_invoice(23853.70), verified_master())
        hit = [x for x in f if x.code == "G-DIFF"]
        self.assertTrue(hit)
        self.assertIn("10倍", hit[0].detail)

    def test_currency_mismatch_blocks(self):
        f = verify(self._with_invoice(238537.00, currency="CNY"), verified_master())
        self.assertIn("G-CUR", codes(f, vr.BLOCK))

    def test_invoice_account_mismatch_blocks(self):
        f = verify(self._with_invoice(238537.00, beneficiary_account="79969931316460"),
                   verified_master())
        self.assertIn("G-ACCT", codes(f, vr.BLOCK))

    def test_products_not_covered_by_details_blocks(self):
        tx = self._with_invoice(238537.00)
        tx["invoice"]["products"] = ["SUITCASE 20INCH x500", "HAIR DRYER 1200W x300"]
        f = verify(tx, verified_master())
        hit = [x for x in f if x.code == "I-MISSING"]
        self.assertTrue(hit, "送金理由SUITCASEにドライヤーが入っていないことを検知できていない")
        self.assertEqual(hit[0].severity, vr.BLOCK)

    def test_products_fully_covered_passes(self):
        tx = self._with_invoice(238537.00)
        tx["invoice"]["products"] = ["SUITCASE 20INCH x500"]
        tx["purpose"]["details"] = "SUITCASE"
        f = verify(tx, verified_master())
        self.assertNotIn("I-MISSING", codes(f))


class TestChargesAndDates(unittest.TestCase):
    def test_beneficiary_pays_charges_warns(self):
        tx = copy.deepcopy(BASE_TX)
        tx["foreign_bank_charges"] = "CREDITOR"
        f = verify(tx, verified_master())
        self.assertIn("H-BEN", codes(f, vr.WARN))

    def test_missing_charge_option_warns(self):
        tx = copy.deepcopy(BASE_TX)
        tx["foreign_bank_charges"] = None
        f = verify(tx, verified_master())
        self.assertIn("H-NONE", codes(f, vr.WARN))

    def test_weekend_value_date_warns(self):
        tx = copy.deepcopy(BASE_TX)
        tx["value_date"] = "2026-09-05"  # 土曜日
        f = verify(tx, verified_master())
        self.assertIn("J-WEEKEND", codes(f, vr.WARN))

    def test_past_value_date_blocks(self):
        tx = copy.deepcopy(BASE_TX)
        tx["value_date"] = "2026-08-31"
        f = verify(tx, verified_master())
        self.assertIn("J-PAST", codes(f, vr.BLOCK))


class TestSanctionsScreening(unittest.TestCase):
    def test_prohibited_destination_blocks(self):
        tx = copy.deepcopy(BASE_TX)
        tx["purpose"]["origin"] = "IRAN"
        f = verify(tx, verified_master())
        self.assertIn("F-PROHIB", codes(f, vr.BLOCK))

    def test_restricted_destination_blocks(self):
        tx = copy.deepcopy(BASE_TX)
        tx["creditor"]["country"] = "RUSSIA"
        f = verify(tx, verified_master())
        self.assertIn("F-RESTRICT", codes(f, vr.BLOCK))

    def test_unchecked_declaration_blocks(self):
        tx = copy.deepcopy(BASE_TX)
        tx["declarations"]["consent"] = False
        f = verify(tx, verified_master())
        self.assertIn("F-DECL", codes(f, vr.BLOCK))


class TestRequiredFields(unittest.TestCase):
    def test_missing_account_blocks(self):
        tx = copy.deepcopy(BASE_TX)
        tx["creditor_account"] = None
        f = verify(tx, verified_master())
        self.assertIn("A-REQ", codes(f, vr.BLOCK))

    def test_missing_debtor_address_blocks_travel_rule(self):
        tx = copy.deepcopy(BASE_TX)
        tx["debtor"]["street"] = None
        f = verify(tx, verified_master())
        self.assertIn("A-TR16", codes(f, vr.BLOCK))

    def test_missing_amount_does_not_crash(self):
        tx = copy.deepcopy(BASE_TX)
        tx["amount"]["value"] = None
        f = verify(tx, verified_master())  # 例外を出さずに完走すること
        self.assertIn("A-REQ", codes(f, vr.BLOCK))
        self.assertTrue(vr.render_text(tx, f))

    def test_iban_country_account_is_validated(self):
        tx = copy.deepcopy(BASE_TX)
        tx["creditor_agent"]["bic"] = "DEUTDEFF"
        tx["creditor_agent"]["name"] = "DEUTSCHE BANK AG"
        tx["creditor_agent"]["country"] = "GERMANY"
        tx["creditor_account"] = "DE89370400440532013001"  # 壊れたIBAN
        f = verify(tx, verified_master())
        self.assertIn("D-IBAN", codes(f, vr.BLOCK))


if __name__ == "__main__":
    unittest.main(verbosity=2)
