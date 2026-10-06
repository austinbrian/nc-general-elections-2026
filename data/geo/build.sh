#!/usr/bin/env bash
# Rebuild the district boundary TopoJSON files in data/geo/ from official sources.
# Requires: curl, unzip, node (npx fetches mapshaper).
# Usage: data/geo/build.sh [workdir]   (workdir defaults to a temp dir)
set -euo pipefail

OUT="$(cd "$(dirname "$0")" && pwd)"
WORK="${1:-$(mktemp -d)}"
mkdir -p "$WORK"
cd "$WORK"
MS="npx -y mapshaper"

# ---- Sources -------------------------------------------------------------
# U.S. House: 2025 congressional plan, S.L. 2025-95 (SB 249), NCGA shapefile
CONGRESS_URL="https://webservices.ncleg.gov/ViewBillDocument/2025/7667/0/SL%202025-95%20-%20Shapefile"
# NC Senate: 2023 plan, S.L. 2023-146 (SB 758)
SENATE_URL="https://www.ncleg.gov/Files/GIS/Plans_Main/Senate_2023/SL%202023-146%20Senate%20-%20Shapefile.zip"
# NC House: 2023 plan, S.L. 2023-149 (HB 898)
HOUSE_URL="https://www.ncleg.gov/Files/GIS/Plans_Main/House_2023/SL%202023-149%20House%20-%20Shapefile.zip"

fetch() { [ -s "$2" ] || curl -sSLf -o "$2" "$1"; mkdir -p "${2%.zip}"; unzip -oq "$2" -d "${2%.zip}"; }
fetch "$CONGRESS_URL" congress2025.zip
fetch "$SENATE_URL"   senate2023.zip
fetch "$HOUSE_URL"    house2023.zip

# ---- Conversion ----------------------------------------------------------
# NCGA shapefiles are NAD83 NC State Plane (FIPS 3200, meters) with a string
# DISTRICT field. Steps: integer `district` -> dissolve by district (guards
# against multi-record districts) -> reproject to WGS84 -> topology-preserving
# weighted Visvalingam simplification (keep-shapes keeps every island/part)
# -> clean -> quantized TopoJSON with a single object.
district_layer() { # $1=src.shp $2=out name $3=simplify pct
  $MS -i "$1" \
    -each 'district = parseInt(DISTRICT, 10)' \
    -dissolve district \
    -proj wgs84 \
    -simplify weighted "$3" keep-shapes \
    -clean \
    -sort district \
    -rename-layers districts \
    -o "$OUT/$2" format=topojson quantization=100000
}

district_layer "congress2025/SL 2025-95.shp" us-house.topo.json  15%
district_layer "senate2023/SL 2023-146.shp"  nc-senate.topo.json 12%
district_layer "house2023/SL 2023-149.shp"   nc-house.topo.json  12%

# State outline: dissolve the congressional layer so the statewide highlight
# lines up exactly with district edges (the Census outline is clipped to the
# shoreline; NCGA districts include sounds).
$MS -i "$OUT/us-house.topo.json" \
  -dissolve \
  -each 'name="North Carolina"' \
  -rename-layers state \
  -o "$OUT/nc-state.topo.json" format=topojson force

# ---- Verification --------------------------------------------------------
node - "$OUT" <<'JS'
const fs = require('fs'), path = require('path');
const dir = process.argv[2];
const spec = { 'us-house.topo.json': ['districts', 14, 400],
               'nc-senate.topo.json': ['districts', 50, 400],
               'nc-house.topo.json': ['districts', 120, 600],
               'nc-state.topo.json': ['state', 1, 400] };
let ok = true;
for (const [f, [obj, n, maxKB]] of Object.entries(spec)) {
  const p = path.join(dir, f), kb = fs.statSync(p).size / 1024;
  const t = JSON.parse(fs.readFileSync(p));
  const objs = Object.keys(t.objects);
  const g = t.objects[obj].geometries;
  const errs = [];
  if (objs.length !== 1 || objs[0] !== obj) errs.push(`objects=${objs}`);
  if (g.length !== n) errs.push(`count=${g.length}`);
  if (kb >= maxKB) errs.push(`size=${kb.toFixed(0)}KB`);
  if (obj === 'districts') {
    const ds = g.map(x => x.properties && x.properties.district);
    for (let i = 1; i <= n; i++) if (ds.filter(d => d === i).length !== 1) errs.push(`district ${i}`);
    if (!ds.every(Number.isInteger)) errs.push('non-integer district');
  }
  // bounds from transform + arcs
  const [sx, sy] = t.transform.scale, [tx, ty] = t.transform.translate;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const a of t.arcs) { let x = 0, y = 0; for (const [dx, dy] of a) { x += dx; y += dy;
    const X = x * sx + tx, Y = y * sy + ty; x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y); } }
  if (x0 < -84.5 || x1 > -75.3 || y0 < 33.7 || y1 > 36.7) errs.push('bounds');
  console.log(`${errs.length ? 'FAIL' : 'ok  '} ${f}  ${kb.toFixed(0)} KB  n=${g.length}  bounds=[${x0.toFixed(3)}, ${y0.toFixed(3)}, ${x1.toFixed(3)}, ${y1.toFixed(3)}] ${errs.join(' ')}`);
  if (errs.length) ok = false;
}
process.exit(ok ? 0 : 1);
JS
