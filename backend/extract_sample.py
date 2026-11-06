"""Step 2: extract selected PDF pages for human verification, without publishing data."""

import argparse
import hashlib
import io
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import pdfplumber

from backend.download import DEFAULT_OUTPUT, atomic_write
from backend.sample_report import write_report


DAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
SUBJECT = re.compile(r"\b([A-Z]{4,8})\s*-\s*(\d{3})\s*-\s*(\d{4}|\d{2}[xX]{2})\b")
ROOM = re.compile(r"\b(?:ICT|IBMC)\s*-\s*[A-Z]?\d{2,3}\b", re.IGNORECASE)
TIME_ROW = re.compile(r"^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$")
DEFAULT_PAGES = (1, 2, 4, 41, 51)
DEFAULT_SAMPLE = DEFAULT_OUTPUT.parent / "sample"
TOLERANCE = 1.2  # PDF points; permits tiny differences between adjacent painted cells.


class LayoutError(ValueError):
    """A page cannot be mapped to its printed labels without guessing."""


def bbox(rect):
    return tuple(rect[key] for key in ("x0", "top", "x1", "bottom"))


def minutes(value):
    hour, minute = map(int, value.split(":"))
    if not 0 <= hour <= 23 or not 0 <= minute <= 59:
        raise LayoutError(f"Invalid printed time: {value}")
    return hour * 60 + minute


def clock(value):
    return f"{value // 60:02d}:{value % 60:02d}"


def parse_subject(raw_text):
    matches = list(SUBJECT.finditer(raw_text))
    if len(matches) > 1:
        raise LayoutError(f"Expected at most one subject code in a block, found {len(matches)}.")
    code = "-".join(matches[0].groups()) if matches else None
    rooms = list(dict.fromkeys(re.sub(r"\s", "", m.group()).upper() for m in ROOM.finditer(raw_text)))
    without_rooms = ROOM.sub("", raw_text)
    name = SUBJECT.sub("", without_rooms, count=1)
    name = " ".join(name.split()).strip(" -–:")
    if not name:
        raise LayoutError(f"Subject name missing for {code}.")
    return code, name, rooms


def nearest_boundary(value, rows, edge):
    row = min(rows, key=lambda item: abs(item[edge] - value))
    if abs(row[edge] - value) > TOLERANCE:
        raise LayoutError(f"Lesson {edge} does not align with a printed time row: {value:.2f}.")
    return row["start_minutes" if edge == "top" else "end_minutes"]


def contains(box, x, y):
    return box[0] <= x <= box[2] and box[1] <= y <= box[3]


