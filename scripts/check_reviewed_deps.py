"""Fail if the crates compiled into the wasm differ from reviewed-deps.txt.

Usage: python3 scripts/check_reviewed_deps.py

Compares, for the wasm target and normal dependencies only (what ends up in the published binary
or runs as a proc-macro to build it), the set of (name, version, checksum) resolved by
Cargo.lock with the hand-reviewed list. Any added, removed or changed crate fails the check
until it has been reviewed and the list updated. Reads metadata only: builds nothing.
"""

import re
import subprocess
import sys

ROOT_PACKAGE = "signal_desk"


def resolved():
    out = subprocess.run(
        ["cargo", "tree", "--locked", "-e", "normal", "--target", "wasm32-unknown-unknown",
         "--prefix", "none"],
        check=True, capture_output=True, text=True,
    ).stdout
    crates = set()
    for line in out.splitlines():
        parts = line.replace(" (*)", "").split()
        if len(parts) >= 2 and parts[0] != ROOT_PACKAGE:
            crates.add((parts[0], parts[1].lstrip("v")))
    lock = open("Cargo.lock", encoding="utf-8").read()
    sums = {}
    for block in lock.split("[[package]]")[1:]:
        name = re.search(r'name = "(.+?)"', block).group(1)
        version = re.search(r'version = "(.+?)"', block).group(1)
        checksum = re.search(r'checksum = "(.+?)"', block)
        sums[(name, version)] = checksum.group(1) if checksum else None
    return {(n, v, sums.get((n, v))) for n, v in crates}


def reviewed():
    entries = set()
    for line in open("reviewed-deps.txt", encoding="utf-8"):
        line = line.split("#", 1)[0].strip()
        if line:
            name, version, checksum = line.split()
            entries.add((name, version, checksum))
    return entries


def main():
    have, want = resolved(), reviewed()
    missing_checksum = [c for c in have if c[2] is None]
    added, removed = sorted(have - want), sorted(want - have)
    for c in missing_checksum:
        print(f"NO CHECKSUM (not from crates.io?): {c[0]} {c[1]}")
    for c in added:
        print(f"NOT REVIEWED: {c[0]} {c[1]} {c[2]}")
    for c in removed:
        print(f"REVIEWED BUT GONE: {c[0]} {c[1]} {c[2]}")
    print(f"crates in the wasm: {len(have)}, reviewed: {len(want)}")
    return 1 if (added or removed or missing_checksum) else 0


if __name__ == "__main__":
    sys.exit(main())
