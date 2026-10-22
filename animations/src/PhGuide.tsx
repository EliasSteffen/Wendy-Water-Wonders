import React from "react";
import { AbsoluteFill, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { MONO, SANS } from "./fonts";
import { alpha } from "./geometry";
import { COLORS, PH_BNC, PH_PINS, PH_PROBE_X, chipPin, colX, hole, rail } from "./layout";
import { ChipEvent, GND_OUTLINE, LabelDef, PI_TAGS, RAIL_GLOWS, RESISTORS, WIRES, WireDef, p, pulse, wire } from "./scene";
import { CLAMP, makeCamera, sec, shot } from "./timeline";
import { BACKDROP, World } from "./components/World";
import { CaptionBar, CaptionSpec, PinoutCard, PowerBadge, SummaryCard, SummaryRow, TermLine, TerminalCard } from "./components/Overlays";

const RAW: [string, number, number][] = [
  ["intro", 0, 3.5],
  ["context", 3.5, 8],
  ["why", 8, 12],
  ["plus", 12, 15.5],
  ["minus", 15.5, 19],
  ["signal", 19, 23.5],
  ["probe", 23.5, 29],
  ["calibrate", 29, 38.6],
  ["test", 38.6, 45],
  ["done", 45, 51],
];
const STEPS = RAW.map(([id, a, b]) => ({ id, from: sec(a), to: sec(b) }));
export const PH_TOTAL_FRAMES = sec(51);
const NUMBERED = ["plus", "minus", "signal", "probe"];
const stepAt = (f: number) => (STEPS.find((s) => f >= s.from && f < s.to) ?? STEPS[STEPS.length - 1]).id;

const camera = makeCamera([
  shot(0, 960, 455, 1),
  shot(8, 1030, 640, 1.6),
  shot(12, 1040, 650, 1.8),
  shot(19, 990, 600, 1.6),
  shot(23.5, 1330, 600, 1.15),
  shot(26.2, 1720, 600, 2.2, 0.9),
  shot(29, 1500, 560, 1.3),
  shot(45, 1354, 462, 0.7, 1.4),
]);

// "Already done" before the video starts.
const BEFORE = -sec(60);

// Everything from the earlier guides is on the board already (minus the test jumpers).
const PRIOR: WireDef[] = WIRES.filter((w) => w.removeAt === undefined).map((w) => ({ ...w, start: BEFORE, step: "before" }));

const PH_CABLE = [
  { x: PH_BNC.x, y: PH_BNC.y + 16 },
  p(PH_BNC.x, 876),
  p(1525, 876),
  p(1525, 242),
  p(PH_PROBE_X, 242),
  p(PH_PROBE_X, 300),
];

// The pH board's wires; StationOverview reuses them.
export const PH_WIRES: WireDef[] = [
  wire({ id: "phVcc", color: COLORS.v33, step: "plus", route: [PH_PINS.vcc, rail(16, "botPlus")], t: [12.4, 13.8], startPlug: "female" }),
  wire({
    id: "phGnd",
    color: COLORS.gnd,
    outline: GND_OUTLINE,
    step: "minus",
    route: [PH_PINS.gnd, rail(18, "botMinus")],
    t: [15.9, 17.3],
    startPlug: "female",
  }),
  wire({
    id: "phSig",
    color: COLORS.ph,
    step: "signal",
    route: [PH_PINS.sig, p(PH_PINS.sig.x, 622), p(colX(12), 622), hole(12, "a")],
    t: [19.5, 21.3],
    startPlug: "female",
    flow: 1,
  }),
  wire({
    id: "phCable",
    color: "#2b2f36",
    outline: "#4b5563",
    step: "probe",
    route: PH_CABLE,
    t: [24.0, 26.0],
    width: 7,
    startPlug: "none",
    endPlug: "none",
  }),
];

const ALL_WIRES: WireDef[] = [...PRIOR, ...PH_WIRES];

const PULSES = [
  pulse(PH_PINS.vcc, COLORS.v33, 11.6, 13.8),
  pulse(rail(16, "botPlus"), COLORS.v33, 12.2, 14.2, 10),
  pulse(PH_PINS.gnd, COLORS.gndUi, 15.1, 17.3),
  pulse(rail(18, "botMinus"), COLORS.gndUi, 15.8, 17.8, 10),
  pulse(PH_PINS.sig, COLORS.ph, 19.1, 21.3),
  pulse(chipPin(3), COLORS.ph, 20.2, 23.2, 10),
  pulse(PH_BNC, COLORS.ph, 23.6, 26.0, 18),
  pulse({ x: PH_PROBE_X, y: 640 }, COLORS.ph, 26.4, 28.6, 16),
];

const LABELS: LabelDef[] = [
  { x: 1020, y: 114, text: "Already wired", at: sec(3.8), out: sec(7.7) },
  { x: 1049, y: 668, text: "pH sensor board", at: sec(4.2), out: sec(7.7) },
  { x: PH_PROBE_X, y: 180, text: "pH probe", at: sec(4.6), out: sec(7.7) },
  { x: 866, y: 452, text: "CH2 column", at: sec(20.2), out: sec(23.3), size: 12 },
  { x: PH_PROBE_X, y: 712, text: "storage cap off", at: sec(26.6), out: sec(28.8), size: 12 },
  { x: 1720, y: 890, text: "pH 7.00 buffer", at: sec(30.2), out: sec(33.5) },
  { x: 1720, y: 890, text: "pH 4.00 buffer", at: sec(34.6), out: sec(38.0) },
  { x: 1720, y: 890, text: "tap water", at: sec(39.2), out: sec(44.6) },
];

const pre = (pin: number, color: string): ChipEvent => ({ pin, color, at: BEFORE });
const CHIP_EVENTS: ChipEvent[] = [
  pre(16, COLORS.v33),
  pre(15, COLORS.v33),
  pre(14, COLORS.gndUi),
  pre(9, COLORS.gndUi),
  pre(13, COLORS.sclk),
  pre(12, COLORS.miso),
  pre(11, COLORS.mosi),
  pre(10, COLORS.ce0),
  pre(1, COLORS.tds),
  pre(2, COLORS.turb),
  { pin: 3, color: COLORS.ph, at: sec(21.3), focus: [sec(19.2), sec(23.2)] },
];
const CARD_WINDOWS: [number, number][] = [[sec(19), sec(23.5)]];

const POWER_ON = sec(29.3);
const POWER = [{ on: POWER_ON, off: sec(45), end: sec(45) }];

const BUFFER_7 = "#22c55e";
const BUFFER_4 = "#ef4444";

const CAPTIONS: Partial<Record<string, CaptionSpec>> = {
  context: {
    kind: "info",
    title: "Starting point",
    body: "Pi, MCP3008, TDS and turbidity are already wired. The pH board only needs {v33:+}, {gnd:−} and {ph:A}.",
  },
  why: {
    kind: "check",
    title: "No resistors needed",
    body: "The pH board outputs at most {ph:3.0 V}, below the MCP3008's {ok:3.3 V} limit, so {ph:A} goes straight to CH2.",
  },
  plus: { kind: "num", badge: "1", title: "+ to 3.3 V", body: "{v33:pH +} → bottom {v33:+} rail. The board runs on 3.3–5.5 V." },
  minus: { kind: "num", badge: "2", title: "− to GND", body: "{gnd:pH −} → bottom {gnd:−} rail" },
  signal: { kind: "num", badge: "3", title: "A to CH2", body: "{ph:pH A} → the column of {ph:chip pin 3 (CH2)}. Nothing in between." },
  probe: {
    kind: "num",
    badge: "4",
    title: "Connect the probe",
    body: "Push the BNC plug on and twist to lock.  Pull off the {ok:storage cap} (keep it!) and rinse the tip.",
    reveal: [sec(2.8)],
  },
  calibrate: {
    kind: "check",
    title: "Calibrate once",
    body: "{ok:pH 7.0 buffer} → wait, Enter    rinse    {v5:pH 4.0 buffer} → wait, Enter    note the {ph:--v7 / --v4} it prints",
    reveal: [sec(0.8), sec(5.4), sec(7.4)],
  },
  test: {
    kind: "check",
    title: "Measure",
    body: "Tap water should read about {ok:pH 6.5–8.5}. Rinse between samples, put the storage cap back when you're done.",
  },
  done: { kind: "star", title: "pH wired!", body: "{tds:CH0 = TDS}   {turb:CH1 = turbidity}   {ph:CH2 = pH}" },
};
const STEP_LABELS = { context: "ALREADY DONE", why: "GOOD NEWS", calibrate: "CHECKPOINT", test: "CHECKPOINT", done: "COMPLETE" };

// Matches the output format of pi/ph_test.py.
const TERM: TermLine[] = [
  { at: sec(0.3), text: "$ python3 ph_test.py --calibrate" },
  { at: sec(0.9), text: "Probe in pH 7.0 buffer. Wait ~1 min, then press Enter", info: true },
  { at: sec(2.4), text: "  pH 7.0 buffer: 1.50 V", out: true },
  { at: sec(3.0), text: "Rinse the probe. Probe in pH 4.0 buffer, then press Enter", info: true },
  { at: sec(6.3), text: "  pH 4.0 buffer: 2.03 V", out: true },
  { at: sec(6.9), text: "Use from now on:  --v7 1.50 --v4 2.03", info: true },
  { at: sec(9.8), text: "$ python3 ph_test.py --v7 1.50 --v4 2.03" },
  { at: sec(10.8), text: "pH on MCP3008 CH2 · v7 = 1.50 V · v4 = 2.03 V", info: true },
  { at: sec(11.6), text: "CH2 1.43 V | pH  7.40 | drinking-water range", out: true },
  { at: sec(12.6), text: "CH2 1.43 V | pH  7.41 | drinking-water range", out: true },
];

const ROWS: SummaryRow[] = [
  { color: COLORS.v33, from: "pH +", to: "bottom + rail (3.3 V)" },
  { color: COLORS.gndUi, from: "pH −", to: "bottom − rail (GND)" },
  { color: COLORS.ph, from: "pH A", to: "CH2 · chip pin 3, no resistors" },
  { color: "#9ca3af", from: "Probe", to: "BNC: push on, twist to lock" },
];

const CODE = `$ cd ~/water-quality
$ python3 ph_test.py --calibrate
$ python3 ph_test.py --v7 1.50 --v4 2.03
# use the values YOUR calibration prints`;

const PhTitle: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = (d: number) => spring({ frame: frame - d, fps, config: { damping: 200 }, durationInFrames: 22 });
  const up = (v: number): React.CSSProperties => ({ opacity: v, transform: `translateY(${(1 - v) * 26}px)` });
  const out = interpolate(frame, [sec(3.0), sec(3.5)], [1, 0], CLAMP);
  const chips = [
    { t: "+ → 3.3 V rail", c: COLORS.v33 },
    { t: "− → GND rail", c: COLORS.gndUi },
    { t: "A → CH2", c: COLORS.ph },
  ];
  return (
    <AbsoluteFill style={{ opacity: out, fontFamily: SANS }}>
      <AbsoluteFill style={{ background: "rgba(4,7,15,0.8)" }} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", marginTop: -40 }}>
          <div
            style={{
              ...up(a(2)),
              display: "inline-block",
              padding: "10px 24px",
              borderRadius: 999,
              border: `1.5px solid ${alpha(COLORS.ph, 0.55)}`,
              background: alpha(COLORS.ph, 0.12),
              color: "#bef264",
              fontWeight: 700,
              letterSpacing: 4,
              fontSize: 20,
            }}
          >
            WATER-QUALITY STATION · PART 3
          </div>
          <div style={{ ...up(a(8)), fontSize: 120, fontWeight: 800, color: "#f8fafc", letterSpacing: -3, marginTop: 30, lineHeight: 1 }}>
            pH Meter
          </div>
          <div
            style={{
              ...up(a(14)),
              fontSize: 46,
              fontWeight: 700,
              marginTop: 22,
              background: "linear-gradient(90deg,#a3e635,#22c55e,#ef4444)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            3 wires · no resistors · calibrate with buffers
          </div>
          <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 44 }}>
            {chips.map((c, i) => (
              <div
                key={c.t}
                style={{
                  ...up(a(22 + i * 5)),
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "12px 22px",
                  borderRadius: 16,
                  background: "rgba(15,23,42,0.85)",
                  border: `1.5px solid ${alpha(c.c, 0.5)}`,
                  color: "#e2e8f0",
                  fontWeight: 600,
                  fontSize: 22,
                }}
              >
                <span style={{ width: 12, height: 12, borderRadius: 6, background: c.c }} />
                {c.t}
              </div>
            ))}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const WhyCard: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 16 });
  const out = interpolate(frame, [duration - 10, duration], [1, 0], CLAMP);
  const row = (i: number): React.CSSProperties => {
    const r = spring({ frame: frame - 8 - i * 9, fps, config: { damping: 200 }, durationInFrames: 14 });
    return { opacity: r, transform: `translateX(${(1 - r) * 16}px)` };
  };
  const line: React.CSSProperties = { display: "flex", justifyContent: "space-between", fontSize: 19, color: "#cbd5e1", marginBottom: 6 };
  return (
    <div
      style={{
        position: "absolute",
        right: 40,
        bottom: 200,
        width: 450,
        borderRadius: 22,
        background: "rgba(10,16,30,0.95)",
        border: `1.5px solid ${alpha(COLORS.ph, 0.45)}`,
        padding: "20px 24px",
        fontFamily: SANS,
        opacity: Math.min(s, out),
        boxShadow: "0 18px 50px rgba(0,0,0,0.5)",
      }}
    >
      <div style={{ color: "#f1f5f9", fontWeight: 800, fontSize: 22, marginBottom: 12 }}>No resistors this time</div>
      <div style={{ ...line, ...row(0) }}>
        <span>pH board output</span>
        <b style={{ color: COLORS.ph }}>0 – 3.0 V</b>
      </div>
      <div style={{ ...line, ...row(1) }}>
        <span>MCP3008 input</span>
        <b style={{ color: "#fbbf24" }}>max 3.3 V</b>
      </div>
      <div style={{ ...row(2), fontSize: 23, fontWeight: 800, color: "#4ade80", margin: "12px 0 8px" }}>3.0 V &lt; 3.3 V → A straight to CH2</div>
      <div style={{ ...row(3), fontSize: 16, color: "#94a3b8", lineHeight: 1.4 }}>pH 7 sits at about 1.5 V. Acid goes up, alkaline goes down.</div>
      <div style={{ ...row(4), fontFamily: MONO, fontSize: 16, color: "#e2e8f0", background: "#0f172a", borderRadius: 12, padding: "10px 14px", marginTop: 12 }}>
        pH = 7 + (V − V7) × 3 / (V7 − V4)
      </div>
    </div>
  );
};

