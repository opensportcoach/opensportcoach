import { StrictMode, lazy, Suspense, useEffect, useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useScrollOnNavigate } from './lib/scroll';
import './styles.css';
import { ENDED, StoreProvider, useStore } from './lib/api';
import { CoachButton, Dock, Header, Sidebar } from './components/Shell';
import { SendToWatch } from './components/SendToWatch';
import { Tooltip } from './components/Tooltip';
import { ErrorBox, IC, Icon, Skeleton } from './components/ui';

const Today = lazy(() => import('./screens/Today'));
const Workouts = lazy(() => import('./screens/Workouts'));
const Workout = lazy(() => import('./screens/Workout'));
const Exercise = lazy(() => import('./screens/Exercise'));
const Plan = lazy(() => import('./screens/Plan'));
const ProposalReview = lazy(() => import('./screens/ProposalReview'));
const Recovery = lazy(() => import('./screens/Recovery'));
const Load = lazy(() => import('./screens/Load'));
const Strength = lazy(() => import('./screens/Strength'));
const Program = lazy(() => import('./screens/Program'));
const Season = lazy(() => import('./screens/Season'));
const Race = lazy(() => import('./screens/Race'));
const Coach = lazy(() => import('./screens/Coach'));
const Body = lazy(() => import('./screens/Body'));
const About = lazy(() => import('./screens/About'));
const Fuel = lazy(() => import('./screens/Fuel'));
const FuelSetup = lazy(() => import('./screens/FuelSetup'));
const FuelCue = lazy(() => import('./screens/FuelCue'));

function readTheme(): string {
  try { return localStorage.getItem('adn-theme') ?? 'dark'; } catch { return 'dark'; }
}

/** "#9DC4EE" → the accent and its 14 % tint, as the boards define --id / --idt. */
function accentVars(hex: string | null | undefined, light: boolean): CSSProperties {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return {};
  let [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  // The light theme needs a darker shade of the same accent to keep its contrast (the boards'
  // .adn.light.sam pairs #9DC4EE with #2B64A3).
  if (light) [r, g, b] = [r, g, b].map((c) => Math.round(c * 0.42));
  return { ['--id' as string]: `rgb(${r},${g},${b})`, ['--idt' as string]: `rgba(${r},${g},${b},${light ? '.10' : '.14'})` };
}

/** This window belongs to a coach session that has ended; a newer one owns the app now. */
function SessionEnded() {
  return (
    <section className="card" style={{ maxWidth: 560, gap: 12, padding: '28px 32px' }}>
      <span className="l" style={{ color: 'var(--tx)' }}>Session ended</span>
      <span className="n" style={{ fontSize: 34, fontWeight: 700 }}>This window is from an earlier coach session</span>
      <span style={{ fontSize: 15, color: 'var(--tx2)', lineHeight: 1.5 }}>
        A newer session owns the app now, so this window can’t read or ask anything. Close it and use the window the newest
        session opened — or, if none is running, start one in a terminal: <code>./scripts/coach.sh</code>
      </span>
    </section>
  );
}

function Layout() {
  useScrollOnNavigate();
  const { state, error, dockOpen, setDockOpen } = useStore();
  const [theme, setTheme] = useState(readTheme);
  const loc = useLocation();
  useEffect(() => {
    try { localStorage.setItem('adn-theme', theme); } catch { /* a private window: the theme just doesn't persist */ }
    document.documentElement.dataset.theme = theme;   // the page behind the app, and the browser's controls (styles.css)
  }, [theme]);
  // The coach stopped for how they feel: the tab says so, for a page left in the background.
  useEffect(() => {
    document.title = !state ? 'OpenSportCoach' : `${state.status?.ask === 'feel' && state.coach === 'online' ? 'How do you feel? · ' : ''}OpenSportCoach · ${state.display}`;
  }, [state]);
  // The coach panel (narrow windows) closes when you go somewhere, or on Escape.
  useEffect(() => { setDockOpen(false); }, [loc.pathname, loc.hash, setDockOpen]);
  useEffect(() => {
    if (!dockOpen) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDockOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dockOpen, setDockOpen]);
  return (
    <div className={`adn${theme === 'light' ? ' light' : ''}`} style={accentVars(state?.accent, theme === 'light')}>
      <Header />
      <div className="shell">
        <div className="side"><Sidebar theme={theme} setTheme={setTheme} /></div>
        <main className="main">
          {state?.outdated && state.mode === 'coach' && (
            <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 12, border: '1px solid var(--y)', background: 'var(--yt)', fontSize: 14 }}>
              <Icon d={IC.refresh} size={16} sw={2} style={{ color: 'var(--y)' }} />
              <span><b>The app was updated after this coach session started.</b> Some buttons may not work until you restart it: quit the coach (<code>/exit</code>) and run <code>./scripts/coach.sh</code> again.</span>
            </div>
          )}
          {error === ENDED ? <SessionEnded /> : error && !state ? <ErrorBox error={`Can't reach the app's server: ${error}`} /> : (
            <Suspense fallback={<Skeleton h={480} />}><Outlet /></Suspense>
          )}
        </main>
        {/* Wide windows: a sticky column. Narrow ones: a panel the Coach button opens (docs/DESIGN.md (app audit) U1). */}
        <div id="dock" className={`dock${dockOpen ? ' open' : ''}`}><Dock /></div>
        <div className={`dock-scrim${dockOpen ? ' open' : ''}`} aria-hidden="true" onClick={() => setDockOpen(false)} />
        <CoachButton />
      </div>
      <SendToWatch />
      <Tooltip />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Today />} />
            <Route path="season" element={<Season />} />
            <Route path="race/:id" element={<Race />} />
            <Route path="workouts" element={<Workouts />} />
            <Route path="workouts/:id" element={<Workout />} />
            <Route path="exercise/:cat/:name" element={<Exercise />} />
            <Route path="plan" element={<Plan />} />
            <Route path="plan/proposal/:id" element={<ProposalReview />} />
            <Route path="fuel" element={<Fuel />} />
            <Route path="fuel/setup" element={<FuelSetup />} />
            <Route path="fuel/cue" element={<FuelCue />} />
            <Route path="recovery" element={<Recovery />} />
            <Route path="load" element={<Load />} />
            <Route path="strength" element={<Strength />} />
            <Route path="program" element={<Program />} />
            <Route path="coach" element={<Coach />} />
            <Route path="body" element={<Body />} />
            <Route path="about" element={<About />} />
            <Route path="*" element={<ErrorBox error="No such page." />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </StoreProvider>
  </StrictMode>,
);
