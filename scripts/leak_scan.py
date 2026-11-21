#!/usr/bin/env python3
"""Refuse personal data anywhere outside an athlete's private folder.

    .venv/bin/python scripts/leak_scan.py                 # every tracked engine file
    .venv/bin/python scripts/leak_scan.py --staged        # what is about to be committed (pre-commit)
    .venv/bin/python scripts/leak_scan.py --tree DIR      # a whole directory (the release export)

WHY. OpenSportCoach is public; the people it coaches are not. Their names, Garmin identities,
workout and activity ids, race calendar and health history live in athletes/<name>/ and data/<name>/,
which the public repository ignores. This scan is the second line behind that .gitignore: a comment
that names an athlete, a test that hardcodes one of their activity ids, a fixture copied from a real
cache — each is a leak that no ignore rule can see.

WHAT IT LOOKS FOR. The list is built AT RUN TIME from the athletes on this machine, so it never has to
be written down anywhere public:
  * each athlete's folder name, display name, Garmin display and full name (and each part of it);
  * their race names, protected workout ids and every workout id the engine pushed for them;
  * terms in the optional private list data/release-denylist.txt (one per line: a surname, a city, a
    clinic, an email — anything personal that is not in a file above). data/ is never committed.
And, for everyone, by pattern: email addresses, Garmin-style activity ids (10-11 digits; the synthetic
Demo athlete's 2100000xxxx ids are allowed), recorded activity files
(.fit, .gpx, .tcx) and any path inside athletes/ or data/ other than the public placeholders.

Exit 1 on any hit, naming file, line and what kind of thing it found. It stops accidents, not intent.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import athlete  # noqa: E402

ROOT = athlete.REPO_ROOT
DENYLIST = athlete.DATA_ROOT / "release-denylist.txt"
# Folders that are public by design: the synthetic Demo athlete and the template.
PUBLIC_ATHLETES = {"demo", "example"}
PUBLIC_PATHS = ("athletes/README.md", "data/README.md")
ALLOWED_EMAILS = re.compile(r"(noreply@anthropic\.com|@example\.(com|org)|users\.noreply\.github\.com)$", re.I)
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")
ACTIVITY_ID = re.compile(r"(?<![\d.])(\d{10,11})(?![\d.])")
SYNTHETIC_ID = re.compile(r"^2100000\d{4}$")
NOT_IDS = {"2147483647", "4294967295"}  # int32 / uint32 max, not anyone's activity
RECORDED = (".fit", ".fit.gz", ".gpx", ".gpx.gz", ".tcx", ".tcx.gz")
# Text this scan reads itself; binaries are named by path only.
TEXT_SUFFIXES = {".py", ".md", ".json", ".ts", ".tsx", ".js", ".mjs", ".css", ".html", ".sh", ".txt",
                 ".yml", ".yaml", ".toml", ".cfg", ".svg", ""}


def _strings(node):
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for v in node.values():
            yield from _strings(v)
    elif isinstance(node, list):
        for v in node:
            yield from _strings(v)


def _ints(node):
    if isinstance(node, bool):
        return
    if isinstance(node, int):
        yield node
    elif isinstance(node, str) and node.isdigit():
        yield int(node)
    elif isinstance(node, dict):
        for v in node.values():
            yield from _ints(v)
    elif isinstance(node, list):
        for v in node:
            yield from _ints(v)


def _load(path: Path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def private_terms() -> dict[str, str]:
    """term (lowercase) -> what it is. Built from every non-public athlete on this machine."""
    terms: dict[str, str] = {}
    if not athlete.ATHLETES_DIR.is_dir():
        return terms

    def add(value, kind, min_len=3):
        if isinstance(value, str) and len(value.strip()) >= min_len:
            terms.setdefault(value.strip().lower(), kind)

    for folder in sorted(p for p in athlete.ATHLETES_DIR.iterdir() if p.is_dir()):
        if folder.name in PUBLIC_ATHLETES:
            continue
        add(folder.name, "an athlete's name")
        cfg = _load(folder / "athlete.json") or {}
        add(cfg.get("display"), "an athlete's name")
        g = cfg.get("garmin") or {}
        add(g.get("display_name"), "a Garmin identity")
        add(g.get("full_name"), "a Garmin identity")
        for part in str(g.get("full_name") or "").split():
            add(part, "a Garmin identity", min_len=4)
        for wid in _ints(cfg.get("protected_workout_ids") or []):
            add(str(wid), "a workout id", min_len=6)
        for wid in _ints(_load(folder / "workouts" / "WORKOUT_IDS.json") or {}):
            if wid > 99999:
                add(str(wid), "a workout id", min_len=6)
        for race in (_load(folder / "races.json") or {}).get("races") or []:
            for key in ("name", "official_name"):
                add(race.get(key), "a race on their calendar", min_len=5)
    if DENYLIST.is_file():
        for line in DENYLIST.read_text().splitlines():
            line = line.split("#", 1)[0].strip()
            add(line, "a term from data/release-denylist.txt", min_len=2)
    return terms


def _term_pattern(terms: dict[str, str]):
    if not terms:
        return None
    alts = sorted((re.escape(t) for t in terms), key=len, reverse=True)
    return re.compile(r"(?<![A-Za-z0-9])(" + "|".join(alts) + r")(?![A-Za-z0-9])", re.I)


def scan_text(rel: str, text: str, pattern, terms) -> list[str]:
    hits = []
    fixture = rel.startswith("app/fixtures/")
    for n, line in enumerate(text.splitlines(), 1):
        if pattern:
            for m in pattern.finditer(line):
                hits.append(f"{rel}:{n}: {terms[m.group(1).lower()]} ({m.group(1)!r})")
        for m in EMAIL.finditer(line):
            if not ALLOWED_EMAILS.search(m.group(0)):
                hits.append(f"{rel}:{n}: an email address ({m.group(0)!r})")
        for m in ACTIVITY_ID.finditer(line):
            if (SYNTHETIC_ID.match(m.group(1)) or m.group(1) in NOT_IDS
                    or (fixture and m.group(1).startswith("2100000"))):
                continue
            hits.append(f"{rel}:{n}: a Garmin-style id ({m.group(1)}): use the Demo athlete's 2100000xxxx ids")
    return hits


# Private by design in the public repository (its .gitignore): what a path there may never contain.
PRIVATE_DIRS = ("athletes/", "data/", "app/web/public/marks/")


def private_dirs_ignored() -> bool:
    """True in a repository that ignores the athletes' folders — the public one. A private repository
    that tracks athletes/ on purpose (an athlete's own data repo, or a pre-split checkout) is not refused
    for committing them."""
    r = subprocess.run(["git", "check-ignore", "-q", "--no-index", "athletes/someone/athlete.json"],
                       cwd=ROOT, capture_output=True)
    return r.returncode == 0


def scan_path_name(rel: str) -> list[str]:
    parts = rel.split("/")
    if rel in PUBLIC_PATHS:
        return []
    if rel.startswith("app/web/public/marks/"):
        return [f"{rel}: an event's logo is its owner's trademark; keep it local (gitignored)"]
    if parts[0] in ("athletes", "data") and len(parts) > 1:
        if parts[0] == "athletes" and parts[1] in PUBLIC_ATHLETES:
            return []
        return [f"{rel}: inside {parts[0]}/, which is private by design"]
    if rel.lower().endswith(RECORDED) and not rel.startswith("tests/fixtures/"):
        return [f"{rel}: a recorded activity file; only synthetic ones under tests/fixtures/ are public"]
    return []


def _tracked() -> list[str]:
    out = subprocess.run(["git", "ls-files", "-z"], cwd=ROOT, capture_output=True, check=True).stdout
    return [p for p in out.decode().split("\0") if p and not p.startswith(PRIVATE_DIRS)]


def _staged() -> list[str]:
    out = subprocess.run(["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
                         cwd=ROOT, capture_output=True, check=True).stdout
    return [p for p in out.decode().split("\0") if p]


def _read(rel: str, staged: bool, base: Path) -> str | None:
    if Path(rel).suffix.lower() not in TEXT_SUFFIXES:
        return None
    try:
        if staged:
            return subprocess.run(["git", "show", f":{rel}"], cwd=ROOT, capture_output=True,
                                  check=True).stdout.decode("utf-8", "replace")
        return (base / rel).read_text(errors="replace")
    except (OSError, subprocess.CalledProcessError):
        return None


def scan(files: list[str], staged: bool = False, base: Path = ROOT,
         skip_private_folders: bool = True) -> list[str]:
    terms = private_terms()
    pattern = _term_pattern(terms)
    hits: list[str] = []
    check_paths = not skip_private_folders or private_dirs_ignored()
    for rel in files:
        if Path(rel).name == "leak_scan.py":
            continue
        private = rel.startswith(PRIVATE_DIRS)
        if check_paths:
            hits += scan_path_name(rel)
        if private and skip_private_folders:
            continue
        text = _read(rel, staged, base)
        if text is not None:
            hits += scan_text(rel, text, pattern, terms)
    return hits


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--staged", action="store_true", help="scan the index (the pre-commit hook)")
    ap.add_argument("--tree", type=Path, help="scan every file under this directory (a release export)")
    args = ap.parse_args()
    if args.tree:
        base = args.tree.resolve()
        files = [str(p.relative_to(base)) for p in base.rglob("*")
                 if p.is_file() and ".git" not in p.relative_to(base).parts]
        hits = scan(files, base=base, skip_private_folders=False)
    elif args.staged:
        hits = scan(_staged(), staged=True)
    else:
        hits = scan(_tracked())
    if hits:
        print(f"PERSONAL DATA OUTSIDE AN ATHLETE'S FOLDER — {len(hits)} hit(s):", file=sys.stderr)
        for h in hits:
            print(f"  {h}", file=sys.stderr)
        print("Move it into athletes/<name>/, replace it with the Demo athlete's synthetic data, or say "
              "'the athlete'.", file=sys.stderr)
        return 1
    print(f"leak scan: clean ({len(private_terms())} private terms checked)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
