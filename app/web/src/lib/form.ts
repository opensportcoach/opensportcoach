/**
 * Form — fitness − fatigue, from Garmin's heart-rate load (export_dashboard_data.fitness_model) — in
 * words (R4): the usual training-stress-balance ranges. Shared by Today's tile and Training load.
 * It reads heart rate, so lifting barely moves it; strength is read by tonnage and sets.
 */
export const FORM_ZONES: { from: number; to: number; word: string; means: string; col: string; tint: string }[] = [
  { from: 25, to: 1e9, word: 'Detraining', means: 'very fresh — fitness is slipping', col: 'var(--y)', tint: 'var(--yt)' },
  { from: 5, to: 25, word: 'Fresh', means: 'rested — ready for a hard day or a test', col: 'var(--g)', tint: 'var(--gt)' },
  { from: -10, to: 5, word: 'Neutral', means: 'load and recovery in balance', col: 'var(--tx2)', tint: 'transparent' },
  { from: -30, to: -10, word: 'Building', means: 'productive fatigue — training is adding fitness', col: 'var(--b)', tint: 'var(--bt)' },
  { from: -1e9, to: -30, word: 'Overreaching', means: 'fatigue well above fitness — recover soon', col: 'var(--r)', tint: 'var(--rt)' },
];
export const formZone = (v: number | null | undefined) => (v == null ? null : FORM_ZONES.find((z) => v >= z.from && v < z.to) ?? null);

