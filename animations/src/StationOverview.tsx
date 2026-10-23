import React from "react";
import { AbsoluteFill, Easing, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { SANS } from "./fonts";
import { alpha } from "./geometry";
import { COLORS, PH_PINS, TDS_PINS, TURB_PINS, chipPin, piPin } from "./layout";
import { LabelDef, PI_TAGS, RAIL_GLOWS, RESISTORS, WIRES, WireDef, pulse } from "./scene";
import { CLAMP, makeCamera, sec, shot } from "./timeline";
import { PH_WIRES } from "./PhGuide";
import LIMITS from "../../shared/limits.json";
import { BACKDROP, World } from "./components/World";
import { CaptionBar, CaptionSpec, SummaryCard, SummaryRow } from "./components/Overlays";
import {
  Dosing,
  LED_WIRES,
  LedBoard,
  Level,
  Light,
  LightsCard,
  NetworkCard,
  Reading,
  ReadingsCard,
  ResetToast,
  WaterTint,
} from "./components/Station";

const RAW: [string, number, number][] = [
  ["intro", 0, 4],
  ["parts", 4, 11],
  ["signal", 11, 18],
  ["normal", 18, 24],
  ["salt", 24, 33],
  ["latch", 33, 39],
  ["reset", 39, 44],
  ["mud", 44, 52],
  ["acid", 52, 60],
  ["offline", 60, 69],
  ["done", 69, 75],
];
const STEPS = RAW.map(([id, a, b]) => ({ id, from: sec(a), to: sec(b) }));
export const STATION_TOTAL_FRAMES = sec(75);

const camera = makeCamera([
  shot(0, 960, 430, 0.95),
  shot(11, 1010, 480, 1.2),
  shot(18, 1720, 560, 1.25, 1.4),
  shot(69, 960, 430, 0.95, 1.6),
]);

// "Already done" before the video starts: the station is fully wired.
const BEFORE = -sec(60);
const ALL_WIRES: WireDef[] = [...WIRES.filter((w) => w.removeAt === undefined), ...PH_WIRES, ...LED_WIRES].map((w) => ({
  ...w,
  start: BEFORE,
  step: "before",
}));

// ---------------------------------------------------------------- what the probes measure
const k = (times: number[]) => times.map(sec);
const EASE = { ...CLAMP, easing: Easing.inOut(Easing.cubic) };

// The glass is emptied and refilled with fresh water after the salt and the mud test.
const levelAt = (f: number) => interpolate(f, k([33.6, 34.6, 35.2, 36.2, 52.4, 53.4, 54.0, 55.0]), [1, 0, 0, 1, 1, 0, 0, 1], CLAMP);
const tdsAt = (f: number) => (f < sec(35.2) ? interpolate(f, k([26.2, 31.0]), [280, 950], EASE) : 280);
const ntuAt = (f: number) => (f < sec(54.0) ? interpolate(f, k([45.6, 49.4]), [0, 900], EASE) : 0);
const phAt = (f: number) => interpolate(f, k([56.2, 59.4]), [7.2, 5.4], EASE);

const readingAt = (f: number): Reading => {
  if (levelAt(f) < 0.5) return { tds: null, ntu: null, ph: null };
  const n = Math.sin(f * 0.37) + Math.sin(f * 0.13);
  const ntu = ntuAt(f);
  return { tds: tdsAt(f) + n * 2, ntu: ntu < 1 ? 0 : ntu + n * 6, ph: phAt(f) + n * 0.01 };
};

// ---------------------------------------------------------------- the lights, same rules as pi/leds.py
const LEVELS: Level[] = ["none", "yellow", "red"];
const TDS_YELLOW = LIMITS.tds_ppm.yellow;
const TDS_RED = LIMITS.tds_ppm.red;
const PH_OK = [LIMITS.ph.min, LIMITS.ph.max];
const NTU_YELLOW = LIMITS.turbidity_ntu.yellow;

const localLevel = (r: Reading): Light => {
  if (r.tds !== null && r.tds > TDS_RED) return { level: "red", reason: `TDS ${Math.round(r.tds)} ppm` };
  if (r.tds !== null && r.tds > TDS_YELLOW) return { level: "yellow", reason: `TDS ${Math.round(r.tds)} ppm` };
  if (r.ph !== null && (r.ph < PH_OK[0] || r.ph > PH_OK[1])) return { level: "yellow", reason: `pH ${r.ph.toFixed(1)}` };
  if (r.ntu !== null && r.ntu > NTU_YELLOW) return { level: "yellow", reason: `turbidity ${Math.round(r.ntu)} NTU` };
  return { level: "none", reason: "measurement ok" };
};

// "Reset water" in the dashboard; the warnings only go up on their own.
const RESETS = [sec(40.6), sec(54.6)];
const LIGHTS: Light[] = (() => {
  const out: Light[] = [];
  let cur: Light = { level: "none", reason: "measurement ok" };
  for (let f = 0; f < STATION_TOTAL_FRAMES; f++) {
    if (RESETS.includes(f)) cur = { level: "none", reason: "reset in the dashboard" };
    const local = localLevel(readingAt(f));
    if (LEVELS.indexOf(local.level) > LEVELS.indexOf(cur.level)) cur = local;
    out.push(cur);
  }
  return out;
})();
const lightAt = (f: number) => LIGHTS[Math.max(0, Math.min(LIGHTS.length - 1, f))];

// ---------------------------------------------------------------- offline buffer
const OFFLINE = [sec(61.2), sec(66.4)];
const QUEUED = Math.floor((OFFLINE[1] - OFFLINE[0]) / sec(0.4));
const waitingAt = (f: number) => {
  if (f < OFFLINE[0]) return 0;
  const queued = Math.floor((Math.min(f, OFFLINE[1]) - OFFLINE[0]) / sec(0.4));
  // one measurement every 0.4 s while offline (sped up from 30 s); the backlog goes out in a batch
  return f < OFFLINE[1] ? queued : Math.max(0, queued - Math.floor((f - OFFLINE[1]) / 2));
};

// ---------------------------------------------------------------- world decoration
const LABELS: LabelDef[] = [
  { x: 266, y: 6, text: "Status lights", at: sec(4.4), out: sec(10.6) },
  { x: 240, y: 880, text: "Raspberry Pi 5", at: sec(4.8), out: sec(10.6) },
  { x: 967, y: 330, text: "MCP3008 ADC", at: sec(5.2), out: sec(10.6) },
  { x: 790, y: 668, text: "Salt (TDS)", at: sec(5.6), out: sec(10.6) },
  { x: 1049, y: 668, text: "pH", at: sec(6.0), out: sec(10.6) },
  { x: 1290, y: 668, text: "Turbidity", at: sec(6.4), out: sec(10.6) },
  { x: 1720, y: 262, text: "Water sample", at: sec(6.8), out: sec(10.6) },
];

const PULSES = [
  pulse(TDS_PINS.sig, COLORS.tds, 11.6, 13.6),
  pulse(TURB_PINS.out, COLORS.turb, 12.0, 14.0),
  pulse(PH_PINS.sig, COLORS.ph, 12.4, 14.4),
  pulse(chipPin(1), COLORS.tds, 13.2, 15.4, 10),
  pulse(chipPin(2), COLORS.turb, 13.5, 15.7, 10),
  pulse(chipPin(3), COLORS.ph, 13.8, 16.0, 10),
  pulse(piPin(21), COLORS.miso, 14.8, 17.2, 10),
  pulse(piPin(23), COLORS.sclk, 15.0, 17.4, 10),
];

// ---------------------------------------------------------------- captions
const CAPTIONS: Partial<Record<string, CaptionSpec>> = {
  parts: {
    kind: "info",
    title: "The station",
    body: "Raspberry Pi 5 · MCP3008 · {tds:salt (TDS)} · {turb:turbidity} · {ph:pH} · three status lights",
  },
  signal: {
    kind: "info",
    title: "From probe to number",
    body: "Each probe gives a voltage → the {accent:MCP3008} turns it into numbers → the Pi reads them over SPI",
  },
  normal: {
    kind: "check",
    title: "Clear water",
    body: "Only the {test:white} light is on: the station runs and measures nothing unusual. White does not mean safe.",
  },
  salt: { kind: "warn", title: "Salt", body: "TDS rises: over {warn:700 ppm} yellow, over {v5:800 ppm} red. Boiling makes salty water worse." },
  latch: {
    kind: "info",
    title: "The warning stays on",
    body: "Fresh water reads fine again, but the {v5:red} light stays on until a person has checked the water point.",
  },
  reset: { kind: "check", title: "A person resets it", body: "Wendy checks the water point and presses {ok:Reset water} in the dashboard." },
  mud: { kind: "warn", title: "Turbid water", body: "Mud makes the water cloudy: over {warn:500 NTU} the {warn:yellow} light comes on." },
  acid: { kind: "warn", title: "pH", body: "Fresh water and a reset, then acid: below {warn:pH 6.5} the light turns {warn:yellow}." },
  offline: {
    kind: "info",
    title: "No network? No problem",
    body: "Measurements wait in the buffer and go out when the connection is back. The lights work offline.",
  },
  done: {
    kind: "star",
    title: "Measure · warn on site · a person resets",
    body: "{tds:CH0 salt}   {turb:CH1 turbidity}   {ph:CH2 pH}   {test:GPIO 17 / 27 / 22 lights}",
  },
};
const STEP_LABELS = {
  parts: "OVERVIEW",
  signal: "HOW IT MEASURES",
  normal: "CLEAR WATER",
  salt: "SALT",
  latch: "THE LIGHT STAYS ON",
  reset: "HUMAN IN THE LOOP",
  mud: "TURBIDITY",
  acid: "PH",
  offline: "OFFLINE",
  done: "SUMMARY",
};

const ROWS: SummaryRow[] = [
  { color: COLORS.tds, from: "Salt (TDS)", to: `CH0 · > ${TDS_YELLOW} ppm yellow · > ${TDS_RED} ppm red` },
  { color: COLORS.turb, from: "Turbidity", to: `CH1 · > ${NTU_YELLOW} NTU yellow` },
  { color: COLORS.ph, from: "pH", to: `CH2 · outside ${PH_OK[0]}–${PH_OK[1]} yellow` },
  { color: "#f8fafc", from: "Lights", to: "GPIO 17 / 27 / 22 · stay on until reset" },
];

const CODE = `$ .venv/bin/python uploader.py
# measures every 30 s, buffers offline,
# uploads to Azure, drives the lights
# limits: shared/limits.json (placeholders)`;

const StationTitle: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = (d: number) => spring({ frame: frame - d, fps, config: { damping: 200 }, durationInFrames: 22 });
  const up = (v: number): React.CSSProperties => ({ opacity: v, transform: `translateY(${(1 - v) * 26}px)` });
  const out = interpolate(frame, [sec(3.5), sec(4)], [1, 0], CLAMP);
  const chips = [
    { t: "Salt (TDS) → CH0", c: COLORS.tds },
    { t: "Turbidity → CH1", c: COLORS.turb },
    { t: "pH → CH2", c: COLORS.ph },
    { t: "Lights → GPIO 17 · 27 · 22", c: "#f8fafc" },
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
              border: `1.5px solid ${alpha(COLORS.accent, 0.55)}`,
              background: alpha(COLORS.accent, 0.12),
              color: "#93c5fd",
              fontWeight: 700,
              letterSpacing: 4,
              fontSize: 20,
            }}
          >
            Wendy's Water Wonder · THE STATION
          </div>
          <div style={{ ...up(a(8)), fontSize: 110, fontWeight: 800, color: "#f8fafc", letterSpacing: -3, marginTop: 30, lineHeight: 1 }}>
            How the station works
          </div>
          <div
            style={{
              ...up(a(14)),
              fontSize: 46,
              fontWeight: 700,
              marginTop: 22,
              background: "linear-gradient(90deg,#2dd4bf,#facc15,#ef4444)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            measure · warn on site · a person resets
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

export const StationOverview: React.FC = () => {
  const frame = useCurrentFrame();
  const level = levelAt(frame);
  const reading = readingAt(frame);
  const light = lightAt(frame);
  const local = localLevel(reading);
  const latched = light.level !== "none" && reading.tds !== null && local.level === "none";
  // While the reading is still bad, show today's value instead of the one that switched the light on
  const shown: Light = local.level === light.level ? local : light;
  const mud = Math.min(interpolate(frame, k([46.2, 49.4]), [0, 0.45], CLAMP), frame < sec(54.0) ? 1 : 0);
  const acid = interpolate(frame, k([56.4, 58.4]), [0, 0.16], CLAMP);
  const online = frame < OFFLINE[0] || frame >= OFFLINE[1];
  const waiting = waitingAt(frame);
  const sent = frame >= OFFLINE[1] ? QUEUED - waiting : 0;
  const cards = { from: sec(18.3), dur: sec(50.7) };
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
        powered
        waterLevel={level}
        ph={{ at: BEFORE, cap: 0 }}
        focusStep={null}
        dimOthers={false}
        flowFrom={sec(12)}
        flowIds={["tdsSig", "turbOut", "jumperCh1", "phSig", "sclk", "miso", "mosi", "ce0"]}
        extra={
          <>
            <LedBoard level={light.level} />
            <WaterTint level={level} color="#78350f" opacity={mud} />
            <WaterTint level={level} color="#bef264" opacity={acid} />
            <Dosing frame={frame} kind="salt" from={sec(25.4)} to={sec(30.4)} level={level} />
            <Dosing frame={frame} kind="mud" from={sec(44.8)} to={sec(48.8)} level={level} />
            <Dosing frame={frame} kind="acid" from={sec(55.4)} to={sec(58.6)} level={level} />
          </>
        }
      />

      <Sequence from={cards.from} durationInFrames={cards.dur} premountFor={15}>
        <ReadingsCard reading={reading} duration={cards.dur} />
        <LightsCard light={shown} latched={latched} duration={cards.dur} />
      </Sequence>
      <Sequence from={sec(60.2)} durationInFrames={sec(8.8)} premountFor={15}>
        <NetworkCard online={online} waiting={waiting} sent={sent} duration={sec(8.8)} />
      </Sequence>
      <Sequence from={sec(39.9)} durationInFrames={sec(2.8)} premountFor={15}>
        <ResetToast duration={sec(2.8)} by="Wendy" />
      </Sequence>
      <Sequence from={sec(53.9)} durationInFrames={sec(2.6)} premountFor={15}>
        <ResetToast duration={sec(2.6)} by="Wendy" />
      </Sequence>
      <Sequence from={sec(69.6)} durationInFrames={sec(5.4)} premountFor={15}>
        <SummaryCard title="The station at a glance" rows={ROWS} code={CODE} />
      </Sequence>
      <Sequence from={0} durationInFrames={sec(4)}>
        <StationTitle />
      </Sequence>
      <CaptionBar steps={STEPS} captions={CAPTIONS} numbered={[]} labels={STEP_LABELS} showAt={sec(4)} />
    </AbsoluteFill>
  );
};
