/**
 * Every hover tip in the app, drawn once at the top of the page. Elements carry their text in
 * `data-tip`; this follows the pointer and keyboard focus to the nearest one.
 *
 * WHY not a CSS ::after on the element (the first version): each card fades in with a transform
 * animation, which makes it its own stacking context, so a tip could never rise above the NEXT card
 * ("Recovery" drew behind the HRV box), and tips near an edge ran off the screen. Here the tip is
 * position: fixed above everything, flips above its anchor when there is no room below, and is
 * clamped inside the viewport.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { parseTip, sourceOf } from '../lib/tip';

const GAP = 6;
const MARGIN = 8;

export function Tooltip() {
  const [tip, setTip] = useState<{ text: string; anchor: DOMRect } | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let current: HTMLElement | null = null;
    const show = (target: EventTarget | null) => {
      const el = (target instanceof Element ? target.closest('[data-tip]') : null) as HTMLElement | null;
      if (el === current) return;
      current = el;
      const text = el?.dataset.tip?.trim();
      setPos(null);
      setTip(el && text ? { text, anchor: el.getBoundingClientRect() } : null);
    };
    const hide = () => { current = null; setTip(null); };
    const onOver = (e: PointerEvent) => show(e.target);
    const onFocus = (e: FocusEvent) => show(e.target);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hide(); };
    document.addEventListener('pointerover', onOver);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', hide);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, []);

  // Measure, then place: below the anchor, or above it when it would leave the screen.
  useLayoutEffect(() => {
    if (!tip || !box.current) return;
    const { width, height } = box.current.getBoundingClientRect();
    const a = tip.anchor;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top = a.bottom + GAP;
    if (top + height > vh - MARGIN && a.top - GAP - height >= MARGIN) top = a.top - GAP - height;
    top = Math.min(Math.max(top, MARGIN), Math.max(MARGIN, vh - height - MARGIN));   // never off screen
    const left = Math.min(Math.max(a.left, MARGIN), Math.max(MARGIN, vw - width - MARGIN));
    setPos({ left, top });
  }, [tip]);

  if (!tip) return null;
  const x = parseTip(tip.text);
  const src = sourceOf(x.s);
  return (
    <div ref={box} role="tooltip" className="tip"
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}>
      {x.t && <div className="tip-t">{x.c && <span className="tip-dot" style={{ background: x.c }} />}{x.t}</div>}
      {x.r && (
        <div className="tip-r">
          {x.r.map(([l, v, c], i) => (
            <div key={i} className="tip-row">
              <span className="tip-sw" style={{ background: c ?? 'transparent' }} />
              <span className="tip-l">{l}</span>
              <span className="tip-v">{v}</span>
            </div>
          ))}
        </div>
      )}
      {x.n?.map((n, i) => <p key={i} className="tip-n">{n}</p>)}
      {x.h && <div className="tip-h">{x.h}</div>}
      {src && <div className="tip-s"><span className="tip-dot" style={{ background: src[1] }} />{src[0]}</div>}
    </div>
  );
}
