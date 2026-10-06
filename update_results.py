#!/usr/bin/env python3
"""Fetch NCSBE election results and write results.json for the matchup guide."""

import json
import re
import urllib.request
from datetime import datetime

RESULTS_URL = "https://er.ncsbe.gov/enr/20260303/data/results_0.txt"
RACES_FILE = "races.json"
OUTPUT_FILE = "results.json"


def build_ncsbe_contest_name(title: str, party: str) -> str | list[str]:
    """Convert a races.json title to the NCSBE contest name format."""
    party_code = "REP" if party == "Republican" else "DEM"

    # US Senate
    if "U.S. Senate" in title:
        return f"US SENATE - {party_code} (VOTE FOR 1)"

    # Congressional district
    m = re.search(r"(\d+)\w* Congressional District", title)
    if m:
        dist = m.group(1).zfill(2)
        return f"US HOUSE OF REPRESENTATIVES DISTRICT {dist} - {party_code} (VOTE FOR 1)"

    # Combined race: "Senate District 9 / House District 4"
    if "/" in title:
        parts = title.split("/")
        names = []
        for part in parts:
            part = part.strip()
            sm = re.search(r"Senate District (\d+)", part)
            if sm:
                dist = sm.group(1).zfill(2)
                names.append(f"NC STATE SENATE DISTRICT {dist} - {party_code} (VOTE FOR 1)")
            hm = re.search(r"House District (\d+)", part)
            if hm:
                dist = hm.group(1).zfill(3)
                names.append(f"NC HOUSE OF REPRESENTATIVES DISTRICT {dist} - {party_code} (VOTE FOR 1)")
        return names

    # State Senate
    m = re.search(r"Senate District (\d+)", title)
    if m:
        dist = m.group(1).zfill(2)
        return f"NC STATE SENATE DISTRICT {dist} - {party_code} (VOTE FOR 1)"

    # State House
    m = re.search(r"House District (\d+)", title)
    if m:
        dist = m.group(1).zfill(3)
        return f"NC HOUSE OF REPRESENTATIVES DISTRICT {dist} - {party_code} (VOTE FOR 1)"

    # Court of Appeals
    m = re.search(r"Court of Appeals Judge Seat (\d+)", title)
    if m:
        dist = m.group(1).zfill(2)
        return f"NC COURT OF APPEALS JUDGE SEAT {dist} - {party_code} (VOTE FOR 1)"

    return None


def extract_last_name(name: str) -> str:
    """Extract last name from a full name, handling suffixes."""
    # Remove common prefixes
    name = re.sub(r"^(Rev\.|Dr\.|Mr\.|Mrs\.|Ms\.)\s+", "", name)
    parts = name.split()
    # Handle suffixes like Jr., Sr., III, IV
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
    # Multiple candidates share a last name — match on first name too
    if len(last_matches) > 1:
        for c in last_matches:
            if c["name"].split()[0].upper() == ncsbe_first:
                return c
    return None


def fetch_results():
    """Fetch and parse NCSBE results."""
    req = urllib.request.Request(RESULTS_URL, headers={"User-Agent": "Mozilla/5.0"})
    resp = urllib.request.urlopen(req, timeout=30)
    return json.loads(resp.read())


def main():
    # Load races
    with open(RACES_FILE) as f:
        races_data = json.load(f)

    # Fetch NCSBE results
    print("Fetching NCSBE results...")
    ncsbe_results = fetch_results()
    print(f"Got {len(ncsbe_results)} result rows")

    # Index NCSBE results by contest name
    by_contest: dict[str, list[dict]] = {}
    for row in ncsbe_results:
        cnm = row["cnm"]
        by_contest.setdefault(cnm, []).append(row)

    # Get global precincts reporting from first result
    global_prt = ncsbe_results[0]["prt"] if ncsbe_results else "0"
    global_ptl = ncsbe_results[0]["ptl"] if ncsbe_results else "0"

    # Build output
    output = {
        "lastUpdated": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
        "precinctsReporting": f"{global_prt} of {global_ptl}",
        "races": {},
    }

    matched = 0
    for race in races_data["races"]:
        contest_names = build_ncsbe_contest_name(race["title"], race["party"])
        if contest_names is None:
            print(f"  SKIP: Could not map '{race['title']}'")
            continue

        if isinstance(contest_names, str):
            contest_names = [contest_names]

        for contest_name in contest_names:
            if contest_name not in by_contest:
                print(f"  MISS: '{contest_name}' not found in NCSBE data")
                continue

            rows = by_contest[contest_name]
            # Sort by vote count descending
            rows.sort(key=lambda r: int(r["vct"]), reverse=True)

            candidates = []
            for row in rows:
                matched_cand = match_candidate(row["bnm"], race["candidates"])
                display_name = matched_cand["name"] if matched_cand else row["bnm"].title()
                candidates.append({
                    "name": display_name,
                    "votes": int(row["vct"]),
                    "percentage": float(row["pct"]),
                })

            race_key = race["title"]
            # For combined races, append sub-race info
            if len(contest_names) > 1:
                # Extract which sub-race this is
                if "STATE SENATE" in contest_name:
                    m = re.search(r"DISTRICT (\d+)", contest_name)
                    race_key = f"Senate District {int(m.group(1))} Republican Primary"
                elif "HOUSE OF REPRESENTATIVES" in contest_name:
                    m = re.search(r"DISTRICT (\d+)", contest_name)
                    race_key = f"House District {int(m.group(1))} Republican Primary"

            output["races"][race_key] = {
                "precinctsReporting": f"{rows[0]['prt']} of {rows[0]['ptl']}",
                "candidates": candidates,
            }
            matched += 1
            print(f"  OK: {race_key} ({len(candidates)} candidates)")

    # Write output
    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f, indent=2)

    print(f"\nWrote {OUTPUT_FILE} with {matched} races (of {len(races_data['races'])} total)")


if __name__ == "__main__":
    main()
