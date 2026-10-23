import { Easing, interpolate } from "remotion";
import { FPS } from "./layout";

export const sec = (s: number) => Math.round(s * FPS);

export const CLAMP = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export type StepId =
  | "intro"
  | "parts"
  | "safety"
  | "chip"
  | "rails"
  | "bridge"
  | "chippower"
  | "spi"
  | "test"
  | "tds"
  | "turbpower"
  | "divider"
  | "ph"
  | "measure"
  | "done";

const RAW: [StepId, number, number][] = [
  ["intro", 0, 4],
  ["parts", 4, 9],
  ["safety", 9, 12],
  ["chip", 12, 18],
  ["rails", 18, 26],
  ["bridge", 26, 31],
  ["chippower", 31, 38],
  ["spi", 38, 50],
  ["test", 50, 57],
  ["tds", 57, 65],
  ["turbpower", 65, 74],
  ["divider", 74, 85],
  ["ph", 85, 93],
  ["measure", 93, 99],
  ["done", 99, 108],
];

export const STEPS = RAW.map(([id, a, b]) => ({ id, from: sec(a), to: sec(b) }));
export const TOTAL_FRAMES = sec(108);
export const NUMBERED: StepId[] = ["chip", "rails", "bridge", "chippower", "spi", "tds", "turbpower", "divider", "ph"];

export const stepAt = (f: number): StepId =>
  (STEPS.find((s) => f >= s.from && f < s.to) ?? STEPS[STEPS.length - 1]).id;

export const stepRange = (id: StepId) => STEPS.find((s) => s.id === id)!;

// 0 → 1 → 0 window with linear fades.
export const env = (f: number, from: number, to: number, fadeIn = 10, fadeOut = 10) => {
  if (f <= from || f >= to) return 0;
  return Math.min(1, (f - from) / fadeIn, (to - f) / fadeOut);
};

export const POWER_WINDOWS = [
  { on: sec(51.4), off: sec(55.8), end: sec(57) },
  { on: sec(93.5), off: sec(98.6), end: sec(99.2) },
];
export const powerOn = (f: number) => POWER_WINDOWS.some((w) => f >= w.on && f < w.off);

// ---------- Camera
export type Shot = { at: number; cx: number; cy: number; z: number; dur: number };
export const shot = (at: number, cx: number, cy: number, z: number, dur = 1.1): Shot => ({
  at: sec(at),
  cx,
  cy,
  z,
  dur: sec(dur),
});

const SHOTS: Shot[] = [
  shot(0, 960, 455, 1),
  shot(12, 967, 374, 2.3, 1.2),
  shot(18, 770, 175, 1.55, 1.2),
  shot(26, 1290, 375, 1.45),
  shot(31, 967, 255, 2.4),
  shot(38, 740, 300, 1.35, 1.2),
  shot(50, 1000, 480, 1.45),
  shot(57, 790, 590, 1.6),
  shot(65, 1290, 760, 2.0, 1.0),
  shot(67.2, 960, 455, 1.0, 1.0),
  shot(71.6, 1290, 630, 1.7, 0.9),
  shot(74, 1180, 500, 2.0),
  shot(85, 1040, 650, 1.6),
  shot(89.8, 1380, 560, 1.0, 1.0),
  shot(93, 1180, 500, 2.0, 1.0),
  shot(99, 1354, 462, 0.7, 1.4),
];

export type Camera = { cx: number; cy: number; z: number };

export const makeCamera = (shots: Shot[]) => (f: number): Camera => {
  let i = 0;
  while (i < shots.length - 1 && shots[i + 1].at <= f) i++;
  const cur = shots[i];
  const prev = shots[Math.max(0, i - 1)];
  const t = interpolate(f, [cur.at, cur.at + cur.dur], [0, 1], {
    ...CLAMP,
    easing: Easing.inOut(Easing.cubic),
  });
  const z = Math.exp(Math.log(prev.z) + (Math.log(cur.z) - Math.log(prev.z)) * t);
  return { cx: prev.cx + (cur.cx - prev.cx) * t, cy: prev.cy + (cur.cy - prev.cy) * t, z };
};

export const cameraAt = makeCamera(SHOTS);
