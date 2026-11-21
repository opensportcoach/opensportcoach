/**
 * The transport seam (docs/DESIGN.md (the app) → The transport seam). The page's requests go to "the coach"
 * through this one interface, whatever stands behind it:
 *   ChannelCoach — the live Claude Code session, through the MCP channel (coach mode)
 *   MockCoach    — fixture results after realistic delays (fixtures mode: UI work, no session)
 * If channels change or break, a headless implementation (pre-bound `claude -p` sessions) slots in
 * here without touching a screen.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppRequest, RequestBook } from './lib.ts';

export interface Coach {
  readonly name: string;
  send(r: AppRequest, meta?: Record<string, string>): Promise<void>;
}

type Notify = (content: string, meta: Record<string, string>) => Promise<void>;

export class ChannelCoach implements Coach {
  readonly name = 'channel';
  #notify: Notify;
  constructor(notify: Notify) {
    this.#notify = notify;
  }
  async send(r: AppRequest, meta: Record<string, string> = {}): Promise<void> {
    // Checked by lib.checkRequest already; booleans travel as "true"/"false" (they used to be dropped).
    const params = r.params ? Object.fromEntries(
      Object.entries(r.params).filter(([k, v]) => /^\w+$/.test(k) && ['string', 'number', 'boolean'].includes(typeof v))
        .map(([k, v]) => [k, String(v)])) : {};
    await this.#notify(r.text, { ...params, ...meta, request_id: r.id, kind: r.kind });
  }
}

/** Which fixture answers which request, in fixtures mode. */
const FIXTURE_FOR: Record<string, string> = {
  question: 'answer', plan: 'plan_proposal', accept: 'push_plan', push: 'push_plan', confirm: 'push_result', checkin: 'daily',
  'workflow:daily': 'daily', 'workflow:week': 'plan_proposal', 'workflow:review': 'review', 'workflow:review:activity': 'endurance_review', 'workflow:audit': 'review', 'workflow:races': 'race_check',
};

export class MockCoach implements Coach {
  readonly name = 'mock';
  #book: RequestBook;
  #emit: (r: AppRequest) => void;
  #dir: string;
  #queue: Promise<void> = Promise.resolve();
  #speed: number;
  #onResult?: (kind: string, payload: unknown) => void;
  constructor(book: RequestBook, emit: (r: AppRequest) => void, fixturesDir: string, speed = 1, onResult?: (kind: string, payload: unknown) => void) {
    this.#onResult = onResult;
    this.#book = book;
    this.#emit = emit;
    this.#dir = fixturesDir;
    this.#speed = speed;
  }
  send(r: AppRequest): Promise<void> {
    // One at a time, like the real session.
    this.#queue = this.#queue.then(() => this.#answer(r));
    return Promise.resolve();
  }
  async #answer(r: AppRequest): Promise<void> {
    const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms * this.#speed));
    await wait(700);
    this.#emit(this.#book.ack(r.id));
    for (const line of ['Reading the dashboard', 'Checking the last six sessions']) {
      await wait(900);
      this.#emit(this.#book.progress(r.id, line));
    }
    await wait(900);
    // A review of one ride or run (it carries the activity) is an endurance_review.
    const key = r.kind === 'workflow' ? `workflow:${String(r.params?.name ?? 'daily')}${r.params?.activity_id ? ':activity' : ''}` : r.kind;
    const fixture = FIXTURE_FOR[key];
    if (!fixture) {
      this.#emit(this.#book.fail(r.id, `the mock coach has no answer for ${key}`));
      return;
    }
    const payload = JSON.parse(readFileSync(join(this.#dir, 'results', `${fixture}.json`), 'utf8'));
    if ('request_id' in payload) payload.request_id = r.id;
    this.#emit(this.#book.publish(r.id, payload.kind, payload));
    this.#onResult?.(payload.kind, payload);
  }
}
