import hashlib
import json
import tempfile
import unittest
from email.message import Message
from pathlib import Path
from unittest.mock import patch
from urllib.error import URLError

from backend.download import DownloadError, discover_timetable, download_timetable


HOMEPAGE = "https://iict.mcast.edu.mt/"
PDF_URL = HOMEPAGE + "wp-content/uploads/iict_timetable_sem1_2026_7.pdf"
HTML = f'<li id="menu-item-25574"><a href="{PDF_URL}">Timetables (Available!)</a></li>'
# Deliberately minimal bytes: test the downloader's envelope checks, not PDF parsing.
PDF = b"%PDF-1.7\nfixture version 1\n%%EOF\n"


def responses(pdf=PDF):
    headers = Message()
    headers["Content-Type"] = "text/html; charset=utf-8"
    return [(HTML.encode(), HOMEPAGE, headers), (pdf, PDF_URL, Message())]


class DiscoveryTests(unittest.TestCase):
    def test_supplied_menu_item(self):
        self.assertEqual(discover_timetable(HTML), PDF_URL)

    def test_menu_item_wins_over_archived_links(self):
        html = '<a href="/old_timetable.pdf">Old timetable</a>' + HTML
        self.assertEqual(discover_timetable(html), PDF_URL)

    def test_fallback_nested_text_and_relative_url(self):
        html = '<a href="/current.PDF?download=1"><span>Timetables</span> &amp; rooms</a>'
        self.assertEqual(discover_timetable(html), HOMEPAGE + "current.PDF?download=1")

    def test_nested_menu_items(self):
        html = '<li id="outer"><ul>' + HTML + '</ul></li>'
        self.assertEqual(discover_timetable(html), PDF_URL)

    def test_duplicate_mobile_and_desktop_links(self):
        self.assertEqual(discover_timetable(HTML + HTML), PDF_URL)

    def test_ambiguous_fallback_fails(self):
        with self.assertRaisesRegex(DownloadError, "Multiple"):
            discover_timetable('<a href="/timetable1.pdf">One</a><a href="/timetable2.pdf">Two</a>')

    def test_missing_pdf_fails(self):
        with self.assertRaisesRegex(DownloadError, "No timetable"):
            discover_timetable('<a href="/news">News</a>')


class DownloadTests(unittest.TestCase):
    def test_first_download_and_unchanged_repeat(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder)
            with patch("backend.download.fetch", side_effect=responses()):
                first = download_timetable(output_dir=target)
            self.assertTrue(first["changed"])
            self.assertEqual(first["sha256"], hashlib.sha256(PDF).hexdigest())
            self.assertEqual((target / "timetable.pdf").read_bytes(), PDF)
            original_mtime = (target / "timetable.pdf").stat().st_mtime_ns
            with patch("backend.download.fetch", side_effect=responses()):
                second = download_timetable(output_dir=target)
            self.assertFalse(second["changed"])
            self.assertEqual((target / "timetable.pdf").stat().st_mtime_ns, original_mtime)
            self.assertEqual(json.loads((target / "metadata.json").read_text()), second)

    def test_content_change_at_same_url(self):
        with tempfile.TemporaryDirectory() as folder:
            with patch("backend.download.fetch", side_effect=responses()):
                first = download_timetable(output_dir=folder)
            updated_pdf = PDF.replace(b"version 1", b"version 2")
            with patch("backend.download.fetch", side_effect=responses(updated_pdf)):
                second = download_timetable(output_dir=folder)
            self.assertTrue(second["changed"])
            self.assertNotEqual(first["sha256"], second["sha256"])
            self.assertEqual((Path(folder) / "timetable.pdf").read_bytes(), updated_pdf)

    def test_bad_download_does_not_overwrite_existing_files(self):
        for bad_body in (b"<html>Error</html>", b"%PDF-1.7\ntruncated"):
            with self.subTest(body=bad_body), tempfile.TemporaryDirectory() as folder:
                target = Path(folder)
                with patch("backend.download.fetch", side_effect=responses()):
                    download_timetable(output_dir=target)
                old_metadata = (target / "metadata.json").read_bytes()
                with patch("backend.download.fetch", side_effect=responses(bad_body)):
                    with self.assertRaises(DownloadError):
                        download_timetable(output_dir=target)
                self.assertEqual((target / "timetable.pdf").read_bytes(), PDF)
                self.assertEqual((target / "metadata.json").read_bytes(), old_metadata)

    def test_network_failure_does_not_create_outputs(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / "source"
            with patch("backend.download.fetch", side_effect=URLError("offline")):
                with self.assertRaises(URLError):
                    download_timetable(output_dir=target)
            self.assertFalse(target.exists())


if __name__ == "__main__":
    unittest.main()
