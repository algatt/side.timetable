import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import pdfplumber

from backend.extract_sample import LayoutError, parse_page, parse_subject
from backend.extract_timetable import build_catalogs, extract_timetable, room_validation, schedule_coverage, validate


SOURCE = Path(__file__).resolve().parents[1] / "data/source/timetable.pdf"
VERIFIED_SHA256 = "736f4378e3bb736b9d03781e540fadf7995b4467eef7cb7a260c6809d9c6fa93"


def entry(identifier="a", group="A", start="08:00", end="09:30", rooms=None, code="ITSYS-206-2002", name="Computer Systems"):
    return {"id": identifier, "group": group, "weekday": "Friday", "start": start, "end": end,
            "duration_minutes": 90, "rooms": ["ICT-126", "ICT-142"] if rooms is None else rooms,
            "subject_code": code, "subject_name": name, "entry_kind": "lesson", "code_status": "complete",
            "source_page": 1}


class CatalogAndOccupancyTests(unittest.TestCase):
    def test_search_coverage_uses_common_printed_hours_and_represented_days(self):
        pages = [{"issues": [], "time_range": ["08:00", "20:00"], "weekdays": ["Friday"]},
                 {"issues": [], "time_range": ["09:00", "19:00"], "weekdays": ["Monday", "Tuesday"]}]
        self.assertEqual(schedule_coverage(pages), {"start": "09:00", "end": "19:00", "weekdays": ["Monday", "Tuesday", "Friday"]})

    def test_missing_or_unreadable_coverage_is_never_guessed(self):
        self.assertIsNone(schedule_coverage([]))
        self.assertIsNone(schedule_coverage([{"issues": [{"message": "bad page"}]}]))
        self.assertIsNone(schedule_coverage([{"issues": [], "time_range": ["08:00", "09:00"], "weekdays": ["Monday"]},
                                            {"issues": [], "time_range": ["10:00", "11:00"], "weekdays": ["Tuesday"]}]))

    def test_every_room_gets_full_duration_without_duplicating_group_lesson(self):
        items = [entry()]
        occupied, conflicts, coincident = room_validation(items)
        self.assertEqual(len(items), 1)
        self.assertEqual([(b["room"], b["start"], b["end"], b["occupied_minutes"]) for b in occupied],
                         [("ICT-126", "08:00", "09:30", 90), ("ICT-142", "08:00", "09:30", 90)])
        self.assertEqual(conflicts + coincident, [])

    def test_coincident_groups_keep_entries_and_union_occupied_minutes(self):
        items = [entry(rooms=["ICT-126"]), entry("b", "B", rooms=["ICT-126"])]
        occupied, conflicts, coincident = room_validation(items)
        self.assertEqual(len(items), 2)
        self.assertEqual(len(occupied), 1)
        self.assertEqual(occupied[0]["occupied_minutes"], 90)
        self.assertEqual(set(occupied[0]["source_entry_ids"]), {"a", "b"})
        self.assertEqual(conflicts, [])
        self.assertEqual(len(coincident), 1)

    def test_partial_overlap_of_different_subjects_is_visible(self):
        items = [entry(rooms=["ICT-126"]), entry("b", "B", "09:00", "10:00", ["ICT-126"], "ITSFT-206-1602", "Programming")]
        occupied, conflicts, coincident = room_validation(items)
        self.assertEqual(occupied[0]["occupied_minutes"], 120)
        self.assertEqual([(c["start"], c["end"]) for c in conflicts], [("09:00", "09:30")])
        self.assertEqual(coincident, [])

    def test_touching_bookings_do_not_conflict(self):
        items = [entry(rooms=["ICT-126"]), entry("b", "B", "09:30", "10:30", ["ICT-126"])]
        occupied, conflicts, coincident = room_validation(items)
        self.assertEqual(occupied[0]["occupied_minutes"], 150)
        self.assertEqual(conflicts + coincident, [])

    def test_placeholder_code_does_not_merge_distinct_subjects(self):
        items = [entry(code="ITIGM-306-21xx", name="Introduction to CRM"),
                 entry("b", code="ITIGM-306-21xx", name="The iGaming Industry")]
        _, subjects, _ = build_catalogs(items)
        self.assertEqual(len(subjects), 2)
        self.assertNotEqual(items[0]["subject_id"], items[1]["subject_id"])

    def test_missing_and_placeholder_codes_and_ibmc_rooms(self):
        self.assertEqual(parse_subject("ITIGM-306-21xx-Introduction to CRM\nICT-131"),
                         ("ITIGM-306-21xx", "Introduction to CRM", ["ICT-131"]))
        self.assertEqual(parse_subject("Advanced Mathematics\nICT-304"),
                         (None, "Advanced Mathematics", ["ICT-304"]))
        self.assertEqual(parse_subject("BCMRK-606-1514-Consumer Behaviour\nIBMC-318"),
                         ("BCMRK-606-1514", "Consumer Behaviour", ["IBMC-318"]))
        self.assertEqual(parse_subject("Student Support"), (None, "Student Support", []))

    def test_duplicate_ids_and_invalid_duration_fail_validation(self):
        first = entry()
        second = copy.deepcopy(first)
        second["duration_minutes"] = 20
        page = {"page": 1, "group": "A", "lessons": [first, second], "issues": [], "warnings": []}
        _, errors, _ = validate([page], 1)
        self.assertEqual({e["kind"] for e in errors}, {"duplicate_entry_id", "invalid_entry"})


class FullDownloadedPdfTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not SOURCE.exists() or hashlib.sha256(SOURCE.read_bytes()).hexdigest() != VERIFIED_SHA256:
            raise unittest.SkipTest("The visually checked source PDF is not available at its recorded checksum.")
        cls.pdf = pdfplumber.open(SOURCE)
        cls.addClassCleanup(cls.pdf.close)
        cls.pages = [parse_page(page) for page in cls.pdf.pages]

    def test_all_source_text_accounted_for_and_complete_totals(self):
        entries, errors, warnings = validate(self.pages, 69)
        self.assertEqual(len(entries), 744)
        self.assertEqual(errors, [])
        self.assertEqual(len(warnings), 44)
        self.assertEqual(sum(e["entry_kind"] == "lesson" for e in entries), 733)
        groups, subjects, rooms = build_catalogs(entries)
        self.assertEqual((len(groups), len(subjects), len(rooms)), (69, 117, 51))
        self.assertEqual(room_validation(entries)[1], [])

    def test_parallel_student_support_blocks_are_both_retained(self):
        page = self.pages[64]
        self.assertEqual(page["group"], "General")
        self.assertEqual(len(page["lessons"]), 8)
        wednesday = [entry for entry in page["lessons"] if entry["weekday"] == "Wednesday"]
        self.assertEqual([(entry["start"], entry["end"]) for entry in wednesday],
                         [("08:00", "10:00"), ("09:00", "11:00")])
        self.assertTrue(all(e["entry_kind"] == "activity" and e["rooms"] == [] for e in wednesday))

    def test_missing_source_fields_are_not_fabricated(self):
        lesson = next(e for e in self.pages[19]["lessons"] if e["subject_name"] == "Advanced Digital Marketing")
        self.assertIsNone(lesson["subject_code"])
        self.assertEqual(lesson["code_status"], "missing")
        self.assertEqual(lesson["rooms"], ["ICT-302"])
        self.assertEqual(self.pages[65]["lessons"][0]["rooms"], ["IBMC-210"])

    def test_failed_parse_keeps_previous_dataset(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            previous = b'{"previous_dataset": true}\n'
            (output / "timetable.json").write_bytes(previous)
            with patch("backend.extract_timetable.parse_page", side_effect=LayoutError("unsupported geometry")), \
                 patch("backend.extract_timetable.write_report"):
                validation = extract_timetable(SOURCE, output)
            self.assertEqual(validation["status"], "failed")
            self.assertEqual((output / "timetable.json").read_bytes(), previous)
            self.assertTrue(json.loads((output / "validation.json").read_text())["errors"])


if __name__ == "__main__":
    unittest.main()
