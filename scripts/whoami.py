#!/usr/bin/env python3
"""Who is this session coaching? Prints the banner, or how to bind one.

    .venv/bin/python scripts/whoami.py          # banner + the athlete's paths
    .venv/bin/python scripts/whoami.py --name   # just the name, for shell scripts (exits if none)
    .venv/bin/python scripts/whoami.py --data-dir   # the athlete's cache directory, for shell scripts

Subagents start cold — they did not see the session banner — so they run this first.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import athlete  # noqa: E402


def banner(a: athlete.Athlete, full: bool = False) -> str:
    try:
        import sources
        srcs = sources.of(a)
    except SystemExit as exc:  # a banner must never fail: say what is wrong instead
        srcs = ["garmin"]
        bad = f"  {exc}"
    else:
        bad = None
    folder = a.root.relative_to(athlete.REPO_ROOT) if a.root.is_relative_to(athlete.REPO_ROOT) else a.root
    if "garmin" in srcs:
        garmin = a.garmin.get("full_name") or "not bound yet — run scripts/login.py"
        also = [s for s in srcs if s != "garmin"]
        head = f"OSC · Athlete: {a.display} · Garmin: {garmin}" + (f" · also {', '.join(also)}" if also else "")
        where = f"  folder {folder}/ · cache data/{a.name}/ · tokens ~/{a.token_dir.name}/"
    else:
        head = (f"OSC · Athlete: {a.display} · Sources: {', '.join(srcs)} "
                "(no Garmin: no sleep or recovery data, and nothing is pushed to a watch)")
        where = f"  folder {folder}/ · cache data/{a.name}/"
    lines = [head, where,
             f"  Everything athlete-specific comes from athletes/{a.name}/ — never read, edit or "
             f"cite another athlete's folder."]
    if bad:
        lines.append(bad)
    if full:
        # An unfinished setup is asked for in the first session bound to them (docs/DESIGN.md (fuelling and score) §3).
        # A banner must never fail, so a broken setup check is reported, not raised.
        try:
            from setup_status import line
            todo = line(a)
        except Exception as exc:  # noqa: BLE001
            todo = f"Setup check failed ({type(exc).__name__}: {exc}) — run scripts/setup_status.py."
        if todo:
            lines.append(f"  {todo}")
        guide = a.root / "ATHLETE.md"
        if guide.is_file():
            lines += ["", guide.read_text().rstrip()]
    return "\n".join(lines)


def main() -> None:
    if "--data-dir" in sys.argv:
        sys.argv.remove("--data-dir")
        print(athlete.current().data_dir)
        return
    if "--name" in sys.argv:
        sys.argv.remove("--name")
        print(athlete.current().name)
        return
    sid = athlete.session_id()
    if sid and not athlete.bound_name(sid):
        print("No athlete is bound to this session. Ask who you are coaching, then run:\n"
              "    .venv/bin/python scripts/use.py <name>\n"
              f"athletes: {', '.join(athlete.known())}")
        return
    print(banner(athlete.current()))


if __name__ == "__main__":
    main()
