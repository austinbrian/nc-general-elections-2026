#!/usr/bin/env python3
"""Validate races.json: unique ids, district chambers, and district number ranges.

Usage: python3 scripts/validate_races.py [path/to/races.json]
Exits non-zero if any problem is found.
"""

import json
import re
import sys
from pathlib import Path

RANGES = {"us-house": (1, 14), "nc-senate": (1, 50), "nc-house": (1, 120)}
STATEWIDE = {"us-senate", "judicial"}
CHAMBERS = set(RANGES) | STATEWIDE
ID_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")


def validate(data: dict) -> list[str]:
    errors = []
    races = data.get("races")
    if not isinstance(races, list) or not races:
        return ["top-level 'races' must be a non-empty list"]

    seen: dict[str, int] = {}
    for i, race in enumerate(races):
        label = f"race[{i}] {race.get('title', '?')!r}"
        rid = race.get("id")
        if not isinstance(rid, str) or not ID_RE.match(rid):
            errors.append(f"{label}: missing or malformed id {rid!r}")
        elif rid in seen:
            errors.append(f"{label}: duplicate id {rid!r} (also race[{seen[rid]}])")
        else:
            seen[rid] = i

        districts = race.get("districts")
        if not isinstance(districts, list) or not districts:
            errors.append(f"{label}: needs at least one district")
            continue
        for d in districts:
            chamber, number = d.get("chamber"), d.get("number")
            if chamber not in CHAMBERS:
                errors.append(f"{label}: invalid chamber {chamber!r}")
            elif chamber in STATEWIDE:
                if number is not None:
                    errors.append(f"{label}: {chamber} is statewide, number must be null")
                if chamber == "judicial" and "seat" in d and not isinstance(d["seat"], int):
                    errors.append(f"{label}: judicial seat must be an int")
            else:
                lo, hi = RANGES[chamber]
                if not isinstance(number, int) or isinstance(number, bool) or not lo <= number <= hi:
                    errors.append(f"{label}: {chamber} number {number!r} not in {lo}-{hi}")
    return errors


def main() -> int:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "races.json"
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    errors = validate(data)
    for e in errors:
        print(f"ERROR: {e}")
    n = len(data.get("races", []))
    print(f"{path.name}: {n} races, {len(errors)} error(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
