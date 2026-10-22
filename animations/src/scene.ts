import { Pt, roundedPolyline, sampled, Sampled } from "./geometry";
import { COLORS, CHIP, TDS_PINS, TURB_PINS, TURB_SWITCH, RAIL_Y, chipPin, hole, piPin, rail } from "./layout";
import { sec } from "./timeline";

export type Plug = "female" | "male" | "none";

export type WireDef = {
  id: string;
  color: string;
  outline?: string;
  step: string;
  path: Sampled;
  start: number;
  dur: number;
  width: number;
  startPlug: Plug;
  endPlug: Plug;
  removeAt?: number;
  // Direction signal pulses travel in the final shot (1 = along the path).
  flow?: 1 | -1;
};

type WireInput = {
  id: string;
  color: string;
  outline?: string;
  step: string;
  route: Pt[];
  t: [number, number];
  width?: number;
  startPlug?: Plug;
  endPlug?: Plug;
  removeAt?: number;
  flow?: 1 | -1;
};

export const wire = ({ route, t, width, startPlug, endPlug, removeAt, ...rest }: WireInput): WireDef => ({
  ...rest,
  path: sampled(roundedPolyline(route, 22)),
  start: sec(t[0]),
  dur: sec(t[1] - t[0]),
  width: width ?? 8,
  startPlug: startPlug ?? "male",
  endPlug: endPlug ?? "male",
  removeAt: removeAt === undefined ? undefined : sec(removeAt),
});

export const p = (x: number, y: number): Pt => ({ x, y });
export const GND_OUTLINE = "#7d8796";

