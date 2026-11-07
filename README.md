# MCAST Timetable

Incremental development of a timetable viewer and room availability tool for the MCAST Institute of ICT.

Architecture: Vue 3 frontend, Python data preparation and static JSON datasets. Timetables, lab details, room searches, live availability, usage and change comparisons are implemented. Each milestone is verified before starting the next.

Daily refresh and free GitHub Pages hosting are prepared in `.github/workflows/publish.yml`. They are not live yet. See [hosting setup and verification](docs/hosting.md) for the initial publication and schedule details.

## Step 1: find and download the timetable

This milestone only discovers and downloads the PDF. It does not extract lessons or build the website yet.

Requires Python 3.9 or newer. There are no third-party dependencies to install.

From the project folder:

```sh
python3 -m backend.download
```

The script:

1. Fetches https://iict.mcast.edu.mt/.
2. Finds the PDF anchor inside `menu-item-25574`. If that ID changes, it falls back to PDF links whose label or URL contains `timetable`.
3. Stops if no link is found or several distinct candidates remain. Duplicate desktop/mobile links are accepted.
4. Downloads the PDF (30-second network timeout; maximum 40 MiB).
5. Checks the PDF header and end marker. These are basic download checks; the next milestone will verify that a PDF library can read the document.
6. Compares SHA-256 hashes to detect changes even when the PDF URL stays the same.
7. Writes `data/source/timetable.pdf` and `data/source/metadata.json`. An unchanged PDF is kept without rewriting it; metadata records each successful check.

Metadata includes the discovered and final download URLs, UTC check time, checksum, file size, whether this run found a change, and available server modification headers. Failures return a nonzero exit code. Network failures or rejected downloads leave existing files untouched. PDF and metadata writes are individually atomic; they are not a two-file transaction.

Downloaded source files are ignored by Git. No lesson dataset is published at this stage.

## Verify this step

1. Run the command above and confirm that it prints the timetable PDF URL.
2. Open the downloaded file:

   ```sh
   open data/source/timetable.pdf
   ```

3. Confirm it is the same timetable you get from the institute homepage.
4. Open `data/source/metadata.json` and check its URL, time and size.
5. Run the downloader again. If the institute has not changed the PDF, it should print `unchanged PDF` and record `"changed": false`.

Run the offline checks:

```sh
python3 -m unittest discover -s tests -v
```

Tests cover link selection, relative URLs, nested markup, duplicate links, ambiguous/missing sources, same-URL updates, unchanged downloads, bad PDF responses and network failures. They use simulated responses; a successful test run does not prove that the live website is reachable.

## GitHub

A public repository is suitable. The project can be named `side.timetable` or `mcast-timetable`. GitHub setup and publishing are separate from verifying this downloader. No GitHub repository or scheduled job has been created by this milestone.

## Step 2: sample PDF extraction

Use a Python 3.12 virtual environment for the PDF tools. With `uv` installed, run these commands from the project folder:

```sh
uv venv --python 3.12 .venv
uv pip install -r requirements.txt
```

If `.venv` already exists, skip the first command. No activation is needed for `uv pip install`; it finds the project environment automatically.

Verify the dependency is available:

```sh
.venv/bin/python -c "import pdfplumber; print(pdfplumber.__version__)"
```

Extract a small sample:

```sh
.venv/bin/python -m backend.extract_sample
open data/sample/review.html
```

The default sample is PDF pages **1, 2, 4, 41 and 51** (page numbers start at 1). These include two-day and four-day timetables, standard five-day timetables, wrapped names, uneven printed row heights, inconsistent spacing in subject codes, and multiple rooms in a single lesson block. Choose different pages with `--pages 1 4 10`, or a different PDF with `--pdf path/to/file.pdf`.

Outputs in `data/sample/`:

- `review.html`: self-contained comparison document with the original pages, detected blocks outlined in blue, extracted lesson tables, and original text for each lesson.
- `lessons.json`: structured sample, raw text, page coordinates, source checksum, and any issues.
- `lessons.csv`: one row per lesson, for inspection in a spreadsheet.

