/**
 * End to end, without Claude: spawn the real server, speak MCP to it over stdio the way Claude
 * Code does, attach it to a throwaway athlete's session, then drive the HTTP side like the page.
 * Proves everything the spike can prove on its own; the live checks are in SPIKE.md.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { request } from 'node:http';

const SERVER = fileURLToPath(new URL('../server.ts', import.meta.url));
const PORT = 5391;
const BASE = `http://127.0.0.1:${PORT}`;

function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'osc-channel-test-'));
  for (const n of ['ann', 'bob']) {
    mkdirSync(join(root, 'athletes', n), { recursive: true });
    writeFileSync(join(root, 'athletes', n, 'athlete.json'),
      JSON.stringify({ display: n[0].toUpperCase() + n.slice(1), garmin: { display_name: `id-${n}`, full_name: `${n.toUpperCase()} M.` } }));
  }
  mkdirSync(join(root, 'data', 'sessions'), { recursive: true });
  writeFileSync(join(root, 'data', 'sessions', 'sess-ann-0001'), '{"athlete": "ann"}');
  writeFileSync(join(root, 'data', 'sessions', 'sess-bob-0001'), '{"athlete": "bob"}');
  return root;
}

function startServer(root: string) {
  const env = { ...process.env, OSC_ATHLETES_ROOT: join(root, 'athletes'), OSC_DATA_ROOT: join(root, 'data'), OSC_APP_PORT: String(PORT) };
  delete env.OSC_SESSION;
  delete env.OSC_ATHLETE;
  const child = spawn(process.execPath, [SERVER], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  const pending = new Map<number, (v: any) => void>();
  const notes: any[] = [];
  createInterface({ input: child.stdout }).on('line', (line) => {
    const msg = JSON.parse(line);
    if (msg.id !== undefined && pending.has(msg.id)) pending.get(msg.id)!(msg);
    else if (msg.method) notes.push(msg);
  });
  let id = 0;
  const rpc = (method: string, params: unknown) => new Promise<any>((resolve) => {
    const n = ++id;
    pending.set(n, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n');
  });
  const call = async (name: string, args: Record<string, unknown>) => (await rpc('tools/call', { name, arguments: args })).result;
  return { child, rpc, call, notes, stderr: () => stderr };
}

/** fetch() won't let a test set Host (it's a forbidden header), so the rebinding case goes raw. */
function rawStatus(path: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    request({ host: '127.0.0.1', port: PORT, path, headers }, (res) => { res.resume(); resolve(res.statusCode ?? 0); })
      .on('error', reject).end();
  });
}

const page = (cookie: string, extra: Record<string, string> = {}) => ({
  host: `127.0.0.1:${PORT}`, cookie, 'sec-fetch-site': 'same-origin', origin: BASE, ...extra,
});

