# The OpenSportCoach workflow

One page. What runs, when, who decides, and where the gates are.

**Several athletes, one folder.** Athletes can share this repo, one computer and one OS user —
never at the same time. Each session is locked to one athlete before anything athlete-specific
happens, and everything below acts for that athlete only. The mechanics are in
`scripts/athlete.py`; the rule is in `CLAUDE.md` → "First: who are you coaching?".

---

## The shape

```
   WHO? ══════════▶ session bound to ONE athlete, once (use.py) ══ never rebound
                      ┌──────────────────────────────────────────────┐
   YOU TYPE ─────────▶│  /osc-daily   /osc-week   /osc-audit│
                      │  /osc-review  /osc-push   /osc-brief│
                      └───────────────────────┬──────────────────────┘
                                              │  skills are the orchestrator
                                              ▼
                          ┌───────────────────────────────────┐
                          │  refresh.sh — 4 steps, ~60 s      │  ← unconditional,
                          │  pull · pull · export · baseline  │    locked, resumes a stopped run, no model
                          └───────────────────┬───────────────┘
                                              ▼
                          ┌───────────────────────────────────┐
                          │  BRANCH on what actually changed  │  ← the skill decides
                          └───────────────────┬───────────────┘
             ┌────────────────┬───────────────┼───────────────┬─────────────────┐
             ▼                ▼               ▼               ▼                 ▼
      new session?    carried sets?     bumps fired?     repo dirty?     nothing happened?
      progression     harvest           update log       sync check      2 lines, stop
             │                                  │
             ▼ (only if anomalous)              ▼
      [execution-reviewer]              propose bumps
             │                                  │
             └──────────────┬───────────────────┘
                            ▼
                 ══════ VALIDATION GATE ══════      build · validate · every athlete's tests · audit
                            ▼
                 ══════ HUMAN CONFIRM ════════      the athlete says yes. Always. No exceptions.
                            ▼
                    sync_workouts.py --yes          the ONLY path to Garmin — identity-checked
                            ▼
                    verify · brief · log · commit
```

**Everything in `[brackets]` is an agent.** Everything in `══` is a gate nothing passes alone.

---

## Cadence

| When | What | Cost |
|---|---|---|
| Every training day | `/osc-daily` | scripts only, no agent |
| After an odd session | `/osc-review <date>` | one agent |
| Sunday | `/osc-week` | one agent (insight) |
| Monthly | `/osc-audit` | one agent (fan-out) |
| Any Garmin write | `/osc-push` | scripts only |
| A race added, a date check due, the day after a race | `/osc-race` | scripts + an online lookup, no agent; never unattended |
| Scheduled / unattended | `/osc-brief` | scripts only, **never pushes** |

---

## The three layers, and the line between them

| Layer | Contains | Rule |
|---|---|---|
| **Deterministic** | the scripts; engine tests + each athlete's `tests.py` | a fixed transformation is a script |
| **Judgment** | 6 skills, 3 agents | a branch that depends on interpretation is a skill |
| **Memory** | engine facts in `memory/`, each athlete's in `athletes/<name>/memory/` | one fact, one file, one `enforced_by` |

**The line:** if it can be wrong in a way a test could catch, it belongs in a test. If being wrong
requires misreading a situation, it belongs in a skill.

---

## What never happens

- **No agent writes to Garmin.** Writes go through `/osc-push`, single-threaded, with the athlete's confirm.
- **No session acts for anyone but its bound athlete.** Scripts refuse, the Garmin login is
  identity-checked, a hook keeps the session out of other athletes' files, commits hold one athlete.
- **No agent edits `tests/`.** The tests are what protect against the agents.
- **No unattended push.** A scheduled session has nobody to confirm with.
- **No agent in the validation path.** Deterministic checks stay assertions — an LLM gate is
  non-deterministic and cannot be regression-tested.
- **No medical decision by an agent.** Removed lifts stay removed; reinstating one is a clinical call.

---

## The app lane

```
coach.sh ─▶ session bound to ONE athlete ─▶ /osc-app: attach · open the page · daily (app mode)
page ──▶ screens from scripts/app_data.py (no model)      page ──▶ request ──▶ channel ──▶ the session
                                                           session ──▶ validated result ──▶ page
Send to watch: dry run (--plan-json) ─▶ card ─▶ CLICK ─▶ confirm_gate.py ─▶ sync --yes --expect-plan
```

The same gates, one more hard line: in a session serving the app a Garmin write needs the athlete's
click on that exact plan — the hook holds it in any permission mode. A ride or run's analysis is
`/osc-review` with the rubric for its sport (one file per sport in the skill), and its every number is checked against `endurance_metrics.py`
before the page shows it. Refreshes are one per athlete at a time, and every open window sees them. Screens never wait on the model;
every number on them comes from a view, every result from the coach passes its contract
(`app/contracts/`). Details: docs/DESIGN.md (the app).

---

## The memory contract

Every durable fact is one file — in `memory/` if it is true for every athlete, in
`athletes/<name>/memory/` if it is theirs — with frontmatter:

```yaml
type: medical | athlete | equipment | convention | preference | incident
status: active | resolved | superseded
since: 2026-01-15
source: physiotherapist     # a fact with no provenance is a rumour
enforced_by: athletes/<name>/tests.py::test_no_overhead_pressing
```

**`enforced_by` is the load-bearing field.** It names the assertion that makes a fact non-optional.
An active medical fact must name one, that test must actually exist, and it must live in THAT
athlete's own `tests.py` — a dangling reference is worse than none, because it looks like
protection.

Three tests hold this together: the index cannot drift, every fact is typed and sourced, and every
active medical fact resolves to a real test.

---

## Failure modes and what to do

| Symptom | Cause | Action |
|---|---|---|
| Sync dies mid-run | `ConnectionResetError` — happened 3× | re-run; `refresh.sh` resumes, `sync_workouts.py` is idempotent |
| Duplicate workout in the account | a failed sync left one behind | verify the keeper round-trips, then delete the other |
| A lift looks like it regressed | usually a different machine | the athlete's `memory/equipment/` (e.g. `per-machine-disc-lifts.md`) |
| A number looks wrong to them | usually a lookup table with a silent default | **pull the raw list before defending it** — the athlete has usually been right |
| "No athlete is bound" / a script refuses to run | the session was never bound, or was bound to someone else | bind with `scripts/use.py <name>`; a wrong binding means a new session |
| "REFUSED: … tokens belong to …" | the token store holds another account | nothing was read or written; the athlete re-runs `scripts/login.py --athlete <name>` |
| A load looks near-doubled, or lands just under an equipment ceiling | **the key says one implement, his hands held another** | suspect the implement before believing the number. Ask; do not bump. See `memory/incident/2026-09-21-key-implement-mismatch.md` |
| `/osc-*` not in the `/` list | frontmatter parse error | check the `SKILL.md` header |

---

## Proving it works

Three acceptance tests, none of them run yet:

1. **`/osc-daily` on a rest day** should produce two lines and stop, not a wall of analysis.
2. **`/osc-review 2026-09-01`** should find the machine split unprompted. If it cannot find
   something already known to be findable, the agent is not ready.
3. **The Sunday insight pass** should be able to return *"no findings this week"*. If it never does,
   the bar is not real and the output will become noise.
