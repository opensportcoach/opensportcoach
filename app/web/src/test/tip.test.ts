/** Hover tips as cards (round 3): plain tips are read into the same structure as rich ones. */
import { describe, expect, it } from 'vitest';
import { parseTip, rich } from '../lib/tip';

describe('parseTip', () => {
  it('a definition: its sentence, and the source as the footer', () => {
    expect(parseTip('Average HRV across the night, from your watch.\nSource: Garmin.')).toEqual({ n: ['Average HRV across the night, from your watch.'], s: 'Garmin' });
  });
  it('a reading: a short first line becomes the title, "label: value" lines become rows', () => {
    expect(parseTip('11 Oct\nNightly HRV, ms: 61\n7-night average: 64')).toEqual({ t: '11 Oct', r: [['Nightly HRV, ms', '61'], ['7-night average', '64']] });
  });
  it('a click hint is set apart; a sentence with a colon stays a sentence', () => {
    const x = parseTip('Readiness is measured each morning. It is: not available for future days.\nClick to show it.');
    expect(x.h).toBe('Click to show it.');
    expect(x.r).toBeUndefined();
  });
  it('a rich tip round-trips', () => {
    const t = { t: 'Zone 2', c: 'var(--b)', r: [['Time', '12:00', 'var(--b)']] as [string, string, string][], s: 'Garmin' };
    expect(parseTip(rich(t))).toEqual(t);
  });
});
