#!/usr/bin/env python3
"""Who is this session coaching? The ONLY resolver of an athlete, its paths, its Garmin token
store and its expected Garmin identity.

WHY THIS EXISTS (2026-09-24). Several athletes can share one repo, one Mac and one
macOS user, so the operating system separates nothing: same home directory, same shell
environment, same Claude config. Separation is therefore enforced here, in code, and it rests on
one rule: **every athlete-specific path is derived from the athlete's name, in this module.**

    athletes/<name>/          program, routine, memory, logs, generated workouts, athlete.json
    data/<name>/              the gitignored Garmin cache
    ~/.garminconnect-<name>/  the Garmin token store — nothing exists at the default path

A script that builds a `data/` or token path itself would defeat that, which is what
tests/run_tests.py::test_no_script_bypasses_the_athlete_resolver catches.

HOW THE ATHLETE IS CHOSEN, in order:
  1. The Claude session's binding, `data/sessions/<OSC_SESSION>`, written ONCE by use.py.
     OSC_SESSION is exported per session by the SessionStart hook.
  2. `--athlete <name>` on the command line, or OSC_ATHLETE (which child processes inherit).
Inside a Claude session the binding is the only authority: an unbound session may not act as
anyone, and a bound one may never act as someone else, even when told to explicitly. Outside a
session (a terminal), the explicit choice is required. Every failure exits BEFORE anything is read
or written — failing closed is the point.

Test-only overrides: OSC_ATHLETES_ROOT and OSC_DATA_ROOT relocate the two roots, so the
suite can scaffold a throwaway athlete without touching the real ones.
"""
from __future__ import annotations

import importlib.util
import json
import os
import re
import sys
from functools import cached_property
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
ATHLETES_DIR = Path(os.environ.get("OSC_ATHLETES_ROOT") or REPO_ROOT / "athletes")
DATA_ROOT = Path(os.environ.get("OSC_DATA_ROOT") or REPO_ROOT / "data")
SESSIONS_DIR = DATA_ROOT / "sessions"
SHARED_WORKOUTS = REPO_ROOT / "workouts"
CATALOG_PATH = SHARED_WORKOUTS / "EXERCISE_CATALOG.json"
# What a fuelling product contains is shared; which products an athlete owns is theirs (fuel_path).
PRODUCTS_PATH = REPO_ROOT / "nutrition" / "PRODUCTS.json"

NAME_RE = re.compile(r"^[a-z][a-z0-9_-]{0,31}$")
SESSION_RE = re.compile(r"^[A-Za-z0-9_-]{8,128}$")


