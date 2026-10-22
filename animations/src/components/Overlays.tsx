import React from "react";
import { AbsoluteFill, Easing, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { MONO, SANS } from "../fonts";
import { alpha, Pt } from "../geometry";
import { CHIP_PIN_NAMES, COLORS, VIEW, hole, rail } from "../layout";
import { CARD_WINDOWS, CHIP_EVENTS, ChipEvent } from "../scene";
import { CLAMP, NUMBERED, POWER_WINDOWS, STEPS, cameraAt, env, sec } from "../timeline";

type StepRange = { id: string; from: number; to: number };

// ---------------------------------------------------------------- rich text
// "{v33:pin 1}" renders a coloured chip; plain text stays plain.
const chipStyle = (key: string, active: boolean): React.CSSProperties => {
  const base: React.CSSProperties = {
    display: "inline-block",
    padding: "1px 12px",
    borderRadius: 999,
    fontWeight: 700,
    margin: "2px 3px",
    opacity: active ? 1 : 0.32,
    whiteSpace: "nowrap",
  };
  if (key === "gnd") return { ...base, background: "#05070a", border: "1.5px solid #8b95a5", color: "#f1f5f9" };
  const c = (COLORS as Record<string, string>)[key] ?? COLORS.accent;
  return { ...base, background: alpha(c, 0.16), border: `1.5px solid ${alpha(c, 0.75)}`, color: c };
};

const Rich: React.FC<{ text: string; frame: number; reveal?: number[] }> = ({ text, frame, reveal }) => {
  const re = /\{(\w+):([^}]*)\}/g;
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let k = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(<span key={`t${k}`}>{text.slice(last, m.index)}</span>);
    const active = !reveal || frame >= (reveal[k] ?? 0);
    nodes.push(
      <span key={`c${k}`} style={chipStyle(m[1], active)}>
        {m[2]}
      </span>,
    );
    last = m.index + m[0].length;
    k++;
  }
  if (last < text.length) nodes.push(<span key="end">{text.slice(last)}</span>);
  return <>{nodes}</>;
};

// ---------------------------------------------------------------- captions
type Kind = "num" | "warn" | "check" | "info" | "star";
export type CaptionSpec = { kind: Kind; badge?: string; title: string; body: string; reveal?: number[] };

const CAPTIONS: Partial<Record<string, CaptionSpec>> = {
  parts: {
    kind: "info",
    title: "What you need",
    body: "Raspberry Pi 5 · half-size breadboard · MCP3008 chip · TDS board · turbidity board · 10 kΩ + 20 kΩ resistors · jumper wires",
  },
  safety: {
    kind: "warn",
    badge: "!",
    title: "Unplug the Pi before you start",
    body: "Wire everything with the power OFF. Plug it in only when a step tells you to.",
  },
  chip: {
    kind: "num",
    badge: "1",
    title: "Place the MCP3008",
    body: "Press it across the centre gap with the {accent:notch facing left}. Pin 1 is bottom-left, next to the dot.",
  },
  rails: {
    kind: "num",
    badge: "2",
    title: "Bring 3.3 V and GND to the rails",
    body: "{v33:Pi pin 1 · 3.3 V} → top {v33:+} rail        {gnd:Pi pin 6 · GND} → top {gnd:−} rail",
    reveal: [0, 0, sec(3.8), sec(3.8)],
  },
  bridge: {
    kind: "num",
    badge: "3",
    title: "Bridge the rails",
    body: "{v33:top + → bottom +}  {gnd:top − → bottom −}   now both halves of the board have 3.3 V and GND",
    reveal: [0, sec(2.4)],
  },
  chippower: {
    kind: "num",
    badge: "4",
    title: "Power the chip",
    body: "{v33:VDD 16} {v33:VREF 15} → + rail        {gnd:AGND 14} {gnd:DGND 9} → − rail",
    reveal: [0, sec(1.6), sec(2.9), sec(4.1)],
  },
  spi: {
    kind: "num",
    badge: "5",
    title: "Connect the SPI data lines",
    body: "{sclk:CLK 13 → Pi 23 (SCLK)} {miso:DOUT 12 → Pi 21 (MISO)} {mosi:DIN 11 → Pi 19 (MOSI)} {ce0:CS 10 → Pi 24 (CE0)}",
    reveal: [sec(0.6), sec(3.3), sec(6.0), sec(8.7)],
  },
  test: {
    kind: "check",
    title: "Checkpoint: test the ADC",
    body: "Power on · jumper CH0 → GND reads {ok:0.0} · CH0 → 3.3 V reads {ok:1.0} · power off, remove the test wire",
  },
  tds: {
    kind: "num",
    badge: "6",
    title: "Connect the TDS sensor",
    body: "{v33:VCC → + rail (3.3 V)}  {gnd:GND → − rail}  {tds:A → CH0 column (chip pin 1)}",
    reveal: [sec(0.7), sec(2.4), sec(4.0)],
  },
  turbpower: {
    kind: "num",
    badge: "7",
    title: "Power the turbidity sensor",
    body: "Switch to {turb:A}   {v5:Pi pin 2 · 5 V → VCC}  straight from the Pi, never on the 3.3 V rail   {gnd:GND → − rail}",
    reveal: [sec(0.6), sec(2.5), sec(7.0)],
  },
  divider: {
    kind: "num",
    badge: "8",
    title: "Voltage divider into CH1",
    body: "{gnd:20 kΩ: node → − rail}  {turb:10 kΩ: node → OUT column}  {turb:jumper: node → CH1}  {turb:plug OUT in last}",
    reveal: [sec(0.8), sec(2.4), sec(4.2), sec(6.4)],
  },
  measure: {
    kind: "check",
    title: "Measure before you trust it",
    body: "Power on, probe in clear water: the divider node (= CH1) reads about {ok:2.7 V}. It must never go above 3.3 V.",
  },
  done: {
    kind: "star",
    title: "All wired!",
    body: "{tds:CH0 = TDS}  {turb:CH1 = turbidity}   read both from Python with gpiozero (cheat-sheet on the right)",
  },
};

