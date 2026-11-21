#!/usr/bin/env python3
"""One-time interactive Garmin Connect login for ONE athlete — the athlete types it themselves.

    cd ~/opensportcoach
    .venv/bin/python scripts/login.py --athlete rocky

Prompts for THAT PERSON's Garmin email and password (hidden) and an MFA code if Garmin asks.
Claude never types these — the person does, in their own terminal. Tokens are saved to
~/.garminconnect-<athlete> and refresh themselves afterwards: no other script ever needs
credentials, and nothing is written into this repo except the account's identity.

BINDING (2026-09-24, multi-athlete). The first successful login BINDS the athlete to that Garmin
account. It shows the account's full name and asks the person to confirm by typing the athlete's
name, then records the account's display name in athletes/<athlete>/athlete.json. Every later
login, by any script, is asserted against it (garmin_client.assert_identity).
  * Binding is REFUSED if that account is already bound to another athlete — so one athlete's folder
    can never be bound to another's account, even by a typo'd email.
  * Every workout already in the account at binding time is recorded as PROTECTED: OpenSportCoach never
    touches, renames or deletes what was there before it.
Credentials are deliberately NOT read from environment variables: on a Mac shared by two people
under one macOS user, an exported GARMIN_EMAIL would apply to both of them.
"""
from __future__ import annotations

import datetime as dt
import json
import sys
from getpass import getpass
from pathlib import Path

from garminconnect import Garmin

sys.path.insert(0, str(Path(__file__).resolve().parent))
import athlete  # noqa: E402


def resolve() -> athlete.Athlete:
    """A login is typed by a PERSON, possibly in the app's Terminal tab, so the athlete is always
    named explicitly — it never depends on a Claude session having been bound. A session bound to
    someone else still refuses it."""
    choice = athlete.explicit_choice()
    if not choice:
        sys.exit(f"usage: login.py --athlete <name>   (athletes: {', '.join(athlete.known())})")
    bound = athlete.bound_name() if athlete.session_id() else None
    if bound and bound != choice:
        sys.exit(f"This session is bound to {bound}; refusing to log in {choice}.")
    return athlete.load(choice)


A = resolve()


def set_aside(reason: str) -> None:
    """Move tokens that belong to the wrong account out of the athlete's store. Never deleted —
    renamed, so nothing is lost and nothing wrong stays where a script would load it."""
    if A.token_dir.exists():
        dest = A.token_dir.with_name(f"{A.token_dir.name}.rejected-{dt.datetime.now():%Y%m%d-%H%M%S}")
        A.token_dir.rename(dest)
        print(f"  tokens moved aside to {dest} ({reason})")


def bound_elsewhere(display_name: str) -> str | None:
    for name in athlete.known():
        if name != A.name and athlete.load(name).garmin.get("display_name") == display_name:
            return name
    return None


def bind(client: Garmin) -> None:
    got, full = client.display_name, client.full_name
    other = bound_elsewhere(got)
    if other:
        set_aside(f"account already bound to {other}")
        sys.exit(f"REFUSED: that Garmin account ({full}) is already bound to {other}. "
                 f"{A.display} must log in with their OWN account.")
    print(f"\nLogged in as: {full}  (Garmin display name {got})")
    answer = input(f"Bind athlete '{A.name}' to this Garmin account? Type '{A.name}' to confirm: ")
    if answer.strip().lower() != A.name:
        set_aside("binding not confirmed")
        sys.exit("Not bound. Nothing was recorded.")
    existing = sorted({int(w["workoutId"]) for w in client.get_workouts(0, 200) or []})
    path = A.root / "athlete.json"
    cfg = json.loads(path.read_text())
    cfg["garmin"] = {"display_name": got, "full_name": full,
                     "bound_at": dt.date.today().isoformat()}
    cfg["protected_workout_ids"] = sorted(set(cfg.get("protected_workout_ids") or []) | set(existing))
    path.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n")
    print(f"Bound {A.name} -> {full}. {len(existing)} existing workout(s) recorded as protected.")
    print(f"Recorded in {path.relative_to(athlete.REPO_ROOT)} — commit it.")


def main() -> None:
    bound = A.garmin.get("display_name")
    # Resume silently if saved tokens still work — and still belong to the right person.
    if A.token_dir.is_dir():
        try:
            client = Garmin()
            client.login(str(A.token_dir))
        except Exception:
            print("Saved tokens invalid/expired — doing a fresh credential login.")
        else:
            if not bound:
                bind(client)
                return
            if client.display_name != bound:
                set_aside("tokens belong to a different account")
                sys.exit(f"REFUSED: the saved tokens belong to {client.full_name}, not {A.display}.")
            print(f"Already logged in as: {client.full_name} (tokens: {A.token_dir})")
            return

    print(f"Garmin login for {A.display}. Type {A.display}'s own credentials.")
    email = input("Garmin email: ").strip()
    password = getpass("Garmin password: ")
    if not email or not password:
        sys.exit("Email and password required.")
    A.token_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    client = Garmin(email=email, password=password,
                    prompt_mfa=lambda: input("MFA code: ").strip())
    # login() tries the (empty) tokenstore first, falls back to credentials (+MFA), and persists
    # fresh tokens to the tokenstore path automatically.
    client.login(str(A.token_dir))

    if not bound:
        bind(client)
        return
    if client.display_name != bound:
        set_aside("logged into a different account")
        sys.exit(f"REFUSED: that login is {client.full_name}, but {A.display} is bound to "
                 f"{A.garmin.get('full_name')}. Nothing was recorded.")
    print(f"Login OK: {client.full_name}")
    print(f"Tokens saved to {A.token_dir} — no script will need credentials again.")


if __name__ == "__main__":
    main()
