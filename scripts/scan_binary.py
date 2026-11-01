"""Refuse a binary that carries personal or secret data.

Usage: python3 scripts/scan_binary.py <file>

Prints only categories and counts, never the matched text: CI logs are public.
Exit code 0 when clean, 1 when anything is found, 2 on a usage error.
Used by CI before the binary is uploaded and by scripts/verify_release.py before publishing.
"""

import re
import sys

CHECKS = {
    "windows user path": r"[A-Za-z]:\\Users\\",
    "macOS user path": r"/Users/",
    "linux home other than the CI runner": r"/home/(?!runner/)",
    "email address": r"[\w.+-]+@[\w-]+\.[\w.]+",
    "github token": r"ghp_|gho_|github_pat_",
    "private key block": r"-----BEGIN",
    "seed or mnemonic": r"(?i)\bseed\b|mnemonic|cipherseed",
    "password": r"(?i)passw(or)?d|keyring",
    "ootle address": r"\botl_",
}


def scan(data):
    text = [m.group().decode() for m in re.finditer(rb"[\x20-\x7e]{6,}", data)]
    found = {name: sum(bool(re.search(p, s)) for s in text) for name, p in CHECKS.items()}
    return found, len(text)


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    found, scanned = scan(open(sys.argv[1], "rb").read())
    for name, count in found.items():
        print(f"{name}: {count}")
    print(f"strings scanned: {scanned}")
    return 1 if any(found.values()) else 0


if __name__ == "__main__":
    sys.exit(main())