class Athlete:
    """One athlete's folder, cache, token store and configuration. Build with load()."""

    def __init__(self, name: str, root: Path):
        self.name = name
        self.root = root

    def __repr__(self) -> str:
        return f"Athlete({self.name!r})"

    # --- paths ---------------------------------------------------------------------------
    @property
    def data_dir(self) -> Path:
        return DATA_ROOT / self.name

    @property
    def workouts_dir(self) -> Path:
        return self.root / "workouts"

    @property
    def logs_dir(self) -> Path:
        return self.root / "logs"

    @property
    def memory_dir(self) -> Path:
        return self.root / "memory"

    @property
    def routine_doc(self) -> Path:
        return self.root / "CURRENT_ROUTINE.md"

    @property
    def plan_path(self) -> Path:
        """Sessions the coach planned that never go to the watch (Zwift, the long ride, tennis):
        dated, so the Plan and Today screens show them beside the Garmin calendar."""
        return self.root / "plan.json"

    @property
    def races_path(self) -> Path:
        """The race season: each event's date, format, target and priority, every online check of
        its date, and the result (docs/DESIGN.md (races)). Absent = no races."""
        return self.root / "races.json"

    @property
    def trips_path(self) -> Path:
        """Their trips: the days they are away from their usual setup, where, and what each place has
        — gym, pool, bike, trainer, running, courts (docs/DESIGN.md (trips)). Absent = no trips."""
        return self.root / "trips.json"

    @property
    def fuel_path(self) -> Path:
        """Their fuelling setup: the products they own, how they mix a bottle, the rate their gut is
        trained to, caffeine, and which setup questions are answered (docs/DESIGN.md (fuelling and score) §2–3).
        Absent = nothing answered yet."""
        return self.root / "fuel.json"

    @property
    def fuel_log_path(self) -> Path:
        """What they took during each session, one record per activity — self-reported."""
        return self.logs_dir / "fuel.json"

    @property
    def dashboard_path(self) -> Path:
        return self.root / "dashboard.json"

    @property
    def app_dir(self) -> Path:
        """The app's state for this athlete: attached sessions, recorded confirms, request history.
        Gitignored with the rest of the cache (docs/DESIGN.md (the app))."""
        return self.data_dir / "app"

    @property
    def artifact_page(self) -> Path:
        """The lite Today page published to claude.ai (scripts/app_artifact.py). Kept with the app's
        state, gitignored: it carries health data."""
        return self.app_dir / "artifact.html"

    @property
    def artifact_record(self) -> Path:
        """Where that page was published — its claude.ai URL — so every daily updates the same one."""
        return self.app_dir / "artifact.json"

    @property
    def token_dir(self) -> Path:
        # Derived from the name, never configured: there is nothing to point at the wrong place.
        return Path.home() / f".garminconnect-{self.name}"

    # --- configuration ---------------------------------------------------------------------
    @cached_property
    def config(self) -> dict:
        return json.loads((self.root / "athlete.json").read_text())

    @property
    def display(self) -> str:
        return self.config.get("display") or self.name.title()

    @property
    def garmin(self) -> dict:
        """The Garmin account this athlete is bound to: display_name + full_name, or {}."""
        return self.config.get("garmin") or {}

    @property
    def protected_ids(self) -> frozenset:
        """Workouts that were in the account before OpenSportCoach managed it. Never touched."""
        return frozenset(int(x) for x in self.config.get("protected_workout_ids") or [])

    @property
    def managed(self) -> list:
        """Workout keys sync_workouts.py reconciles. Anything else in the account is left alone."""
        return list(self.config.get("managed_workouts") or [])

    @property
    def previous_names(self) -> dict:
        """Managed key -> the names its workout used to carry on Garmin. sync_workouts.py treats an
        account workout under a previous name as the copy a renamed upload supersedes, and
        strength_sessions.py still attributes sessions logged under the old name to the same day."""
        return {k: list(v) for k, v in (self.config.get("previous_names") or {}).items()}

    @property
    def sessions(self) -> list:
        """Session modules — swims, runs, circuits, mobility — relative to the athlete folder, each
        exposing WORKOUTS (scripts/workout_dsl.py). scripts/build_sessions.py builds them."""
        return [self.root / s for s in self.config.get("sessions") or []]

    @property
    def workout_needs(self) -> dict:
        """Managed workout key -> what it needs where it is done (scripts/trips.py ACCESS), where its
        sport alone would say something else: the watch copy of a Zwift ride is a `cycling` workout
        that needs the trainer, not the bike; a bodyweight circuit needs nothing. Absent = its sport's."""
        return {k: list(v) for k, v in (self.config.get("workout_needs") or {}).items()}

    @property
    def generators(self) -> list:
        """Extra generator scripts, relative to the athlete folder (the engine's build_workouts.py
        always runs for program.py)."""
        return [self.root / g for g in self.config.get("generators") or []]

    @property
    def profile(self) -> dict:
        """Analysis settings: key lifts, weekly set targets, weight target, fallbacks."""
        return self.config.get("profile") or {}

    @cached_property
    def logging_rules(self) -> dict:
        path = self.workouts_dir / "LOGGING_RULES.json"
        rules = json.loads(path.read_text()) if path.exists() else {}
        for bucket in ("two_db_weight_summed", "unilateral_reps_summed", "machine_added_load_only", "same_lift"):
            rules.setdefault(bucket, [])
        return rules

    @cached_property
    def program(self):
        """athletes/<name>/program.py as a module. Location is ownership: a program can only be
        loaded as the athlete whose folder it sits in."""
        path = self.root / "program.py"
        spec = importlib.util.spec_from_file_location(f"osc_program_{self.name}", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod


def committed_before(path: Path, start: str) -> tuple[str | None, str | None]:
    """(text, short sha) of `path` as last committed before `start` ("YYYY-MM-DD HH:MM:SS"), from whichever
    git repository holds it — the engine's, or the athlete's own private one when athletes/ is a
    separate repository — following moves. (None, None) when git has no such version. A session is
    judged against what it followed then, not against today's program."""
    import subprocess
    try:
        top = subprocess.run(["git", "-C", str(path.parent), "rev-parse", "--show-toplevel"],
                             capture_output=True, text=True, check=True).stdout.strip()
        rel = path.resolve().relative_to(Path(top).resolve()).as_posix()
        # The whole followed history, newest first, then the first commit before `start`: with --before,
        # git never walks the later commit where the file was renamed, and so cannot follow it back.
        import datetime as _dt
        log = subprocess.run(["git", "-C", top, "log", "--follow", "--format=@%H %ct", "--name-only", "--", rel],
                             capture_output=True, text=True, check=True).stdout
        limit = _dt.datetime.fromisoformat(start.replace("T", " ")[:19]).timestamp()
        sha = was = None
        for entry in log.split("@")[1:]:
            lines = [x for x in entry.splitlines() if x.strip()]
            h, ct = lines[0].split()
            if int(ct) < limit:
                sha, was = h, (lines[1] if len(lines) > 1 else rel)
                break
        if sha is None:
            return None, None
        src = subprocess.run(["git", "-C", top, "show", f"{sha}:{was}"], capture_output=True, text=True,
                             check=True).stdout
        return src, sha[:7]
    except (subprocess.CalledProcessError, ValueError, OSError):
        return None, None


def known() -> list[str]:
    """Every athlete with a folder and an athlete.json."""
    if not ATHLETES_DIR.is_dir():
        return []
    return sorted(p.name for p in ATHLETES_DIR.iterdir() if (p / "athlete.json").is_file())


def load(name: str) -> Athlete:
    if not NAME_RE.match(name or ""):
        sys.exit(f"'{name}' is not a valid athlete name.")
    root = ATHLETES_DIR / name
    if not (root / "athlete.json").is_file():
        sys.exit(f"No athlete '{name}' (athletes: {', '.join(known()) or 'none'}). "
                 "Someone new? Set them up with the /osc-setup skill.")
    return Athlete(name, root)


def session_id() -> str | None:
    sid = os.environ.get("OSC_SESSION") or None
    if sid and not SESSION_RE.match(sid):
        sys.exit(f"OSC_SESSION={sid!r} is malformed; refusing to guess an athlete.")
    return sid


def bound_name(sid: str | None = None) -> str | None:
    """The athlete this Claude session is bound to, or None."""
    sid = sid or session_id()
    if not sid:
        return None
    path = SESSIONS_DIR / sid
    if not path.is_file():
        return None
    return json.loads(path.read_text()).get("athlete")


def bind(sid: str, name: str) -> Athlete:
    """Lock a session to one athlete, once. Rebinding to someone else is refused."""
    if not SESSION_RE.match(sid or ""):
        sys.exit("No Claude session id — use.py only works inside a Claude session.")
    athlete = load(name)
    current_binding = bound_name(sid)
    if current_binding and current_binding != name:
        sys.exit(f"This session is already bound to {current_binding}. A session is never "
                 f"rebound — start a new session to coach {name}.")
    if not current_binding:
        import datetime as dt
        SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
        (SESSIONS_DIR / sid).write_text(json.dumps(
            {"athlete": name, "bound_at": dt.datetime.now().isoformat(timespec="seconds")}) + "\n")
    return athlete


def explicit_choice() -> str | None:
    """--athlete NAME / --athlete=NAME, removed from sys.argv so scripts' own argparse never sees
    it, else OSC_ATHLETE."""
    argv, choice, out, i = sys.argv, None, [], 0
    while i < len(argv):
        arg = argv[i]
        if arg == "--athlete" and i + 1 < len(argv):
            choice, i = argv[i + 1], i + 2
            continue
        if arg.startswith("--athlete="):
            choice, i = arg.split("=", 1)[1], i + 1
            continue
        out.append(arg)
        i += 1
    sys.argv[:] = out
    return choice or os.environ.get("OSC_ATHLETE") or None


_CURRENT: Athlete | None = None


def current() -> Athlete:
    """The athlete this process acts for. Exits — before anything is touched — if that is not
    unambiguous."""
    global _CURRENT
    if _CURRENT is not None:
        return _CURRENT
    explicit = explicit_choice()
    sid = session_id()
    if sid:
        bound = bound_name(sid)
        if not bound:
            sys.exit("No athlete is bound to this Claude session. Ask who you are coaching, "
                     "then run:  .venv/bin/python scripts/use.py <name>   "
                     f"(athletes: {', '.join(known())})")
        if explicit and explicit != bound:
            sys.exit(f"This session is bound to {bound}; refusing to act as {explicit}.")
        name = bound
    elif explicit:
        name = explicit
    else:
        sys.exit("No athlete selected. In a terminal pass  --athlete <name>  "
                 f"(athletes: {', '.join(known()) or 'none'}).")
    _CURRENT = load(name)
    # Children (sync -> generators, refresh.sh -> pulls) inherit the choice.
    os.environ["OSC_ATHLETE"] = name
    return _CURRENT