The parser reads filled cell rectangles, weekday labels and time-row labels. It does not assume five weekday columns or equally sized time rows. Subject codes and room labels are also searched independently to flag text that was not assigned to a lesson. Unknown geometry or ambiguous lessons produce visible issues rather than guessed data. Exit code 0 means no structural issues were detected, 2 means the report contains issues, and 1 means extraction/report generation failed. None of these constitute human approval of the sample.

For every sample page, compare the group and each lesson's day, start/end time, subject code, name and rooms with the image. Page 4 (IT-FIT-2.1A) is a useful starting point. Its Friday 08:00–09:30 block lists **both ICT-126 and ICT-142**; both are retained without guessing which students use each room. Missing weekdays mean only that no column is printed for that group; this stage does not infer room availability.

**Agreed room availability rule:** when a lesson lists multiple rooms, treat every listed room as occupied for the full lesson interval. For IT-FIT-2.1A, both ICT-126 and ICT-142 are therefore occupied on Friday from 08:00 to 09:30. This is a conservative rule based on the published timetable. For statistics, the block counts as one lesson for the group, while each listed room accumulates the full occupied duration. The room finder will apply this rule when it is implemented.

The sample does not deduplicate lessons shared by groups, publish a full dataset, infer lecturer names, or handle calendar exceptions.

Run all checks with the project environment:

```sh
.venv/bin/python -m unittest discover -s tests -v
```

PDF integration checks use independently verified sample expectations and run only when the local PDF matches the recorded checksum. They skip if the file is absent or has changed, since a new timetable needs fresh verification. Subject normalization and downloader checks run without the source PDF. The extraction tests require the dependencies in `requirements.txt`.

Downloaded PDFs, generated reports and the virtual environment remain outside version control.

## Step 3: full extraction and validation

```sh
.venv/bin/python -m backend.extract_timetable
open data/processed/review.html
```

This processes every page and produces a comparison report with a **group/activity page selector**, annotated originals, a page index, and source warnings. It creates:

- `data/processed/timetable.json`: structured weekly data for the future Vue viewer, including entries, groups, subjects, rooms and merged room occupancy intervals.
- `data/processed/validation.json`: structural errors, missing source fields, placeholder codes, potential room conflicts, and coincident booking pairs.
- `data/processed/lessons.csv`: all timetable entries, including general activities, with their type and source page.
- `data/processed/review.html`: the self-contained verification report.

The current source (SHA-256 `736f4378e3bb736b9d03781e540fadf7995b4467eef7cb7a260c6809d9c6fa93`) produces **69 pages, 69 group/activity labels, 733 lessons, 11 general activities, 109 subject records and 51 rooms**. Its 44 source warnings comprise 6 placeholder-code occurrences, 27 blocks without a subject code, and 11 blocks without a recognized printed room. These counts describe the current file rather than requirements for future timetables.

### Rules for incomplete source data

- Placeholder codes such as `ITIGM-306-21xx` stay unchanged. Subjects with the same placeholder code and different names receive different subject IDs.
- Named lessons without printed codes keep their names and rooms, with a null code and a visible warning.
- Room labels currently support both `ICT-...` and `IBMC-...`.
- Meetings and Student Support are retained as activities. Missing rooms remain unassigned; no room is guessed. Parallel activity blocks within one weekday are captured separately.
- Original group labels stay separate, including `IT-ADS-6.3A` and `IT-ADS-6.3A-2`. They can be linked explicitly later if appropriate.
- A group-only annotation before a subject code (for example `IT-CYB-6.2A, Erasmus Group 1`) is recorded in `shared_groups`, separately from the unit name `Maths for Cybersecurity`. The timetable page still determines the entry's group. This does not create extra entries or alter bookings; original text is retained. Unrecognized text before a code stays in the name rather than being discarded.
- All listed rooms in a multi-room block are occupied for its entire interval. Each block remains one group lesson. Occupied room minutes use the union of intervals so coincident bookings are counted once.
- Matching subject/time bookings in the same room are reported as coincident pairs, which may represent shared teaching. They remain separate group entries. Other overlaps are reported as potential room conflicts. The current PDF has 16 coincident pairs and no potential room conflicts under this check.

