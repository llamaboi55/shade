// One overlay per screen. It paints the shade and cuts out what should stay visible.
// Every click passes through it, except in curtain mode.
import { call, listen, native } from './api.js';
import { load, COLORS } from './prefs.js';
import { approach, onScreen, spotlightStops, bandEdges, fmtTime } from './shapes.js';

const canvas = document.getElementById('c');
const g = canvas.getContext('2d');
const curtain = document.getElementById('curtain');
const params = new URLSearchParams(location.search);

let prefs = load();
let mode = native ? 'off' : params.get('mode') || 'spotlight';
let W = 0;
let H = 0;
let cursor = null;
let active = null; // target rect of the focused window
let shown = null; // the rect as drawn, easing toward `active`
let lastActiveAt = 0;
let running = false;

if (!native) document.documentElement.classList.add('preview');

function resize() {
  const dpr = window.devicePixelRatio || 1;
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function shadeColor(alpha = prefs.dim) {
  const [r, gg, b] = COLORS[prefs.color] || COLORS.black;
  return `rgba(${r},${gg},${b},${alpha})`;
}

function paint() {
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, W, H);
  g.fillStyle = shadeColor();
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'destination-out';
  if (mode === 'spotlight' && cursor) {
    const r = prefs.radius;
    const grad = g.createRadialGradient(cursor.x, cursor.y, 0, cursor.x, cursor.y, r);
    for (const [at, a] of spotlightStops(prefs.softness)) grad.addColorStop(at, `rgba(0,0,0,${a})`);
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cursor.x, cursor.y, r, 0, Math.PI * 2);
    g.fill();
  } else if (mode === 'window' && shown && onScreen(shown, W, H)) {
    // A soft-edged hole: the blurred shadow of a shape drawn far off screen.
    const feather = 6 + prefs.softness * 30;
    g.save();
    g.shadowColor = 'rgba(0,0,0,1)';
    g.shadowBlur = feather;
    g.shadowOffsetX = W + 1000;
    g.fillStyle = '#000';
    g.beginPath();
    g.roundRect(shown.x - W - 1000 - 2, shown.y - 2, shown.w + 4, shown.h + 4, 10);
    g.fill();
    g.restore();
  } else if (mode === 'band' && cursor) {
    const { top, bottom } = bandEdges(cursor.y, prefs.band, H);
    const fade = 10 + prefs.softness * 50;
    const grad = g.createLinearGradient(0, top - fade, 0, bottom + fade);
    const span = bottom - top + fade * 2;
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(fade / span, 'rgba(0,0,0,1)');
    grad.addColorStop(1 - fade / span, 'rgba(0,0,0,1)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, top - fade, W, span);
  }
  g.globalCompositeOperation = 'source-over';
}

async function sample(now) {
  if (native) {
    const wantActive = mode === 'window' && now - lastActiveAt > 120;
    try {
      const p = await call('pointer', { wantActive });
      cursor = p.cursor && p.cursor[0] >= -50 && p.cursor[1] >= -50 && p.cursor[0] <= W + 50 && p.cursor[1] <= H + 50 ? { x: p.cursor[0], y: p.cursor[1] } : null;
      if (wantActive) {
        active = p.active;
        lastActiveAt = now;
      }
    } catch {}
  } else if (mode === 'window') {
    const el = document.querySelector('.fake-window.active');
    if (el) {
      const r = el.getBoundingClientRect();
      active = { x: r.left, y: r.top, w: r.width, h: r.height };
    }
  }
  shown = active ? approach(shown, active, shown ? 0.35 : 1) : null;
}

async function frame(now) {
  if (!running) return;
  await sample(now);
  paint();
  requestAnimationFrame(frame);
}

function start() {
  if (running) return;
  running = true;
  requestAnimationFrame(frame);
}

function stop() {
  running = false;
}

// ---------- Curtain
let clockTimer = 0;
function showCurtain(on) {
  curtain.hidden = !on;
  document.body.classList.toggle('curtain', on);
  clearInterval(clockTimer);
  if (!on) return;
  const [r, gg, b] = COLORS[prefs.color] || COLORS.black;
  curtain.style.setProperty('--shade', `rgb(${r},${gg},${b})`);
  curtain.querySelector('.message').textContent = prefs.curtainMessage;
  const clock = curtain.querySelector('.clock');
  clock.hidden = !prefs.curtainClock;
  const tick = () => (clock.textContent = fmtTime());
  tick();
  clockTimer = setInterval(tick, 5000);
}

curtain.addEventListener('dblclick', () => (native ? call('lift_curtain') : setMode('spotlight')));
document.addEventListener('keydown', (e) => {
  if (mode === 'curtain' && e.key === 'Escape') call('lift_curtain');
});

function setMode(next) {
  mode = next;
  document.body.dataset.mode = mode;
  showCurtain(mode === 'curtain');
  shown = null;
  if (mode === 'off' || mode === 'curtain') {
    stop();
    g.clearRect(0, 0, W, H);
  } else {
    start();
  }
}

listen('shade://mode', setMode);
listen('shade://prefs', (next) => {
  prefs = next;
  if (mode === 'curtain') showCurtain(true);
});
window.addEventListener('resize', resize);
if (!native) {
  window.addEventListener('pointermove', (e) => (cursor = { x: e.clientX, y: e.clientY }));
  window.addEventListener('pointerdown', (e) => {
    const w = e.target.closest?.('.fake-window');
    if (!w) return;
    document.querySelectorAll('.fake-window').forEach((x) => x.classList.toggle('active', x === w));
  });
}

resize();
if (native) call('get_mode').then((m) => setMode(m || 'off'));
else {
  window.shadeSetMode = setMode; // lets the preview switch modes
  setMode(mode);
}
