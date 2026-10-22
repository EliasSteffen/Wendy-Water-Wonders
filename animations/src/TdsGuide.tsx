import React from "react";
import { AbsoluteFill, Easing, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { MONO, SANS } from "./fonts";
import { alpha } from "./geometry";
import { BEAKER, COLORS, TDS_BOARD, TDS_PINS, chipPin, rail } from "./layout";
import { ChipEvent, LabelDef, PI_TAGS, RAIL_GLOWS, RESISTORS, TDS_CABLE, WIRES, WireDef, pulse, wire } from "./scene";
import { CLAMP, env, makeCamera, sec, shot } from "./timeline";
import { BACKDROP, World } from "./components/World";
import { CaptionBar, CaptionSpec, PinoutCard, PowerBadge, SummaryCard, SummaryRow, TermLine, TerminalCard } from "./components/Overlays";

const RAW: [string, number, number][] = [
  ["intro", 0, 3.5],
  ["context", 3.5, 8.5],
  ["why", 8.5, 13],
  ["plus", 13, 17],
  ["minus", 17, 20.5],
  ["signal", 20.5, 25],
  ["probe", 25, 30],
  ["test", 30, 40],
  ["done", 40, 46],
];
const STEPS = RAW.map(([id, a, b]) => ({ id, from: sec(a), to: sec(b) }));
export const TDS_TOTAL_FRAMES = sec(46);
const NUMBERED = ["plus", "minus", "signal", "probe"];
const stepAt = (f: number) => (STEPS.find((s) => f >= s.from && f < s.to) ?? STEPS[STEPS.length - 1]).id;

const camera = makeCamera([
  shot(0, 960, 455, 1),
  shot(8.5, 800, 600, 1.6),
  shot(13, 800, 630, 1.75),
  shot(20.5, 850, 600, 1.55),
  shot(25, 1260, 565, 1.25),
  shot(30, 1500, 560, 1.3),
  shot(40, 1354, 462, 0.7, 1.4),
]);

// "Already done" before the video starts.
const BEFORE = -sec(60);

// Everything from the main guide is on the board already, except the TDS wires and the test jumpers.
const PRIOR: WireDef[] = WIRES.filter((w) => !w.id.startsWith("tds") && w.removeAt === undefined).map((w) => ({
  ...w,
  start: BEFORE,
  step: "before",
}));

const retime = (id: string, step: string, a: number, b: number): WireDef => {
  const w = WIRES.find((x) => x.id === id)!;
  return { ...w, step, start: sec(a), dur: sec(b - a) };
};

const ALL_WIRES: WireDef[] = [
  ...PRIOR,
  retime("tdsVcc", "plus", 13.4, 14.8),
  retime("tdsGnd", "minus", 17.4, 18.8),
  retime("tdsSig", "signal", 21.0, 22.6),
  wire({
    id: "tdsCable",
    color: "#2b2f36",
    outline: "#4b5563",
    step: "probe",
    route: TDS_CABLE,
    t: [25.8, 27.8],
    width: 7,
    startPlug: "none",
    endPlug: "none",
  }),
];

const CONNECTOR = { x: TDS_BOARD.x + TDS_BOARD.w - 11, y: TDS_BOARD.y + 86 };

const PULSES = [
  pulse(TDS_PINS.vcc, COLORS.v33, 12.9, 14.8),
  pulse(rail(6, "botPlus"), COLORS.v33, 13.6, 15.4, 10),
  pulse(TDS_PINS.gnd, COLORS.gndUi, 16.9, 18.8),
  pulse(rail(8, "botMinus"), COLORS.gndUi, 17.6, 19.4, 10),
  pulse(TDS_PINS.sig, COLORS.tds, 20.6, 22.6),
  pulse(chipPin(1), COLORS.tds, 21.6, 24.6, 10),
  pulse(CONNECTOR, COLORS.tds, 25.2, 27.2, 18),
];

const LABELS: LabelDef[] = [
  { x: 1020, y: 114, text: "Already wired", at: sec(4.0), out: sec(8.2) },
  { x: 790, y: 668, text: "TDS sensor board", at: sec(4.4), out: sec(8.2) },
  { x: 1660, y: 180, text: "TDS probe", at: sec(4.8), out: sec(8.2) },
  { x: 812, y: 452, text: "CH0 column", at: sec(21.6), out: sec(24.8), size: 12 },
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
  pre(2, COLORS.turb),
  { pin: 1, color: COLORS.tds, at: sec(22.6), focus: [sec(20.6), sec(24.6)] },
];
const CARD_WINDOWS: [number, number][] = [[sec(20.5), sec(25)]];

const POWER_ON = sec(30.6);
const POWER = [{ on: POWER_ON, off: sec(40), end: sec(40) }];

const CAPTIONS: Partial<Record<string, CaptionSpec>> = {
  context: {
    kind: "info",
    title: "Starting point",
    body: "Pi, MCP3008 and the turbidity sensor are already wired. The TDS board only needs {v33:+}, {gnd:−} and {tds:A}.",
  },
  why: {
    kind: "check",
    title: "No resistors needed",
    body: "The TDS board outputs at most {tds:2.3 V}, below the MCP3008's {ok:3.3 V} limit, so {tds:A} goes straight to CH0.",
  },
  plus: { kind: "num", badge: "1", title: "+ to 3.3 V", body: "{v33:TDS +} → bottom {v33:+} rail. The board runs fine on 3.3 V." },
  minus: { kind: "num", badge: "2", title: "− to GND", body: "{gnd:TDS −} → bottom {gnd:−} rail" },
  signal: { kind: "num", badge: "3", title: "A to CH0", body: "{tds:TDS A} → the column of {tds:chip pin 1 (CH0)}. Nothing in between." },
  probe: {
    kind: "num",
    badge: "4",
    title: "Plug in the probe",
    body: "Probe cable into the {ok:white connector} on the board, probe into the glass. Keep it off the glass walls.",
  },
  test: {
    kind: "check",
    title: "Test it",
    body: "{ok:dry probe ≈ 0 ppm}   {ok:tap water 100–500 ppm}   {ok:pinch of salt → it climbs}",
    reveal: [sec(2.3), sec(4.4), sec(7.4)],
  },
  done: { kind: "star", title: "TDS wired!", body: "{tds:CH0 = TDS}   run {ok:python3 tds_test.py} in ~/water-quality on the Pi" },
};
const STEP_LABELS = { context: "ALREADY DONE", why: "GOOD NEWS", test: "CHECKPOINT", done: "COMPLETE" };

// Matches the output format of station/tds_test.py.
const TERM: TermLine[] = [
  { at: sec(0.3), text: "$ python3 tds_test.py" },
  { at: sec(0.9), text: "TDS on MCP3008 CH0 · 25.0 °C · k = 1.00", info: true },
  { at: sec(1.5), text: "CH0 0.00 V | TDS    0 ppm | EC    0 µS/cm | dry probe / pure water", out: true },
  { at: sec(3.6), text: "CH0 0.76 V | TDS  281 ppm | EC  562 µS/cm | excellent", out: true },
  { at: sec(6.6), text: "CH0 2.09 V | TDS  946 ppm | EC 1892 µS/cm | poor", out: true },
];

const ROWS: SummaryRow[] = [
  { color: COLORS.v33, from: "TDS +", to: "bottom + rail (3.3 V)" },
  { color: COLORS.gndUi, from: "TDS −", to: "bottom − rail (GND)" },
  { color: COLORS.tds, from: "TDS A", to: "CH0 · chip pin 1, no resistors" },
  { color: "#9ca3af", from: "Probe", to: "white connector on the board" },
];

const CODE = `$ cd ~/water-quality
$ python3 tds_test.py
$ python3 tds_test.py --temp 18
$ python3 tds_test.py --calibrate 707`;

const rand = (i: number) => {
  const s = Math.sin(i * 12.9898) * 43758.5453;
  return s - Math.floor(s);
};

// Tap water pouring in, then a pinch of salt.
const PourAndSalt: React.FC<{ frame: number; level: number }> = ({ frame, level }) => {
  const bottom = BEAKER.y + BEAKER.h - 6;
  const surface = bottom - level * (bottom - BEAKER.water);
  const pour = env(frame, sec(32.5), sec(34.2), 6, 8);
  const shaker = env(frame, sec(34.9), sec(37.6), 8, 10);
  const saltStart = sec(35.3);
  return (
    <g>
      {pour > 0 && (
        <g opacity={pour}>
          <path d="M1584 200 L1636 186 L1648 228 L1598 242 Z" fill="rgba(186,230,253,0.35)" stroke="rgba(226,232,240,0.85)" strokeWidth={2} />
          <rect x={1606} y={236} width={9} height={Math.max(0, surface - 236)} rx={4} fill="#7dd3fc" opacity={0.75} />
          <ellipse cx={1610} cy={surface} rx={16} ry={4} fill="#bae6fd" opacity={0.6} />
        </g>
      )}
      {shaker > 0 && (
        <g opacity={shaker}>
          <g transform="translate(1732 262) rotate(150)">
            <rect x={-14} y={-26} width={28} height={44} rx={6} fill="#e5e7eb" stroke="#94a3b8" strokeWidth={1.5} />
            <rect x={-15} y={-34} width={30} height={10} rx={3} fill="#94a3b8" />
            {[-6, 0, 6].map((hx) => (
              <circle key={hx} cx={hx} cy={-29} r={1.6} fill="#475569" />
            ))}
          </g>
          {Array.from({ length: 18 }, (_, i) => {
            const t = (frame - saltStart - i * 2) / 18;
            if (t < 0 || t > 1) return null;
            const px = 1745 + (rand(i) - 0.5) * 26 + t * 4;
            const py = 291 + t * (surface - 291);
            return <circle key={i} cx={px} cy={py} r={2.6} fill="#f8fafc" opacity={1 - t ** 4} />;
          })}
        </g>
      )}
    </g>
  );
};

const TdsTitle: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = (d: number) => spring({ frame: frame - d, fps, config: { damping: 200 }, durationInFrames: 22 });
  const up = (v: number): React.CSSProperties => ({ opacity: v, transform: `translateY(${(1 - v) * 26}px)` });
  const out = interpolate(frame, [sec(3.0), sec(3.5)], [1, 0], CLAMP);
  const chips = [
    { t: "+ → 3.3 V rail", c: COLORS.v33 },
    { t: "− → GND rail", c: COLORS.gndUi },
    { t: "A → CH0", c: COLORS.tds },
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
              border: `1.5px solid ${alpha(COLORS.tds, 0.55)}`,
              background: alpha(COLORS.tds, 0.12),
              color: "#5eead4",
              fontWeight: 700,
              letterSpacing: 4,
              fontSize: 20,
            }}
          >
            WATER-QUALITY STATION · PART 2
          </div>
          <div style={{ ...up(a(8)), fontSize: 120, fontWeight: 800, color: "#f8fafc", letterSpacing: -3, marginTop: 30, lineHeight: 1 }}>
            TDS Meter
          </div>
          <div
            style={{
              ...up(a(14)),
              fontSize: 46,
              fontWeight: 700,
              marginTop: 22,
              background: "linear-gradient(90deg,#2dd4bf,#60a5fa,#a78bfa)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            3 wires · no resistors · then test it
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
        border: `1.5px solid ${alpha(COLORS.tds, 0.45)}`,
        padding: "20px 24px",
        fontFamily: SANS,
        opacity: Math.min(s, out),
        boxShadow: "0 18px 50px rgba(0,0,0,0.5)",
      }}
    >
      <div style={{ color: "#f1f5f9", fontWeight: 800, fontSize: 22, marginBottom: 12 }}>No resistors this time</div>
      <div style={{ ...line, ...row(0) }}>
        <span>TDS board output</span>
        <b style={{ color: COLORS.tds }}>0 – 2.3 V</b>
      </div>
      <div style={{ ...line, ...row(1) }}>
        <span>MCP3008 input</span>
        <b style={{ color: "#fbbf24" }}>max 3.3 V</b>
      </div>
      <div style={{ ...row(2), fontSize: 23, fontWeight: 800, color: "#4ade80", margin: "12px 0 8px" }}>2.3 V &lt; 3.3 V → A straight to CH0</div>
      <div style={{ ...row(3), fontSize: 16, color: "#94a3b8", lineHeight: 1.4 }}>
        The turbidity sensor needed a divider because it puts out up to 4.5 V.
      </div>
      <div style={{ ...row(4), fontFamily: MONO, fontSize: 16, color: "#e2e8f0", background: "#0f172a", borderRadius: 12, padding: "10px 14px", marginTop: 12 }}>
        V = MCP3008(channel=0).value × 3.3
      </div>
    </div>
  );
};

