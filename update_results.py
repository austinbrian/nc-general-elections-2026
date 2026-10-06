#!/usr/bin/env python3
"""Fetch NCSBE election results and write results.json for the general-election guide.

Usage:
    python3 update_results.py                      # Nov 3, 2026 general (default)
    python3 update_results.py --url URL            # any NCSBE results_0.txt (e.g. 2024 general)
    python3 update_results.py --output FILE        # write somewhere other than results.json

The URL can also be set with the NCSBE_RESULTS_URL environment variable.

Contests are mapped from each race's `districts` array (see README). General-election
contest names have no party suffix, e.g. "US HOUSE OF REPRESENTATIVES DISTRICT 01 (VOTE FOR 1)".
If a race still has a top-level `party` (primary-style data), the primary suffix
" - REP" / " - DEM" is added, matching NCSBE's primary contest names.
"""

import argparse
import json
import os
import re
import urllib.request
from datetime import datetime

RESULTS_URL = "https://er.ncsbe.gov/enr/20261103/data/results_0.txt"
RACES_FILE = "races.json"
OUTPUT_FILE = "results.json"

PARTY_CODES = {"Republican": "REP", "Democratic": "DEM"}
PARTY_NAMES = {
    "REP": "Republican",
    "DEM": "Democratic",
    "LIB": "Libertarian",
    "GRE": "Green",
    "CST": "Constitution",
    "JFA": "Justice for All",
    "WTP": "We the People",
    "UNA": "Unaffiliated",
}
SUB_LABELS = {"nc-senate": "Senate District", "nc-house": "House District",
              "us-house": "Congressional District"}


def contest_base(district: dict) -> str | None:
    """NCSBE contest name (without party suffix / vote-for) for one districts[] entry."""
    chamber, number = district.get("chamber"), district.get("number")
    if chamber == "us-senate":
        return "US SENATE"
    if chamber == "us-house" and number:
        return f"US HOUSE OF REPRESENTATIVES DISTRICT {number:02d}"
    if chamber == "nc-senate" and number:
        return f"NC STATE SENATE DISTRICT {number:02d}"
    if chamber == "nc-house" and number:
        return f"NC HOUSE OF REPRESENTATIVES DISTRICT {number:03d}"
    if chamber == "judicial" and district.get("seat"):
        seat = district["seat"]
        court = district.get("court", "coa")
        if court == "coa":
            return f"NC COURT OF APPEALS JUDGE SEAT {seat:02d}"
        if court == "supreme":
            return f"NC SUPREME COURT ASSOCIATE JUSTICE SEAT {seat:02d}"
    return None


def districts_from_title(title: str) -> list[dict]:
    """Fallback for races without a `districts` field: derive them from the title."""
    if "U.S. Senate" in title:
        return [{"chamber": "us-senate", "number": None}]
    m = re.search(r"(\d+)\w* Congressional District", title)
    if m:
        return [{"chamber": "us-house", "number": int(m.group(1))}]
    m = re.search(r"Court of Appeals Judge Seat (\d+)", title)
    if m:
        return [{"chamber": "judicial", "number": None, "court": "coa", "seat": int(m.group(1))}]
    return [
        {"chamber": "nc-senate" if kind == "Senate" else "nc-house", "number": int(num)}
        for kind, num in re.findall(r"(Senate|House) District (\d+)", title)
    ]


def build_ncsbe_contests(race: dict) -> list[tuple[str, str]]:
    """Return [(ncsbe_contest_name, results_key)] for a race.

    results_key is the race title, or for multi-district races a per-district sub-key
    ("Senate District 9" in a general, "Senate District 9 Republican Primary" in a
    primary) that app.js's getResultsHTML matches against the title parts.
    """
    party = race.get("party")
    suffix = f" - {PARTY_CODES[party]}" if party in PARTY_CODES else ""
    districts = race.get("districts") or districts_from_title(race["title"])

    contests = []
    for d in districts:
        base = contest_base(d)
        if base is None:
            continue
        key = race["title"]
        if len(districts) > 1:
            key = f"{SUB_LABELS.get(d['chamber'], d['chamber'])} {d['number']}"
            if suffix:
                key += f" {party} Primary"
        contests.append((f"{base}{suffix} (VOTE FOR 1)", key))
    return contests


