import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RequestBook, checkRequest, checkView, cookieToken, gate, sameToken } from '../lib.ts';

const PORT = 5280;

test('gate: only this server, from this page', () => {
  assert.equal(gate({ host: '127.0.0.1:5280' }, PORT), null, 'curl-style: no browser headers');
  assert.equal(gate({ host: 'localhost:5280', 'sec-fetch-site': 'same-origin', origin: 'http://localhost:5280' }, PORT), null);
  assert.equal(gate({ host: '127.0.0.1:5280', 'sec-fetch-site': 'none' }, PORT), null, 'a URL typed or opened by the coach');
  // DNS rebinding: the attacker's page is "same-origin" with itself, and its hostname rides in Host.
  assert.equal(gate({ host: 'evil.example:5280', 'sec-fetch-site': 'same-origin', origin: 'http://evil.example:5280' }, PORT), 'wrong host');
  assert.equal(gate({ host: '127.0.0.1:5281' }, PORT), 'wrong host', 'another local dev server');
  assert.equal(gate({ host: '127.0.0.1:5280', 'sec-fetch-site': 'cross-site' }, PORT), 'cross-site request');
  assert.equal(gate({ host: '127.0.0.1:5280', origin: 'http://localhost:5173' }, PORT), 'foreign origin');
});

test('tokens compare exactly, and only when both exist', () => {
  assert.ok(sameToken('abc', 'abc'));
  assert.ok(!sameToken('abc', 'abd'));
  assert.ok(!sameToken('abc', 'abcd'));
  assert.ok(!sameToken(undefined, 'abc'));
  assert.ok(!sameToken('', ''));
  assert.equal(cookieToken({ cookie: 'x=1; adn_t=tok=en; y=2' }), 'tok=en');
  assert.equal(cookieToken({}), undefined);
});

test('a request only moves forward: QUEUED → WORKING → DONE / FAILED', () => {
  const book = new RequestBook();
  const r = book.add('question', 'What should I do today?', 1000);
  assert.equal(r.id, 'r1');
  assert.equal(r.state, 'QUEUED');
  book.progress('r1', 'refreshing');
  assert.equal(book.get('r1')?.state, 'WORKING', 'progress implies the coach picked it up');
  book.finish('r1', 'TRAIN · D2 Pull', 5000);
  assert.equal(book.get('r1')?.state, 'DONE');
  assert.throws(() => book.finish('r1', 'again'), /already DONE/);
  assert.throws(() => book.ack('r9'), /no request r9/);
  const f = book.add('question', 'x');
  book.fail(f.id, 'Garmin sign-in expired');
  assert.equal(book.get(f.id)?.error, 'Garmin sign-in expired');
});

test('the dev origin passes only when it is the one configured (fixtures mode)', () => {
  const dev = 'http://localhost:5173';
  assert.equal(gate({ host: '127.0.0.1:5280', origin: dev, 'sec-fetch-site': 'same-site' }, PORT, dev), null);
  assert.equal(gate({ host: '127.0.0.1:5280', origin: dev, 'sec-fetch-site': 'same-site' }, PORT), 'cross-site request');
});

test('only allowlisted views, with well-formed arguments, reach Python', () => {
  assert.equal(checkView('today', null), null);
  assert.equal(checkView('workout', '21000000102'), null);
  assert.equal(checkView('exercise', 'BENCH_PRESS/BARBELL_BENCH_PRESS'), null);
  assert.ok(checkView('workout', '1; rm -rf /'));
  assert.ok(checkView('exercise', '../athletes/x'));
  assert.ok(checkView('journal-entry', '../../etc/passwd'));
  assert.ok(checkView('today', 'x'));
  assert.ok(checkView('attach', null), 'attach is never a view');
});

test('only plans published in this run can be confirmed; earlier requests are never re-opened', () => {
  const book = new RequestBook();
  book.load([{ id: 'r7', kind: 'question', text: 'x', state: 'WORKING', createdAt: 1, progress: [] }]);
  assert.equal(book.get('r7')?.state, 'FAILED', 'a request left open by an ended session is closed');
  const r = book.add('accept', 'go');
  assert.equal(r.id, 'r8', 'numbering continues');
  assert.ok(!book.isPublishedPlan('abc123'));
  book.publish(r.id, 'push_plan', { plan_hash: 'abc123' });
  assert.ok(book.isPublishedPlan('abc123'));
  assert.equal(book.get(r.id)?.result?.kind, 'push_plan');
});

test('every request the page sends has one meaning, and nothing else gets through (APP_AUDIT H3)', () => {
  // The shapes app/web sends — keep in step with its ask(...) calls.
  const sent: [string, Record<string, unknown> | undefined][] = [
    ['question', undefined], ['question', { about: 'Bench · Sat 10 Oct' }], ['question', { about: 'x', flag: true }],
    ['question', { pending_id: 'q1' }],                    // answering the daily's pending question (R1)
    ['workflow', { name: 'daily' }], ['workflow', { name: 'week' }], ['workflow', { name: 'review' }],
    ['workflow', { name: 'review', activity_id: '21000000099', date: '2026-10-04' }],
    ['plan', { move: 'D1 · Push', to: '2026-10-12' }], ['plan', { proposal: 'plan-next-week', about: 'Proposal plan-next-week' }],
    ['accept', { proposal: 'p1' }], ['accept', { pending_id: 'b0' }],
    ['push', undefined], ['push', { retry: 'a1b2c3' }],
    ['checkin', { feel: 4, note: 'legs heavy' }],
  ];
  for (const [kind, params] of sent) assert.equal(checkRequest(kind, params), null, `${kind} ${JSON.stringify(params)}`);
  const refused: [string, Record<string, unknown> | undefined][] = [
    ['accept', { pending: true }],                       // the old "send pending changes"
    ['accept', { retry: 'a1b2c3' }],                      // the old retry
    ['accept', undefined], ['accept', { proposal: 'p1', pending_id: 'b0' }],
    ['workflow', { name: 'push' }], ['workflow', undefined],
    ['checkin', { feel: 9 }], ['question', { plan_hash: 'x' }],   // a confirm is never a question
    ['confirm', { plan_hash: 'x' }],                      // confirms go through /api/confirm only
    ['question', { about: 'x'.repeat(301) }],
  ];
  for (const [kind, params] of refused) assert.ok(checkRequest(kind, params), `${kind} ${JSON.stringify(params)} must be refused`);
});
