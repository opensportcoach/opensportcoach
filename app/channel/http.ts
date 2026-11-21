/**
 * The page's HTTP side, the same in every mode (docs/DESIGN.md (the app) → Processes, Security):
 *
 *   GET  /?t=<token>            swap the launch token for an HttpOnly cookie, then drop it from the URL
 *   GET  /, /assets/*           the built SPA (app/web/dist), or the spike's test page before it exists
 *   GET  /api/state             who, the coach's status, every request
 *   GET  /api/views/<name>?arg= one of app_data.py's views (allowlisted names and argument shapes)
 *   GET  /api/events            SSE: request updates, the daily, refresh progress, the coach's status
 *   POST /api/requests          {kind, text, params} → the coach (kinds and params: lib.ts REQUEST_PARAMS)
 *   POST /api/confirm           {plan_hash} → Send to watch on a plan the coach published in this run
 *   POST /api/actions/refresh   pull Garmin + rebuild the export (no model), one at a time
 *   POST /api/actions/fuel      what was taken during a session → scripts/fuel.py log (no model)
 *   POST /api/actions/fuel-setup the fuel setup answers → scripts/fuel.py setup (no model)
 *
 * Checked before routing: Host, Sec-Fetch-Site, Origin (lib.gate), then the cookie.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import type { Coach } from './coach.ts';
import { COOKIE, MAX_BODY_BYTES, type AppRequest, type RequestBook, checkFuelLog, checkFuelSetup, checkRequest, checkView, cookieToken, gate, sameToken } from './lib.ts';
import { PAGE } from './page.ts';

export interface Who {
  athlete: string;
  display: string;
  garmin_account: string | null;
  accent?: string | null;
}

/** What the coach is doing outside a request; `ask` names what it waits on ("feel": the page shows the 1–5 picker). */
export interface CoachStatus { text: string; since: number; updated?: number; ask?: 'feel' }

/** The data refresh, as every open tab sees it (docs/DESIGN.md (app audit) H1): who started it, how it went. */
export interface RefreshState {
  state: 'idle' | 'running' | 'done' | 'failed';
  by?: 'page' | 'coach';
  startedAt?: number;
  finishedAt?: number;
  summary?: string;
  error?: string;
}

export interface RefreshOutcome { error: string | null; summary?: string }

/** A fuel write (docs/DESIGN.md (fuelling and score) §7): the log of one session, or the setup answers. */
export type FuelAction = 'log' | 'setup';
export interface FuelOutcome { error: string | null; summary?: string }

export interface Deps {
  mode: 'coach' | 'standalone' | 'fixtures';
  port: number;
  /** The launch token, or null when this mode serves only synthetic data (fixtures, --no-token). */
  token: () => string | null;
  devOrigin?: string;
  who: () => Who | null;
  book: RequestBook;
  coach: () => Coach | null;
  views: (name: string, arg: string | null) => Promise<unknown>;
  recordConfirm: (planHash: string) => Promise<string | null>;  // error, or null when recorded
  refresh: (() => Promise<RefreshOutcome>) | null;
  /** Writes the athlete's fuel through scripts/fuel.py — no model, as a refresh. Null where nothing may be written. */
  fuel?: ((action: FuelAction, body: Record<string, unknown>) => Promise<FuelOutcome>) | null;
  /** What the coach is doing outside any request (the startup daily), or null. */
  status?: () => CoachStatus | null;
  staticDir?: string;
  onChange?: () => void;                                         // persist the book
  /** True when this server's own code changed after it started: the page says to restart the coach. */
  outdated?: () => boolean;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.ico': 'image/x-icon',
};

export class Events {
  #listeners = new Set<ServerResponse>();
  add(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(': connected\n\n');
    this.#listeners.add(res);
    const keepalive = setInterval(() => res.write(': ping\n\n'), 15_000);
    req.on('close', () => {
      clearInterval(keepalive);
      this.#listeners.delete(res);
    });
  }
  emit(event: string, data: unknown): void {
    const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of this.#listeners) res.write(chunk);
  }
}

