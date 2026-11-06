"""Generate self-contained review documents for sample or full extraction."""

import base64
import csv
import io
from html import escape

from backend.download import atomic_write


def write_report(report, pdf, output_dir):
    is_full = "validation" in report
    validation = report.get("validation", {})
    heading = "Full timetable extraction" if is_full else "Does the extraction match the PDF?"
    checkpoint = "Step 3 · full extraction checkpoint" if is_full else "Step 2 · verification checkpoint"
    csv_buffer = io.StringIO(newline="")
    fields = ("id", "group", "entry_kind", "weekday", "start", "end", "duration_minutes", "subject_code", "code_status", "subject_name", "rooms", "source_page", "notes")
    writer = csv.DictWriter(csv_buffer, fieldnames=fields)
    writer.writeheader()
    sections, links, index_rows, options = [], [], [], ['<option value="all">All pages</option>']
    for result in report["pages"]:
        number = result["page"]
        links.append(f'<a href="#page-{number}">Page {number} · {escape(result["group"])}</a>')
        options.append(f'<option value="{number}">Page {number} · {escape(result["group"])}</option>')
        index_rows.append(f'<tr><td><a href="#page-{number}">{number}</a></td><td>{escape(result["group"])}</td><td>{len(result["lessons"])}</td><td>{len(result.get("warnings", []))}</td><td>{len(result["issues"])}</td></tr>')
        page_image = pdf.pages[number - 1].to_image(resolution=150)
        for lesson in result["lessons"]:
            for_export = {key: lesson.get(key) for key in fields}
            for_export["rooms"] = "; ".join(lesson["rooms"])
            for_export["notes"] = " ".join(lesson["notes"])
            writer.writerow(for_export)
            page_image.draw_rect(lesson["source_bbox"], fill=None, stroke="#1769aa", stroke_width=2)
        image_bytes = io.BytesIO()
        page_image.annotated.save(image_bytes, format="PNG")
        image_data = base64.b64encode(image_bytes.getvalue()).decode("ascii")
        rows = []
        for lesson in result["lessons"]:
            values = (lesson["id"], lesson["weekday"], f'{lesson["start"] or "?"}–{lesson["end"] or "?"}',
                      lesson["duration_minutes"], lesson["subject_code"], lesson["subject_name"], ", ".join(lesson["rooms"]))
            cells = "".join(f"<td>{escape(str(value if value is not None else '?'))}</td>" for value in values)
            details = f'<details><summary>Source text</summary><pre>{escape(lesson["raw_text"])}</pre></details>'
            if lesson["notes"]:
                details += '<p class="note">' + escape(" ".join(lesson["notes"])) + '</p>'
            rows.append(f'<tr>{cells}<td>{details}</td></tr>')
        issues = "".join(f'<li>{escape(issue["message"])}</li>' for issue in result["issues"])
        issue_html = f'<div class="warning"><strong>Structural issues</strong><ul>{issues}</ul></div>' if issues else '<p class="checks">No structural issues detected. Human verification is still required.</p>'
        source_warnings = result.get("warnings", [])
        if source_warnings:
            warning_items = "".join(f'<li>{escape(warning["message"])}</li>' for warning in source_warnings)
            issue_html += f'<details class="warning"><summary>{len(source_warnings)} source warnings</summary><ul>{warning_items}</ul></details>'
        sections.append(f'''<section id="page-{number}" data-page="{number}">
<h2>Page {number} <span>{escape(result['group'])}</span></h2>
<p>{len(result['lessons'])} timetable blocks extracted. Blue outlines show the blocks used for extraction.</p>
{issue_html}
<details class="source" open><summary>Original PDF page with detected blocks</summary>
<img loading="lazy" src="data:image/png;base64,{image_data}" alt="PDF page {number} with extracted lesson blocks outlined in blue"></details>
<div class="table-wrap"><table><thead><tr><th>ID</th><th>Day</th><th>Time</th><th>Minutes</th><th>Subject code</th><th>Subject</th><th>Room(s)</th><th>Evidence / notes</th></tr></thead><tbody>{''.join(rows)}</tbody></table></div>
</section>''')
    total = sum(len(page["lessons"]) for page in report["pages"])
    overview = ""
    if is_full:
        summary = validation["summary"]
        overview = '<div class="stats">' + "".join(f'<div><strong>{summary[key]}</strong><span>{label}</span></div>'
            for key, label in (("pdf_pages", "PDF pages"), ("groups", "Group / activity labels"), ("lessons", "Lessons"),
                               ("activities", "General activities"), ("rooms", "Rooms"), ("errors", "Structural errors"))) + '</div>'
        overview += f'<p>{summary["source_warnings"]} source warnings · {summary["potential_room_conflicts"]} potential room conflicts · {summary["coincident_booking_pairs"]} coincident booking pairs. Coincident bookings may be shared teaching; original group entries remain separate and occupied minutes are counted once.</p>'
        if validation["errors"]:
            overview += '<p class="warning"><strong>Dataset not replaced:</strong> structural errors need review. Any existing timetable.json belongs to its earlier successful run.</p>'
        overview += '<details><summary>Source warning counts</summary><ul>' + "".join(f'<li>{escape(kind.replace("_", " "))}: {count}</li>' for kind,count in validation["warning_counts"].items()) + '</ul></details>'
        if validation["potential_room_conflicts"]:
            overview += '<details class="warning"><summary>Potential room conflicts</summary><ul>' + "".join(
                f'<li>{escape(item["room"])} · {escape(item["weekday"])} {item["start"]}–{item["end"]}: {escape(", ".join(item["groups"]))}</li>' for item in validation["potential_room_conflicts"]) + '</ul></details>'
        overview += '<details class="index"><summary>Page index and extraction counts</summary><div class="table-wrap"><table><thead><tr><th>Page</th><th>Group / activity</th><th>Entries</th><th>Warnings</th><th>Errors</th></tr></thead><tbody>' + ''.join(index_rows) + '</tbody></table></div></details>'
    navigation = (f'<label class="picker" for="page-filter">Choose a group or activity page</label><select id="page-filter">{"".join(options)}</select>'
                  if is_full else f'<nav>{"".join(links)}</nav>')
    script = '''<script>
const picker = document.getElementById('page-filter');
if (picker) picker.addEventListener('change', () => {
  for (const section of document.querySelectorAll('section[data-page]')) {
    section.hidden = picker.value !== 'all' && section.dataset.page !== picker.value;
  }
});
document.querySelectorAll('.index a').forEach(link => link.addEventListener('click', () => {
  if (picker) { picker.value = 'all'; picker.dispatchEvent(new Event('change')); }
}));
</script>''' if is_full else ""
    html = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>MCAST timetable · {'full extraction' if is_full else 'sample verification'}</title><style>
