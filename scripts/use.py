#!/usr/bin/env python3
"""Lock THIS Claude session to one athlete. Run once, at the start of a session.

    .venv/bin/python scripts/use.py alex

WHY (2026-09-24). Several athletes can use the same folder, the same Mac and the same macOS user,
and never at the same time. So a session does not know who it is coaching until someone says so,
and saying so has to happen exactly once and stick. This writes the binding —
data/sessions/<session id> -> athlete — and from then on every script in the session resolves
that athlete and no other (athlete.current()). A session can NEVER be rebound: if the wrong name
was given, start a new session. Resuming a session keeps its binding.

The session id comes from OSC_SESSION, which the SessionStart hook exports for the session
(scripts/hooks/session_start.py). Outside a Claude session there is nothing to bind — pass
`--athlete <name>` to each script instead.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import athlete  # noqa: E402
from whoami import banner  # noqa: E402


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(f"usage: use.py <athlete>   (athletes: {', '.join(athlete.known())})")
    sid = athlete.session_id()
    if not sid:
        sys.exit("Not inside a Claude session (OSC_SESSION is not set). In a terminal, pass "
                 "--athlete <name> to each script instead.")
    a = athlete.bind(sid, sys.argv[1].strip().lower())
    print(banner(a, full=True))


if __name__ == "__main__":
    main()