test('attach, the token swap, a request round trip, and a recorded click', async () => {
  const root = scratch();
  const s = startServer(root);
  try {
    const init = await s.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
    assert.deepEqual(init.result.capabilities.experimental, { 'claude/channel': {} }, 'declares itself a channel');
    assert.match(init.result.instructions, /app_attach/);
    s.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

    const tools = (await s.rpc('tools/list', {})).result.tools.map((t: any) => t.name);
    assert.deepEqual(tools, ['app_attach', 'app_ack', 'app_progress', 'app_status', 'app_reply', 'app_publish', 'app_fail']);

    // Nothing listens before attach.
    await assert.rejects(fetch(`${BASE}/`), 'the port opens only at attach');

    const unbound = await s.call('app_attach', { session_id: 'sess-nobody-1' });
    assert.ok(unbound.isError && /not bound/.test(unbound.content[0].text), unbound.content[0].text);

    const ok = await s.call('app_attach', { session_id: 'sess-ann-0001' });
    assert.ok(!ok.isError, ok.content[0]?.text);
    const info = JSON.parse(ok.content[0].text);
    assert.equal(info.athlete, 'Ann');
    assert.equal(info.garmin_account, 'ANN M.');
    const token = new URL(info.url).searchParams.get('t')!;
    assert.ok(existsSync(join(root, 'data', 'ann', 'app', 'sessions', 'sess-ann-0001.json')));

    const other = await s.call('app_attach', { session_id: 'sess-bob-0001' });
    assert.ok(other.isError && /never re-attached/.test(other.content[0].text), 'locked to one session for life');

    // Gate: rebinding host, foreign origin, no token, stale token.
    assert.equal(await rawStatus('/api/state', { host: `evil.example:${PORT}`, 'sec-fetch-site': 'same-origin',
      origin: `http://evil.example:${PORT}` }), 403, 'a DNS-rebinding page');
    assert.equal((await fetch(`${BASE}/api/state`, { headers: { origin: 'http://localhost:5173' } })).status, 403);
    assert.equal((await fetch(`${BASE}/api/state`)).status, 401);
    assert.equal((await fetch(`${BASE}/?t=nope`, { redirect: 'manual' })).status, 401);
    // A person who opens an old link gets words, not JSON (docs/DESIGN.md (app audit) M6); the page's API calls
    // learn the session ended.
    const old = await fetch(`${BASE}/?t=nope`, { redirect: 'manual', headers: { accept: 'text/html' } });
    assert.equal(old.status, 401);
    assert.match(await old.text(), /ended, or a newer session/);
    const oldTab = await fetch(`${BASE}/workouts/1`, { headers: { accept: 'text/html', cookie: 'adn_t=old' } });
    assert.match(await oldTab.text(), /newer one/);
    assert.equal((await (await fetch(`${BASE}/api/state`, { headers: { cookie: 'adn_t=old' } })).json()).error, 'session_ended');

    // The coach's link swaps the token for an HttpOnly cookie.
    const swap = await fetch(info.url, { redirect: 'manual' });
    assert.equal(swap.status, 303);
    const setCookie = swap.headers.get('set-cookie') ?? '';
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    const cookie = `adn_t=${token}`;

    const state = await (await fetch(`${BASE}/api/state`, { headers: page(cookie) })).json();
    assert.equal(state.display, 'Ann');
    assert.equal(state.athlete, 'ann');

    assert.equal((await fetch(`${BASE}/api/requests`, { method: 'POST', headers: page(cookie, { 'content-type': 'text/plain' }), body: 'x' })).status, 400, 'JSON only');

    const posted = await fetch(`${BASE}/api/requests`, {
      method: 'POST', headers: page(cookie, { 'content-type': 'application/json' }), body: JSON.stringify({ text: 'What should I do today?' }),
    });
    assert.equal(posted.status, 201);
    const req = await posted.json();
    await new Promise((r) => setTimeout(r, 100));
    const note = s.notes.find((n) => n.method === 'notifications/claude/channel');
    assert.ok(note, 'the request reached the session as a channel event');
    assert.equal(note.params.content, 'What should I do today?');
    assert.deepEqual(note.params.meta, { request_id: req.id, kind: 'question' });

    await s.call('app_ack', { request_id: req.id });
    await s.call('app_progress', { request_id: req.id, text: 'reading the dashboard' });
    await s.call('app_reply', { request_id: req.id, markdown: 'TRAIN · D2 Pull' });
    const after = await (await fetch(`${BASE}/api/state`, { headers: page(cookie) })).json();
    assert.equal(after.requests[0].state, 'DONE');
    assert.equal(after.requests[0].reply, 'TRAIN · D2 Pull');
    assert.deepEqual(after.requests[0].progress, ['reading the dashboard']);

    // The startup daily: status lines on the page, and a reload of every screen once data is new.
    const sse = await fetch(`${BASE}/api/events`, { headers: page(cookie) });
    const reader = sse.body!.getReader();
    let streamed = '';
    const until = async (needle: string) => {
      while (!streamed.includes(needle)) streamed += new TextDecoder().decode((await reader.read()).value);
    };
    await s.call('app_status', { text: 'Pulling today’s Garmin data' });
    await until('Pulling today');
    let st = await (await fetch(`${BASE}/api/state`, { headers: page(cookie) })).json();
    assert.equal(st.status.text, 'Pulling today’s Garmin data');
    const since = st.status.since;
    const changedData = await s.call('app_status', { text: 'Analysing', data_changed: true });
    assert.match(changedData.content[0].text, /reloads/);
    await until('"state":"done"');
    st = await (await fetch(`${BASE}/api/state`, { headers: page(cookie) })).json();
    assert.equal(st.status.text, 'Analysing');
    assert.equal(st.status.since, since, 'one run keeps its start time');
    await s.call('app_status', { text: 'stopped', done: true });
    await until('event: status\ndata: null');
    st = await (await fetch(`${BASE}/api/state`, { headers: page(cookie) })).json();
    assert.equal(st.status, null);
    await reader.cancel();

    // A click on a plan the coach never showed is refused.
    const unshown = await fetch(`${BASE}/api/confirm`, {
      method: 'POST', headers: page(cookie, { 'content-type': 'application/json' }), body: JSON.stringify({ plan_hash: 'spike1' }),
    });
    assert.equal(unshown.status, 409, 'only a plan published in this run can be confirmed');

    // The coach publishes a dry-run plan (a file in the athlete's app state, valid against its contract).
    const acc = await (await fetch(`${BASE}/api/requests`, {
      method: 'POST', headers: page(cookie, { 'content-type': 'application/json' }),
      body: JSON.stringify({ kind: 'accept', text: 'Accept the plan', params: { proposal: 'plan-next-week' } }),
    })).json();
    const planFile = join(root, 'data', 'ann', 'app', 'results', `${acc.id}.json`);
    mkdirSync(join(root, 'data', 'ann', 'app', 'results'), { recursive: true });
    writeFileSync(planFile, JSON.stringify({ kind: 'push_plan', request_id: acc.id, athlete: 'ann', display: 'Ann',
      garmin_account: 'ANN M.', protected: 0, script: 'sync', plan_hash: 'spike1',
      actions: [{ verb: 'replace', workout: 'D1 · Push', key: 'd1', old_id: 1, dates: [] }] }));
    const outside = join(root, 'elsewhere.json');
    writeFileSync(outside, '{}');
    const refusedPub = await s.call('app_publish', { request_id: acc.id, kind: 'push_plan', file: outside });
    assert.ok(refusedPub.isError && /only from the athlete/.test(refusedPub.content[0].text), 'files outside are refused: ' + JSON.stringify(refusedPub));
    const invalid = join(root, 'data', 'ann', 'app', 'results', 'bad.json');
    writeFileSync(invalid, JSON.stringify({ kind: 'push_plan', request_id: acc.id }));
    const refusedBad = await s.call('app_publish', { request_id: acc.id, kind: 'push_plan', file: invalid });
    assert.ok(refusedBad.isError && /not a valid push_plan/.test(refusedBad.content[0].text), refusedBad.content[0].text);
    const pub = await s.call('app_publish', { request_id: acc.id, kind: 'push_plan', file: planFile });
    assert.ok(!pub.isError, pub.content[0]?.text);

    // Send to watch: the click is recorded for this session and the session is told.
    const click = await fetch(`${BASE}/api/confirm`, {
      method: 'POST', headers: page(cookie, { 'content-type': 'application/json' }), body: JSON.stringify({ plan_hash: 'spike1' }),
    });
    assert.equal(click.status, 201, await click.clone().text());
    assert.ok(existsSync(join(root, 'data', 'ann', 'app', 'confirms', 'sess-ann-0001--spike1.json')));
    await new Promise((r) => setTimeout(r, 100));
    const confirmNote = s.notes.filter((n) => n.method === 'notifications/claude/channel').at(-1);
    assert.equal(confirmNote.params.meta.kind, 'confirm');
    assert.equal(confirmNote.params.meta.plan_hash, 'spike1');
    const bad = await fetch(`${BASE}/api/confirm`, {
      method: 'POST', headers: page(cookie, { 'content-type': 'application/json' }), body: JSON.stringify({ plan_hash: 'x;rm -rf' }),
    });
    assert.equal(bad.status, 409, 'a hash the coach never published is refused before Python runs');
    const saved = JSON.parse(readFileSync(join(root, 'data', 'ann', 'app', 'requests.json'), 'utf8'));
    assert.ok(saved.some((r: any) => r.kind === 'confirm'), 'the book persists in the athlete app state');
  } finally {
    s.child.kill();
    rmSync(root, { recursive: true, force: true });
  }
});
