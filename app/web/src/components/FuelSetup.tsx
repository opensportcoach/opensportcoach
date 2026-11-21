/**
 * The fuel setup (docs/DESIGN.md (fuelling and score) §3, §6.7): the four questions asked the first time a session is
 * bound to the athlete, answerable here too — which products, how a bottle is mixed, what the gut takes
 * today, caffeine. The catalog is the shared, verified one (nutrition/PRODUCTS.json): each product shows
 * the page it was read from and when. A product that isn't listed goes to the coach, who reads it off the
 * maker's page — never typed in here. Saved through the server's fuel action (scripts/fuel.py setup).
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useStore, useView } from '../lib/api';
import { tip } from '../lib/fmt';
import { IC, Icon, Skeleton } from './ui';
import { Mark, type Display } from './Fuel';

interface Product {
  id: string; brand: string; name: string; form: 'gel' | 'drink_mix' | 'bar' | 'chew'; carbs_g?: number; carbs_per_100g?: number;
  serving_g?: number; glucose_fructose?: string | null; caffeine_mg?: number | null; source: string; source_kind: string; checked: string;
  max_g_per_h?: number; max_g_per_session?: number; easy_only?: boolean; note?: string; display?: Display;
}
interface Recipe { id: string; label?: string; product: string; powder_g: number; water_ml: number; g_each?: number | null }

const GUT = [[0, 'None'], [30, 'About 30'], [45, 'About 45'], [60, 'About 60'], [75, 'About 75'], [90, 'About 90']] as const;
const CAFFEINE: [string, string][] = [['never', 'Never'], ['races', 'Races only'], ['training', 'Training too']];
const FORM: Record<string, string> = { gel: 'Gel', drink_mix: 'Drink mix', bar: 'Bar', chew: 'Chews' };
const field: CSSProperties = { minHeight: 38, padding: '0 10px', borderRadius: 10, border: '1px solid var(--ln2)', background: 'var(--bg)', color: 'var(--tx)', fontSize: 14 };

const carbsOf = (p: Product) => p.form === 'drink_mix' ? `${p.carbs_per_100g} g carbohydrate per 100 g of powder` : `${p.carbs_g} g carbohydrate${p.serving_g ? ` in ${p.serving_g} g` : ''}`;

/** The setup form: a dialog over a screen, or (`page`) the body of the Fuel setup page (board Fuel-Setup). */
export function FuelSetupDialog({ close, page }: { close?: () => void; page?: boolean }) {
  const { data, error } = useView('fuel');
  const { state, fuel, ask } = useStore();
  const offline = state?.coach !== 'online';
  const box = useRef<HTMLElement>(null);
  const [owned, setOwned] = useState<string[] | null>(null);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [gut, setGut] = useState<number | null>(null);
  const [caffeine, setCaffeine] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!data || owned) return;
    setOwned(data.products ?? []);
    setRecipes((data.recipes ?? []).map((r: Recipe) => ({ ...r })));
    setGut(data.gut?.g_per_h ?? null);
    setCaffeine(data.caffeine ?? null);
    setNotes(data.notes ?? '');
  }, [data, owned]);
  useEffect(() => {
    if (page || !close) return undefined;
    box.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const catalog: Product[] = data?.catalog ?? [];
  const byId = Object.fromEntries(catalog.map((p) => [p.id, p]));
  const mixes = (owned ?? []).filter((id) => byId[id]?.form === 'drink_mix');
  const toggle = (id: string) => {
    const on = !(owned ?? []).includes(id);
    setOwned(on ? [...(owned ?? []), id] : (owned ?? []).filter((x) => x !== id));
    // A drink mix brings its bottle with it: two of the maker's spoons in a bottle, until they say otherwise.
    if (on && byId[id]?.form === 'drink_mix' && !recipes.some((r) => r.product === id)) {
      setRecipes([...recipes, { id: `${id}-bottle`, label: 'Bottle', product: id, powder_g: byId[id].serving_g ?? 40, water_ml: 500 }]);
    }
    if (!on) setRecipes(recipes.filter((r) => r.product !== id));
  };
  const setRecipe = (i: number, k: 'powder_g' | 'water_ml', v: number) => setRecipes(recipes.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const save = () => {
    setBusy(true);
    setMsg(null);
    const answers = {
      products: owned ?? [],
      ...(mixes.length || recipes.length ? { recipes: recipes.filter((r) => mixes.includes(r.product)).map(({ id, label, product, powder_g, water_ml }) => ({ id, ...(label ? { label } : {}), product, powder_g, water_ml })) } : {}),
      ...(gut != null ? { gut } : {}),
      ...(caffeine ? { caffeine: caffeine as 'never' | 'races' | 'training' } : {}),
      notes: notes.trim() || null,
    };
    fuel('setup', answers).then((s) => setMsg({ ok: true, text: s ?? 'Saved.' }))
      .catch((e) => setMsg({ ok: false, text: `Not saved — ${String(e.message ?? e)}` })).finally(() => setBusy(false));
  };
  const askCoach = () => ask('question', `Add a fuel product to my setup: ${other.trim()}. Read it off the maker's page.`, { about: 'Fuel setup' })
    .then(() => { setOther(''); setMsg({ ok: true, text: 'Sent — the coach looks it up on the maker’s page and adds it.' }); })
    .catch((e) => setMsg({ ok: false, text: String(e.message ?? e) }));
  const open = (data?.questions ?? []).filter((q: any) => q.open).length;

  return (
    <section ref={box} role={page ? undefined : 'dialog'} aria-labelledby="fs-h" className="card" style={{ borderColor: page ? 'var(--ln)' : 'var(--o)', boxShadow: page ? 'none' : 'var(--sh)', borderRadius: 16, gap: 18, scrollMarginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <h2 id="fs-h" className="l" style={{ color: 'var(--o)' }}>Your fuel setup</h2>
          <span style={{ fontSize: 13, color: 'var(--tx2)' }}>{data ? (open ? `${open} of 4 questions still open.` : 'Complete — change anything below.') : ''}</span>
        </span>
        {close && <button type="button" aria-label="Close" onClick={close} style={{ width: 32, height: 32, border: 0, borderRadius: 8, background: 'transparent', color: 'var(--tx2)' }}>✕</button>}
      </div>
      {page && data && (
        <nav aria-label="Setup steps" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {(data.questions ?? []).map((q: any, i: number) => (
            <a key={q.id} href={`#q${i + 1}`} className="hv" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 34, padding: '0 12px', borderRadius: 999, border: `1px solid ${q.open ? 'var(--o)' : 'var(--ln2)'}`, color: 'var(--tx)', fontSize: 13, fontWeight: 600 }}>
              {q.open ? <span className="n" style={{ color: 'var(--o)' }}>{i + 1}</span> : <Icon d={IC.check} size={12} sw={3} style={{ color: 'var(--g)' }} />}
              {['Products', 'Bottles', 'Your gut', 'Caffeine'][i]}
            </a>
          ))}
        </nav>
      )}
      {error && <span role="alert" style={{ color: 'var(--r)', fontSize: 13 }}>Couldn’t read your setup ({error}).</span>}
      {!data && !error ? <Skeleton h={220} /> : data && (<>
        <fieldset id="q1" style={{ scrollMarginTop: 16, border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <legend className="l" style={{ fontSize: 11, color: 'var(--tx)', paddingBottom: 8 }}>1 · Which products do you use?</legend>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(240px, 100%), 1fr))', gap: 8 }}>
            {catalog.map((p) => {
              const on = (owned ?? []).includes(p.id);
              return (
                <label key={p.id} style={{ display: 'flex', gap: 10, padding: '10px 12px', borderRadius: 12, border: `1px solid ${on ? 'var(--o)' : 'var(--ln2)'}`, background: on ? 'var(--ot)' : 'transparent', cursor: 'pointer' }}>
                  <input type="checkbox" checked={on} onChange={() => toggle(p.id)} style={{ marginTop: 3 }} />
                  <Mark d={p.display} w={24} h={30} />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={{ fontSize: 14, fontWeight: 700 }}>{p.brand} {p.name}</span>
                    <span style={{ fontSize: 12, color: 'var(--tx2)' }}>{FORM[p.form]} · {carbsOf(p)}{p.glucose_fructose ? ` · glucose:fructose ${p.glucose_fructose}` : ''}</span>
                    {(p.max_g_per_h || p.easy_only) && <span style={{ fontSize: 12, color: 'var(--tx2)' }}>Maker’s limit: {[p.max_g_per_h ? `${p.max_g_per_h} g an hour` : null, p.max_g_per_session ? `${p.max_g_per_session} g a session` : null, p.easy_only ? 'easy sessions only' : null].filter(Boolean).join(' · ')}</span>}
                    <a href={p.source} target="_blank" rel="noopener noreferrer" className="link" style={{ fontSize: 11 }} data-tip={p.note ?? undefined}>
                      Read off the {p.source_kind === 'maker' ? 'maker’s page' : p.source_kind === 'label' ? 'label' : 'a listing'} · {p.checked}
                    </a>
                  </span>
                </label>
              );
            })}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <input type="text" value={other} onChange={(e) => setOther(e.target.value)} placeholder="Not listed? Name it — brand and product" aria-label="A product that isn't listed" style={{ ...field, flex: '1 1 240px' }} />
            <button type="button" className="btn2 hv" disabled={offline || !other.trim()} onClick={askCoach}><Icon d={IC.chat} size={14} sw={2} />Ask the coach to add it</button>
          </div>
        </fieldset>

        <fieldset id="q2" style={{ scrollMarginTop: 16, border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <legend className="l" style={{ fontSize: 11, color: 'var(--tx)', paddingBottom: 8 }}>2 · How do you mix a bottle?</legend>
          {!mixes.length ? <span style={{ fontSize: 13, color: 'var(--tx2)' }}>No drink mix ticked — nothing to mix.</span>
            : recipes.map((r, i) => mixes.includes(r.product) && (
              <div key={r.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 14 }}>
                <span style={{ fontWeight: 700, minWidth: 180 }}>{byId[r.product]?.brand} {byId[r.product]?.name}</span>
                <input type="number" min={1} max={200} value={r.powder_g} aria-label={`Grams of powder in a bottle of ${byId[r.product]?.name}`} onChange={(e) => setRecipe(i, 'powder_g', Number(e.target.value))} style={{ ...field, width: 80 }} />
                <span style={{ color: 'var(--tx2)' }}>g of powder in</span>
                <input type="number" min={100} max={1500} step={50} value={r.water_ml} aria-label={`Bottle size in ml for ${byId[r.product]?.name}`} onChange={(e) => setRecipe(i, 'water_ml', Number(e.target.value))} style={{ ...field, width: 90 }} />
                <span style={{ color: 'var(--tx2)' }}>ml</span>
                {r.g_each != null && <span className="n" style={{ color: 'var(--tx2)' }}>· {r.g_each} g carbohydrate a bottle</span>}
              </div>
            ))}
        </fieldset>

        <fieldset id="q3" style={{ scrollMarginTop: 16, border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <legend className="l" style={{ fontSize: 11, color: 'var(--tx)', paddingBottom: 8 }} data-tip={tip(data.defs, 'fuel_gut')} tabIndex={0}>3 · What do you take on a 2–3 hour ride today?</legend>
          <div role="radiogroup" aria-label="Grams of carbohydrate an hour" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {GUT.map(([v, l]) => {
              const on = gut === v;
              return <button key={v} type="button" role="radio" aria-checked={on} onClick={() => setGut(v)}
                style={{ minHeight: 36, padding: '0 12px', borderRadius: 999, border: `1px solid ${on ? 'var(--tx)' : 'var(--ln2)'}`, background: on ? 'var(--tx)' : 'transparent', color: on ? 'var(--on)' : 'var(--tx)', fontSize: 13, fontWeight: 600 }}>{l}{v ? ' g/h' : ''}</button>;
            })}
          </div>
          <span style={{ fontSize: 12, color: 'var(--tx3)' }}>Plans never ask for more than this; it goes up 10 g/h at a time, after a logged session at the current rate.{gut === 0 ? ` Taking none today starts the ramp at ${data.gut_start} g/h.` : ''}</span>
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder="Has anything upset your stomach? (optional)" aria-label="Stomach notes" style={field} />
        </fieldset>

        <fieldset id="q4" style={{ scrollMarginTop: 16, border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <legend className="l" style={{ fontSize: 11, color: 'var(--tx)', paddingBottom: 8 }}>4 · Caffeine?</legend>
          <div role="radiogroup" aria-label="Caffeine" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {CAFFEINE.map(([v, l]) => {
              const on = caffeine === v;
              return <button key={v} type="button" role="radio" aria-checked={on} onClick={() => setCaffeine(v)}
                style={{ minHeight: 36, padding: '0 12px', borderRadius: 999, border: `1px solid ${on ? 'var(--tx)' : 'var(--ln2)'}`, background: on ? 'var(--tx)' : 'transparent', color: on ? 'var(--on)' : 'var(--tx)', fontSize: 13, fontWeight: 600 }}>{l}</button>;
            })}
          </div>
        </fieldset>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <button type="button" className="btn" disabled={busy || !(owned ?? []).length} onClick={save}>{busy ? 'Saving…' : 'Save my setup'}</button>
          {msg && <span role={msg.ok ? 'status' : 'alert'} style={{ fontSize: 13, color: msg.ok ? 'var(--g)' : 'var(--r)' }}>{msg.text}</span>}
        </div>
      </>)}
    </section>
  );
}
