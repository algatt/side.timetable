"""Step 1: discover and download the institute's current timetable PDF.

Uses only Python's standard library. Run with: python3 -m backend.download
"""

import argparse
import hashlib
import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import URLError
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen


HOMEPAGE = "https://iict.mcast.edu.mt/"
MENU_ITEM_ID = "menu-item-25574"
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "data" / "source"
MAX_DOWNLOAD_BYTES = 40 * 1024 * 1024


class DownloadError(Exception):
    """A source could not be discovered or safely downloaded."""


class TimetableLinks(HTMLParser):
    """Collect anchor text and whether it belongs to the known menu item."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links = []
        self.list_items = []
        self.anchor = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "li":
            self.list_items.append(attrs.get("id"))
        elif tag == "a":
            self.anchor = {
                "href": attrs.get("href", ""),
                "text": "",
                "preferred": MENU_ITEM_ID in self.list_items,
            }

    def handle_data(self, data):
        if self.anchor is not None:
            self.anchor["text"] += data

    def handle_endtag(self, tag):
        if tag == "a" and self.anchor is not None:
            self.links.append(self.anchor)
            self.anchor = None
        elif tag == "li" and self.list_items:
            self.list_items.pop()


def discover_timetable(html, base_url=HOMEPAGE):
    parser = TimetableLinks()
    parser.feed(html)
    preferred, fallback = set(), set()
    for link in parser.links:
        url = urljoin(base_url, link["href"])
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            continue
        if not parsed.path.lower().endswith(".pdf"):
            continue
        if link["preferred"]:
            preferred.add(url)
        elif "timetable" in link["text"].lower() or "timetable" in parsed.path.lower():
            fallback.add(url)
    candidates = preferred or fallback
    if not candidates:
        raise DownloadError("No timetable PDF link found on the homepage.")
    if len(candidates) != 1:
        raise DownloadError(
            "Multiple timetable PDFs found; refusing to guess:\n"
            + "\n".join(sorted(candidates))
        )
    return candidates.pop()


def fetch(url):
    request = Request(url, headers={"User-Agent": "MCAST-Timetable/0.1"})
    with urlopen(request, timeout=30) as response:
        body = response.read(MAX_DOWNLOAD_BYTES + 1)
        if len(body) > MAX_DOWNLOAD_BYTES:
            raise DownloadError("Download exceeds the 40 MiB limit.")
        return body, response.geturl(), response.headers


def atomic_write(path, body):
    """Complete each file in a temporary sibling before replacing its target."""
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(body)
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def download_timetable(homepage=HOMEPAGE, output_dir=DEFAULT_OUTPUT):
    html_bytes, homepage_url, headers = fetch(homepage)
    charset = headers.get_content_charset() or "utf-8"
    pdf_url = discover_timetable(html_bytes.decode(charset), homepage_url)
    pdf, resolved_url, pdf_headers = fetch(pdf_url)
    # These checks reject HTML error pages and obvious truncated downloads.
    # Full document validation belongs to the PDF parser in the next milestone.
    if not pdf.startswith(b"%PDF-") or b"%%EOF" not in pdf[-1024:]:
        raise DownloadError("Response is not a complete-looking PDF; existing files kept.")

    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = output_dir / "timetable.pdf"
    metadata_path = output_dir / "metadata.json"
    digest = hashlib.sha256(pdf).hexdigest()
    changed = not pdf_path.exists() or hashlib.sha256(pdf_path.read_bytes()).hexdigest() != digest
    metadata = {
        "homepage_url": homepage_url,
        "pdf_url": pdf_url,
        "resolved_pdf_url": resolved_url,
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "sha256": digest,
        "size_bytes": len(pdf),
        "changed": changed,
        "server_last_modified": pdf_headers.get("Last-Modified"),
        "server_etag": pdf_headers.get("ETag"),
    }
    if changed:
        atomic_write(pdf_path, pdf)
    atomic_write(metadata_path, (json.dumps(metadata, indent=2) + "\n").encode("utf-8"))
    return metadata


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--homepage", default=HOMEPAGE)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    try:
        metadata = download_timetable(args.homepage, args.output_dir)
    except (DownloadError, URLError, OSError, ValueError, LookupError) as error:
        print(f"Download failed: {error}", file=sys.stderr)
        return 1
    print(f"Timetable: {metadata['pdf_url']}")
    print(f"Status: {'new or changed PDF saved' if metadata['changed'] else 'unchanged PDF'}")
    print(f"Size: {metadata['size_bytes']:,} bytes")
    print(f"SHA-256: {metadata['sha256']}")
    print(f"PDF: {args.output_dir.resolve() / 'timetable.pdf'}")
    print(f"Metadata: {args.output_dir.resolve() / 'metadata.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