def parse_page(page):
    # Filled cell rectangles preserve lesson boundaries that text/table extraction loses.
    cells = []
    for rect in page.rects:
        if not rect["fill"] or rect["width"] < 10 or rect["height"] < 5:
            continue
        color = rect.get("non_stroking_color")
        if color == 1 or color == (1, 1, 1):
            continue  # Whole-page/table backgrounds are not cells.
        text = page.within_bbox(bbox(rect)).extract_text(x_tolerance=1, y_tolerance=2) or ""
        cells.append({**rect, "text": text.strip()})

    columns = sorted([cell for cell in cells if cell["text"] in DAYS], key=lambda cell: cell["x0"])
    if not columns or len({c["text"] for c in columns}) != len(columns):
        raise LayoutError("Missing or duplicate weekday headers.")
    if any(abs(c["top"] - columns[0]["top"]) > TOLERANCE for c in columns):
        raise LayoutError("Weekday headers are not on one row.")
    if [DAYS.index(c["text"]) for c in columns] != sorted(DAYS.index(c["text"]) for c in columns):
        raise LayoutError("Weekday columns are out of order.")

    titles = [cell for cell in cells if cell["bottom"] <= min(c["top"] for c in columns)
              and cell["x0"] <= columns[0]["x0"] + TOLERANCE
              and cell["x1"] >= columns[-1]["x1"] - TOLERANCE and cell["text"]]
    if len(titles) != 1 or "\n" in titles[0]["text"]:
        raise LayoutError("Expected one group title above the weekday headers.")
    group = titles[0]["text"]

    rows = []
    for cell in cells:
        match = TIME_ROW.fullmatch(cell["text"])
        if match and cell["x1"] <= columns[0]["x0"] + TOLERANCE:
            start, end = map(minutes, match.groups())
            if start >= end:
                raise LayoutError("Invalid time interval in the row labels.")
            rows.append({**cell, "start_minutes": start, "end_minutes": end})
    rows.sort(key=lambda cell: cell["top"])
    if not rows or any(a["end_minutes"] != b["start_minutes"] for a, b in zip(rows, rows[1:])):
        raise LayoutError("Printed time rows are missing, duplicated or not continuous.")

    issues, warnings, lessons = [], [], []
    for cell in cells:
        if cell["top"] < rows[0]["top"] - TOLERANCE or not cell["text"]:
            continue
        matching = [column for column in columns
                    if cell["x0"] >= column["x0"] - TOLERANCE
                    and cell["x1"] <= column["x1"] + TOLERANCE]
        if len(matching) != 1:
            continue
        source_box = [round(v, 3) for v in bbox(cell)]
        lesson = {"group": group, "weekday": matching[0]["text"],
                  "start": None, "end": None, "duration_minutes": None,
                  "subject_code": None, "subject_name": None, "rooms": [],
                  "entry_kind": "unknown", "code_status": "missing",
                  "source_page": page.page_number, "source_bbox": source_box,
                  "raw_text": cell["text"], "notes": []}
        try:
            start = nearest_boundary(cell["top"], rows, "top")
            end = nearest_boundary(cell["bottom"], rows, "bottom")
            if start >= end:
                raise LayoutError("Lesson ends before it starts.")
            lesson.update(start=clock(start), end=clock(end), duration_minutes=end - start)
            code, name, rooms = parse_subject(cell["text"])
            lesson.update(subject_code=code, subject_name=name, rooms=rooms,
                          entry_kind="lesson" if code or rooms else "activity",
                          code_status="missing" if code is None else "placeholder" if "x" in code.lower() else "complete")
            if code is None:
                warning = "No subject code printed; the block name is retained."
                warnings.append({"kind": "missing_subject_code", "message": warning, "bbox": source_box})
                lesson["notes"].append(warning)
            elif lesson["code_status"] == "placeholder":
                warning = "Placeholder subject code retained exactly as printed."
                warnings.append({"kind": "placeholder_subject_code", "message": warning, "bbox": source_box})
                lesson["notes"].append(warning)
            if not rooms:
                warning = "No recognized room printed; no room occupancy can be assigned to this block."
                warnings.append({"kind": "missing_room", "message": warning, "bbox": source_box})
                lesson["notes"].append(warning)
            if len(rooms) > 1:
                lesson["notes"].append("Every listed room is treated as occupied for the full block; this counts as one lesson for the group.")
        except LayoutError as error:
            issues.append({"kind": "lesson_needs_review", "message": str(error), "bbox": source_box})
            lesson["notes"].append(str(error))
        lessons.append(lesson)

    # Every printed subject code and room must belong to exactly one extracted block.
    # This catches omitted, unshaded, split or overlapping blocks rather than silently losing them.
    coverage = {}
    for label, pattern in (("subject_codes", SUBJECT), ("rooms", ROOM)):
        matches = page.search(pattern, x_tolerance=1, y_tolerance=2) or []
        coverage[label] = len(matches)
        for match in matches:
            x, y = (match["x0"] + match["x1"]) / 2, (match["top"] + match["bottom"]) / 2
            assigned = [lesson for lesson in lessons if contains(lesson["source_bbox"], x, y)]
            if len(assigned) != 1:
                issues.append({"kind": "unassigned_source_text", "message":
                               f"{match['text']} belongs to {len(assigned)} extracted blocks.",
                               "bbox": [round(match[k], 3) for k in ("x0", "top", "x1", "bottom")]})
    # Also catch uncoded text (e.g. Student Support), including parallel subcolumns.
    for word in page.extract_words(x_tolerance=1, y_tolerance=2):
        x, y = (word["x0"] + word["x1"]) / 2, (word["top"] + word["bottom"]) / 2
        if rows[0]["top"] <= y <= rows[-1]["bottom"] and any(c["x0"] <= x <= c["x1"] for c in columns):
            assigned = [lesson for lesson in lessons if contains(lesson["source_bbox"], x, y)]
            if len(assigned) != 1:
                issues.append({"kind": "unassigned_body_text", "message":
                               f"{word['text']} belongs to {len(assigned)} extracted blocks.",
                               "bbox": [round(word[k], 3) for k in ("x0", "top", "x1", "bottom")]})
    if not lessons:
        issues.append({"kind": "no_lessons", "message": "No lesson blocks extracted from this page."})
    lessons.sort(key=lambda item: (DAYS.index(item["weekday"]), item["start"] or "", item["raw_text"]))
    for index, lesson in enumerate(lessons, 1):
        lesson["id"] = f"p{page.page_number:03d}-{index:02d}"
    return {"page": page.page_number, "group": group, "weekdays": [c["text"] for c in columns],
            "time_range": [clock(rows[0]["start_minutes"]), clock(rows[-1]["end_minutes"])],
            "time_row_count": len(rows), "source_text_counts": coverage,
            "lessons": lessons, "issues": issues, "warnings": warnings}


