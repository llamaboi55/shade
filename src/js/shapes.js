// Pure geometry for the overlay, kept separate so it can be tested without a browser.

/** Moves `from` part of the way to `to`, for smooth window-following. */
export function approach(from, to, k) {
  if (!from) return { ...to };
  return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, w: from.w + (to.w - from.w) * k, h: from.h + (to.h - from.h) * k };
}

/** True when the rectangle overlaps a screen of the given size at all. */
export function onScreen(r, width, height) {
  return Boolean(r) && r.x < width && r.y < height && r.x + r.w > 0 && r.y + r.h > 0;
}

/** Radial gradient stops for the spotlight: fully clear inside, fading out to the edge. */
export function spotlightStops(softness) {
  const s = Math.min(1, Math.max(0, softness));
  return [[0, 1], [Math.max(0.02, 1 - s * 0.85), 1], [1, 0]];
}

/** The reading band's top and bottom around the mouse, kept on screen. */
export function bandEdges(y, height, screenHeight) {
  const top = Math.max(0, Math.min(screenHeight - height, y - height / 2));
  return { top, bottom: top + height };
}

export function fmtTime(d = new Date()) {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
