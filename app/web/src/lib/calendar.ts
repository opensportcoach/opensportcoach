/** What the calendar holds on a day (the `calendar` view), read one way by Plan and by a proposal's "Now" row. */

export const plannedKey = (x: { date: string; title: string }) => `plan:${x.date}:${x.title}`;

export type EntryKind = 'done' | 'watch' | 'planned' | 'upcoming' | 'changed' | 'missed';
/** `zwift`: the Zwift workout a planned Zwift ride names (plan.json `zwift_workout`, his rule 2026-11-05).
 * `fuel`: its fuel plan, from its intent (scripts/fuel.py via the calendar view; docs/DESIGN.md (fuelling and score) §6.4). */
export interface Entry { kind: EntryKind; title: string; badge?: any; id?: string; key?: string; sport?: string; group?: string; zwift?: any; fuel?: any }

/** The entries of a day: done, on the watch (or changed and not on it yet), planned off the watch, missed. */
export function calendarEntries(c: any, today: string): (d: string) => Entry[] {
  const changed = new Set((c.sync?.workouts ?? []).filter((w: any) => w.state === 'changed' || w.state === 'not_pushed').map((w: any) => w.workout));
  return (d: string) => [
    ...c.done.filter((x: any) => x.date === d).map((x: any) => ({ kind: 'done' as const, title: x.title, group: x.group, id: x.id, badge: x })),
    // A calendar entry is done when that day logged it — the same name, or the same sport (a pool
    // swim for "Swim 1,800 m") — even if Garmin didn't link them (it does only when the session was
    // started from the calendar). A past entry with nothing logged was not done.
    ...c.scheduled.filter((x: any) => x.date === d && !x.done && !c.done.some((a: any) => a.date === d && (a.title === x.title || (a.icon && a.icon === x.badge?.icon && a.icon !== 'strength'))))
      .map((x: any) => ({ kind: (d < today ? 'missed' : changed.has(x.title) ? 'changed' : 'watch') as EntryKind, title: x.title, sport: x.sport, badge: x.badge })),
    // Planned off the watch (plan.json): Zwift runs its own workouts, the long ride needs no steps.
    // Done when that day logged the same kind of sport — the view decides, by the rule above.
    ...(c.planned ?? []).filter((x: any) => x.date === d && !x.done)
      .map((x: any) => ({ kind: (d < today ? 'missed' : x.workout ? 'upcoming' : 'planned') as EntryKind, title: x.title, badge: x.badge, key: x.workout ?? plannedKey(x), zwift: x.zwift_workout ?? undefined, fuel: x.fuel ?? undefined })),
  ];
}