*{{box-sizing:border-box}}body{{font:16px/1.55 system-ui,sans-serif;color:#172b3a;background:#f3f6f9;margin:0}}
main{{max-width:1480px;margin:auto;padding:32px 24px 80px}}header,section{{background:white;border:1px solid #dbe3ea;border-radius:12px;padding:24px;margin-bottom:24px}}
h1{{font-size:30px;line-height:1.2;margin:10px 0}}h2{{margin-top:0}}h2 span{{color:#1769aa;margin-left:12px}}.eyebrow{{font-size:13px;text-transform:uppercase;letter-spacing:.1em;font-weight:700;color:#1769aa}}
nav{{display:flex;gap:10px;flex-wrap:wrap;margin-top:20px}}nav a{{background:#eaf2fa;border-radius:6px;padding:7px 12px;color:#144f7e;text-decoration:none}}
.meta{{font-size:13px;color:#526778;overflow-wrap:anywhere}}.checks{{color:#27603c}}.warning{{background:#fff4dd;padding:12px 16px;border-radius:6px}}.note{{color:#7b4c0b;font-size:13px}}
img{{display:block;width:100%;height:auto;border:1px solid #dbe3ea;margin-top:10px}}summary{{cursor:pointer;font-weight:600}}.source{{margin:20px 0}}
.table-wrap{{overflow:auto}}table{{border-collapse:collapse;width:100%;font-size:14px}}th,td{{text-align:left;vertical-align:top;padding:12px 10px;border-bottom:1px solid #dbe3ea}}th{{background:#edf3f8;white-space:nowrap}}td:nth-child(3),td:nth-child(5){{white-space:nowrap}}pre{{font-size:12px;white-space:pre-wrap;min-width:180px}}section{{scroll-margin-top:20px}}
.stats{{display:flex;gap:16px;flex-wrap:wrap;margin:24px 0}}.stats div{{background:#edf3f8;min-width:130px;padding:14px 18px;border-radius:8px}}.stats strong{{display:block;font-size:25px}}.stats span{{font-size:13px;color:#526778}}.picker{{display:block;margin:24px 0 8px;font-weight:600}}select{{font:inherit;padding:10px;max-width:100%;width:460px;border:1px solid #a6b6c4;border-radius:6px}}.index{{margin-top:18px}}
@media(max-width:650px){{main{{padding:12px}}header,section{{padding:16px}}h1{{font-size:25px}}h2 span{{display:block;margin-left:0}}}}
</style></head><body><main><header><div class="eyebrow">{checkpoint}</div><h1>{heading}</h1>
<p>{total} timetable entries from {len(report['pages'])} {'processed' if is_full else 'selected'} pages of a {report['source_page_count']}-page document. Compare each table with its original page: group, day, start/end time, subject code, name and all printed rooms.</p>
<p>Every listed room is treated as occupied for the full block. Multiple rooms still count as one lesson for group teaching hours. Missing codes and rooms remain unassigned; lecturer names and date-specific exceptions are not inferred.</p>
{overview}
<p class="meta">Generated (UTC): {escape(report['generated_at'])}<br>Source PDF SHA-256: {escape(report['source_pdf_sha256'])}</p>
{navigation}</header>{''.join(sections)}</main>{script}</body></html>'''
    atomic_write(output_dir / "lessons.csv", csv_buffer.getvalue().encode("utf-8-sig"))
    atomic_write(output_dir / "review.html", html.encode("utf-8"))
