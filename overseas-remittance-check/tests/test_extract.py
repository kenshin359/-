#!/usr/bin/env python3
"""PDF読み取りのテスト。

申込書PDFそのものはリポジトリに入れていない（口座番号を含む取引書類のため）。
samples/ に置けばテストが動く。無ければスキップする。

    cp 送金申込書.pdf overseas-remittance-check/samples/remittance.pdf
    python3 -m unittest discover -s tests -v
"""

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

SAMPLE = ROOT / "samples" / "remittance.pdf"
DATA = ROOT / "data" / "OMT20260901100481.json"

try:
    import extract_pdf
    HAVE_PYMUPDF = True
except SystemExit:
    HAVE_PYMUPDF = False


@unittest.skipUnless(SAMPLE.exists(), f"サンプルPDFがない: {SAMPLE}")
@unittest.skipUnless(HAVE_PYMUPDF, "pymupdf が入っていない")
class TestExtract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = extract_pdf.extract(str(SAMPLE))

    def test_money_critical_fields_read(self):
        for field in ("reference_no", "creditor_account", "bic",
                      "amount_value", "amount_currency", "value_date"):
            self.assertTrue(self.data[field], f"{field} が読めていない")

    def test_checkboxes_resolve_unambiguously(self):
        for group, info in self.data["_checkboxes"].items():
            self.assertTrue(info["marked"], f"{group} のチェックが取れていない")

    def test_no_extraction_warnings(self):
        self.assertEqual(self.data["_warnings"], [])

    def test_matches_committed_json(self):
        """PDFの読み取り値と、リポジトリに入れた送金データが一致すること。

        これが落ちたら、手入力を間違えたか、銀行が帳票レイアウトを変えたかのどちらか。
        """
        tx = json.loads(DATA.read_text(encoding="utf-8"))
        matched, mismatches = extract_pdf.compare(self.data, tx)
        self.assertEqual(mismatches, [], f"転記不一致: {mismatches}")
        self.assertGreaterEqual(len(matched), 17)


class TestNormalizers(unittest.TestCase):
    @unittest.skipUnless(HAVE_PYMUPDF, "pymupdf が入っていない")
    def test_amount_normalizer_ignores_formatting(self):
        self.assertEqual(extract_pdf.norm_amount("238,537.00"),
                         extract_pdf.norm_amount(238537.0))

    @unittest.skipUnless(HAVE_PYMUPDF, "pymupdf が入っていない")
    def test_date_normalizer_ignores_separators(self):
        self.assertEqual(extract_pdf.norm_date("2026/09/03"),
                         extract_pdf.norm_date("2026-09-03"))

    @unittest.skipUnless(HAVE_PYMUPDF, "pymupdf が入っていない")
    def test_amount_normalizer_still_separates_different_amounts(self):
        self.assertNotEqual(extract_pdf.norm_amount("238,537.00"),
                            extract_pdf.norm_amount("23,853.70"))
