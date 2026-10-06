# NC General Elections Guide

An interactive guide to North Carolina's top races in the November 3, 2026 general
election, built for The Assembly. Forked from the spring primaries guide.

> **Placeholder data:** until the general-election article is written, `races.json` holds the
> 26 spring primary races as placeholders (`"placeholder": true`).

## Live Site

- **GitHub Pages**: _TBD — not deployed yet_
- **Data source**: `races.json`

## Quick Start

```bash
# Run locally
python3 -m http.server 8000
# Open http://localhost:8000
```

## Login

The site opens behind a login gate: username `admin`, password `grace`. The check runs
client-side (`auth.js` compares a SHA-256 hash), so it keeps casual visitors and search
engines out but is **not** real security: anyone can fetch `races.json` directly or read
the repo. To change the credentials, replace `CREDENTIAL_HASH` in `auth.js` with the output of
`printf 'user:pass' | shasum -a 256`. Needs https or localhost (Web Crypto).

## District Map

`map.js` draws the districts from `data/geo/` with a Federal / NC House / NC Senate toggle.
Districts with a featured race (from each race's `districts` field) are highlighted;
clicking one opens its card, and a card's district chip jumps back to the map. Deep link
to a race with `#race=<id>`. Boundary sources and the rebuild script are in
`data/geo/SOURCES.md` and `data/geo/build.sh`.

## Updating Race Data

Edit `races.json` directly. Each race has:

```json
{
  "id": "nc-senate-26",          // stable slug: map → card links and #race=<id> URLs
  "rank": 1,
  "title": "Senate District 26",
  "party": "Republican",         // optional; primary-style races only — omit for general races
  "type": "State Senate",        // "State Senate", "State House", "U.S. House", "U.S. Senate", "Judicial"
  "districts": [                 // what the map highlights and what results map to
    { "chamber": "nc-senate", "number": 26 }
  ],
  "location": "Rockingham & Guilford Counties",
  "candidates": [
    {
      "name": "Phil Berger",
      "party": "Republican",     // general races: each candidate's party
      "role": "Incumbent",       // "Incumbent", "Challenger", "Candidate", "Frontrunner", "Appointed Incumbent"
      "description": "State Senate leader since 2011..."
    }
  ],
  "summary": "The main story...",
  "stakes": "Why it matters...",
  "keyIssues": ["Issue 1", "Issue 2"],
  "keyFact": "Key statistic or detail..."
}
```

### `id` and `districts`

- `id` is a lowercase slug, unique across races: `us-senate`, `us-house-1`, `nc-senate-26`,
  `nc-house-106`, `judicial-coa-3`. A race covering two districts gets one id
  (`nc-senate-9-nc-house-4`).
- `districts` is a list of `{ "chamber", "number" }`:

  | chamber | number |
  |---|---|
  | `us-house` | 1–14 |
  | `nc-senate` | 1–50 |
  | `nc-house` | 1–120 |
  | `us-senate` | `null` (statewide) |
  | `judicial` | `null` (statewide); add `"court": "coa"` (or `"supreme"`) and `"seat": N` so results can be matched |

  A combined race lists every district it covers.

### Validate before committing

```bash
python3 scripts/validate_races.py
```

Checks unique ids, at least one district per race, valid chambers, and district numbers in
range. Exits non-zero on any error.

After editing, commit and push:

```bash
git add races.json
git commit -m "Update race data"
git push
```

Changes appear on GitHub Pages within a few minutes.

## Election Results

`update_results.py` fetches NCSBE's live results file and writes `results.json`, keyed by race
title (multi-district races get one entry per district, e.g. `"Senate District 9"`). Each
candidate includes `name`, `votes`, `percentage` and, when NCSBE reports one, `party`.

```bash
python3 update_results.py                    # Nov 3, 2026: https://er.ncsbe.gov/enr/20261103/data/results_0.txt
python3 update_results.py --url https://er.ncsbe.gov/enr/20241105/data/results_0.txt --output /tmp/test.json
NCSBE_RESULTS_URL=... python3 update_results.py   # same as --url
```

Contests are matched from each race's `districts`, using NCSBE's general-election names
(no party suffix), e.g. `US SENATE (VOTE FOR 1)`, `US HOUSE OF REPRESENTATIVES DISTRICT 01 (VOTE FOR 1)`,
`NC STATE SENATE DISTRICT 09 (VOTE FOR 1)`, `NC HOUSE OF REPRESENTATIVES DISTRICT 004 (VOTE FOR 1)`,
`NC COURT OF APPEALS JUDGE SEAT 03 (VOTE FOR 1)`. A race that still has a top-level `party`
is treated as a primary and matched with the ` - REP` / ` - DEM` suffix.

The page's "Update Results" button does the same mapping in the browser (`app.js`), so keep
the two in sync when changing either.

`.github/workflows/update-results.yml` runs the script and commits `results.json`. Its
15-minute cron is **commented out** until election night; uncomment it on Nov 3 and remove it
afterwards. It can be run manually any time via `workflow_dispatch`. Keep `results.json` at
`{"lastUpdated": null, "precinctsReporting": null, "races": {}}` until then.

## WordPress Integration

Deferred until the map is final (see `PLAN.md`).

## File Structure

```
├── index.html              # Page shell: header, login gate, map, controls, board
├── styles.css              # Styles
├── app.js                  # Cards, views, filters, results
├── map.js                  # District map
├── auth.js                 # Login gate
├── races.json              # Race data (edit this to update content)
├── results.json            # NCSBE results (empty until election night)
├── update_results.py       # NCSBE results fetcher
├── scripts/validate_races.py  # races.json validator
├── data/geo/               # District boundaries (TopoJSON) + SOURCES.md
└── reference/              # Primary article text, for reference only
```

## Features

- **4 View Modes**: Skim, Peek, Peruse, Deep Dive
- **District map**: Federal / NC House / NC Senate toggle; click a district to open its race
- **Filters**: By race type (Congress, Senate, House, Judicial)
- **Click to Expand**: Click any card to see more details
- **Responsive**: Works on mobile and desktop

## Credits

By Bryan Anderson, The Assembly