export const PhGuide: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const step = stepAt(frame);
  const focus = NUMBERED.includes(step) ? step : null;
  // Empty glass → pH 7 buffer → drain → pH 4 buffer → drain → tap water.
  const level = interpolate(
    frame,
    [29.8, 30.8, 33.6, 34.2, 34.4, 35.4, 38.2, 38.8, 39.0, 40.0].map(sec),
    [0, 1, 1, 0, 0, 1, 1, 0, 0, 1],
    CLAMP,
  );
  const waterColor = frame < sec(34.3) ? BUFFER_7 : frame < sec(38.9) ? BUFFER_4 : undefined;
  const cap = interpolate(frame, [sec(26.6), sec(27.6)], [1, 0], CLAMP);
  return (
    <AbsoluteFill style={{ fontFamily: SANS, background: BACKDROP }}>
      <World
        cam={camera(frame)}
        wires={ALL_WIRES}
        pulses={PULSES}
        tags={PI_TAGS.map((t) => ({ ...t, at: BEFORE }))}
        labels={LABELS}
        glows={RAIL_GLOWS.map((g) => ({ ...g, at: BEFORE }))}
        resistors={RESISTORS.map((r) => ({ ...r, at: BEFORE }))}
        appear={{ pi: BEFORE, bb: BEFORE, tds: BEFORE, turb: BEFORE, beaker: BEFORE, cables: BEFORE }}
        chipAt={BEFORE}
        switchA={1}
        powered={frame >= POWER_ON}
        waterLevel={level}
        waterColor={waterColor}
        ph={{ at: BEFORE, cap }}
        focusStep={focus}
        dimOthers={focus !== null}
        flowFrom={sec(46)}
        flowIds={["phSig", "tdsSig", "sclk", "miso", "mosi", "ce0"]}
      />

      <PinoutCard frame={frame} windows={CARD_WINDOWS} events={CHIP_EVENTS} />
      <Sequence from={0} durationInFrames={sec(3.5)}>
        <PhTitle />
      </Sequence>
      <Sequence from={sec(8.3)} durationInFrames={sec(3.7)} premountFor={15}>
        <WhyCard duration={sec(3.7)} />
      </Sequence>
      <Sequence from={sec(29.5)} durationInFrames={sec(15.5)} premountFor={15}>
        <TerminalCard duration={sec(15.5)} lines={TERM} title="ssh raspberrypi.local — ~/water-quality" side="left" width={830} fontSize={19} />
      </Sequence>
      <Sequence from={sec(46)} durationInFrames={sec(5)} premountFor={15}>
        <SummaryCard title="pH cheat-sheet" rows={ROWS} code={CODE} />
      </Sequence>
      <PowerBadge frame={frame} fps={fps} windows={POWER} />
      <CaptionBar steps={STEPS} captions={CAPTIONS} numbered={NUMBERED} labels={STEP_LABELS} showAt={sec(3.5)} />
    </AbsoluteFill>
  );
};
