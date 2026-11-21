import { useEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/**
 * Where a page opens (2026-10-17, the flow review): at its top — a link clicked low on one page used to
 * open the next one as far down (the proposal review opened 1,100 px below its title) — or at its
 * #anchor, once that section has rendered (views load after the route: "See the constraint" used to
 * land at the top of Program). Back and forward keep the browser's own restore.
 */
export function useScrollOnNavigate() {
  const loc = useLocation();
  const kind = useNavigationType();
  useEffect(() => {
    if (kind === 'POP') return undefined;
    if (!loc.hash) { window.scrollTo(0, 0); return undefined; }
    const id = decodeURIComponent(loc.hash.slice(1));
    let tries = 0;
    const timer = setInterval(() => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ block: 'start' });   // instant: a page landing, not an animation
      if (el || ++tries > 40) clearInterval(timer);   // up to 4 s for the view behind it
    }, 100);
    return () => clearInterval(timer);
  }, [loc.pathname, loc.search, loc.hash, kind]);
}
