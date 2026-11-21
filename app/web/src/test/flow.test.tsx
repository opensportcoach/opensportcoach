/** Navigation and flow (2026-10-17, the flow review): where a page opens, one Send-to-watch state on every
 * button, the dock linking to the result itself, and a session linked from Today opening on its own week. */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import Today from '../screens/Today';
import Plan from '../screens/Plan';
import { Dock } from '../components/Shell';
import { WatchSendButton } from '../components/WatchSend';
import { useScrollOnNavigate } from '../lib/scroll';
import type { AppRequest } from '../lib/api';
import { atFixtureDay, fixtureSet, serveViews, show, store } from './harness';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const demo = fixtureSet('demo');
const at = (iso: string, h = 9) => new Date(`${iso}T${String(h).padStart(2, '0')}:00:00`).getTime();
const req = (over: Partial<AppRequest>): AppRequest => ({ id: 'r1', kind: 'push', text: 'Send the pending changes to the watch', state: 'DONE', createdAt: 1, finishedAt: 2, progress: [], ...over });

describe('Where a page opens', () => {
  it('at its top on a link, at its #anchor once that section renders', async () => {
    const scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);
    const into = vi.spyOn(Element.prototype, 'scrollIntoView');
    function Late() {   // a section that renders after its view loads
      const [shown, setShown] = useState(false);
      setTimeout(() => setShown(true), 250);
      return shown ? <h2 id="cn">Locked constraint</h2> : null;
    }
    function Shell() {
      useScrollOnNavigate();
      return <><Link to="/b">to b</Link><Link to="/c#cn">to c</Link><Routes><Route path="/" element={null} /><Route path="/b" element={null} /><Route path="/c" element={<Late />} /></Routes></>;
    }
    render(<MemoryRouter initialEntries={['/']}><Shell /></MemoryRouter>);
    scrollTo.mockClear();
    fireEvent.click(screen.getByText('to b'));
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    fireEvent.click(screen.getByText('to c'));
    // The section renders late; the hook keeps looking until it is there (outside act, so React paints it).
    await screen.findByText('Locked constraint');
    await new Promise((r) => setTimeout(r, 250));
    expect(into.mock.contexts.some((el) => (el as Element).id === 'cn')).toBe(true);
    into.mockRestore();
  });
});

describe('Send to watch, one state everywhere', () => {
  it('asks for a dry run, waits while it is prepared, then reopens the waiting card — never a second dry run', async () => {
    atFixtureDay(demo.index.generated_on);
    const day = demo.index.generated_on;
    const s1 = store();
    show(<WatchSendButton />, s1);
    fireEvent.click(screen.getByRole('button', { name: 'Send to watch' }));
    expect((s1.ask as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('push');
    cleanup();

    show(<WatchSendButton showNote />, store({}, { requests: [req({ state: 'WORKING', createdAt: at(day) })] }));
    expect((screen.getByRole('button', { name: 'Preparing…' }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();

    const plan = req({ createdAt: at(day), result: { kind: 'push_plan', payload: demo.result('push_plan') } });
    const s3 = store({}, { requests: [plan] });
    show(<WatchSendButton />, s3);
    fireEvent.click(screen.getByRole('button', { name: 'Open the card' }));
    expect(s3.openSendToWatch).toHaveBeenCalledWith(plan);
    expect(s3.ask).not.toHaveBeenCalled();
    cleanup();

    // Confirmed: nothing is waiting any more.
    const confirm = req({ id: 'r2', kind: 'confirm', params: { plan_hash: demo.result('push_plan').plan_hash }, createdAt: at(day, 10) });
    show(<WatchSendButton />, store({}, { requests: [plan, confirm] }));
    expect(screen.getByRole('button', { name: 'Send to watch' })).toBeTruthy();
  });

  it('on Today, the rail and the week agree once a dry run is waiting', async () => {
    atFixtureDay(demo.index.generated_on);
    serveViews({ today: demo.view('today'), calendar: demo.view('calendar') });
    const plan = req({ createdAt: at(demo.index.generated_on), result: { kind: 'push_plan', payload: demo.result('push_plan') } });
    show(<Today />, store({}, { requests: [plan] }));
    const hero = (await screen.findByRole('heading', { level: 1 })).closest('section')!;
    expect(within(hero).getByRole('button', { name: 'Open the card' })).toBeTruthy();
    const week = screen.getByRole('heading', { name: /^This week · / }).closest('section')!;
    expect(within(week).getByRole('button', { name: 'Open the card' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send to watch' })).toBeNull();
  });
});

describe('The dock links to the result itself', () => {
  it('a proposal opens its review; a waiting dry run reopens its card', () => {
    atFixtureDay(demo.index.generated_on);
    const plan = demo.result('plan_proposal');
    show(<Dock />, store({}, { requests: [req({ kind: 'workflow', text: 'Plan my week', result: { kind: 'plan_proposal', payload: plan } })] }));
    expect(screen.getByText(/^A plan to review: /)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Review it' }).getAttribute('href')).toBe(`/plan/proposal/${plan.id}`);
    cleanup();
    const dry = req({ createdAt: at(demo.index.generated_on), result: { kind: 'push_plan', payload: demo.result('push_plan') } });
    const s = store({}, { requests: [dry] });
    show(<Dock />, s);
    fireEvent.click(screen.getByRole('button', { name: 'Open the card' }));
    expect(s.openSendToWatch).toHaveBeenCalledWith(dry);
  });
});

describe('A session linked from Today', () => {
  it('opens Plan on its own week when the link names its date', async () => {
    atFixtureDay(demo.index.generated_on);
    serveViews({ calendar: demo.view('calendar'), program: demo.view('program') });
    const later = new Date(at(demo.index.generated_on) + 7 * 864e5).toISOString().slice(0, 10);
    show(<Plan />, store(), `/plan?watch=d1&date=${later}`, '/plan');
    expect((await screen.findByText(/next week$/))).toBeTruthy();
  });
});
