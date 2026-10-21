// The settings window: pick a mode and tune how the shade looks.
import { call, listen, native, autostart } from './api.js';
import { load, save } from './prefs.js';

let prefs = load();
const $ = (id) => document.getElementById(id);

function update(patch) {
  prefs = { ...prefs, ...patch };
  save(prefs);
  render();
}

const NAMES = { off: 'Off', spotlight: 'Spotlight on', window: 'Window on', band: 'Reading band on', curtain: 'Curtain down' };

function showMode(mode) {
  for (const b of document.querySelectorAll('#modes button')) b.setAttribute('aria-checked', String(b.dataset.mode === mode));
  $('state').textContent = NAMES[mode] || 'Off';
  $('state').classList.toggle('live', mode !== 'off');
}

function render() {
  $('dim').value = prefs.dim;
  $('softness').value = prefs.softness;
  $('radius').value = prefs.radius;
  $('band').value = prefs.band;
  if (document.activeElement !== $('message')) $('message').value = prefs.curtainMessage;
  $('clock').checked = prefs.curtainClock;
  for (const b of document.querySelectorAll('.colors button')) b.setAttribute('aria-checked', String(b.dataset.color === prefs.color));
}

for (const b of document.querySelectorAll('#modes button')) {
  b.addEventListener('click', () => {
    showMode(b.dataset.mode);
    call('set_mode', { mode: b.dataset.mode });
  });
}
for (const b of document.querySelectorAll('.colors button')) b.addEventListener('click', () => update({ color: b.dataset.color }));
for (const id of ['dim', 'softness', 'radius', 'band']) $(id).addEventListener('input', (e) => update({ [id]: Number(e.target.value) }));
$('message').addEventListener('input', (e) => update({ curtainMessage: e.target.value }));
$('clock').addEventListener('change', (e) => update({ curtainClock: e.target.checked }));
$('autostart').addEventListener('change', (e) => autostart.set(e.target.checked).catch(() => (e.target.checked = !e.target.checked)));
$('refit').addEventListener('click', () => call('refit'));
$('quit').addEventListener('click', () => (native ? call('quit') : window.close()));

listen('shade://mode', showMode);
call('get_mode').then((m) => showMode(m || 'off'));
autostart.isEnabled().then((on) => ($('autostart').checked = on)).catch(() => {});
render();