// Header wires leave the Pi, climb a lane between Pi and breadboard and run
// over the top of the board, so the bundle stays tidy.
export const WIRES: WireDef[] = [
  // Step 2: Pi power onto the top rails
  wire({
    id: "v33",
    color: COLORS.v33,
    step: "rails",
    route: [piPin(1), p(372, 146), p(476, 146), p(476, 54), p(1162, 54), rail(21, "topPlus")],
    t: [19.4, 21.4],
    startPlug: "female",
  }),
  wire({
    id: "gnd",
    color: COLORS.gnd,
    outline: GND_OUTLINE,
    step: "rails",
    route: [piPin(6), p(490, 234), p(490, 68), p(1136, 68), rail(20, "topMinus")],
    t: [22.5, 24.3],
    startPlug: "female",
  }),
  // Step 3: bridge top rails to bottom rails
  wire({ id: "bridgePlus", color: COLORS.v33, step: "bridge", route: [rail(30, "topPlus"), rail(30, "botPlus")], t: [27.0, 28.2], width: 7 }),
  wire({
    id: "bridgeMinus",
    color: COLORS.gnd,
    outline: GND_OUTLINE,
    step: "bridge",
    route: [rail(29, "topMinus"), rail(29, "botMinus")],
    t: [28.4, 29.6],
    width: 7,
  }),
  // Step 4: chip power
  wire({ id: "vdd", color: COLORS.v33, step: "chippower", route: [hole(10, "j"), rail(10, "topPlus")], t: [31.8, 32.8], width: 7 }),
  wire({ id: "vref", color: COLORS.v33, step: "chippower", route: [hole(11, "j"), rail(11, "topPlus")], t: [33.0, 34.0], width: 7 }),
  wire({ id: "agnd", color: COLORS.gnd, outline: GND_OUTLINE, step: "chippower", route: [hole(12, "j"), rail(12, "topMinus")], t: [34.3, 35.3], width: 7 }),
  wire({ id: "dgnd", color: COLORS.gnd, outline: GND_OUTLINE, step: "chippower", route: [hole(17, "j"), rail(17, "topMinus")], t: [35.5, 36.5], width: 7 }),
  // Step 5: SPI
  wire({
    id: "sclk",
    color: COLORS.sclk,
    step: "spi",
    route: [piPin(23), p(372, 541), p(546, 541), p(546, 124), p(954, 124), hole(13, "j")],
    t: [39.1, 40.9],
    startPlug: "female",
    flow: 1,
  }),
  wire({
    id: "miso",
    color: COLORS.miso,
    step: "spi",
    route: [piPin(21), p(518, 490), p(518, 96), p(980, 96), hole(14, "j")],
    t: [41.8, 43.6],
    startPlug: "female",
    flow: -1,
  }),
  wire({
    id: "mosi",
    color: COLORS.mosi,
    step: "spi",
    route: [piPin(19), p(504, 458), p(504, 82), p(1006, 82), hole(15, "j")],
    t: [44.5, 46.3],
    startPlug: "female",
    flow: 1,
  }),
  wire({
    id: "ce0",
    color: COLORS.ce0,
    step: "spi",
    route: [piPin(24), p(532, 522), p(532, 110), p(1032, 110), hole(16, "j")],
    t: [47.2, 49.0],
    startPlug: "female",
    flow: 1,
  }),
  // Checkpoint: temporary test jumper on CH0
  wire({ id: "testGnd", color: COLORS.test, step: "test", route: [hole(10, "b"), rail(9, "botMinus")], t: [50.6, 51.2], width: 6, removeAt: 53.6 }),
  wire({ id: "testPlus", color: COLORS.test, step: "test", route: [hole(10, "b"), rail(9, "botPlus")], t: [53.9, 54.5], width: 6, removeAt: 56.2 }),
  // Step 6: TDS sensor
  wire({ id: "tdsVcc", color: COLORS.v33, step: "tds", route: [TDS_PINS.vcc, rail(6, "botPlus")], t: [58.2, 59.4], startPlug: "female" }),
  wire({ id: "tdsGnd", color: COLORS.gnd, outline: GND_OUTLINE, step: "tds", route: [TDS_PINS.gnd, rail(8, "botMinus")], t: [59.8, 61.0], startPlug: "female" }),
  wire({ id: "tdsSig", color: COLORS.tds, step: "tds", route: [TDS_PINS.sig, hole(10, "a")], t: [61.4, 62.8], startPlug: "female", flow: 1 }),
  // Step 7: turbidity power — 5 V straight from the Pi, never on a rail
  wire({
    id: "v5",
    color: COLORS.v5,
    step: "turbpower",
    route: [piPin(2), p(462, 170), p(462, 40), p(1470, 40), p(1470, 645), p(TURB_PINS.vcc.x, 645), TURB_PINS.vcc],
    t: [68.0, 71.2],
    startPlug: "female",
    endPlug: "female",
  }),
  wire({
    id: "turbGnd",
    color: COLORS.gnd,
    outline: GND_OUTLINE,
    step: "turbpower",
    route: [TURB_PINS.gnd, rail(27, "botMinus")],
    t: [72.4, 73.4],
    startPlug: "female",
  }),
  // Step 8: divider node (column 21) → CH1, then the sensor output
  wire({ id: "jumperCh1", color: COLORS.turb, step: "divider", route: [hole(21, "d"), hole(11, "d")], t: [78.2, 79.6], width: 7, flow: 1 }),
  wire({ id: "turbOut", color: COLORS.turb, step: "divider", route: [TURB_PINS.out, hole(25, "a")], t: [80.4, 81.6], startPlug: "female", flow: 1 }),
];

export type ResistorDef = { id: string; a: Pt; b: Pt; bands: string[]; label: string; labelAt: Pt; at: number };

export const RESISTORS: ResistorDef[] = [
  {
    id: "r20k",
    a: hole(21, "b"),
    b: rail(21, "botMinus"),
    bands: ["#dc2626", "#111111", "#f97316", "#d4a017"],
    label: "20 kΩ",
    labelAt: p(1096, 498),
    at: sec(75.0),
  },
  {
    id: "r10k",
    a: hole(21, "c"),
    b: hole(25, "c"),
    bands: ["#7c4a1e", "#111111", "#f97316", "#d4a017"],
    label: "10 kΩ",
    labelAt: p(1214, 434),
    at: sec(76.6),
  },
];

