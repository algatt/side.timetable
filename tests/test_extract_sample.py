"""Checks for subject normalization and visually verified sample PDF lessons."""

import hashlib
import unittest
from pathlib import Path

import pdfplumber

from backend.extract_sample import LayoutError, nearest_boundary, parse_page, parse_subject


SOURCE = Path(__file__).resolve().parents[1] / "data/source/timetable.pdf"
VERIFIED_SHA256 = "736f4378e3bb736b9d03781e540fadf7995b4467eef7cb7a260c6809d9c6fa93"


class SubjectTests(unittest.TestCase):
    def test_spaces_in_code_and_multiple_rooms_are_preserved(self):
        self.assertEqual(parse_subject("CDPSD-000- 2301 - My Personal Journey\nICT-126\nICT-142"),
                         ("CDPSD-000-2301", "My Personal Journey", ["ICT-126", "ICT-142"]))

    def test_wrapped_name_with_no_separator_after_code(self):
        self.assertEqual(parse_subject("ITMMD-406-2004\nIntroduction to Object\nOriented Programming\nICT-B05"),
                         ("ITMMD-406-2004", "Introduction to Object Oriented Programming", ["ICT-B05"]))

    def test_ambiguous_subjects_fail_instead_of_merging(self):
        with self.assertRaises(LayoutError):
            parse_subject("ITSYS-206-2002 Systems\nITSFT-206-1602 Programming\nICT-142")

    def test_name_must_be_present(self):
        with self.assertRaises(LayoutError):
            parse_subject("ITSYS-206-2002\nICT-142")

    def test_nonuniform_rows_use_printed_times(self):
        rows = [{"top": 100, "bottom": 120, "start_minutes": 480, "end_minutes": 510},
                {"top": 121, "bottom": 150, "start_minutes": 510, "end_minutes": 540}]
        self.assertEqual(nearest_boundary(121.1, rows, "top"), 510)
        self.assertEqual(nearest_boundary(150, rows, "bottom"), 540)
        with self.assertRaises(LayoutError):
            nearest_boundary(135, rows, "top")


class DownloadedPdfTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not SOURCE.exists():
            raise unittest.SkipTest("Download the source PDF to run sample integration checks.")
        if hashlib.sha256(SOURCE.read_bytes()).hexdigest() != VERIFIED_SHA256:
            raise unittest.SkipTest("The source PDF changed; verify new sample expectations first.")
        cls.pdf = pdfplumber.open(SOURCE)
        cls.addClassCleanup(cls.pdf.close)
        cls.results = {n: parse_page(cls.pdf.pages[n - 1]) for n in (1, 2, 4, 41, 51)}

    def test_sample_counts_and_coverage(self):
        for number, count in ((1, 2), (2, 12), (4, 17), (41, 13), (51, 8)):
            with self.subTest(page=number):
                result = self.results[number]
                self.assertEqual(len(result["lessons"]), count)
                self.assertEqual(result["issues"], [])
                self.assertEqual(result["source_text_counts"]["subject_codes"], count)
                self.assertEqual(result["time_row_count"], 24)
                self.assertEqual(result["time_range"], ["08:00", "20:00"])

    def test_two_day_page_uses_actual_weekdays(self):
        result = self.results[1]
        self.assertEqual(result["group"], "ENV6.3A")
        self.assertEqual(result["weekdays"], ["Tuesday", "Friday"])
        actual = [(l["weekday"], l["start"], l["end"], l["rooms"]) for l in result["lessons"]]
        self.assertEqual(actual, [("Tuesday", "13:30", "15:00", ["ICT-044"]),
                                  ("Friday", "08:00", "10:00", ["ICT-043"])])

    def test_full_group_matches_visually_checked_page_four(self):
        # Independently transcribed from the rendered PDF, including unequal row heights.
        expected = [
            ("Monday", "08:00", "09:00", "CDKSK-206-2308", ["ICT-237"]),
            ("Monday", "09:00", "10:00", "ITSYS-206-2002", ["ICT-142"]),
            ("Monday", "10:30", "12:00", "ITCGR-206-2002", ["ICT-308"]),
            ("Monday", "13:00", "14:00", "CDKSK-206-2312", ["ICT-100"]),
            ("Tuesday", "09:00", "10:00", "CDKSK-206-2309", ["ICT-031"]),
            ("Tuesday", "10:00", "11:30", "ITSFT-206-1602", ["ICT-208"]),
            ("Tuesday", "11:30", "12:30", "CDPSD-000-2301", ["ICT-208"]),
            ("Tuesday", "13:30", "15:00", "ITPRJ-206-2010", ["ICT-131"]),
            ("Wednesday", "09:00", "10:00", "CDKSK-206-2310", ["ICT-141"]),
            ("Wednesday", "10:00", "11:00", "ITPRJ-206-2010", ["ICT-202"]),
            ("Wednesday", "12:00", "13:00", "CDKSK-206-2309", ["ICT-029"]),
            ("Wednesday", "13:00", "14:00", "ITCGR-206-2002", ["ICT-208"]),
            ("Thursday", "10:00", "11:00", "ITSFT-206-1602", ["ICT-029"]),
            ("Thursday", "11:00", "12:00", "CDKSK-206-2308", ["ICT-140"]),
            ("Friday", "08:00", "09:30", "ITSYS-206-2002", ["ICT-126", "ICT-142"]),
            ("Friday", "09:30", "11:30", "CDKSK-206-2307", ["ICT-029"]),
            ("Friday", "11:30", "12:30", "CDKSK-206-2310", ["ICT-102"]),
        ]
        result = self.results[4]
        self.assertEqual(result["group"], "IT-FIT-2.1A")
        actual = [(l["weekday"], l["start"], l["end"], l["subject_code"], l["rooms"])
                  for l in result["lessons"]]
        self.assertEqual(actual, expected)

    def test_wrapped_subject_is_one_lesson(self):
        lessons = [l for l in self.results[41]["lessons"]
                   if l["weekday"] == "Thursday" and l["subject_code"] == "ITMMD-406-2004"]
        self.assertEqual(len(lessons), 1)
        self.assertEqual(lessons[0]["subject_name"], "Introduction to Object Oriented Programming")
        self.assertEqual((lessons[0]["start"], lessons[0]["end"]), ("13:00", "15:00"))

    def test_missing_wednesday_does_not_shift_thursday_to_wednesday(self):
        result = self.results[51]
        self.assertEqual(result["weekdays"], ["Monday", "Tuesday", "Thursday", "Friday"])
        thursday = [l for l in result["lessons"] if l["weekday"] == "Thursday"]
        self.assertEqual([(l["start"], l["end"], l["subject_code"]) for l in thursday],
                         [("08:00", "09:30", "ITDVP-606-2101"), ("11:00", "12:30", "ITNET-606-1610")])

    def test_unshaded_lesson_is_flagged_as_unassigned(self):
        # Simulate a changed PDF format: its text remains, but its block is unshaded.
        page = self.pdf.pages[0]
        original_objects = page._objects
        try:
            page._objects = {**original_objects, "rect": [r for r in page.rects
                            if not (abs(r["top"] - 301.08) < .1 and r["width"] > 300 and r["height"] > 40)]}
            result = parse_page(page)
            self.assertTrue(any(issue["kind"] == "unassigned_source_text" for issue in result["issues"]))
        finally:
            page._objects = original_objects


if __name__ == "__main__":
    unittest.main()
