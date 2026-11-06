"""Step 3: extract all pages, validate the result, and prepare data for the viewer."""

import argparse
from collections import Counter, defaultdict
import hashlib
import io
import json
from pathlib import Path
import sys
from datetime import datetime, timezone

import pdfplumber

from backend.download import DEFAULT_OUTPUT, atomic_write
from backend.extract_sample import DAYS, LayoutError, clock, minutes, parse_page
from backend.sample_report import write_report


DEFAULT_PROCESSED = DEFAULT_OUTPUT.parent / "processed"


def subject_key(entry):
    # A placeholder code can name more than one unit. Never identify a subject by code alone.
    return (entry["subject_code"] or "", " ".join((entry["subject_name"] or "").casefold().split()))


def build_catalogs(entries):
    subjects = {}
    for entry in entries:
        if entry["entry_kind"] != "lesson" or not entry["subject_name"]:
            entry["subject_id"] = None
            continue
        key = subject_key(entry)
        identifier = "subject-" + hashlib.sha256(json.dumps(key).encode()).hexdigest()[:16]
        entry["subject_id"] = identifier
        if identifier not in subjects:
            subjects[identifier] = {"id": identifier, "code": entry["subject_code"],
                                    "code_status": entry["code_status"], "name": entry["subject_name"]}
    rooms = sorted({room for entry in entries for room in entry["rooms"]})
    groups = []
    for name in sorted({entry["group"] for entry in entries}):
        items = [entry for entry in entries if entry["group"] == name]
        groups.append({"id": name, "label": name, "source_pages": sorted({e["source_page"] for e in items}),
                       "entry_count": len(items), "lesson_count": sum(e["entry_kind"] == "lesson" for e in items),
                       "activity_count": sum(e["entry_kind"] == "activity" for e in items)})
    return groups, sorted(subjects.values(), key=lambda s: (s["code"] or "", s["name"])), rooms


def room_validation(entries):
    """Union bookings for occupancy; keep coincident lessons and conflicts visible."""
    bookings = defaultdict(list)
    for entry in entries:
        if entry["start"] and entry["end"]:
            for room in entry["rooms"]:
                bookings[(room, entry["weekday"])].append(entry)
    occupancy, conflicts, coincident = [], [], []
    for (room, day), items in sorted(bookings.items(), key=lambda p: (p[0][0], DAYS.index(p[0][1]))):
        items.sort(key=lambda entry: (entry["start"], entry["end"], entry["id"]))
        # All rooms in a multi-room block receive the entire interval. Overlaps and
        # adjacent bookings are unioned so occupied minutes are never counted twice.
        merged = []
        for entry in items:
            start, end = minutes(entry["start"]), minutes(entry["end"])
            if merged and start <= merged[-1][1]:
                merged[-1][1] = max(merged[-1][1], end)
                merged[-1][2].append(entry["id"])
            else:
                merged.append([start, end, [entry["id"]]])
        for start, end, ids in merged:
            occupancy.append({"room": room, "weekday": day, "start": clock(start), "end": clock(end),
                              "occupied_minutes": end - start, "source_entry_ids": ids})
        for i, first in enumerate(items):
            for second in items[i + 1:]:
                if second["start"] >= first["end"]:
                    break
                start, end = max(first["start"], second["start"]), min(first["end"], second["end"])
                if start >= end:
                    continue
                item = {"room": room, "weekday": day, "start": start, "end": end,
                        "entry_ids": [first["id"], second["id"]],
                        "groups": [first["group"], second["group"]]}
                same_session = (subject_key(first) == subject_key(second)
                                and first["start"] == second["start"] and first["end"] == second["end"])
                (coincident if same_session else conflicts).append(item)
    return occupancy, conflicts, coincident


def validate(pages, page_count):
    entries = [entry for page in pages for entry in page["lessons"]]
    errors = [{"page": page["page"], "group": page["group"], **issue}
              for page in pages for issue in page["issues"]]
    warnings = [{"page": page["page"], "group": page["group"], **warning}
                for page in pages for warning in page.get("warnings", [])]
    if len(pages) != page_count:
        errors.append({"kind": "missing_pages", "message": "Not every PDF page was processed."})
    if not entries:
        errors.append({"kind": "empty_document", "message": "No timetable entries were extracted."})
    counts = Counter(entry["id"] for entry in entries)
    for identifier, count in counts.items():
        if count != 1:
            errors.append({"kind": "duplicate_entry_id", "message": identifier})
    for entry in entries:
        try:
            if not entry["start"] or not entry["end"]:
                raise ValueError("Missing times")
            if minutes(entry["end"]) - minutes(entry["start"]) != entry["duration_minutes"] or entry["duration_minutes"] <= 0:
                raise ValueError("Inconsistent duration")
            if entry["weekday"] not in DAYS or not entry["subject_name"]:
                raise ValueError("Missing name or weekday")
            if len(set(entry["rooms"])) != len(entry["rooms"]):
                raise ValueError("Duplicate room in entry")
        except (ValueError, TypeError) as error:
            errors.append({"kind": "invalid_entry", "entry_id": entry["id"], "message": str(error)})
    return entries, errors, warnings


def schedule_coverage(pages):
    """Common printed time range and represented weekdays; never infer from bookings."""
    if not pages or any(page["issues"] or not page.get("time_range") for page in pages):
        return None
    start = max(minutes(page["time_range"][0]) for page in pages)
    end = min(minutes(page["time_range"][1]) for page in pages)
    if start >= end:
        return None
    weekdays = {day for page in pages for day in page.get("weekdays", [])}
    return {"weekdays": [day for day in DAYS if day in weekdays], "start": clock(start), "end": clock(end)}