export const TdsGuide: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const step = stepAt(frame);
  const level = interpolate(frame, [sec(32.8), sec(34.0)], [0, 1], { ...CLAMP, easing: Easing.inOut(Easing.quad) });
  const focus = NUMBERED.includes(step) ? step : null;
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
        cables={{ tds: false, turb: true }}
        chipAt={BEFORE}
        switchA={1}
        powered={frame >= POWER_ON}
        waterLevel={level}
        focusStep={focus}
        dimOthers={focus !== null}
        flowFrom={sec(41)}
        flowIds={["tdsSig", "sclk", "miso", "mosi", "ce0"]}
        extra={<PourAndSalt frame={frame} level={level} />}
      />

      <PinoutCard frame={frame} windows={CARD_WINDOWS} events={CHIP_EVENTS} />
      <Sequence from={0} durationInFrames={sec(3.5)}>
        <TdsTitle />
      </Sequence>
      <Sequence from={sec(8.8)} durationInFrames={sec(4.2)} premountFor={15}>
        <WhyCard duration={sec(4.2)} />
      </Sequence>
      <Sequence from={sec(30.8)} durationInFrames={sec(9.2)} premountFor={15}>
        <TerminalCard duration={sec(9.2)} lines={TERM} title="ssh raspberrypi.local — ~/water-quality" side="left" width={830} fontSize={19} />
      </Sequence>
      <Sequence from={sec(41)} durationInFrames={sec(5)} premountFor={15}>
        <SummaryCard title="TDS cheat-sheet" rows={ROWS} code={CODE} />
      </Sequence>
      <PowerBadge frame={frame} fps={fps} windows={POWER} />
      <CaptionBar steps={STEPS} captions={CAPTIONS} numbered={NUMBERED} labels={STEP_LABELS} showAt={sec(3.5)} />
    </AbsoluteFill>
  );
};