const BADGE_BG: Record<Kind, string> = {
  num: "linear-gradient(135deg,#3b82f6,#6366f1)",
  warn: "linear-gradient(135deg,#f59e0b,#ef4444)",
  check: "linear-gradient(135deg,#22c55e,#0d9488)",
  info: "linear-gradient(135deg,#8b5cf6,#6366f1)",
  star: "linear-gradient(135deg,#f472b6,#8b5cf6)",
};

const BadgeIcon: React.FC<{ spec: CaptionSpec }> = ({ spec }) => {
  if (spec.kind === "check") {
    return (
      <svg width={44} height={44} viewBox="0 0 24 24">
        <path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (spec.kind === "star") {
    return (
      <svg width={44} height={44} viewBox="0 0 24 24">
        <path d="M12 3.5l2.6 5.5 6 .7-4.4 4.1 1.2 5.9L12 16.8l-5.4 2.9 1.2-5.9L3.4 9.7l6-.7z" fill="#fff" />
      </svg>
    );
  }
  if (spec.kind === "info") {
    return (
      <svg width={44} height={44} viewBox="0 0 24 24">
        <rect x="6.5" y="4" width="11" height="16" rx="2" fill="#fff" />
        {[7.5, 12, 16.5].map((y) => (
          <g key={y}>
            <rect x="3" y={y - 0.9} width="3.5" height="1.8" rx="0.6" fill="#fff" />
            <rect x="17.5" y={y - 0.9} width="3.5" height="1.8" rx="0.6" fill="#fff" />
          </g>
        ))}
      </svg>
    );
  }
  return <span>{spec.badge}</span>;
};

const CaptionContent: React.FC<{ spec: CaptionSpec; duration: number }> = ({ spec, duration }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const inS = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 16 });
  const out = interpolate(frame, [duration - 8, duration], [1, 0], CLAMP);
  return (
    <AbsoluteFill style={{ flexDirection: "row", alignItems: "center", padding: "0 360px 0 32px", gap: 28, opacity: Math.min(inS, out) }}>
      <div
        style={{
          width: 84,
          height: 84,
          borderRadius: 42,
          flexShrink: 0,
          background: BADGE_BG[spec.kind],
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontSize: 42,
          fontWeight: 800,
          boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
          transform: `scale(${0.6 + 0.4 * inS})`,
        }}
      >
        <BadgeIcon spec={spec} />
      </div>
      <div style={{ flex: 1, transform: `translateY(${(1 - inS) * 14}px)` }}>
        <div style={{ fontSize: 34, fontWeight: 800, color: "#f8fafc", letterSpacing: -0.5 }}>{spec.title}</div>
        <div style={{ fontSize: 22, color: "#b6c3d6", marginTop: 6, lineHeight: 1.45, whiteSpace: "pre-wrap" }}>
          <Rich text={spec.body} frame={frame} reveal={spec.reveal} />
        </div>
      </div>
    </AbsoluteFill>
  );
};

const STEP_LABEL: Partial<Record<string, string>> = {
  parts: "GET READY",
  safety: "SAFETY FIRST",
  test: "CHECKPOINT",
  measure: "CHECKPOINT",
  done: "COMPLETE",
};

type DotsProps = { frame: number; steps: StepRange[]; numbered: string[]; labels: Partial<Record<string, string>> };