def extract_timetable(pdf_path=DEFAULT_OUTPUT / "timetable.pdf", output_dir=DEFAULT_PROCESSED):
    pdf_path, output_dir = Path(pdf_path), Path(output_dir)
    source_bytes = pdf_path.read_bytes()
    digest = hashlib.sha256(source_bytes).hexdigest()
    generated = datetime.now(timezone.utc).isoformat()
    pages = []
    with pdfplumber.open(io.BytesIO(source_bytes)) as pdf:
        for page in pdf.pages:
            try:
                pages.append(parse_page(page))
            except LayoutError as error:
                pages.append({"page": page.page_number, "group": "Unknown", "lessons": [], "warnings": [],
                              "issues": [{"kind": "page_layout", "message": str(error)}]})
        entries, errors, warnings = validate(pages, len(pdf.pages))
        groups, subjects, rooms = build_catalogs(entries)
        occupancy, conflicts, coincident = room_validation(entries)
        coverage = schedule_coverage(pages)
        summary = {"pdf_pages": len(pdf.pages), "parsed_pages": sum(not p["issues"] for p in pages),
                   "groups": len(groups), "entries": len(entries),
                   "lessons": sum(e["entry_kind"] == "lesson" for e in entries),
                   "activities": sum(e["entry_kind"] == "activity" for e in entries),
                   "subjects": len(subjects), "rooms": len(rooms), "errors": len(errors),
                   "source_warnings": len(warnings), "multi_room_entries": sum(len(e["rooms"]) > 1 for e in entries),
                   "potential_room_conflicts": len(conflicts), "coincident_booking_pairs": len(coincident)}
        validation = {"status": "failed" if errors else "passed_with_warnings" if warnings or conflicts else "passed",
                      "human_review_required": True, "generated_at": generated, "source_pdf_sha256": digest,
                      "summary": summary, "errors": errors, "source_warnings": warnings, "schedule_coverage": coverage,
                      "warning_counts": dict(Counter(w["kind"] for w in warnings)),
                      "potential_room_conflicts": conflicts, "coincident_booking_pairs": coincident,
                      "notes": ["Coincident booking pairs may represent shared teaching. Original group entries are retained.",
                                "Room occupancy uses the union of intervals, including all rooms in multi-room blocks.",
                                "Groups and subject names are retained as printed; continuation groups are not automatically merged.",
                                "Rooms can only be drawn from printed room labels; this is not a complete room inventory."]}
        report = {"schema_version": 2, "status": "full_extraction_for_human_review", "generated_at": generated,
                  "source_pdf_sha256": digest, "source_page_count": len(pdf.pages),
                  "selected_pages": list(range(1, len(pdf.pages) + 1)), "pages": pages, "validation": validation}
        source_url = None
        metadata_path = pdf_path.with_name("metadata.json")
        if metadata_path.exists():
            try:
                metadata = json.loads(metadata_path.read_text())
                if metadata.get("sha256") == digest:
                    source_url = metadata.get("pdf_url")
            except (ValueError, OSError):
                pass  # Optional download metadata never overrides PDF provenance.
        dataset = {"schema_version": 1, "generated_at": generated, "timezone": "Europe/Malta",
                   "schedule_kind": "weekly", "source": {"pdf_url": source_url, "sha256": digest, "page_count": len(pdf.pages)},
                   "human_review_required": True, "validation_status": validation["status"],
                   "policies": {"multi_room": "all_listed_rooms_for_full_interval", "occupied_minutes": "union_of_intervals",
                                "missing_rooms": "unassigned", "group_labels": "preserve_as_printed"},
                   "summary": summary, "groups": groups, "subjects": subjects, "rooms": rooms,
                   "entries": entries, "room_occupancy": occupancy, "schedule_coverage": coverage}
        output_dir.mkdir(parents=True, exist_ok=True)
        # Diagnostics are always regenerated. A structurally invalid parse must not
        # replace a previously valid dataset. Nothing is deployed by this command.
        atomic_write(output_dir / "validation.json", (json.dumps(validation, indent=2) + "\n").encode())
        write_report(report, pdf, output_dir)
        if not errors:
            atomic_write(output_dir / "timetable.json", (json.dumps(dataset, indent=2) + "\n").encode())
    return validation


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf", type=Path, default=DEFAULT_OUTPUT / "timetable.pdf")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_PROCESSED)
    args = parser.parse_args()
    try:
        validation = extract_timetable(args.pdf, args.output_dir)
    except (OSError, ValueError) as error:
        print(f"Full extraction failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps(validation["summary"], indent=2))
    print(f"Review: {args.output_dir.resolve() / 'review.html'}")
    print("Dataset written." if not validation["errors"] else "Structural errors found: existing timetable.json kept unchanged.")
    if not validation["errors"]:
        from backend.extract_labs import DEFAULT_LABS, extract_labs
        if DEFAULT_LABS.exists():
            try:
                inventory = extract_labs()
                print(f"Lab inventory: {inventory['room_count']} ICT rooms.")
            except (OSError, ValueError) as error:
                print(f"Lab inventory extraction failed: {error}", file=sys.stderr)
                return 1
    return 2 if validation["errors"] else 0


if __name__ == "__main__":
    sys.exit(main())