/** For a person who opened an old link (docs/DESIGN.md (app audit) M6): what happened, and what to do — not JSON. */
const ENDED_PAGE = (why: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenSportCoach · open it from the coach</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07090B;color:#F1F3F4;font:16px/1.5 -apple-system,Helvetica,Arial,sans-serif}
main{max-width:460px;padding:32px}h1{font-size:28px;margin:0 0 12px}p{color:#AEB6BD;margin:0 0 12px}code{background:#14181C;padding:2px 6px;border-radius:6px;color:#F1F3F4}</style></head>
<body><main><h1>Open the app from your coach session</h1><p>${why}</p><p>Use the link from your newest coach session — it opens the app by itself. No session running? In a terminal: <code>./scripts/coach.sh</code></p></main></body></html>`;

function wantsPage(req: IncomingMessage, url: URL): boolean {
  return req.method === 'GET' && !url.pathname.startsWith('/api/') && String(req.headers.accept ?? '').includes('text/html');
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    if (!String(req.headers['content-type'] ?? '').includes('application/json')) return reject(new Error('send JSON'));
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        resolve(typeof v === 'object' && v && !Array.isArray(v) ? v : {});
      } catch {
        reject(new Error('body is not JSON'));
      }
    });
    req.on('error', reject);
  });
}

export function createHandler(d: Deps, events: Events) {
  const refresh: RefreshState = { state: 'idle' };
  const setRefresh = (r: RefreshState) => {
    Object.assign(refresh, { by: undefined, startedAt: undefined, finishedAt: undefined, summary: undefined, error: undefined }, r);
    events.emit('refresh', refresh);
  };
  const changed = (r: AppRequest) => {
    events.emit('request', r);
    d.onChange?.();
  };

  function serveStatic(path: string, res: ServerResponse): boolean {
    if (!d.staticDir || !existsSync(join(d.staticDir, 'index.html'))) return false;
    const rel = normalize(path).replace(/^(\.\.[/\\])+/, '');
    let file = join(d.staticDir, rel);
    if (!file.startsWith(d.staticDir) || !existsSync(file) || statSync(file).isDirectory()) {
      file = join(d.staticDir, 'index.html');   // the SPA routes everything else
    }
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': file.endsWith('index.html') ? 'no-store' : 'public, max-age=31536000, immutable',
      'X-Frame-Options': 'DENY',
    });
    res.end(readFileSync(file));
    return true;
  }

  const handle = async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const refused = gate(req.headers, d.port, d.devOrigin);
    const who = d.who();
    if (refused || !who) return send(res, 403, { error: refused ?? 'not attached yet' });
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${d.port}`);
    const token = d.token();

    if (token !== null) {
      if (req.method === 'GET' && url.pathname === '/' && url.searchParams.has('t')) {
        if (!sameToken(url.searchParams.get('t') ?? '', token)) {
          if (wantsPage(req, url)) {
            res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' });
            return void res.end(ENDED_PAGE('It belongs to a coach session that has ended, or a newer session has started since.'));
          }
          return send(res, 401, { error: 'stale link' });
        }
        res.writeHead(303, { Location: '/', 'Set-Cookie': `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`, 'Cache-Control': 'no-store' });
        return void res.end();
      }
      if (!sameToken(cookieToken(req.headers), token)) {
        if (wantsPage(req, url)) {
          res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' });
          return void res.end(ENDED_PAGE(cookieToken(req.headers)
            ? 'This window was opened by a coach session that has ended — the app now belongs to a newer one.'
            : 'The app opens from the link your coach session gives you: it carries the key to this window.'));
        }
        return send(res, 401, { error: 'session_ended' });
      }
    }

    const coach = d.coach();
    if (req.method === 'GET' && url.pathname === '/api/state') {
      return send(res, 200, { ...who, mode: d.mode, coach: coach ? 'online' : 'offline', requests: d.book.all(),
        status: coach ? d.status?.() ?? null : null, refresh, outdated: d.outdated?.() ?? false });
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/views/')) {
      const name = decodeURIComponent(url.pathname.slice('/api/views/'.length));
      const arg = url.searchParams.get('arg');
      const bad = checkView(name, arg);
      if (bad) return send(res, 400, { error: bad });
      try {
        return send(res, 200, await d.views(name, arg));
      } catch (err) {
        return send(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
    }
    if (req.method === 'GET' && url.pathname === '/api/events') return events.add(req, res);

    if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
      const body = await readJson(req).catch((e: Error) => ({ __error: e.message }));
      if ('__error' in body) return send(res, 400, { error: body.__error });

      if (url.pathname === '/api/requests') {
        if (!coach) return send(res, 409, { error: 'The coach is offline — the app is read-only. Start it with scripts/coach.sh.' });
        const kind = String(body.kind ?? 'question');
        const text = String(body.text ?? '').trim();
        if (!text) return send(res, 400, { error: 'empty request' });
        if (text.length > 4000) return send(res, 400, { error: 'request too long' });
        const params = typeof body.params === 'object' && body.params && !Array.isArray(body.params)
          ? body.params as Record<string, unknown> : undefined;
        const bad = checkRequest(kind, params);
        if (bad) return send(res, 400, { error: bad });
        const r = d.book.add(kind, text, params);
        await coach.send(r);
        changed(r);
        return send(res, 201, r);
      }
      if (url.pathname === '/api/confirm') {
        if (!coach) return send(res, 409, { error: 'The coach is offline — nothing can be sent to the watch.' });
        const plan = String(body.plan_hash ?? '');
        if (!d.book.isPublishedPlan(plan)) {
          return send(res, 409, { error: 'That plan is not one the coach showed in this session. Ask for a new dry run.' });
        }
        const error = await d.recordConfirm(plan);
        if (error) return send(res, 422, { error });
        const r = d.book.add('confirm', `Send to watch — plan ${plan}`, { plan_hash: plan });
        await coach.send(r, { plan_hash: plan });
        changed(r);
        return send(res, 201, r);
      }
      if (url.pathname === '/api/actions/refresh') {
        if (!d.refresh) return send(res, 409, { error: 'Refresh is not available in this mode.' });
        // A second press while one runs joins it: the page already shows its progress.
        if (refresh.state === 'running') return send(res, 202, refresh);
        const startedAt = Date.now();
        setRefresh({ state: 'running', by: 'page', startedAt });
        const out = await d.refresh().catch((e: Error) => ({ error: e.message, summary: undefined }));
        setRefresh({ state: out.error ? 'failed' : 'done', by: 'page', startedAt, finishedAt: Date.now(),
          summary: out.summary, error: out.error ?? undefined });
        return send(res, out.error ? 500 : 200, refresh);
      }
      if (url.pathname === '/api/actions/fuel' || url.pathname === '/api/actions/fuel-setup') {
        if (!d.fuel) return send(res, 409, { error: 'Fuel can’t be saved in this mode.' });
        const action: FuelAction = url.pathname.endsWith('-setup') ? 'setup' : 'log';
        const bad = action === 'log' ? checkFuelLog(body) : checkFuelSetup(body);
        if (bad) return send(res, 400, { error: bad });
        const out = await d.fuel(action, body as Record<string, unknown>).catch((e: Error) => ({ error: e.message, summary: undefined }));
        if (out.error) return send(res, 422, { error: out.error });
        // Every open window re-reads its views: the Fuel card, Today's items, the Workouts list.
        events.emit('data', { what: `fuel-${action}`, at: Date.now() });
        return send(res, 200, { ok: true, summary: out.summary ?? null });
      }
      return send(res, 404, { error: 'not found' });
    }

    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
      if (serveStatic(url.pathname, res)) return;
      if (url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' });
        return void res.end(PAGE);
      }
    }
    return send(res, 404, { error: 'not found' });
  };
  /** The coach session refreshed the data itself (app_status data_changed): tell every tab. */
  const coachRefreshed = (summary: string) => setRefresh({ state: 'done', by: 'coach', finishedAt: Date.now(), summary });
  return Object.assign(handle, { coachRefreshed });
}