Every entry includes source text and PDF coordinates. Coverage checks account for every timetable-body word, as well as every recognized subject code and room label. A structural error prevents replacing `timetable.json`; diagnostics and the review report still describe the failed run. A previous dataset may remain, so compare its source hash and generated time with `validation.json` after failures. Individual files are replaced atomically; the output folder is not a single atomic publication.

This is still a verification checkpoint. The command does not publish a website or infer calendar dates, holidays, cancellations or lecturer assignments. Room availability will reflect the known published timetable; unassigned activity rooms and rooms absent from the PDF cannot establish a complete physical inventory.

## Step 4: Vue timetable viewer

The viewer is in `frontend/`, built with Vue 3, TypeScript and Vite. It reads the validated JSON directly; a running Python API is not needed. Use Node.js **22.18 or newer**.

On a fresh checkout, generate the Python dataset first, then install and launch:

```sh
cd frontend
npm ci
npm run dev
```

Open the Local URL Vite prints (normally http://127.0.0.1:5173/). If dependencies are already installed, only `npm run dev` is needed. The `predev` script copies the dataset automatically after checking that its source hash and generation timestamp match a successful validation report. A failed or mismatched extraction stops preparation rather than serving a newly copied dataset.

### Verify the viewer

1. The initial schedule is **IT-FIT-2.1A**, if present. Use the sidebar search to find another group or activity. On small screens use the group dropdown.
2. Compare the weekly grid with the PDF. Select Friday's **08:00–09:30 Computer Systems** block and confirm it displays both **ICT-126 and ICT-142**, the subject code, duration, source notes, and a link to PDF page 4.
3. Use **Week / List** to change views. List view includes the subject codes and opens by default on screens 760px wide or narrower. Week view scrolls horizontally on narrow screens.
4. Select **General** and confirm the two overlapping Wednesday activities appear side by side in Week view and separately in List view.
5. Select **IT-DIG-3.1A** to see placeholder codes in the details. Missing or placeholder source information remains visible rather than being filled in.
6. Open and close a lesson with the keyboard. The native dialog supports Escape to close. Copy the browser URL to retain the selected group through its `?group=` parameter.

The viewer always displays a weekly pattern, not a dated calendar. Times and the preparation timestamp use Europe/Malta. Block hours sum each listed block's duration; simultaneous blocks remain separate and this total is not room occupancy. Subject colours are stable across groups and rooms. Timetable labels from the source stay unchanged.

After generating new Python data while the dev server is already running, run `npm run prepare-data` inside `frontend/` and refresh the browser. The app does not fetch or parse the institute's PDF in the browser.

Checks and production build, from `frontend/`:

```sh
npm test
npm run build
```

The build runs Vue/TypeScript checking and writes the static website to `frontend/dist/`. Use `npm run preview` to serve that build locally. `package-lock.json` records the installed dependency versions; generated data, build output and dependencies are ignored by Git. Frontend tests include lane placement for every group in the extracted dataset. Browser checks cover search, group selection, weekly and list views, multi-room lesson details, Escape dismissal, parallel activity blocks, and mobile layouts.

## Step 5: free-room finder

Open **Find a room** in the app. Choose a weekday and start/end times, then select **Find rooms**. Searches are limited to **ICT rooms**, with no IBMC or building selector. The default search is Friday 08:00–09:30. Room labels can be filtered (e.g. `126`), and **Show occupied rooms** reveals the rooms excluded from the free list. Expand a room's day schedule to see its bookings, and select one to open its lesson details and original PDF reference.

Searches consider all timetable groups and every room printed in a block. A room is free only if no booking overlaps any part of the requested interval. Intervals are treated as `[start, end)`: a booking ending exactly at the search start, or starting exactly at the search end, does not overlap. Times can use any minute; the search does not round to half-hour slots. Changing fields keeps the previous results explicitly labelled until **Find rooms** is selected again. Invalid searches show an error without replacing the last valid results.

The exported `schedule_coverage` records the represented weekdays and the time range common to the printed page grids. This is calculated from the PDF labels, independently of when lessons happen. The current PDF supports Monday–Friday, 08:00–20:00. The finder rejects searches outside this coverage; an older dataset without coverage can still display timetables, but room search is unavailable until extraction is rerun.

### Verify room availability

For the current source, search Friday with **Show occupied rooms** enabled and use the room filter:

| Interval | ICT-126 | ICT-142 |
| --- | --- | --- |
| 08:00–09:30 | Occupied by IT-FIT-2.1A | Occupied by IT-FIT-2.1A |
| 09:30–10:00 | Free in the published timetable | Occupied by IT-FIT-2.1H |

Also try an end time earlier than the start, expand the day bookings, and switch back to **Timetables**. Search settings are retained in the URL (`tool=rooms`, `day`, `start`, `end`, and optional `room`) for reloading or sharing. The internal `building=ICT` parameter is retained for compatibility; an old `building=all` link still searches only ICT rooms, and the interface normalizes older IBMC links to ICT.

Availability applies to known rooms and printed assignments, rather than a complete physical room inventory. Overlapping blocks without a printed room are shown above the results and cannot be assigned to any particular room. Capacity, equipment, ad hoc bookings and actual physical occupancy are not inferred. The finder does not reserve rooms.

Checks cover partial overlap, exact boundaries, multi-room lessons, other groups, ICT-only scope, missing rooms, supported search hours, and comparison with the complete source data. The production build also runs TypeScript checking.

## Lab inventory: room details and equipment

The supplied `data/IICT Labs.pdf` is imported with:

```sh
.venv/bin/python -m backend.extract_labs
```

The full timetable extraction command also imports this inventory when the PDF is present. Output is `data/processed/labs.json`. The importer verifies column names, checkmark values, numeric fields, unique rooms and the PDF's colour legend. It records each room's original page, raw table values and the source PDF checksum. The current document contains **55 ICT rooms: 40 computer labs, 5 classrooms and 10 other rooms**.

`npm run prepare-data` (also run before dev/build) verifies the inventory checksum against the supplied PDF, attaches the inventory to the website's data, and copies the original reference to `frontend/public/data/iict-labs.pdf`. After changing the PDF, rerun the inventory extraction, prepare the frontend data and reload the browser. Inventory details do not change the original timetable's room assignments.

The **Lab directory** displays all 55 rooms and supports room/note searches, minimum seats, minimum student PCs, room type, OS and display filters. The same capacity/equipment filters are available in **Find a room**. Room cards and lesson details show seating, student PC counts, OS, notes, teacher-PC/display information and a link to the lab PDF page.

Blank cells remain **Not listed**, rather than zero or an assumed “no”. For example, ICT-300's `Raspberry Pi Lab (x30)` note does not establish a student-PC count; its student-PC cell is blank. A minimum-PC filter only matches explicitly listed counts. Inventory OS values stay as printed, including `MAC OS` and `Win10/Ubuntu`.

All **47 ICT rooms in the timetable** have inventory matches. The **8 inventory-only rooms** (ICT-002, ICT-108, ICT-109, ICT-143, ICT-144, ICT-145, ICT-236 and ICT-B02) are visible in the directory with **No current timetable listing**. They are excluded from free-room results, since the timetable does not establish their availability. Free-room searches still consider bookings from every group and block every room listed in a multi-room lesson.

Useful checks: ICT-003 has 31 seats, 20 student PCs, Ubuntu and a TV screen; ICT-126 has 19 seats, a projector and no printed student-PC count; ICT-302 is a MAC Lab. In the free-room finder, try Friday 08:00–09:30 with at least 30 student PCs and Ubuntu, then inspect ICT-006's details.

Timetable statistics are implemented. The daily refresh and hosting workflow is ready for GitHub activation; see [hosting setup](docs/hosting.md).

## Next milestones

1. Discover and download the PDF.
2. Verify sample extraction against the PDF.
3. Verify the full extraction, source warnings and room occupancy rules.
4. Verify the Vue weekly timetable viewer.
5. Verify the free-room finder.
6. Verify timetable statistics and UI refinements.
7. **Current checkpoint:** activate the prepared daily GitHub Actions refresh and GitHub Pages hosting.

## Group and room schedules

Under Timetables, **Display schedules by → Group / Room** switches the sidebar and mobile selector between group schedules and ICT room schedules. Room schedules collect entries from all groups, preserve parallel/shared blocks and show the group on each block. Week and List views both work; selecting a block opens its original group lesson and PDF references. Multi-room lessons appear in every listed room. Inventory-only rooms show a notice that their availability is unconfirmed. The selection is retained in `by=room&schedule_room=ICT-126`, independently of room-finder filters.

### Timetable insights

The viewer now includes these tools:

- **Changes** compares the latest distinct PDF import with the previous recorded import. It reports added/removed blocks and unambiguous changes to day, time, rooms or subject name. PDF page numbers, generated entry IDs and room ordering do not create changes. Ambiguous matches remain separate additions/removals; removal does not establish cancellation.
- **Free now** uses the current `Europe/Malta` time, including daylight saving, and refreshes every 30 seconds. Choose 15–120 minutes. The requested duration must fit within the published days/hours. Both this tool and interval searches show **Free until** the next booking, capped at the end of published hours.
- **Room usage** ranks ICT rooms by scheduled occupancy, with day/time/type filters, total room hours and daily breakdowns. Occupancy uses the union of overlapping bookings per room, clipped to the selected window. The denominator is the window duration multiplied by the selected published days. It is not attendance or seat utilisation.
- **Alternative rooms** is available on occupied room cards under **Find a room → Show occupied rooms**. Candidates must be free for the full interval and match the source room's known type, minimum seating/student PCs, OS and positively listed equipment, as well as explicit search filters. Missing source details add no constraint; unknown candidate details cannot satisfy a known requirement. Specialist facilities/software require manual checking.

All availability and usage calculations remain ICT-only, use all timetable groups and reserve every listed room in a multi-room block. Inventory-only rooms have unconfirmed availability and are excluded. Ad hoc bookings and entries without a printed room cannot be inferred.

### Statistics by unit and group

**Statistics** provides searchable, sortable **By unit / By group** tables for
lesson counts, weekly lesson hours, scheduled days and group/unit counts.
**View groups** expands a unit into group totals; **View units** expands a group
into unit totals. The grouping is retained in `tool=stats&stats_by=group` (or
`unit`). Weekday columns vary in height with scheduled lesson hours. Main rows
share a scale across the full unit/group view, unaffected by search or sorting;
each expanded breakdown has its own shared scale. Hover for exact hours, also
available to assistive technology. Days without lessons have no filled column.

Only lesson entries contribute. Multi-room lessons count once per group; shared
sessions and overlapping lesson entries remain separate group blocks. Hours sum
the weekly pattern, rather than lecturer contact time or whole-unit delivery.
Complete codes combine printed-name variants, with all original names retained
in the unit breakdown. Missing or placeholder codes use code plus name to keep
unrelated units separate. Different complete codes remain distinct even when
their names match.

The current PDF yields **108 units, 65 groups with lessons and 1,036 weekly
lesson hours across groups**. IT-FIT-2.1A has **10 units, 17 lessons and 20 weekly
hours**. Its multi-room Computer Systems block contributes 1.5 hours, giving
Computer Systems 2.5 hours for that group. Activities such as meetings are
excluded. Automated checks reconcile both views against all lesson entries.

### Import history and daily updates

`npm --prefix frontend run prepare-data` (also run by `dev` and `build`) records validated snapshots in `data/history/`, keyed by PDF SHA-256, and publishes `frontend/public/data/changes.json` alongside the timetable. The first import establishes a baseline; it cannot reconstruct an earlier PDF. Rebuilding the same PDF retains the existing comparison. A later different PDF advances the comparison.

The snapshot archive in `data/history/` is tracked by Git so clean CI runners retain the previous import. The publication workflow commits new snapshots after validation and build checks pass. Only the latest comparison is included in the website; the snapshot archive is available in the public repository.

The prepared workflow runs download, extraction, tests and frontend preparation/build in that order, targeting 06:17 Malta time daily after GitHub activation. For a local refresh:

```sh
.venv/bin/python -m backend.download
.venv/bin/python -m backend.extract_timetable
npm --prefix frontend run build
```

Check the features locally at `http://127.0.0.1:5173/`. Run frontend checks with `npm --prefix frontend test`; the insights tests cover Malta winter/summer time, coverage limits, occupancy unions, alternative constraints, change matching and persistent history across repeated builds.