const StepDots: React.FC<DotsProps> = ({ frame, steps, numbered, labels }) => {
  const id = (steps.find((s) => frame >= s.from && frame < s.to) ?? steps[steps.length - 1]).id;
  const idx = numbered.indexOf(id);
  return (
    <div
      style={{
        position: "absolute",
        right: 34,
        top: 0,
        bottom: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "flex-end",
        gap: 14,
      }}
    >
      <div style={{ fontSize: 16, letterSpacing: 2.5, color: "#8ea0bb", fontWeight: 700 }}>
        {idx >= 0 ? `STEP ${idx + 1} OF ${numbered.length}` : labels[id] ?? ""}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {numbered.map((s, i) => {
          const st = steps.find((x) => x.id === s)!;
          const current = i === idx;
          const finished = frame >= st.to;
          return (
            <div
              key={s}
              style={{
                width: current ? 40 : 14,
                height: 14,
                borderRadius: 7,
                background: current ? "#60a5fa" : finished ? "rgba(59,130,246,0.75)" : "transparent",
                border: "2px solid #3b82f6",
              }}
            />
          );
        })}
      </div>
    </div>
  );
};

type CaptionBarProps = {
  steps?: StepRange[];
  captions?: Partial<Record<string, CaptionSpec>>;
  numbered?: string[];
  labels?: Partial<Record<string, string>>;
  showAt?: number;
};

export const CaptionBar: React.FC<CaptionBarProps> = ({
  steps = STEPS,
  captions = CAPTIONS,
  numbered = NUMBERED,
  labels = STEP_LABEL,
  showAt = sec(4),
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - showAt, fps, config: { damping: 200 }, durationInFrames: 20 });
  if (s <= 0.001) return null;
  const cur = steps.find((x) => frame >= x.from && frame < x.to) ?? steps[steps.length - 1];
  const progress = interpolate(frame, [cur.from, cur.to], [0, 1], CLAMP);
  return (
    <div
      style={{
        position: "absolute",
        left: 40,
        right: 40,
        bottom: 30,
        height: 140,
        borderRadius: 28,
        background: "linear-gradient(180deg, rgba(17,26,46,0.95), rgba(9,14,27,0.97))",
        border: "1.5px solid rgba(148,163,184,0.22)",
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        transform: `translateY(${(1 - s) * 190}px)`,
        overflow: "hidden",
        fontFamily: SANS,
      }}
    >
      {steps
        .filter((st) => captions[st.id])
        .map((st) => (
          <Sequence key={st.id} from={st.from} durationInFrames={st.to - st.from}>
            <CaptionContent spec={captions[st.id]!} duration={st.to - st.from} />
          </Sequence>
        ))}
      <StepDots frame={frame} steps={steps} numbered={numbered} labels={labels} />
      <div style={{ position: "absolute", left: 0, bottom: 0, height: 4, width: `${progress * 100}%`, background: "linear-gradient(90deg,#3b82f6,#a78bfa)" }} />
    </div>
  );
};

