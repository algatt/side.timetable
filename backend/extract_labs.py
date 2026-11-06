"""Extract the locally supplied IICT lab inventory, preserving blanks and provenance."""

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import re

import pdfplumber

from backend.download import atomic_write

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_LABS = ROOT / "data" / "IICT Labs.pdf"
DEFAULT_OUTPUT = ROOT / "data" / "processed" / "labs.json"
HEADERS = ["Location", "Seating Capacity", "Teacher's PC", "Students' PCs", "Smartboard", "TV Screen", "Projector", "OS", "Notes"]


def text(value):
    return " ".join((value or "").split())


def number(value):
    value = text(value)
    if not value:
        return None
    if not value.isdigit():
        raise ValueError(f"Unexpected numeric inventory value: {value}")
    return int(value)


def checked(value):
    value = text(value)
    if not value:
        return None
    if value not in ("\uf0fc", "✓", "✔"):
        raise ValueError(f"Unexpected inventory equipment marker: {value}")
    return True


def fill_at(page, x, y):
    rectangles = [r for r in page.rects if r["fill"] and r["width"] > 5 and r["height"] > 5
                  and r["x0"] <= x <= r["x1"] and r["top"] <= y <= r["bottom"]]
    if not rectangles:
        return (1.0, 1.0, 1.0)
    rectangle = min(rectangles, key=lambda r: r["width"] * r["height"])
    color = rectangle["non_stroking_color"]
    return tuple(round(float(v), 3) for v in color) if isinstance(color, (tuple, list)) else (float(color),) * 3


def legend_colors(pdf):
    colors = {}
    for label, kind in (("Computer Labs", "computer_lab"), ("Classrooms", "classroom"), ("Other Rooms", "other")):
        matches = [(page, match) for page in pdf.pages for match in (page.search(label) or [])]
        if len(matches) != 1:
            raise ValueError(f"Expected one inventory legend label: {label}")
        page, match = matches[0]
        y = (match["top"] + match["bottom"]) / 2
        # Legend swatches are immediately left of the labels; x is inside each swatch.
        swatches = [r for r in page.rects if r["fill"] and r["width"] > 10 and r["height"] > 5
                    and r["x1"] < match["x0"] and r["top"] <= y <= r["bottom"]]
        color = fill_at(page, (swatches[-1]["x0"] + swatches[-1]["x1"]) / 2, y) if swatches else (1.0, 1.0, 1.0)
        if color in colors:
            raise ValueError("Inventory legend colours are not distinct.")
        colors[color] = kind
    return colors


def extract_labs(pdf_path=DEFAULT_LABS, output=DEFAULT_OUTPUT):
    source = Path(pdf_path).read_bytes()
    rooms = []
    with pdfplumber.open(io.BytesIO(source)) as pdf:
        colors = legend_colors(pdf)
        header_seen = False
        for page in pdf.pages:
            for table in page.find_tables():
                for row, values in zip(table.rows, table.extract()):
                    if not any(text(value) for value in values):
                        continue
                    if text(values[0]) == "Location":
                        if [text(value) for value in values] != HEADERS:
                            raise ValueError("The inventory columns changed; review the PDF before importing.")
                        header_seen = True
                        continue
                    if len(values) != 9 or not re.fullmatch(r"[A-Z]?\d{2,3}", text(values[0])):
                        raise ValueError(f"Unrecognized inventory row on page {page.page_number}: {values}")
                    cell = row.cells[0]
                    color = fill_at(page, (cell[0] + cell[2]) / 2, (cell[1] + cell[3]) / 2)
                    if color not in colors:
                        raise ValueError(f"Unrecognized inventory row colour for {values[0]}.")
                    rooms.append({"room": "ICT-" + text(values[0]), "location": text(values[0]),
                                  "kind": colors[color], "seating_capacity": number(values[1]),
                                  "teacher_pc": checked(values[2]), "student_pcs": number(values[3]),
                                  "smartboard": checked(values[4]), "tv_screen": checked(values[5]),
                                  "projector": checked(values[6]), "os": text(values[7]) or None,
                                  "notes": text(values[8]) or None, "source_page": page.page_number,
                                  "raw_cells": dict(zip(HEADERS, values))})
        if not header_seen or not rooms or len({r["room"] for r in rooms}) != len(rooms):
            raise ValueError("Missing inventory header, empty inventory or duplicate room labels.")
        if any(room["seating_capacity"] is not None and room["seating_capacity"] < 1 for room in rooms):
            raise ValueError("A seating capacity must be positive when printed.")
        inventory = {"schema_version": 1, "generated_at": datetime.now(timezone.utc).isoformat(),
                     "source": {"filename": Path(pdf_path).name, "sha256": hashlib.sha256(source).hexdigest(), "page_count": len(pdf.pages)},
                     "room_count": len(rooms), "category_counts": dict(Counter(room["kind"] for room in rooms)),
                     "blank_cells": "not_listed", "rooms": sorted(rooms, key=lambda room: room["room"])}
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    atomic_write(output, (json.dumps(inventory, indent=2) + "\n").encode())
    return inventory


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf", type=Path, default=DEFAULT_LABS)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    try:
        inventory = extract_labs(args.pdf, args.output)
    except (OSError, ValueError) as error:
        parser.exit(1, f"Lab extraction failed: {error}\n")
    print(f"Extracted {inventory['room_count']} ICT rooms: {inventory['category_counts']}")
    print(f"Inventory: {args.output.resolve()}")


if __name__ == "__main__":
    main()
