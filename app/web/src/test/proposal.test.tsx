/** The plan proposal review (board Plan-Proposal, 2026-10-16): every change with its reason, the week now →
 * proposed, and where the proposal stands — waiting, requested, accepted, out of date, replaced. A revert
 * is never a partial accept: it becomes a plan request the server accepts. On the committed fixtures. */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { StoreCtx } from '../lib/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProposalReview from '../screens/ProposalReview';
import type { AppRequest } from '../lib/api';
import { atFixtureDay, fixtureSet, serveViews, show, store } from './harness';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const demo = fixtureSet('demo');
const plan = demo.result('plan_proposal');
const req = (over: Partial<AppRequest>): AppRequest => ({ id: 'r2', kind: 'workflow', text: 'Plan my week', state: 'DONE', createdAt: 10, ackedAt: 11, finishedAt: 140_000, progress: [], ...over });
const proposed = req({ result: { kind: 'plan_proposal', payload: plan } });
const at = `/plan/proposal/${plan.id}`;
const route = '/plan/proposal/:id';
const views = (today = demo.view('today')) => ({ today, calendar: demo.view('calendar') });
const asked = (s: ReturnType<typeof store>) => (s.ask as ReturnType<typeof vi.fn>).mock;

describe('Plan proposal review', () => {
  it('says what changes and why: the headline, the counts, each change with its reason, the program change under its session', async () => {
    atFixtureDay(demo.index.generated_on);
    serveViews(views());
    show(<ProposalReview />, store({}, { requests: [proposed] }), at, route);
    expect(await screen.findByRole('heading', { level: 1, name: plan.headline })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toMatch(/Waiting for you/);
    expect(screen.getByText(`proposal ${plan.version.n} of ${plan.version.of}`)).toBeTruthy();
    const counts = within(screen.getByRole('list', { name: 'What changes' }));
    expect(counts.getAllByRole('listitem').map((x) => x.textContent)).toEqual(['Δ4changed', '→1moved', '+1added', '−1removed', '=1unchanged']);
    for (const d of plan.days.filter((d: any) => d.change !== 'unchanged')) expect(screen.getAllByText(d.reason).length).toBeGreaterThan(0);
    expect(screen.getByText(plan.program_changes[0].exercise)).toBeTruthy();
    expect(screen.getByText('What the week becomes')).toBeTruthy();
    expect(screen.getByText('Checked against the rules')).toBeTruthy();
    expect(screen.getByText('3 hold · 1 near limit')).toBeTruthy();
    expect(screen.getByText('Proposed')).toBeTruthy();
  });

  it('accepts as one request naming the proposal', async () => {
    atFixtureDay(demo.index.generated_on);
    serveViews(views());
    const s = store({}, { requests: [proposed] });
    show(<ProposalReview />, s, at, route);
    fireEvent.click(await screen.findByRole('button', { name: 'Accept plan' }));
    expect(asked(s).calls[0].slice(0, 1).concat(asked(s).calls[0][2])).toEqual(['accept', { proposal: plan.id }]);
    await expect(asked(s).results[0].value).resolves.toBeTruthy();
  });

  it('a revert turns Accept into Ask for changes — a plan request for a new version, which the server accepts', async () => {
    atFixtureDay(demo.index.generated_on);
    serveViews(views());
    const s = store({}, { requests: [proposed] });
    show(<ProposalReview />, s, at, route);
    fireEvent.click(await screen.findByRole('button', { name: 'Keep it' }));
    expect(screen.queryByRole('button', { name: 'Accept plan' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ask for changes · 1 reverted' }));
    expect(screen.getByText(/Attached:/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send to the coach' }));
    const [kind, text, params] = asked(s).calls[0];
    expect(kind).toBe('plan');
    expect(params).toEqual({ proposal: plan.id, about: `Proposal ${plan.id}` });
    expect(text).toMatch(/keep Circuit · 5 rounds/);
    await expect(asked(s).results[0].value).resolves.toBeTruthy();
  });

  it('is out of date once data from a later day is in: no accept, a re-check instead', async () => {
    atFixtureDay(demo.index.generated_on);
    const today = demo.view('today');
    today.freshness.data_as_of = `${plan.days[0].date}T07:00:00`;
    serveViews(views(today));
    const s = store({}, { requests: [proposed] });
    show(<ProposalReview />, s, at, route);
    expect(await screen.findByText('Out of date', { selector: 'span[role=status]' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Accept plan' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Re-check with today’s data' }));
    expect(asked(s).calls[0][0]).toBe('plan');
    await expect(asked(s).results[0].value).resolves.toBeTruthy();
  });

  it('while a new version is written it says so, and a newer proposal replaces it', async () => {
    atFixtureDay(demo.index.generated_on);
    serveViews(views());
    const asking = req({ id: 'r3', kind: 'plan', text: 'Change the proposal: keep the circuit.', params: { proposal: plan.id }, state: 'WORKING', createdAt: 200_000 });
    show(<ProposalReview />, store({}, { requests: [proposed, asking] }), at, route);
    expect(await screen.findByText('A new version is being written')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Accept plan' })).toBeNull();
    cleanup();
    const v3 = req({ id: 'r4', createdAt: 300_000, result: { kind: 'plan_proposal', payload: { ...plan, id: 'plan-next-week-3' } } });
    show(<ProposalReview />, store({}, { requests: [proposed, { ...asking, state: 'DONE' }, v3] }), at, route);
    expect((await screen.findByRole('link', { name: /Open the newer proposal/ })).getAttribute('href')).toBe('/plan/proposal/plan-next-week-3');
  });

  it('reads an older proposal that says only changed or not', async () => {
    atFixtureDay(demo.index.generated_on);
    serveViews(views());
    const old = { kind: 'plan_proposal', request_id: 'r2', id: 'old', title: 'Next week', needs_push: false, program_changes: [],
      days: [{ date: plan.days[0].date, type: 'session', title: 'D1 · Push', changed: true }, { date: plan.days[1].date, type: 'rest', title: 'Rest' }] };
    show(<ProposalReview />, store({}, { requests: [req({ result: { kind: 'plan_proposal', payload: old as never } })] }), '/plan/proposal/old', route);
    expect(await screen.findByRole('heading', { level: 1, name: 'Next week' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Accept plan' })).toBeTruthy();
  });

  it('a new version under the same id starts clean: the reverts made on the old one are not carried over', async () => {
    atFixtureDay(demo.index.generated_on);
    serveViews(views());
    const tree = (requests: AppRequest[]) => (
      <StoreCtx.Provider value={store({}, { requests })}>
        <MemoryRouter initialEntries={[at]}><Routes><Route path={route} element={<ProposalReview />} /></Routes></MemoryRouter>
      </StoreCtx.Provider>
    );
    const { rerender } = render(tree([proposed]));
    fireEvent.click(await screen.findByRole('button', { name: 'Keep it' }));
    expect(screen.getByRole('button', { name: 'Ask for changes · 1 reverted' })).toBeTruthy();
    const asking = req({ id: 'r3', kind: 'plan', text: 'Change the proposal: keep the circuit.', params: { proposal: plan.id }, state: 'DONE', createdAt: 200_000 });
    const v3 = req({ id: 'r4', createdAt: 300_000, result: { kind: 'plan_proposal', payload: { ...plan, version: { n: 3, of: 3, note: null } } } });
    rerender(tree([proposed, asking, v3]));
    expect(await screen.findByText('proposal 3 of 3')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Accept plan' })).toBeTruthy();
    expect(screen.queryByText('↶ you reverted this')).toBeNull();
  });
});