def extract_sample(pdf_path, pages, output_dir):
    if not pages or len(set(pages)) != len(pages):
        raise LayoutError("Choose distinct page numbers, starting at 1.")
    source = Path(pdf_path).read_bytes()
    digest = hashlib.sha256(source).hexdigest()
    results = []
    with pdfplumber.open(io.BytesIO(source)) as pdf:
        if any(number < 1 or number > len(pdf.pages) for number in pages):
            raise LayoutError(f"Page numbers must be between 1 and {len(pdf.pages)}.")
        for number in pages:
            try:
                results.append(parse_page(pdf.pages[number - 1]))
            except LayoutError as error:
                results.append({"page": number, "group": "Unknown", "lessons": [],
                                "issues": [{"kind": "page_layout", "message": str(error)}]})
        report = {"schema_version": 1, "status": "sample_for_human_review",
                  "generated_at": datetime.now(timezone.utc).isoformat(),
                  "source_pdf_sha256": digest, "source_page_count": len(pdf.pages),
                  "selected_pages": list(pages), "pages": results}
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
        atomic_write(output_dir / "lessons.json", (json.dumps(report, indent=2) + "\n").encode())
        write_report(report, pdf, output_dir)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf", type=Path, default=DEFAULT_OUTPUT / "timetable.pdf")
    parser.add_argument("--pages", type=int, nargs="+", default=DEFAULT_PAGES, help="1-based PDF page numbers")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_SAMPLE)
    args = parser.parse_args()
    try:
        report = extract_sample(args.pdf, args.pages, args.output_dir)
    except (OSError, ValueError) as error:
        print(f"Sample extraction failed: {error}", file=sys.stderr)
        return 1
    issue_count = sum(len(page["issues"]) for page in report["pages"])
    for page in report["pages"]:
        print(f"Page {page['page']}: {page['group']} - {len(page['lessons'])} lessons, {len(page['issues'])} issues")
    print(f"Review: {args.output_dir.resolve() / 'review.html'}")
    print("Sample only: verify it against the PDF before expanding to all pages.")
    return 2 if issue_count else 0


if __name__ == "__main__":
    sys.exit(main())
