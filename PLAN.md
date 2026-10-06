# NC General Elections Guide 2026 — Technical Plan

Fork of `~/dev/matchup-guide` (the spring "Top Primaries to Watch" guide) for the
Nov 3, 2026 general election. Same static-site architecture (plain HTML/CSS/JS, no build
step, `races.json` as the single editable data file), plus three additions:

1. **District map** with a three-way toggle: **Federal** (U.S. House + U.S. Senate) /
   **NC House** / **NC Senate**. Districts with a featured race are highlighted; clicking
   one opens that race's card.
2. **Login gate** (username `admin`, password `grace`) so the site can be handed to Grace
   at The Assembly before publication.
3. **General-election plumbing**: race data without party primaries, NCSBE results for
   the Nov 3 contest names.

The article isn't written yet (expected week of Oct 12). Until then `races.json` holds the
**26 primary races as placeholders**; districts will likely change when the real list lands.

---

## Layout

```
index.html            page shell: header, login gate, map section, controls, board
app.js                cards, views, filters, results (from primaries guide)
map.js                NEW — map rendering, toggle, highlight, click → card
auth.js               NEW — login gate
styles.css            + map + gate styles
races.json            race data (placeholder) — gains a `districts` field per race
results.json          NCSBE results (empty until election night)
update_results.py     NCSBE fetcher — retargeted to 20261103 general contest names
data/geo/             NEW — simplified TopoJSON district boundaries + SOURCES.md
reference/            primary article text, for reference only
```

## 1. District boundaries (`data/geo/`)

Maps in force for the **2026** general election:

| Layer | Expected plan | Notes |
|---|---|---|
| U.S. House (14) | 2025 congressional remap (S.L. 2025-95, enacted Oct 2025) | Mid-decade redraw; mostly CD1. Census CD119 TIGER files are **not** current. Verify against NCGA and any court orders. |
| NC Senate (50) | 2023 Senate plan (S.L. 2023-146), plus any court-ordered/2025 changes | Verify. |
| NC House (120) | 2023 House plan (S.L. 2023-149) | Verify. |
| State outline | Census cartographic boundary | Used for U.S. Senate (statewide) highlight. |

Primary source: NCGA redistricting site (ncleg.gov / webservices.ncleg.gov shapefiles).
Fallback: NCSBE / Redistricting Data Hub / Census.

**Output contract** (the map code depends on exactly this):

- `data/geo/us-house.topo.json`, `nc-senate.topo.json`, `nc-house.topo.json`, `nc-state.topo.json`
- Each TopoJSON has one object named **`districts`** (`state` for the outline).
- Each feature has integer property **`district`** (1-based, no zero padding).
- WGS84 lon/lat, simplified with mapshaper so each file is **< 400 KB** (House < 600 KB),
  topology preserved (no gaps/slivers between neighbors).
- `data/geo/SOURCES.md`: source URL, plan name/session law, download date, simplification
  settings, and a reproducible `build.sh`.

## 2. Race data (`races.json`)

Each race gains a machine-readable `districts` array so the map never parses titles:

```json
"districts": [{ "chamber": "us-house", "number": 1 }]
```

`chamber` ∈ `us-house | us-senate | nc-senate | nc-house | judicial`. U.S. Senate and
judicial use `"number": null` (statewide). The combined SD9/HD4 race lists both. Each
race also gets a stable `id` slug (e.g. `"nc-senate-26"`) used for map → card linking and
URL hashes (`#race=nc-senate-26`).

General-election changes: `party` becomes optional (general races have one D and one R
plus others; candidate objects gain `party`), and titles drop "Republican/Democratic
Primary". Placeholders keep primary candidates but are flagged `"placeholder": true` at
the top level, and the subtitle says so.

`update_results.py` / `app.js` results: date → `20261103`; general contest names have no
party suffix (`US HOUSE OF REPRESENTATIVES DISTRICT 01 (VOTE FOR 1)`, etc.). Verify the
format against NCSBE's 2024 general (`enr/20241105`). The cron stays commented out until
election night.

## 3. Map (`map.js`)

- **D3 v7 + topojson-client** from cdnjs; inline SVG, `d3.geoMercator().fitSize()` to
  NC. No tile server, no API key, works inside an iframe.
- **Toggle**: segmented control `Federal | NC House | NC Senate`, styled like the
  existing view buttons. Federal draws U.S. House districts; if a U.S. Senate race is
  featured, the state outline gets a highlighted stroke plus a "Statewide: U.S. Senate"
  chip under the map that opens its card.
- **Highlight**: districts with a featured race filled in the accent color (party-neutral,
  since these are general races); others light gray; district labels on highlighted ones.
- **Interaction**: hover/focus → tooltip (district + race title); click/Enter → scroll to
  the race card, expand it to Peruse, flash it. Clicking a card's district chip goes the
  other way (switch layer, pulse the district). Districts are focusable (`tabindex`,
  `role="button"`, `aria-label`).
- **Sync with filters**: the existing type filters (US House / NC Senate / …) set the map
  layer; the map toggle sets the filter. One source of truth: `currentFilter`.
- Layers load lazily (fetch the TopoJSON when first toggled) and are cached.
- Responsive: full width on mobile, side-by-side with a race list ≥ 1000px is optional;
  default is map stacked above the board.

## 4. Login gate (`auth.js`)

The site is static on GitHub Pages, which has no server-side auth. The gate:

- Full-screen login form (username + password) rendered before anything else; `app.js`
  and `map.js` don't load data until it resolves.
- Credentials are not stored in plain text: the page compares `SHA-256("admin:grace")`
  computed with Web Crypto against a stored hash. On success it sets a
  `sessionStorage` flag (in try/catch) so reloads don't re-prompt.
- Logout link in the footer.

**Limit, stated plainly:** this keeps casual visitors and search engines out (also add
`<meta name="robots" content="noindex">`), but anyone who opens the repo or fetches
`races.json` directly can read the data. If pre-publication content must actually stay
secret, host the repo **private** and put real HTTP auth in front (e.g. Cloudflare Pages
with a basic-auth `_middleware.js`). That's a hosting decision for Brian, not built yet.

## 5. Deferred / not in scope yet

- WordPress embed (`wordpress-embed.html`, `build-wordpress.sh`) — not copied; regenerate
  after the map is final. The iframe embed from the README still works.
- GitHub repo + Pages deployment — needs Brian's go-ahead (repo name, public/private).
- Swapping in the real race list once the article arrives (data-only change:
  `races.json` + `districts` field).

## Work split

| Agent | Owns | Depends on |
|---|---|---|
| **geo** | `data/geo/*` | — |
| **data** | `races.json` (`id`, `districts`), `update_results.py`, results code in `app.js` | — |
| **frontend** | `map.js`, `auth.js`, `index.html`, `styles.css`, card wiring in `app.js` | contracts above; integrates geo/data output at the end |

Integration check (lead): serve locally, log in, toggle all three layers, click each
highlighted district → correct card; every race with a district appears on the map.
