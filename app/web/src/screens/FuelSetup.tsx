/** Fuel setup (board Fuel-Setup, handoff 2026-11-07): the four questions asked when a session is first
 * bound to the athlete — products, bottles, gut, caffeine — answerable or changeable here. */
import { Link } from 'react-router-dom';
import { PageTitle } from '../components/ui';
import { FuelSetupDialog } from '../components/FuelSetup';

export default function FuelSetup() {
  return (
    <>
      <nav aria-label="Breadcrumb" style={{ display: 'flex', gap: 8, fontSize: 13, color: 'var(--tx2)' }}>
        <Link to="/fuel" className="link">Fuel</Link><span aria-hidden="true">/</span><span aria-current="page" style={{ color: 'var(--tx)' }}>Setup</span>
      </nav>
      <PageTitle eyebrow="Fuel" title="Your fuel setup" />
      <FuelSetupDialog page />
    </>
  );
}
