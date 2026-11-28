/** Fixtures mode: the synthetic Demo athlete and a mock coach — the UI's development server. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SERVER = fileURLToPath(new URL('../server.ts', import.meta.url));
const PORT = 5392;
const BASE = `http://127.0.0.1:${PORT}`;

async function until<T>(fn: () => Promise<T | undefined>, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v !== undefined) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timed out');
}

test('fixtures mode serves the Demo views and a mock coach end to end', async () => {
  const child = spawn(process.execPath, [SERVER, '--fixtures', '--no-token', '--port', String(PORT), '--speed', '0.01'],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  try {
    await until(async () => (await fetch(`${BASE}/api/state`).catch(() => undefined))?.ok || undefined);
    const state = await (await fetch(`${BASE}/api/state`)).json();
    assert.equal(state.display, 'Rocky');
    assert.equal(state.mode, 'fixtures');
    assert.equal(state.outdated, false, 'a server just started runs the code on disk');
    const today = await (await fetch(`${BASE}/api/views/today`)).json();
    assert.equal(today.view, 'today');
    assert.equal((await fetch(`${BASE}/api/views/workout?arg=1`)).status, 500, 'no fixture → an error, not a guess');
    assert.equal((await fetch(`${BASE}/api/views/nope`)).status, 400);

    const json = { 'content-type': 'application/json' };
    // Trips (docs/DESIGN.md (trips)): the demo's view, and its write — checked, then nothing written in fixtures mode.
    const trips = await (await fetch(`${BASE}/api/views/trips`)).json();
    assert.deepEqual(trips.trips.map((t: any) => t.id), ['lakeside', 'hill-town']);
    const trip = { where: 'Seaport', from: '2027-03-01', to: '2027-03-03', access: { gym: 'no', pool: 'no', bike: 'no', trainer: 'no', run: 'yes', courts: 'no' } };
    const saved = await fetch(`${BASE}/api/actions/trips`, { method: 'POST', headers: json, body: JSON.stringify({ action: 'save', trip }) });
    assert.equal(saved.status, 200);
    assert.match((await saved.json()).summary, /demo data, so nothing was written/);
    const half = await fetch(`${BASE}/api/actions/trips`, { method: 'POST', headers: json, body: JSON.stringify({ action: 'save', trip: { ...trip, access: { run: 'yes' } } }) });
    assert.equal(half.status, 400, 'a trip that leaves a place unanswered never reaches trips.py');
    const q = await (await fetch(`${BASE}/api/requests`, { method: 'POST', headers: json, body: JSON.stringify({ text: 'Why did my bench stall?' }) })).json();
    const answered = await until(async () => {
      const s = await (await fetch(`${BASE}/api/state`)).json();
      const r = s.requests.find((x: any) => x.id === q.id);
      return r.state === 'DONE' ? r : undefined;
    });
    assert.equal(answered.result.kind, 'answer');
    assert.equal(answered.result.payload.request_id, q.id);
    assert.ok(answered.progress.length >= 2);

    const acc = await (await fetch(`${BASE}/api/requests`, { method: 'POST', headers: json, body: JSON.stringify({ kind: 'push', text: 'Send the pending changes to the watch' }) })).json();
    const plan = await until(async () => {
      const s = await (await fetch(`${BASE}/api/state`)).json();
      const r = s.requests.find((x: any) => x.id === acc.id);
      return r.state === 'DONE' ? r.result.payload : undefined;
    });
    const click = await fetch(`${BASE}/api/confirm`, { method: 'POST', headers: json, body: JSON.stringify({ plan_hash: plan.plan_hash }) });
    assert.equal(click.status, 201);
    const pushed = await until(async () => {
      const s = await (await fetch(`${BASE}/api/state`)).json();
      const r = s.requests.filter((x: any) => x.kind === 'confirm').at(-1);
      return r?.state === 'DONE' ? r.result.payload : undefined;
    });
    assert.equal(pushed.kind, 'push_result');
    assert.equal((await fetch(`${BASE}/api/requests`, { method: 'POST', headers: json, body: JSON.stringify({ kind: 'confirm', text: 'x' }) })).status, 400,
      'a confirm never comes through the requests route');
  } finally {
    child.kill();
  }
});
