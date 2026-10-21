// Settings kept in local storage and shared by every Shade window. A change in the
// settings window is announced to the overlays with an event.
import { emit } from './api.js';

const KEY = 'shade:prefs';
export const COLORS = {
  black: [8, 9, 12],
  midnight: [16, 22, 40],
  forest: [12, 26, 20],
  frost: [236, 238, 243],
};
export const DEFAULTS = {
  dim: 0.9, // how dark the shade is, 0..1
  color: 'black',
  radius: 220, // spotlight radius in px
  softness: 0.55, // 0 sharp edge .. 1 very soft
  band: 160, // reading band height in px
  curtainMessage: 'Back in a moment',
  curtainClock: true,
};

export function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function save(prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {}
  emit('shade://prefs', prefs);
}
