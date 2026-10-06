# District boundary sources

Downloaded **2026-10-06**. Rebuild with `data/geo/build.sh [workdir]`; it downloads, converts, and verifies everything.

| File | Layer | Plan | Enacted | Source |
|---|---|---|---|---|
| `us-house.topo.json` | U.S. House, 14 districts | **2025 Congressional Plan, S.L. 2025-95** (SB 249, "Realign Congressional Districts 2025") | Oct 22, 2025 | NCGA shapefile: https://webservices.ncleg.gov/ViewBillDocument/2025/7667/0/SL%202025-95%20-%20Shapefile |
| `nc-senate.topo.json` | NC Senate, 50 districts | **2023 Senate Plan, S.L. 2023-146** (SB 758) | ratified Oct 25, 2023 (first used in 2024) | https://www.ncleg.gov/Files/GIS/Plans_Main/Senate_2023/SL%202023-146%20Senate%20-%20Shapefile.zip |
| `nc-house.topo.json` | NC House, 120 districts | **2023 House Plan, S.L. 2023-149** (HB 898) | ratified Oct 25, 2023 (first used in 2024) | https://www.ncleg.gov/Files/GIS/Plans_Main/House_2023/SL%202023-149%20House%20-%20Shapefile.zip |
| `nc-state.topo.json` | State outline | Dissolved from `us-house.topo.json` (S.L. 2025-95) | n/a | derived |

The NCGA plan index is https://www.ncleg.gov/redistricting.

## How I confirmed these are the 2026 maps

- **NCGA redistricting page** (checked 2026-10-06). Under "Current District Plans", the Congressional entry is labeled "(To be used for the 2026 Election)": SB 249 / S.L. 2025-95, "Enacted 2025 (to be used for the 2026 elections)". The House and Senate entries are HB 898 / S.L. 2023-149 and SB 758 / S.L. 2023-146.
- **NCSBE "Voting Maps/Redistricting"** (https://www.ncsbe.gov/results-data/voting-maps-redistricting). It says S.L. 2025-95 is the congressional map "for use in the 2026 elections", and it links the 2023 House and Senate maps as the current legislative maps.
- **Litigation:**
  - *Williams v. Hall* (M.D.N.C., three-judge panel). The 2023 congressional, Senate and House plans were upheld on Nov 20, 2025. A preliminary injunction against the 2025 CD1/CD3 changes was denied on Nov 26, 2025. The case was dismissed on Jan 16, 2026.
  - *Pierce v. NCSBE* (E.D.N.C., VRA §2 challenge to Senate districts 1 and 2). The Senate map was upheld on Sep 30, 2025. Plaintiffs voluntarily dismissed their appeal on May 11, 2026, after *Louisiana v. Callais*.
  - I found no court-ordered or legislative change to the 2023 legislative plans since then.
- The source files carry the right number of records (14, 50, 120). Each district number appears exactly once.

What the 2025 congressional change did: it redrew only eastern NC. Four counties moved from CD1 to CD3, and six moved from CD3 to CD1. News coverage reports the other districts are unchanged from S.L. 2023-145. I did not check that geometrically.

## Processing (mapshaper, via `npx -y mapshaper`)

The source projection is NAD83 NC State Plane (FIPS 3200, meters). It is reprojected with `-proj wgs84`.

For each district layer:

```
-each 'district = parseInt(DISTRICT, 10)'
-dissolve district            # one feature per district; drops all other fields
-proj wgs84
-simplify weighted <pct> keep-shapes
-clean
-sort district
-rename-layers districts
-o format=topojson quantization=100000
```

The `<pct>` value is the share of vertices kept:

| Layer | Vertices kept |
|---|---|
| U.S. House | 15% |
| NC Senate | 12% |
| NC House | 12% |
| State outline | 15% |

The state outline is filtered to `STATEFP === "37"`, keeps only `name`, and uses the object name `state`.

TopoJSON shares arcs between neighbors, so simplification cannot open gaps or slivers between districts.

## Result (verified by the check at the end of `build.sh`)

| File | Size | Features | Bounds (lon/lat) |
|---|---|---|---|
| us-house.topo.json | 151 KB | 14 | -84.322, 33.753 .. -75.400, 36.588 |
| nc-senate.topo.json | 204 KB | 50 | same |
| nc-house.topo.json | 284 KB | 120 | same |
| nc-state.topo.json | 12 KB | 1 | -84.322, 33.843 .. -75.462, 36.588 |

## Caveats

- **Coastline mismatch.** The NCGA district shapes are built from Census blocks, so they include sounds and nearshore water. The Census cartographic state outline is clipped to the shoreline. On the coast, the district layers therefore extend a little past the state outline: about 0.09° further south and 0.06° further east. For a statewide highlight that lines up exactly with the district edges, dissolve any district layer instead (`-dissolve` with no field).
- **Remaining legal uncertainty is low.** Absentee voting for Nov 3, 2026 is already under way, and I found no pending order that could change any of these maps before the election.


**2026-10-06 change:** `nc-state.topo.json` is now the dissolved congressional layer rather than the Census outline, so the U.S. Senate highlight matches district edges (resolves the coastline mismatch above).
