import type { Pt } from "./geometry";

export const WIDTH = 1920;
export const HEIGHT = 1080;
export const FPS = 30;
// Screen point the camera centres on (the caption bar covers the bottom).
export const VIEW = { x: 960, y: 450 };

export const COLORS = {
  bg0: "#060b16",
  bg1: "#0d1628",
  text: "#e8eef7",
  muted: "#a9b7cb",
  accent: "#60a5fa",
  ok: "#22c55e",
  warn: "#f59e0b",
  v33: "#ff9f1c",
  v5: "#ef4444",
  gnd: "#22252a",
  gndUi: "#d4dbe5",
  sclk: "#facc15",
  miso: "#38bdf8",
  mosi: "#4ade80",
  ce0: "#c084fc",
  tds: "#2dd4bf",
  turb: "#f472b6",
  ph: "#a3e635",
  test: "#f8fafc",
} as const;

// ---------- Raspberry Pi 5 (portrait: GPIO header on the right, USB ports at the bottom)
export const PI = { x: 40, y: 120, w: 400, h: 720 };
export const HEADER = { oddX: 372, evenX: 404, y0: 170, pitch: 32 };
export const piPin = (n: number): Pt => ({
  x: n % 2 === 1 ? HEADER.oddX : HEADER.evenX,
  y: HEADER.y0 + Math.floor((n - 1) / 2) * HEADER.pitch,
});
export const PI_LED: Pt = { x: 96, y: 268 };

// ---------- Half-size breadboard, 30 columns
export const BB = { x: 600, y: 140, w: 840, h: 468, pitch: 26, col1: 642 };
export const colX = (c: number) => BB.col1 + (c - 1) * BB.pitch;
export const ROWS = ["j", "i", "h", "g", "f", "e", "d", "c", "b", "a"] as const;
export type Row = (typeof ROWS)[number];
export const ROW_Y: Record<Row, number> = {
  j: 244,
  i: 270,
  h: 296,
  g: 322,
  f: 348,
  e: 400,
  d: 426,
  c: 452,
  b: 478,
  a: 504,
};
export const RAIL_Y = { topPlus: 168, topMinus: 194, botMinus: 554, botPlus: 580 } as const;
export type RailKey = keyof typeof RAIL_Y;
export const CHANNEL_Y = 374;
export const hole = (c: number, r: Row): Pt => ({ x: colX(c), y: ROW_Y[r] });
export const rail = (c: number, k: RailKey): Pt => ({ x: colX(c), y: RAIL_Y[k] });

// ---------- MCP3008 in columns 10–17, notch facing left
export const CHIP = { x: colX(10) - 17, y: 356, w: colX(17) - colX(10) + 34, h: 36 };
export const chipPin = (p: number): Pt => (p <= 8 ? hole(9 + p, "e") : hole(26 - p, "f"));
export const CHIP_PIN_NAMES: Record<number, string> = {
  1: "CH0",
  2: "CH1",
  3: "CH2",
  4: "CH3",
  5: "CH4",
  6: "CH5",
  7: "CH6",
  8: "CH7",
  9: "DGND",
  10: "CS",
  11: "DIN",
  12: "DOUT",
  13: "CLK",
  14: "AGND",
  15: "VREF",
  16: "VDD",
};

// ---------- Sensor boards (below the breadboard) and the water beaker
export const TDS_BOARD = { x: 660, y: 690, w: 260, h: 170 };
export const TDS_PINS = { vcc: { x: 772, y: 708 }, gnd: { x: 824, y: 708 }, sig: { x: 876, y: 708 } };
export const TURB_BOARD = { x: 1150, y: 690, w: 280, h: 170 };
export const TURB_PINS = { out: { x: 1266, y: 708 }, gnd: { x: 1324, y: 708 }, vcc: { x: 1382, y: 708 } };
export const TURB_SWITCH: Pt = { x: 1200, y: 800 };
export const BEAKER = { x: 1570, y: 330, w: 300, h: 530, water: 430 };
export const TDS_PROBE_X = 1660;
export const TURB_PROBE_X = 1790;

// pH meter (DFRobot Gravity V2.0) sits in the gap between the TDS and turbidity boards.
// Pin order A / + / − is the real connector seen from the other side.
export const PH_BOARD = { x: 962, y: 690, w: 174, h: 170 };
export const PH_PINS = { sig: { x: 984, y: 708 }, vcc: { x: 1036, y: 708 }, gnd: { x: 1088, y: 708 } };
export const PH_BNC: Pt = { x: 1112, y: 850 };
export const PH_PROBE_X = 1720;