// ---------------------------------------------------------------- MCP3008 pinout card
export const PinoutCard: React.FC<{ frame: number; windows?: [number, number][]; events?: ChipEvent[] }> = ({
  frame,
  windows = CARD_WINDOWS,
  events = CHIP_EVENTS,
}) => {
  const vis = Math.max(0, ...windows.map(([a, b]) => env(frame, a, b, 12, 10)));
  if (vis <= 0) return null;
  const top = [16, 15, 14, 13, 12, 11, 10, 9];
  const bottom = [1, 2, 3, 4, 5, 6, 7, 8];
  const state = (pin: number) => {
    let color: string | null = null;
    let focus = 0;
    let focusColor: string = COLORS.accent;
    for (const e of events) {
      if (e.pin !== pin) continue;
      if (e.at !== undefined && frame >= e.at) color = e.color;
      if (e.focus) {
        const f = env(frame, e.focus[0], e.focus[1], 6, 6);
        if (f > focus) {
          focus = f;
          focusColor = e.color;
        }
      }
    }
    return { color, focus, focusColor };
  };
  const px = (i: number) => 53.5 + i * 39;
  const pinEl = (pin: number, i: number, isTop: boolean) => {
    const st = state(pin);
    const x = px(i);
    const fill = st.focus > 0 ? st.focusColor : st.color ?? "#9aa3ae";
    const nameColor = st.focus > 0 ? st.focusColor : st.color ?? "#cbd5e1";
    const y = isTop ? 66 : 146;
    return (
      <g key={pin}>
        {st.focus > 0 && <circle cx={x} cy={y + 9} r={18} fill={st.focusColor} opacity={0.4 * st.focus} filter="url(#cardGlow)" />}
        <rect x={x - 7} y={y} width={14} height={18} rx={2} fill={fill} />
        <text x={x} y={isTop ? 99 : 140} textAnchor="middle" fontSize={11} fill="#7c8594" fontFamily={SANS} fontWeight={600}>
          {pin}
        </text>
        <text x={x} y={isTop ? 56 : 184} textAnchor="middle" fontSize={12.5} fontWeight={800} fill={nameColor} fontFamily={SANS}>
          {CHIP_PIN_NAMES[pin]}
        </text>
      </g>
    );
  };
  return (
    <div
      style={{
        position: "absolute",
        right: 40,
        top: 40,
        width: 380,
        borderRadius: 22,
        background: "rgba(10,16,30,0.94)",
        border: "1.5px solid rgba(148,163,184,0.25)",
        boxShadow: "0 18px 50px rgba(0,0,0,0.5)",
        opacity: vis,
        transform: `translateY(${-(1 - vis) * 30}px)`,
        padding: "16px 0 6px",
        fontFamily: SANS,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", padding: "0 22px", alignItems: "baseline" }}>
        <div style={{ color: "#f1f5f9", fontWeight: 800, fontSize: 20 }}>MCP3008 pinout</div>
        <div style={{ color: "#8ea0bb", fontSize: 14, fontWeight: 600 }}>top view · notch left</div>
      </div>
      <svg width={380} height={200} viewBox="0 0 380 200">
        <defs>
          <filter id="cardGlow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>
        <rect x={34} y={84} width={312} height={62} rx={8} fill="#1b1d22" stroke="#3a3f47" strokeWidth={1.5} />
        <path d="M34 105 A10 10 0 0 1 34 125 Z" fill="#07080a" />
        <circle cx={52} cy={132} r={4.5} fill="#2c3036" stroke="#6b7280" />
        <text x={196} y={121} textAnchor="middle" fill="#9aa3af" fontWeight={800} fontSize={16} letterSpacing={2} fontFamily={SANS}>
          MCP3008
        </text>
        {top.map((p, i) => pinEl(p, i, true))}
        {bottom.map((p, i) => pinEl(p, i, false))}
      </svg>
    </div>
  );
};

// ---------------------------------------------------------------- title + safety
export const TitleCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = (d: number) => spring({ frame: frame - d, fps, config: { damping: 200 }, durationInFrames: 22 });
  const up = (v: number): React.CSSProperties => ({ opacity: v, transform: `translateY(${(1 - v) * 26}px)` });
  const out = interpolate(frame, [sec(3.3), sec(4)], [1, 0], CLAMP);
  const chips = [
    { t: "Raspberry Pi 5", c: "#4ade80" },
    { t: "MCP3008 ADC", c: "#60a5fa" },
    { t: "TDS sensor", c: COLORS.tds },
    { t: "Turbidity sensor", c: COLORS.turb },
  ];
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: out, fontFamily: SANS }}>
      <div style={{ textAlign: "center", marginTop: -40 }}>
        <div
          style={{
            ...up(a(2)),
            display: "inline-block",
            padding: "10px 24px",
            borderRadius: 999,
            border: "1.5px solid rgba(96,165,250,0.55)",
            background: "rgba(59,130,246,0.12)",
            color: "#93c5fd",
            fontWeight: 700,
            letterSpacing: 4,
            fontSize: 20,
          }}
        >
          WATER-QUALITY STATION · WIRING GUIDE
        </div>
        <div style={{ ...up(a(8)), fontSize: 120, fontWeight: 800, color: "#f8fafc", letterSpacing: -3, marginTop: 30, lineHeight: 1 }}>
          Wire it up
        </div>
        <div
          style={{
            ...up(a(14)),
            fontSize: 46,
            fontWeight: 700,
            marginTop: 22,
            background: "linear-gradient(90deg,#4ade80,#60a5fa,#2dd4bf,#f472b6)",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
          }}
        >
          Raspberry Pi 5 + MCP3008 + 2 water sensors
        </div>
        <div style={{ ...up(a(20)), fontSize: 26, color: "#a9b7cb", marginTop: 20 }}>Step by step on a breadboard · about 90 seconds</div>
        <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 44 }}>
          {chips.map((c, i) => (
            <div
              key={c.t}
              style={{
                ...up(a(28 + i * 5)),
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
  );
};

export const SafetyCard: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 15, stiffness: 160 } });
  const fade = Math.min(interpolate(frame, [0, 8], [0, 1], CLAMP), interpolate(frame, [duration - 10, duration], [1, 0], CLAMP));
  return (
    <AbsoluteFill style={{ opacity: fade, alignItems: "center", justifyContent: "center", fontFamily: SANS }}>
      <AbsoluteFill style={{ background: "rgba(3,6,12,0.62)" }} />
      <div
        style={{
          transform: `translateY(-60px) scale(${0.85 + 0.15 * s})`,
          width: 900,
          borderRadius: 30,
          padding: "40px 48px",
          background: "linear-gradient(180deg, rgba(48,24,10,0.97), rgba(26,13,8,0.97))",
          border: "2px solid rgba(245,158,11,0.6)",
          display: "flex",
          gap: 36,
          alignItems: "center",
          boxShadow: "0 30px 80px rgba(0,0,0,0.6)",
        }}
      >
        <svg width={130} height={130} viewBox="0 0 64 64" style={{ flexShrink: 0 }}>
          <circle cx="32" cy="32" r="30" fill="rgba(245,158,11,0.18)" stroke="#f59e0b" strokeWidth="2.5" />
          <rect x="22" y="22" width="20" height="16" rx="3" fill="#fbbf24" />
          <rect x="25" y="13" width="3.5" height="10" rx="1.5" fill="#fbbf24" />
          <rect x="35.5" y="13" width="3.5" height="10" rx="1.5" fill="#fbbf24" />
          <path d="M32 38 V50" stroke="#fbbf24" strokeWidth="4" strokeLinecap="round" />
          <path d="M14 14 L50 50" stroke="#ef4444" strokeWidth="5" strokeLinecap="round" />
        </svg>
        <div>
          <div style={{ color: "#fbbf24", fontWeight: 800, letterSpacing: 3, fontSize: 18 }}>SAFETY FIRST</div>
          <div style={{ color: "#fff7ed", fontWeight: 800, fontSize: 48, marginTop: 6, lineHeight: 1.1 }}>Unplug the Pi before wiring</div>
          <div style={{ color: "#fed7aa", fontSize: 24, marginTop: 14, lineHeight: 1.4 }}>
            A wrong wire with the power on can fry a GPIO pin. Plug in only when a step tells you to.
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- checkpoint terminal
// out = program output (green), info = neutral program output (grey).
export type TermLine = { at: number; text: string; out?: boolean; info?: boolean };

const TERMINAL_LINES: TermLine[] = [
  { at: sec(0.4), text: ">>> from gpiozero import MCP3008" },
  { at: sec(0.8), text: ">>> ch0 = MCP3008(channel=0)" },
  { at: sec(1.2), text: ">>> ch0.value        # CH0 → GND" },
  { at: sec(1.6), text: "0.0", out: true },
  { at: sec(3.2), text: ">>> ch0.value        # CH0 → 3.3 V" },
  { at: sec(3.6), text: "1.0", out: true },
];

type TerminalProps = {
  duration: number;
  lines?: TermLine[];
  title?: string;
  side?: "left" | "right";
  width?: number;
  fontSize?: number;
};

export const TerminalCard: React.FC<TerminalProps> = ({
  duration,
  lines = TERMINAL_LINES,
  title = "python3 — raspberrypi",
  side = "right",
  width = 700,
  fontSize = 23,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 16 });
  const out = interpolate(frame, [duration - 10, duration], [1, 0], CLAMP);
  return (
    <div
      style={{
        position: "absolute",
        ...(side === "right" ? { right: 40 } : { left: 40 }),
        top: 110,
        width,
        opacity: Math.min(s, out),
        transform: `translateY(${(1 - s) * -20}px)`,
        borderRadius: 18,
        overflow: "hidden",
        background: "#0a0f1a",
        border: "1.5px solid rgba(148,163,184,0.3)",
        boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
      }}
    >
      <div style={{ height: 40, background: "#141b2b", display: "flex", alignItems: "center", gap: 8, padding: "0 16px" }}>
        {["#ef4444", "#f59e0b", "#22c55e"].map((c) => (
          <div key={c} style={{ width: 13, height: 13, borderRadius: 7, background: c }} />
        ))}
        <div style={{ marginLeft: 12, color: "#8ea0bb", fontFamily: SANS, fontSize: 15, fontWeight: 600 }}>{title}</div>
      </div>
      <div style={{ padding: "18px 22px 22px", fontFamily: MONO, fontSize, lineHeight: 1.6, minHeight: 250 }}>
        {lines.map((l, i) => {
          if (frame < l.at) return null;
          const printed = l.out || l.info;
          const shown = printed ? l.text : l.text.slice(0, Math.floor((frame - l.at) * 2.4));
          const hash = printed ? -1 : shown.indexOf("#");
          const code = hash >= 0 ? shown.slice(0, hash) : shown;
          const comment = hash >= 0 ? shown.slice(hash) : "";
          const prompt = printed ? null : code.startsWith(">>>") ? ">>>" : code.startsWith("$") ? "$" : null;
          const color = l.info ? "#94a3b8" : l.out ? "#4ade80" : "#e2e8f0";
          return (
            <div key={i} style={{ whiteSpace: "pre", color, fontWeight: l.out ? 600 : 400 }}>
              {prompt ? (
                <>
                  <span style={{ color: prompt === "$" ? "#4ade80" : "#60a5fa" }}>{prompt}</span>
                  {code.slice(prompt.length)}
                </>
              ) : (
                code
              )}
              <span style={{ color: "#64748b" }}>{comment}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const Bolt: React.FC = () => (
  <svg width={22} height={22} viewBox="0 0 24 24">
    <path d="M13 2 L4 14 H11 L10 22 L20 9 H13 Z" fill="#fff" />
  </svg>
);

type PowerWindow = { on: number; off: number; end: number };

export const PowerBadge: React.FC<{ frame: number; fps: number; windows?: PowerWindow[] }> = ({ frame, fps, windows = POWER_WINDOWS }) => {
  const w = windows.find((x) => frame >= x.on && frame < x.end);
  if (!w) return null;
  const on = frame < w.off;
  const pop = spring({ frame: frame - (on ? w.on : w.off), fps, config: { damping: 14, stiffness: 200 } });
  const fade = interpolate(frame, [w.end - 10, w.end], [1, 0], CLAMP);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: 30, display: "flex", justifyContent: "center", opacity: fade, fontFamily: SANS }}>
      <div
        style={{
          transform: `scale(${0.7 + 0.3 * pop})`,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 26px",
          borderRadius: 999,
          background: on ? "rgba(22,163,74,0.95)" : "rgba(71,85,105,0.95)",
          color: "#fff",
          fontWeight: 800,
          fontSize: 22,
          letterSpacing: 2,
          boxShadow: "0 12px 30px rgba(0,0,0,0.45)",
        }}
      >
        <Bolt />
        {on ? "POWER ON" : "POWER OFF — UNPLUG THE PI"}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------- divider maths
export const MathCard: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 16 });
  const out = interpolate(frame, [duration - 10, duration], [1, 0], CLAMP);
  const row = (i: number): React.CSSProperties => {
    const r = spring({ frame: frame - 10 - i * 10, fps, config: { damping: 200 }, durationInFrames: 14 });
    return { opacity: r, transform: `translateX(${(1 - r) * 16}px)` };
  };
  const line: React.CSSProperties = { display: "flex", justifyContent: "space-between", fontSize: 19, color: "#cbd5e1", marginBottom: 6 };
  return (
    <div
      style={{
        position: "absolute",
        right: 40,
        bottom: 200,
        width: 420,
        borderRadius: 22,
        background: "rgba(10,16,30,0.95)",
        border: `1.5px solid ${alpha(COLORS.turb, 0.45)}`,
        padding: "20px 24px",
        fontFamily: SANS,
        opacity: Math.min(s, out),
        boxShadow: "0 18px 50px rgba(0,0,0,0.5)",
      }}
    >
      <div style={{ color: "#f1f5f9", fontWeight: 800, fontSize: 22, marginBottom: 12 }}>Why the divider?</div>
      <div style={{ ...line, ...row(0) }}>
        <span>Turbidity OUT</span>
        <b style={{ color: "#f87171" }}>up to 4.5 V</b>
      </div>
      <div style={{ ...line, ...row(1) }}>
        <span>MCP3008 input</span>
        <b style={{ color: "#fbbf24" }}>max 3.3 V</b>
      </div>
      <div style={{ ...row(2), fontFamily: MONO, fontSize: 17, color: "#e2e8f0", background: "#0f172a", borderRadius: 12, padding: "12px 14px", margin: "12px 0" }}>
        V_CH1 = V_OUT × 20k / (10k + 20k)
      </div>
      <div style={{ ...row(3), fontSize: 24, fontWeight: 800, color: "#4ade80" }}>4.5 V → 3.0 V · safe</div>
      <div style={{ ...row(4), fontSize: 17, color: "#94a3b8", marginTop: 8 }}>In code: V_OUT = V_CH1 × 1.5</div>
    </div>
  );
};

// ---------------------------------------------------------------- multimeter
export const Multimeter: React.FC<{ frame: number; fps: number }> = ({ frame, fps }) => {
  const from = sec(85.8);
  const to = sec(91);
  const vis = env(frame, from, to, 14, 10);
  if (vis <= 0) return null;
  const slide = spring({ frame: frame - from, fps, config: { damping: 200 }, durationInFrames: 18 });
  const cam = cameraAt(frame);
  const toScreen = (p: Pt): Pt => ({ x: VIEW.x + (p.x - cam.cx) * cam.z, y: VIEW.y + (p.y - cam.cy) * cam.z });
  const probeIn = interpolate(frame, [sec(86.2), sec(87.0)], [0, 1], { ...CLAMP, easing: Easing.out(Easing.cubic) });
  const reading =
    frame < sec(87)
      ? 0
      : interpolate(frame, [sec(87), sec(88.2)], [0, 2.71], { ...CLAMP, easing: Easing.out(Easing.cubic) }) +
        (frame > sec(88.2) ? Math.sin(frame * 0.7) * 0.005 : 0);
  const okS = spring({ frame: frame - sec(88.4), fps, config: { damping: 14 } });
  const meter = { x: 1500, y: 130, w: 330, h: 470 };
  const dx = (1 - slide) * 80;
  const jackR = { x: meter.x + 110 + dx, y: meter.y + meter.h - 46 };
  const jackB = { x: meter.x + 220 + dx, y: meter.y + meter.h - 46 };
  const ang = (-38 * Math.PI) / 180;
  const penLen = 120;
  const pen = (tip: Pt, color: string, extra: number) => {
    const tx = tip.x + (1 - probeIn) * (160 + extra);
    const ty = tip.y - (1 - probeIn) * 110;
    return { tx, ty, end: { x: tx + Math.cos(ang) * penLen, y: ty + Math.sin(ang) * penLen }, color };
  };
  // Row e of the node column is free (the 20 kΩ body covers row a).
  const pr = pen(toScreen(hole(21, "e")), "#dc2626", 0);
  const pb = pen(toScreen(rail(22, "botMinus")), "#1f2328", 40);
  const lead = (a: Pt, b: Pt, color: string) => (
    <path
      d={`M${a.x} ${a.y} C${a.x + 120} ${a.y - 40}, ${b.x - 60} ${b.y + 160}, ${b.x} ${b.y}`}
      fill="none"
      stroke={color}
      strokeWidth={7}
      strokeLinecap="round"
    />
  );
  return (
    <AbsoluteFill style={{ opacity: vis, fontFamily: SANS }}>
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        {lead(pb.end, jackB, "#111827")}
        {lead(pr.end, jackR, "#dc2626")}
        {[pr, pb].map((p, i) => (
          <g key={i} transform={`translate(${p.tx} ${p.ty}) rotate(-38)`}>
            <path d="M0 0 L22 -3 L22 3 Z" fill="#d1d5db" />
            <rect x={22} y={-9} width={penLen - 22} height={18} rx={7} fill={p.color} stroke="#000" strokeOpacity={0.5} />
            <rect x={40} y={-12} width={9} height={24} rx={3} fill={p.color} stroke="#000" strokeOpacity={0.4} />
          </g>
        ))}
        {probeIn > 0.98 && <circle cx={pr.tx} cy={pr.ty} r={9} fill="#fde047" opacity={0.8} filter="url(#glow)" />}
      </svg>
      <div
        style={{
          position: "absolute",
          left: meter.x,
          top: meter.y,
          width: meter.w,
          height: meter.h,
          transform: `translateX(${dx}px)`,
          borderRadius: 36,
          background: "linear-gradient(180deg,#facc15,#d9a406)",
          boxShadow: "0 24px 60px rgba(0,0,0,0.55)",
          padding: 18,
          boxSizing: "border-box",
        }}
      >
        <div style={{ width: "100%", height: "100%", borderRadius: 24, background: "#1f2430", padding: 22, boxSizing: "border-box" }}>
          <div
            style={{
              height: 130,
              borderRadius: 12,
              background: "linear-gradient(180deg,#c7d3b0,#aebc94)",
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "flex-end",
              padding: "0 18px 14px",
              fontFamily: MONO,
              color: "#1f2a1a",
              boxSizing: "border-box",
            }}
          >
            <span style={{ fontSize: 76, fontWeight: 600, lineHeight: 1 }}>{reading.toFixed(2)}</span>
            <span style={{ fontSize: 30, marginLeft: 8, fontWeight: 600 }}>V</span>
          </div>
          <svg width={250} height={170} viewBox="0 0 250 170" style={{ display: "block", margin: "10px auto 0" }}>
            <circle cx={125} cy={85} r={62} fill="#2b313f" stroke="#111" strokeWidth={3} />
            {[-120, -60, 0, 60, 120].map((a) => (
              <line
                key={a}
                x1={125 + Math.sin((a * Math.PI) / 180) * 70}
                y1={85 - Math.cos((a * Math.PI) / 180) * 70}
                x2={125 + Math.sin((a * Math.PI) / 180) * 80}
                y2={85 - Math.cos((a * Math.PI) / 180) * 80}
                stroke="#e5e7eb"
                strokeWidth={3}
              />
            ))}
            <rect x={119} y={30} width={12} height={58} rx={6} fill="#e5e7eb" transform="rotate(-60 125 85)" />
            <text x={40} y={34} fill="#facc15" fontSize={18} fontWeight={800} fontFamily={SANS}>
              V⎓
            </text>
            <text x={198} y={34} fill="#9ca3af" fontSize={16} fontWeight={700} fontFamily={SANS}>
              Ω
            </text>
          </svg>
        </div>
        {[
          { x: 110, c: "#dc2626" },
          { x: 220, c: "#111827" },
        ].map((j) => (
          <div
            key={j.x}
            style={{
              position: "absolute",
              left: j.x - 17,
              top: meter.h - 46 - 17,
              width: 34,
              height: 34,
              borderRadius: 17,
              background: j.c,
              border: "4px solid #4b5563",
              boxSizing: "border-box",
            }}
          />
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          left: meter.x + dx,
          top: meter.y + meter.h + 18,
          width: meter.w,
          display: "flex",
          justifyContent: "center",
          opacity: okS,
          transform: `scale(${0.8 + 0.2 * okS})`,
        }}
      >
        <div style={{ padding: "10px 20px", borderRadius: 999, background: "rgba(22,163,74,0.95)", color: "#fff", fontWeight: 800, fontSize: 20, whiteSpace: "nowrap" }}>
          below 3.3 V · safe
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- final cheat-sheet
export type SummaryRow = { color: string; from: string; to: string };

const SUMMARY: SummaryRow[] = [
  { color: COLORS.v33, from: "Pi 1 · 3.3 V", to: "+ rails → VDD 16, VREF 15, TDS VCC" },
  { color: COLORS.gndUi, from: "Pi 6 · GND", to: "− rails → AGND 14, DGND 9, both sensors" },
  { color: COLORS.sclk, from: "Pi 23 · SCLK", to: "CLK 13" },
  { color: COLORS.miso, from: "Pi 21 · MISO", to: "DOUT 12" },
  { color: COLORS.mosi, from: "Pi 19 · MOSI", to: "DIN 11" },
  { color: COLORS.ce0, from: "Pi 24 · CE0", to: "CS 10" },
  { color: COLORS.v5, from: "Pi 2 · 5 V", to: "Turbidity VCC (direct)" },
  { color: COLORS.tds, from: "TDS A", to: "CH0 · chip pin 1" },
  { color: COLORS.turb, from: "Turbidity OUT", to: "10k → CH1 (pin 2), 20k → GND" },
];

const CODE = `from gpiozero import MCP3008

tds  = MCP3008(channel=0)
turb = MCP3008(channel=1)

v_tds  = tds.value  * 3.3
v_turb = turb.value * 3.3 * 1.5`;

export const SummaryCard: React.FC<{ title?: string; rows?: SummaryRow[]; code?: string }> = ({
  title = "Wiring cheat-sheet",
  rows = SUMMARY,
  code = CODE,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 20 });
  const row = (i: number): React.CSSProperties => {
    const r = spring({ frame: frame - 8 - i * 5, fps, config: { damping: 200 }, durationInFrames: 14 });
    return { opacity: r, transform: `translateX(${(1 - r) * 20}px)` };
  };
  return (
    <div
      style={{
        position: "absolute",
        right: 40,
        top: 46,
        width: 470,
        borderRadius: 26,
        background: "rgba(10,16,30,0.95)",
        border: "1.5px solid rgba(148,163,184,0.25)",
        boxShadow: "0 24px 60px rgba(0,0,0,0.55)",
        padding: "24px 26px",
        fontFamily: SANS,
        opacity: s,
        transform: `translateX(${(1 - s) * 60}px)`,
        boxSizing: "border-box",
      }}
    >
      <div style={{ color: "#f8fafc", fontWeight: 800, fontSize: 26, marginBottom: 14 }}>{title}</div>
      {rows.map((r, i) => (
        <div key={r.from} style={{ ...row(i), display: "flex", alignItems: "flex-start", gap: 12, padding: "7px 0", borderTop: i ? "1px solid rgba(148,163,184,0.12)" : "none" }}>
          <span style={{ width: 12, height: 12, borderRadius: 6, background: r.color, marginTop: 6, flexShrink: 0, border: "1px solid rgba(255,255,255,0.3)" }} />
          <span style={{ width: 138, flexShrink: 0, color: "#f1f5f9", fontWeight: 700, fontSize: 17 }}>{r.from}</span>
          <span style={{ color: "#a9b7cb", fontSize: 16, lineHeight: 1.35 }}>{r.to}</span>
        </div>
      ))}
      <div
        style={{
          ...row(rows.length + 1),
          marginTop: 16,
          background: "#060a14",
          borderRadius: 14,
          padding: "14px 16px",
          fontFamily: MONO,
          fontSize: 16,
          lineHeight: 1.55,
          color: "#e2e8f0",
          whiteSpace: "pre",
          border: "1px solid rgba(148,163,184,0.18)",
        }}
      >
        {code}
      </div>
    </div>
  );
};
