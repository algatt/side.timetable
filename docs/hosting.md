# Daily refresh and GitHub Pages

The repository contains a ready-to-run workflow in
`.github/workflows/publish.yml`. It is not active until the project is pushed to
GitHub and Pages is enabled.

## First publication

1. Create a **public**, empty GitHub repository, for example `mcast-timetable`.
   Do not generate a README or `.gitignore`; this project already contains them.
2. Push this project to its `main` branch, including `data/IICT Labs.pdf`,
   `data/history/`, the mascot and the workflow. Downloaded timetable PDFs,
   environments, dependencies, generated reports and build files are ignored.
3. In the repository, open **Settings → Pages → Build and deployment → Source**
   and choose **GitHub Actions**.
4. Open **Actions → Refresh and publish timetable → Run workflow** on `main`.
   The first push also triggers a run; if it fails because Pages is not yet
   enabled, enable Pages and run it again.
5. Follow the deployment link in the successful workflow. It normally has the
   form `https://USERNAME.github.io/REPOSITORY/`.

With Git installed, the initial push from the project folder is:

```sh
git init -b main
git add .
git commit -m "Add MCAST timetable app and daily publication"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
git push -u origin main
```

Use your normal GitHub authentication or GitHub Desktop. Never place credentials
in source files or the remote URL. The workflow uses GitHub's built-in token;
it needs no personal token or paid server.

## What each refresh does

The workflow runs on pushes to `main`, manual runs, and at **06:17 Europe/Malta**
every day, including weekends. The timezone setting follows daylight saving.
GitHub schedules are best effort, so this is the target start time.

It discovers the homepage link again, downloads the current PDF, parses every
page and the supplied lab inventory, runs Python and frontend tests, and builds
the static site. A final check reads the built files and verifies PDF checksums,
matching extraction/validation timestamps, the Changes comparison, searchable
hours, ICT rooms, the lab PDF and essential assets.

Only a successful build can reach the deployment job. Download, extraction,
test or publication-check failures leave the previous deployed website online.
Available parser diagnostics are uploaded with failed runs for seven days.
Source warnings remain visible and do not imply human approval; automatic checks
cannot prove that an unfamiliar PDF layout was interpreted correctly.

Validated import history is tracked in `data/history/`. Each distinct PDF adds
a snapshot and updates the index; an unchanged PDF adds no history commit. The
workflow commits new history only after the build and publication checks pass.
This archive survives clean runners and is independent of expiring caches.
It records validated imports, including an import whose subsequent deployment
may fail. Re-running that import retains its comparison.

The workflow serializes publications. Its history push does not force-push; if
another commit reaches `main` during a build, a rejected push fails the run and
the next run starts with the latest code and history. Branch rules must permit
the workflow's history commits, or publication will stop on a new PDF.

Python runs only during refreshes. The published Vue app loads static JSON and
uses the browser for searches, statistics and the Malta clock. No Python API
needs hosting. Relative asset/data URLs support GitHub project subpaths.

## Verify before pushing

```sh
.venv/bin/python -m backend.download
.venv/bin/python -m backend.extract_timetable
.venv/bin/python -m unittest discover -s tests -v
npm --prefix frontend ci
npm --prefix frontend test
npm --prefix frontend run build
node frontend/scripts/check-publication.mjs
```

After deployment, verify a shared group URL, room search, the lab PDF link and
the sidebar's processed timestamp. A new PDF should advance Changes; an
unchanged PDF should retain the last comparison. Replace `data/IICT Labs.pdf`
and push when the inventory changes; this reference is supplied manually.

## GitHub scheduling limits

GitHub can delay or drop scheduled runs during heavy load. Public repositories
also have scheduled workflows disabled after 60 days without repository
activity. An unchanged timetable produces no history commits, so check the
Actions page periodically and re-enable a disabled workflow. Manual runs remain
available. A failed run can be retried from Actions after resolving its cause.

Official references:

- [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [Enable GitHub Actions as the Pages source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [Schedule events and their limits](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