def extract_last_name(name: str) -> str:
    """Extract last name from a full name, handling suffixes."""
    name = re.sub(r"^(Rev\.|Dr\.|Mr\.|Mrs\.|Ms\.)\s+", "", name)
    parts = name.split()
    suffixes = {"jr.", "sr.", "ii", "iii", "iv", "v"}
    if len(parts) > 1 and parts[-1].lower().rstrip(".") in suffixes:
        return parts[-2].upper()
    return parts[-1].upper()


def match_candidate(ncsbe_name: str, race_candidates: list[dict]) -> dict | None:
    """Match an NCSBE ballot name to a candidate by last name, then first name if ambiguous."""
    suffixes = {"JR.", "SR.", "II", "III", "IV", "V"}
    parts = ncsbe_name.strip().split()
    ncsbe_last = parts[-1].upper()
    if len(parts) > 1 and ncsbe_last in suffixes:
        ncsbe_last = parts[-2].upper()
    ncsbe_first = parts[0].upper()

    last_matches = [c for c in race_candidates if extract_last_name(c["name"]) == ncsbe_last]
    if len(last_matches) == 1:
        return last_matches[0]
    if len(last_matches) > 1:
        for c in last_matches:
            if c["name"].split()[0].upper() == ncsbe_first:
                return c
    return None


def fallback_name(ncsbe_name: str) -> str:
    """Keep NCSBE's mixed-case ballot name; title-case it only if it's ALL CAPS (as app.js does)."""
    if ncsbe_name != ncsbe_name.upper():
        return ncsbe_name.strip()
    return " ".join(w[:1].upper() + w[1:].lower() for w in ncsbe_name.split())


def fetch_results(url: str):
    """Fetch and parse NCSBE results (a JSON array despite the .txt extension)."""
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    resp = urllib.request.urlopen(req, timeout=30)
    return json.loads(resp.read())


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--url", default=os.environ.get("NCSBE_RESULTS_URL", RESULTS_URL),
                        help="NCSBE results_0.txt URL (default: %(default)s)")
    parser.add_argument("--races", default=RACES_FILE)
    parser.add_argument("--output", default=OUTPUT_FILE)
    args = parser.parse_args()

    with open(args.races, encoding="utf-8") as f:
        races_data = json.load(f)

    print(f"Fetching NCSBE results from {args.url} ...")
    ncsbe_results = fetch_results(args.url)
    print(f"Got {len(ncsbe_results)} result rows")

    by_contest: dict[str, list[dict]] = {}
    for row in ncsbe_results:
        by_contest.setdefault(row["cnm"], []).append(row)

    global_prt = ncsbe_results[0]["prt"] if ncsbe_results else "0"
    global_ptl = ncsbe_results[0]["ptl"] if ncsbe_results else "0"

    output = {
        "lastUpdated": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
        "precinctsReporting": f"{global_prt} of {global_ptl}",
        "races": {},
    }

    matched = 0
    for race in races_data["races"]:
        contests = build_ncsbe_contests(race)
        if not contests:
            print(f"  SKIP: Could not map '{race['title']}'")
            continue

        for contest_name, race_key in contests:
            if contest_name not in by_contest:
                print(f"  MISS: '{contest_name}' not found in NCSBE data")
                continue

            rows = sorted(by_contest[contest_name], key=lambda r: int(r["vct"]), reverse=True)
            candidates = []
            for row in rows:
                matched_cand = match_candidate(row["bnm"], race["candidates"])
                cand = {
                    "name": matched_cand["name"] if matched_cand else fallback_name(row["bnm"]),
                    "votes": int(row["vct"]),
                    "percentage": float(row["pct"]),
                }
                pty = (row.get("pty") or "").strip()
                if pty:
                    cand["party"] = PARTY_NAMES.get(pty, pty)
                candidates.append(cand)

            output["races"][race_key] = {
                "precinctsReporting": f"{rows[0]['prt']} of {rows[0]['ptl']}",
                "candidates": candidates,
            }
            matched += 1
            print(f"  OK: {race_key} <- {contest_name} ({len(candidates)} candidates)")

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"\nWrote {args.output} with {matched} contests (from {len(races_data['races'])} races)")


if __name__ == "__main__":
    main()
