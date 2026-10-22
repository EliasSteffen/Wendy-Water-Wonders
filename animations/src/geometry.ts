export type Pt = { x: number; y: number };

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Orthogonal-ish route with rounded corners, sampled into a dense polyline.
export const roundedPolyline = (route: Pt[], radius: number, steps = 12): Pt[] => {
  const pts: Pt[] = [];
  for (const p of route) {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 0.01) pts.push(p);
  }
  if (pts.length < 3) return pts;
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const d1 = Math.hypot(b.x - a.x, b.y - a.y);
    const d2 = Math.hypot(c.x - b.x, c.y - b.y);
    const r = Math.min(radius, d1 / 2, d2 / 2);
    const p1 = { x: b.x + ((a.x - b.x) / d1) * r, y: b.y + ((a.y - b.y) / d1) * r };
    const p2 = { x: b.x + ((c.x - b.x) / d2) * r, y: b.y + ((c.y - b.y) / d2) * r };
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const u = 1 - t;
      out.push({
        x: u * u * p1.x + 2 * u * t * b.x + t * t * p2.x,
        y: u * u * p1.y + 2 * u * t * b.y + t * t * p2.y,
      });
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
};

export type Sampled = { pts: Pt[]; cum: number[]; length: number };

export const sampled = (pts: Pt[]): Sampled => {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  return { pts, cum, length: cum[cum.length - 1] };
};

const segmentIndex = (s: Sampled, dist: number) => {
  let lo = 0;
  let hi = s.cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (s.cum[mid] <= dist) lo = mid;
    else hi = mid - 1;
  }
  return lo;
};

export const pointAt = (s: Sampled, t: number): Pt => {
  const last = s.pts[s.pts.length - 1];
  if (s.pts.length < 2) return last;
  const dist = clamp01(t) * s.length;
  const i = segmentIndex(s, dist);
  if (i >= s.pts.length - 1) return last;
  const seg = s.cum[i + 1] - s.cum[i];
  const k = seg > 0 ? (dist - s.cum[i]) / seg : 0;
  return { x: lerp(s.pts[i].x, s.pts[i + 1].x, k), y: lerp(s.pts[i].y, s.pts[i + 1].y, k) };
};

// The first fraction t of the path, by arc length.
export const partial = (s: Sampled, t: number): Pt[] => {
  if (t >= 1) return s.pts;
  const dist = clamp01(t) * s.length;
  const i = segmentIndex(s, dist);
  return [...s.pts.slice(0, i + 1), pointAt(s, t)];
};

export const toPath = (pts: Pt[]) =>
  pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");

const hexToRgb = (hex: string) => {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((o) => parseInt(h.slice(o, o + 2), 16));
};

export const darken = (hex: string, amount: number) => {
  const [r, g, b] = hexToRgb(hex).map((v) => Math.round(v * (1 - amount)));
  return `rgb(${r},${g},${b})`;
};

export const alpha = (hex: string, a: number) => {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};