export type PulseDef = { at: Pt; color: string; from: number; to: number; r: number };
export const pulse = (at: Pt, color: string, a: number, b: number, r = 14): PulseDef => ({ at, color, from: sec(a), to: sec(b), r });

export const PULSES: PulseDef[] = [
  pulse({ x: CHIP.x + 2, y: CHIP.y + CHIP.h / 2 }, COLORS.accent, 13.6, 17.8, 12),
  pulse(chipPin(1), COLORS.accent, 14.6, 17.8, 10),
  pulse(piPin(1), COLORS.v33, 18.6, 21.4),
  pulse(piPin(6), COLORS.gndUi, 21.8, 24.3),
  pulse(rail(30, "topPlus"), COLORS.v33, 26.6, 28.2, 10),
  pulse(rail(29, "topMinus"), COLORS.gndUi, 28.0, 29.6, 10),
  pulse(chipPin(16), COLORS.v33, 31.4, 32.8, 10),
  pulse(chipPin(15), COLORS.v33, 32.6, 34.0, 10),
  pulse(chipPin(14), COLORS.gndUi, 33.9, 35.3, 10),
  pulse(chipPin(9), COLORS.gndUi, 35.1, 36.5, 10),
  pulse(piPin(23), COLORS.sclk, 38.6, 40.9),
  pulse(chipPin(13), COLORS.sclk, 38.6, 40.9, 10),
  pulse(piPin(21), COLORS.miso, 41.3, 43.6),
  pulse(chipPin(12), COLORS.miso, 41.3, 43.6, 10),
  pulse(piPin(19), COLORS.mosi, 44.0, 46.3),
  pulse(chipPin(11), COLORS.mosi, 44.0, 46.3, 10),
  pulse(piPin(24), COLORS.ce0, 46.7, 49.0),
  pulse(chipPin(10), COLORS.ce0, 46.7, 49.0, 10),
  pulse(hole(10, "b"), COLORS.test, 50.2, 51.2, 9),
  pulse(TDS_PINS.vcc, COLORS.v33, 57.7, 59.4),
  pulse(TDS_PINS.gnd, COLORS.gndUi, 59.4, 61.0),
  pulse(TDS_PINS.sig, COLORS.tds, 61.0, 62.8),
  pulse(chipPin(1), COLORS.tds, 62.6, 64.6, 10),
  pulse(TURB_SWITCH, COLORS.turb, 65.6, 67.0, 20),
  pulse(piPin(2), COLORS.v5, 67.5, 71.2),
  pulse(TURB_PINS.gnd, COLORS.gndUi, 72.0, 73.4),
  pulse(chipPin(2), COLORS.turb, 78.0, 80.0, 10),
  pulse(TURB_PINS.out, COLORS.turb, 80.0, 81.6),
];

// Labels next to the Pi header. Odd pins sit in the inner column, even pins
// in the outer one, so even pins get a leader line.
export type TagDef = { text: string; color: string; y: number; at: number; leader?: Pt; above?: Pt };
export const PI_TAGS: TagDef[] = [
  { text: "Pin 1 · 3.3V", color: COLORS.v33, y: 170, at: sec(18.6) },
  { text: "Pin 6 · GND", color: COLORS.gndUi, y: 234, at: sec(21.8), leader: piPin(6) },
  { text: "Pin 23 · SCLK", color: COLORS.sclk, y: 522, at: sec(38.6) },
  { text: "Pin 21 · MISO", color: COLORS.miso, y: 490, at: sec(41.3) },
  { text: "Pin 19 · MOSI", color: COLORS.mosi, y: 458, at: sec(44.0) },
  { text: "Pin 24 · CE0", color: COLORS.ce0, y: 562, at: sec(46.7), leader: piPin(24) },
  { text: "Pin 2 · 5V", color: COLORS.v5, y: 128, at: sec(67.5), above: piPin(2) },
];

export type GlowDef = { y: number; color: string; at: number };
export const RAIL_GLOWS: GlowDef[] = [
  { y: RAIL_Y.topPlus, color: COLORS.v33, at: sec(21.4) },
  { y: RAIL_Y.topMinus, color: "#93c5fd", at: sec(24.3) },
  { y: RAIL_Y.botPlus, color: COLORS.v33, at: sec(28.2) },
  { y: RAIL_Y.botMinus, color: "#93c5fd", at: sec(29.6) },
];

export type LabelDef = { x: number; y: number; text: string; at: number; out: number; size?: number };
export const WORLD_LABELS: LabelDef[] = [
  { x: 240, y: 96, text: "Raspberry Pi 5", at: sec(4.5), out: sec(8.7) },
  { x: 1020, y: 114, text: "Half-size breadboard", at: sec(5.2), out: sec(8.7) },
  { x: 790, y: 668, text: "TDS sensor board", at: sec(5.9), out: sec(8.7) },
  { x: 1290, y: 668, text: "Turbidity sensor board", at: sec(6.6), out: sec(8.7) },
  { x: 1720, y: 180, text: "Probes in the water", at: sec(7.3), out: sec(8.7) },
  { x: 1660, y: 740, text: "TDS", at: sec(7.5), out: sec(8.7), size: 12 },
  { x: 1790, y: 740, text: "Turbidity", at: sec(7.6), out: sec(8.7), size: 12 },
  { x: 806, y: 374, text: "notch", at: sec(13.6), out: sec(17.8), size: 11 },
  { x: 876, y: 452, text: "pin 1", at: sec(14.6), out: sec(17.8), size: 11 },
];

// MCP3008 pinout card: which pins light up, and when.
export type ChipEvent = { pin: number; color: string; at?: number; focus?: [number, number] };
const ev = (pin: number, color: string, at: number | undefined, f0: number, f1: number): ChipEvent => ({
  pin,
  color,
  at: at === undefined ? undefined : sec(at),
  focus: [sec(f0), sec(f1)],
});
export const CHIP_EVENTS: ChipEvent[] = [
  ev(1, COLORS.accent, undefined, 14.6, 17.8),
  ev(16, COLORS.v33, 32.8, 31.4, 32.8),
  ev(15, COLORS.v33, 34.0, 32.6, 34.0),
  ev(14, COLORS.gndUi, 35.3, 33.9, 35.3),
  ev(9, COLORS.gndUi, 36.5, 35.1, 36.5),
  ev(13, COLORS.sclk, 40.9, 38.6, 40.9),
  ev(12, COLORS.miso, 43.6, 41.3, 43.6),
  ev(11, COLORS.mosi, 46.3, 44.0, 46.3),
  ev(10, COLORS.ce0, 49.0, 46.7, 49.0),
  ev(1, COLORS.tds, 62.8, 61.0, 64.6),
  ev(2, COLORS.turb, 79.6, 78.0, 82.0),
];
export const CARD_WINDOWS: [number, number][] = [
  [sec(12.8), sec(18)],
  [sec(31), sec(50)],
  [sec(57), sec(65)],
  [sec(74), sec(85)],
];

// Probe cables from the boards to the probes in the beaker (decorative).
export const TDS_CABLE = roundedPolyline(
  [p(924, 780), p(950, 780), p(950, 885), p(1545, 885), p(1545, 252), p(1660, 252), p(1660, 300)],
  30,
);
export const TURB_CABLE = roundedPolyline(
  [p(1456, 766), p(1505, 766), p(1505, 232), p(1790, 232), p(1790, 300)],
  30,
);
