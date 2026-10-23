import React from "react";
import { AbsoluteFill, Easing, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { MONO, SANS } from "./fonts";
import { Pt, alpha, partial, pointAt, roundedPolyline, sampled, toPath } from "./geometry";
import { COLORS, HEIGHT, WIDTH } from "./layout";
import { p } from "./scene";
import { CLAMP, sec } from "./timeline";
import { BACKDROP } from "./components/World";
import { CaptionBar, CaptionSpec } from "./components/Overlays";
import TURKANA from "./data/turkana.json";
import LIMITS from "../../shared/limits.json";

const RAW: [string, number, number][] = [
  ["intro", 0, 4],
  ["map", 4, 14],
  ["stations", 14, 19],
  ["measure", 19, 25],
  ["uplink", 25, 32],
  ["cloud", 32, 40],
  ["alerts", 40, 48],
  ["dashboard", 48, 54],
  ["twin", 54, 62],
  ["done", 62, 68],
];
const STEPS = RAW.map(([id, a, b]) => ({ id, from: sec(a), to: sec(b) }));
export const ARCH_TOTAL_FRAMES = sec(68);
const stepAt = (f: number) => (STEPS.find((s) => f >= s.from && f < s.to) ?? STEPS[STEPS.length - 1]).id;
const EASE = { ...CLAMP, easing: Easing.inOut(Easing.cubic) };

// ---------------------------------------------------------------- Turkana map (real data, see geo/)
const CLASSES = ["le5", "le15", "le35", "gt35"] as const;
const CLASS_COLORS = ["#22c55e", "#facc15", "#f97316", "#ef4444"];
const CLASS_LABELS = ["up to 5 km", "5–15 km", "15–35 km", "over 35 km"];
const REAL = TURKANA.stations.find((s) => s.real)!;

// Big in the middle first, then smaller on the left while the system builds up on the right.
const mapView = (f: number) => {
  const t = interpolate(f, [sec(14), sec(15.6)], [0, 1], EASE);
  return {
    s: 0.78 - 0.16 * t,
    x: 520 - 370 * t,
    y: 110 + 40 * t,
    dim: interpolate(f, [sec(19), sec(20)], [1, 0.22], CLAMP),
  };
};

const TurkanaMap: React.FC<{ frame: number }> = ({ frame }) => {
  const v = mapView(frame);
  const draw = interpolate(frame, [sec(4.2), sec(6.2)], [0, 1], CLAMP);
  const rings = Math.min(interpolate(frame, [sec(9.5), sec(10.5)], [0, 1], CLAMP), interpolate(frame, [sec(14), sec(15)], [1, 0], CLAMP));
  const masts = interpolate(frame, [sec(5.6), sec(6.4)], [0, 1], CLAMP);
  const stations = interpolate(frame, [sec(15.4), sec(16.2)], [0, 1], CLAMP);
  const pulse = 0.5 + 0.5 * Math.sin(frame * 0.18);
  return (
    <g opacity={v.dim} transform={`translate(${v.x} ${v.y}) scale(${v.s})`}>
      <path
        d={TURKANA.boundary}
        fill="rgba(30,58,95,0.35)"
        fillOpacity={draw}
        stroke={alpha(COLORS.accent, 0.75)}
        strokeWidth={2.5 / v.s}
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={1 - draw}
      />
      {TURKANA.masts.map(([x, y], i) => (
        <circle
          key={`ring${i}`}
          cx={x}
          cy={y}
          r={35 * TURKANA.km}
          fill={alpha("#e2e8f0", 0.035)}
          stroke={alpha("#e2e8f0", 0.28)}
          strokeWidth={1.5 / v.s}
          strokeDasharray="6 6"
          opacity={rings}
        />
      ))}
      {TURKANA.points.map(([x, y, c], i) => {
        const o = interpolate(frame, [sec(6) + i * 0.12, sec(6) + i * 0.12 + 8], [0, 1], CLAMP);
        return o > 0 ? <circle key={i} cx={x} cy={y} r={4.4} fill={CLASS_COLORS[c]} opacity={o * (1 - 0.65 * stations)} /> : null;
      })}
      {TURKANA.masts.map(([x, y], i) => (
        <path key={`mast${i}`} d={`M${x} ${y - 10} L${x + 8} ${y + 6} L${x - 8} ${y + 6} Z`} fill="#e2e8f0" stroke="#0f172a" strokeWidth={1.5} opacity={masts} />
      ))}
      {stations > 0 &&
        TURKANA.stations.map((s) =>
          s.real ? (
            <g key={s.id} opacity={stations}>
              <circle cx={s.x} cy={s.y} r={14 + pulse * 10} fill="none" stroke={COLORS.tds} strokeWidth={3 / v.s} opacity={1 - pulse * 0.7} />
              <circle cx={s.x} cy={s.y} r={8} fill={COLORS.tds} stroke="#0f172a" strokeWidth={2} />
            </g>
          ) : (
            <circle key={s.id} cx={s.x} cy={s.y} r={4} fill="#f8fafc" stroke="#0f172a" strokeWidth={1} opacity={stations} />
          ),
        )}
    </g>
  );
};

// ---------------------------------------------------------------- the system
const W = 196;
const H = 92;
type NodeDef = { id: string; x: number; y: number; title: string; sub: string; color: string; at: number };
const NODES: NodeDef[] = [
  { id: "station", x: 830, y: 430, title: "Station", sub: "Pi 5 · sensors · lights", color: COLORS.tds, at: 19.2 },
  { id: "uplink", x: 1060, y: 430, title: "Mobile network", sub: "mast or Wendy's hotspot", color: COLORS.sclk, at: 25.2 },
  { id: "hub", x: 1290, y: 430, title: "Azure IoT Hub", sub: "MQTT · device twin", color: COLORS.accent, at: 26.0 },
  { id: "func", x: 1520, y: 430, title: "Azure Functions", sub: "risk logic · outlook", color: COLORS.ce0, at: 32.2 },
  { id: "weather", x: 1520, y: 210, title: "Weather", sub: "Open-Meteo · Azure Maps", color: COLORS.miso, at: 33.4 },
  { id: "storage", x: 1520, y: 650, title: "Table Storage", sub: "history · state", color: COLORS.muted, at: 34.4 },
  { id: "alerts", x: 1765, y: 250, title: "Alerts", sub: "SMS · e-mail · Telegram", color: COLORS.v5, at: 40.2 },
  { id: "dashboard", x: 1765, y: 610, title: "Dashboard", sub: "for Wendy", color: COLORS.ok, at: 48.2 },
];
const N = Object.fromEntries(NODES.map((n) => [n.id, n]));
const R = (id: string): Pt => ({ x: N[id].x + W / 2, y: N[id].y });
const L = (id: string): Pt => ({ x: N[id].x - W / 2, y: N[id].y });
const T = (id: string): Pt => ({ x: N[id].x, y: N[id].y - H / 2 });
const B = (id: string): Pt => ({ x: N[id].x, y: N[id].y + H / 2 });

type EdgeDef = { id: string; pts: Pt[]; color: string; at: number; dashed?: boolean; label?: string };
const EDGES: EdgeDef[] = [
  { id: "up", pts: [R("station"), L("uplink")], color: COLORS.sclk, at: 25.2 },
  { id: "hub", pts: [R("uplink"), L("hub")], color: COLORS.accent, at: 26.0 },
  { id: "func", pts: [R("hub"), L("func")], color: COLORS.ce0, at: 32.2 },
  { id: "weather", pts: [B("weather"), T("func")], color: COLORS.miso, at: 33.4 },
  { id: "storage", pts: [B("func"), T("storage")], color: COLORS.muted, at: 34.4 },
  { id: "alerts", pts: [R("func"), p(1642, 430), p(1642, 250), L("alerts")], color: COLORS.v5, at: 40.2 },
  { id: "dash", pts: [R("func"), p(1642, 430), p(1642, 610), L("dashboard")], color: COLORS.ok, at: 48.2 },
  {
    id: "twin",
    pts: [p(1460, 476), p(1460, 552), p(830, 552), p(830, 476)],
    color: COLORS.warn,
    at: 54.2,
    dashed: true,
    label: "device twin",
  },
];
const PATHS = Object.fromEntries(EDGES.map((e) => [e.id, sampled(roundedPolyline(e.pts, 16))]));

type Flow = { edge: string; from: number; to: number; reverse?: boolean };
const FLOWS: Flow[] = [
  { edge: "up", from: 26.4, to: 31.4 },
  { edge: "hub", from: 27.0, to: 31.8 },
  { edge: "func", from: 32.8, to: 39.4 },
  { edge: "weather", from: 34.0, to: 39.4 },
  { edge: "storage", from: 35.0, to: 39.4 },
  { edge: "alerts", from: 40.8, to: 47.4 },
  { edge: "dash", from: 48.8, to: 53.4 },
  { edge: "twin", from: 54.8, to: 56.4 },
  { edge: "dash", from: 58.2, to: 59.2, reverse: true },
  { edge: "twin", from: 59.2, to: 60.4 },
];

const ACTIVE: Record<string, string[]> = {
  measure: ["station"],
  uplink: ["station", "uplink", "hub", "up", "hub"],
  cloud: ["func", "weather", "storage", "func", "weather", "storage"],
  alerts: ["func", "alerts"],
  dashboard: ["func", "dashboard", "dash"],
  twin: ["station", "hub", "dashboard", "twin", "dash"],
};

const bufferAt = (f: number) =>
  Math.max(0, Math.floor(interpolate(f, [sec(20), sec(25)], [0, 12], CLAMP)) - Math.floor(interpolate(f, [sec(26.6), sec(28.4)], [0, 12], CLAMP)));
const stationRed = (f: number) => f >= sec(40.2) && f < sec(60.6);

const NodeBox: React.FC<{ n: NodeDef; frame: number; active: boolean }> = ({ n, frame, active }) => {
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - sec(n.at), fps, config: { damping: 200 }, durationInFrames: 18 });
  if (s <= 0.001) return null;
  const buffer = n.id === "station" ? bufferAt(frame) : 0;
  return (
    <g opacity={s} transform={`translate(${n.x} ${n.y + (1 - s) * 16})`}>
      {active && <rect x={-W / 2 - 6} y={-H / 2 - 6} width={W + 12} height={H + 12} rx={22} fill={n.color} opacity={0.22} filter="url(#archSoft)" />}
      <rect x={-W / 2} y={-H / 2} width={W} height={H} rx={18} fill="rgba(15,23,42,0.96)" stroke={alpha(n.color, active ? 0.95 : 0.5)} strokeWidth={active ? 3 : 1.5} />
      <rect x={-W / 2} y={-H / 2 + 16} width={5} height={H - 32} rx={2.5} fill={n.color} />
      <text x={-W / 2 + 20} y={-4} fontFamily={SANS} fontSize={19} fontWeight={800} fill="#f1f5f9">
        {n.title}
      </text>
      <text x={-W / 2 + 20} y={22} fontFamily={SANS} fontSize={13} fill="#94a3b8">
        {n.sub}
      </text>
      {n.id === "station" &&
        [
          { x: 44, c: "#f8fafc", on: true },
          { x: 60, c: "#facc15", on: false },
          { x: 76, c: "#ef4444", on: stationRed(frame) },
        ].map((l) => (
          <g key={l.x}>
            {l.on && <circle cx={l.x} cy={-28} r={11} fill={l.c} opacity={0.6} filter="url(#archGlow)" />}
            <circle cx={l.x} cy={-28} r={6} fill={l.on ? l.c : alpha(l.c, 0.2)} stroke={alpha(l.c, 0.8)} strokeWidth={1.5} />
          </g>
        ))}
      {buffer > 0 && (
        <g transform={`translate(0 ${-H / 2 - 24})`}>
          <rect x={-62} y={-16} width={124} height={32} rx={16} fill="rgba(7,11,20,0.95)" stroke={alpha(COLORS.warn, 0.8)} />
          <text x={0} y={6} textAnchor="middle" fontFamily={MONO} fontSize={16} fontWeight={700} fill={COLORS.warn}>
            buffer {buffer}
          </text>
        </g>
      )}
    </g>
  );
};

const Edge: React.FC<{ e: EdgeDef; frame: number; active: boolean }> = ({ e, frame, active }) => {
  const t = interpolate(frame, [sec(e.at), sec(e.at + 0.8)], [0, 1], EASE);
  if (t <= 0) return null;
  const s = PATHS[e.id];
  const pts = partial(s, t);
  const end = pts[pts.length - 1];
  const prev = pointAt(s, Math.max(0, t - 0.03));
  const ang = (Math.atan2(end.y - prev.y, end.x - prev.x) * 180) / Math.PI;
  const c = alpha(e.color, active ? 0.95 : 0.55);
  const mid = pointAt(s, 0.5);
  return (
    <g>
      <path d={toPath(pts)} fill="none" stroke={c} strokeWidth={active ? 4 : 3} strokeDasharray={e.dashed ? "10 8" : undefined} strokeLinecap="round" strokeLinejoin="round" />
      {t > 0.98 && <path d="M2 0 L-12 -7 L-12 7 Z" fill={c} transform={`translate(${end.x} ${end.y}) rotate(${ang})`} />}
      {e.label && t > 0.98 && (
        <text x={mid.x} y={mid.y + 24} textAnchor="middle" fontFamily={SANS} fontSize={15} fontWeight={700} fill={e.color}>
          {e.label}
        </text>
      )}
    </g>
  );
};

const Packets: React.FC<{ frame: number }> = ({ frame }) => (
  <g>
    {FLOWS.flatMap((fl, i) => {
      const color = EDGES.find((e) => e.id === fl.edge)!.color;
      const out: React.ReactNode[] = [];
      for (let start = sec(fl.from); start < sec(fl.to); start += sec(0.45)) {
        const t = (frame - start) / sec(0.9);
        if (t < 0 || t > 1) continue;
        const pt = pointAt(PATHS[fl.edge], fl.reverse ? 1 - t : t);
        out.push(
          <g key={`${i}-${start}`}>
            <circle cx={pt.x} cy={pt.y} r={11} fill={color} opacity={0.7} filter="url(#archGlow)" />
            <circle cx={pt.x} cy={pt.y} r={5.5} fill="#f8fafc" stroke={color} strokeWidth={2} />
          </g>,
        );
      }
      return out;
    })}
  </g>
);

// ---------------------------------------------------------------- screen-space cards
const useEnter = (duration: number) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 18 });
  return { frame, fps, o: Math.min(s, interpolate(frame, [duration - 12, duration], [1, 0], CLAMP)) };
};

const panel = (o: number, color: string, extra: React.CSSProperties = {}): React.CSSProperties => ({
  position: "absolute",
  left: 40,
  top: 110,
  width: 660,
  borderRadius: 22,
  background: "rgba(10,16,30,0.97)",
  border: `1.5px solid ${alpha(color, 0.5)}`,
  boxShadow: "0 18px 50px rgba(0,0,0,0.5)",
  padding: "24px 28px",
  fontFamily: SANS,
  opacity: o,
  transform: `translateY(${(1 - o) * 18}px)`,
  ...extra,
});

const DetailCard: React.FC<{ title: string; color: string; lines: string[]; duration: number; reveal?: number[] }> = ({
  title,
  color,
  lines,
  duration,
  reveal,
}) => {
  const { frame, fps, o } = useEnter(duration);
  return (
    <div style={panel(o, color)}>
      <div style={{ color: "#f1f5f9", fontWeight: 800, fontSize: 28, marginBottom: 16 }}>{title}</div>
      {lines.map((line, i) => {
        const r = spring({ frame: frame - sec(reveal?.[i] ?? 0.4 + i * 0.6), fps, config: { damping: 200 }, durationInFrames: 14 });
        return (
          <div key={line} style={{ display: "flex", gap: 14, alignItems: "flex-start", marginBottom: 12, opacity: r, transform: `translateX(${(1 - r) * 16}px)` }}>
            <span style={{ width: 10, height: 10, borderRadius: 5, background: color, marginTop: 11, flexShrink: 0 }} />
            <span style={{ color: "#cbd5e1", fontSize: 22, lineHeight: 1.4 }}>{line}</span>
          </div>
        );
      })}
    </div>
  );
};

const CoverageCard: React.FC<{ duration: number }> = ({ duration }) => {
  const { frame, fps, o } = useEnter(duration);
  return (
    <div style={{ ...panel(o, COLORS.accent), left: 1080, top: 190, width: 600 }}>
      <div style={{ color: "#f1f5f9", fontWeight: 800, fontSize: 28 }}>How far is the next cell tower?</div>
      <div style={{ color: "#94a3b8", fontSize: 18, margin: "6px 0 20px" }}>
        {TURKANA.stats.rural} rural water points (SNV mapping in OpenStreetMap)
      </div>
      {CLASSES.map((c, i) => {
        const pct = TURKANA.stats.classes[c];
        const w = spring({ frame: frame - 10 - i * 8, fps, config: { damping: 200 }, durationInFrames: 24 });
        return (
          <div key={c} style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 12 }}>
            <span style={{ width: 120, color: "#e2e8f0", fontSize: 19, fontWeight: 600 }}>{CLASS_LABELS[i]}</span>
            <div style={{ flex: 1, height: 22, borderRadius: 11, background: "rgba(148,163,184,0.14)", overflow: "hidden" }}>
              <div style={{ width: `${pct * w}%`, height: "100%", borderRadius: 11, background: CLASS_COLORS[i] }} />
            </div>
            <span style={{ width: 60, textAlign: "right", fontFamily: MONO, fontSize: 22, fontWeight: 700, color: CLASS_COLORS[i] }}>
              {Math.round(pct * w)} %
            </span>
          </div>
        );
      })}
      <div style={{ color: "#94a3b8", fontSize: 16, marginTop: 10, lineHeight: 1.4 }}>
        ▲ {TURKANA.stats.masts} masts known in OpenStreetMap; real coverage may be better. Dashed rings: 35 km, the 2G limit.
      </div>
    </div>
  );
};

const SMS = "WATER ALERT well07: salt very high. Do not drink, do not boil. Livestock ok. Go to well05 (9.5km).";

const SmsCard: React.FC<{ duration: number }> = ({ duration }) => {
  const { frame, fps, o } = useEnter(duration);
  const typed = Math.round(interpolate(frame, [sec(0.6), sec(2.6)], [0, SMS.length], CLAMP));
  const people = ["Water committee", "Wendy", "WHH field team"];
  return (
    <div style={panel(o, COLORS.v5)}>
      <div style={{ color: "#f1f5f9", fontWeight: 800, fontSize: 28, marginBottom: 16 }}>An SMS to the people who act</div>
      <div
        style={{
          fontFamily: MONO,
          fontSize: 21,
          lineHeight: 1.45,
          color: "#f8fafc",
          background: "#14532d",
          borderRadius: "20px 20px 20px 6px",
          padding: "16px 20px",
          minHeight: 96,
        }}
      >
        {SMS.slice(0, typed)}
      </div>
      <div style={{ display: "flex", gap: 14, marginTop: 18 }}>
        {people.map((name, i) => {
          const r = spring({ frame: frame - sec(2.8) - i * 8, fps, config: { damping: 200 }, durationInFrames: 14 });
          return (
            <div
              key={name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 16px",
                borderRadius: 14,
                background: "rgba(15,23,42,0.9)",
                border: `1.5px solid ${alpha(COLORS.v5, 0.5)}`,
                color: "#e2e8f0",
                fontSize: 18,
                fontWeight: 600,
                opacity: r,
                transform: `translateY(${(1 - r) * 12}px)`,
              }}
            >
              <span style={{ width: 14, height: 22, borderRadius: 4, border: "2px solid #e2e8f0" }} />
              {name}
            </div>
          );
        })}
      </div>
      <div style={{ color: "#94a3b8", fontSize: 17, marginTop: 16, lineHeight: 1.4 }}>
        One SMS per event and only for very high salt. Germ risk, rain and outlook go out by e-mail or Telegram.
      </div>
    </div>
  );
};

const DashboardCard: React.FC<{ duration: number }> = ({ duration }) => {
  const { o } = useEnter(duration);
  const xs = TURKANA.stations.map((s) => s.x);
  const ys = TURKANA.stations.map((s) => s.y);
  const box = (v: number, lo: number, hi: number, size: number) => 20 + ((v - lo) / (hi - lo || 1)) * (size - 40);
  const colour = (id: string) => (id === "wp07" ? "#ef4444" : ["wp03", "wp11"].includes(id) ? "#facc15" : "#f8fafc");
  const rows = [
    { k: "Alert", v: "well07 · too salty for people", c: "#f87171" },
    { k: "Test today", v: "well11 · well03", c: "#facc15" },
    { k: "Alternative", v: "well05 Nadapal · 9.5 km", c: COLORS.ok },
  ];
  return (
    <div style={panel(o, COLORS.ok)}>
      <div style={{ color: "#f1f5f9", fontWeight: 800, fontSize: 28, marginBottom: 16 }}>Wendy's dashboard</div>
      <div style={{ display: "flex", gap: 22 }}>
        <svg width={260} height={220} style={{ background: "#0b1324", borderRadius: 16, flexShrink: 0 }}>
          {TURKANA.stations.map((s) => (
            <circle
              key={s.id}
              cx={box(s.x, Math.min(...xs), Math.max(...xs), 260)}
              cy={box(s.y, Math.min(...ys), Math.max(...ys), 220)}
              r={s.real ? 10 : 7}
              fill={colour(s.id)}
              stroke="#0f172a"
              strokeWidth={2}
            />
          ))}
        </svg>
        <div style={{ flex: 1 }}>
          {rows.map((r) => (
            <div key={r.k} style={{ marginBottom: 16 }}>
              <div style={{ color: r.c, fontSize: 15, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>{r.k}</div>
              <div style={{ color: "#e2e8f0", fontSize: 21, fontWeight: 600 }}>{r.v}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ color: "#94a3b8", fontSize: 16, marginTop: 14 }}>Illustration of the demo dashboard (cloud/static/map.html)</div>
    </div>
  );
};

const ArchTitle: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = (d: number) => spring({ frame: frame - d, fps, config: { damping: 200 }, durationInFrames: 22 });
  const up = (v: number): React.CSSProperties => ({ opacity: v, transform: `translateY(${(1 - v) * 26}px)` });
  const out = interpolate(frame, [sec(3.5), sec(4)], [1, 0], CLAMP);
  const chips = [
    { t: "Station at the well", c: COLORS.tds },
    { t: "Azure IoT Hub", c: COLORS.accent },
    { t: "Azure Functions", c: COLORS.ce0 },
    { t: "SMS · dashboard", c: COLORS.v5 },
  ];
  return (
    <AbsoluteFill style={{ opacity: out, fontFamily: SANS, background: "rgba(4,7,15,0.85)", alignItems: "center", justifyContent: "center" }}>
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
          Wendy Water Wonders · THE SYSTEM
        </div>
        <div style={{ ...up(a(8)), fontSize: 110, fontWeight: 800, color: "#f8fafc", letterSpacing: -3, marginTop: 30, lineHeight: 1 }}>
          From the well to the phone
        </div>
        <div
          style={{
            ...up(a(14)),
            fontSize: 46,
            fontWeight: 700,
            marginTop: 22,
            background: "linear-gradient(90deg,#2dd4bf,#60a5fa,#c084fc,#ef4444)",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
          }}
        >
          measure · send · decide · alert · a person resets
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
  );
};

// ---------------------------------------------------------------- captions
const CAPTIONS: Partial<Record<string, CaptionSpec>> = {
  map: {
    kind: "info",
    title: "Turkana, Kenya",
    body: "Rural water points by distance to the nearest known cell tower: {ok:up to 5 km} {sclk:5–15 km} {v33:15–35 km} {v5:over 35 km}",
  },
  stations: {
    kind: "info",
    title: "Stations at the wells",
    body: "One real station ({tds:well07}) and 13 simulated ones. Their positions are placeholders near Lodwar.",
  },
  measure: { kind: "check", title: "Measure", body: "The station measures every 30 s and warns on site, with or without a network." },
  uplink: { kind: "info", title: "Send", body: "As soon as there is a connection, the buffer goes to the {accent:Azure IoT Hub} over MQTT." },
  cloud: {
    kind: "info",
    title: "Decide",
    body: "{ce0:Azure Functions} combine the readings with weather and lab tests and find the nearest usable water point.",
  },
  alerts: { kind: "warn", title: "Alert", body: "When a water point gets worse, the right people get an {v5:SMS}: what is wrong, what to do, where to go." },
  dashboard: { kind: "info", title: "Overview for Wendy", body: "The {ok:dashboard} shows every water point, what to test today and the alternatives." },
  twin: {
    kind: "check",
    title: "A person has the last word",
    body: "The verdict goes back to the station. Only {ok:Reset water} after a check on site switches the warning off.",
  },
  done: {
    kind: "star",
    title: "From the well to the phone",
    body: "{tds:measure} → {accent:send} → {ce0:decide} → {v5:alert} → {ok:a person resets}",
  },
};
const STEP_LABELS = {
  map: "THE PLACE",
  stations: "THE STATIONS",
  measure: "MEASURE",
  uplink: "SEND",
  cloud: "DECIDE",
  alerts: "ALERT",
  dashboard: "DASHBOARD",
  twin: "HUMAN IN THE LOOP",
  done: "SUMMARY",
};

export const Architecture: React.FC = () => {
  const frame = useCurrentFrame();
  const step = stepAt(frame);
  const active = ACTIVE[step] ?? [];
  const v = mapView(frame);
  const real = { x: v.x + REAL.x * v.s, y: v.y + REAL.y * v.s };
  const link = interpolate(frame, [sec(19.2), sec(20)], [0, 1], EASE);
  const labelIn = Math.min(interpolate(frame, [sec(15.8), sec(16.4)], [0, 1], CLAMP), interpolate(frame, [sec(18.8), sec(19.2)], [1, 0], CLAMP));
  const attribution = Math.min(interpolate(frame, [sec(4.4), sec(5)], [0, 1], CLAMP), interpolate(frame, [sec(19), sec(19.6)], [1, 0], CLAMP));
  return (
    <AbsoluteFill style={{ fontFamily: SANS, background: BACKDROP }}>
      <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <filter id="archGlow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation={4} />
          </filter>
          <filter id="archSoft" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation={10} />
          </filter>
        </defs>
        <TurkanaMap frame={frame} />
        {link > 0 && (
          <path
            d={toPath([real, { x: L("station").x - 40, y: real.y }, L("station")])}
            fill="none"
            stroke={alpha(COLORS.tds, 0.7)}
            strokeWidth={3}
            strokeDasharray="8 8"
            pathLength={1}
            opacity={link}
          />
        )}
        {EDGES.map((e) => (
          <Edge key={e.id} e={e} frame={frame} active={active.includes(e.id)} />
        ))}
        <Packets frame={frame} />
        {NODES.map((n) => (
          <NodeBox key={n.id} n={n} frame={frame} active={active.includes(n.id)} />
        ))}
      </svg>

      {labelIn > 0 && (
        <div
          style={{
            position: "absolute",
            left: real.x + 26,
            top: real.y - 22,
            opacity: labelIn,
            padding: "8px 16px",
            borderRadius: 999,
            background: "rgba(7,11,20,0.92)",
            border: `1.5px solid ${alpha(COLORS.tds, 0.7)}`,
            color: "#f1f5f9",
            fontWeight: 700,
            fontSize: 18,
            whiteSpace: "nowrap",
          }}
        >
          well07 · live station <span style={{ color: "#94a3b8", fontWeight: 500 }}>+ 13 simulated</span>
        </div>
      )}
      <div style={{ position: "absolute", left: 40, top: 872, opacity: attribution, color: "#64748b", fontSize: 15 }}>
        Map data: © OpenStreetMap contributors · Water Point Data Exchange · geoBoundaries
      </div>

      <Sequence from={sec(7.8)} durationInFrames={sec(6.2)} premountFor={15}>
        <CoverageCard duration={sec(6.2)} />
      </Sequence>
      <Sequence from={sec(19.4)} durationInFrames={sec(5.6)} premountFor={15}>
        <DetailCard
          title="At the water point"
          color={COLORS.tds}
          duration={sec(5.6)}
          lines={[
            "Measures salt, turbidity and pH every 30 seconds",
            "The lights switch on site, even without a network",
            "Every measurement goes into a local buffer first (about 70 days offline)",
          ]}
        />
      </Sequence>
      <Sequence from={sec(25.4)} durationInFrames={sec(6.6)} premountFor={15}>
        <DetailCard
          title="Getting the data out"
          color={COLORS.sclk}
          duration={sec(6.6)}
          lines={[
            "MQTT to the Azure IoT Hub (port 8883, or 443 where it is blocked)",
            "Over the mobile network where a mast is in reach",
            "Or when Wendy passes by with her phone as a hotspot",
            "A measurement is deleted only after the hub confirmed it",
          ]}
        />
      </Sequence>
      <Sequence from={sec(32.4)} durationInFrames={sec(7.6)} premountFor={15}>
        <DetailCard
          title="What the cloud decides"
          color={COLORS.ce0}
          duration={sec(7.6)}
          lines={[
            `Salt: over ${LIMITS.tds_ppm.yellow} mg/L watch, over ${LIMITS.tds_ppm.red} mg/L too salty for people`,
            "Germ risk from turbidity, rain after a dry spell, source type and lab tests",
            "Outlook from the 10-day weather forecast",
            "The nearest usable water point within 15 km",
          ]}
        />
      </Sequence>
      <Sequence from={sec(40.4)} durationInFrames={sec(7.6)} premountFor={15}>
        <SmsCard duration={sec(7.6)} />
      </Sequence>
      <Sequence from={sec(48.4)} durationInFrames={sec(5.6)} premountFor={15}>
        <DashboardCard duration={sec(5.6)} />
      </Sequence>
      <Sequence from={sec(54.4)} durationInFrames={sec(7.6)} premountFor={15}>
        <DetailCard
          title="Back to the station"
          color={COLORS.warn}
          duration={sec(7.6)}
          reveal={[0.4, 3.4, 5.0, 6.2]}
          lines={[
            "The cloud's verdict goes back over the device twin",
            "Wendy checks the water point and presses Reset water",
            "The reset reaches the station the same way, even after it was offline",
            "Only a person can switch a warning off",
          ]}
        />
      </Sequence>
      <Sequence from={sec(62.3)} durationInFrames={sec(5.7)} premountFor={15}>
        <DetailCard
          title="In one sentence"
          color={COLORS.accent}
          duration={sec(5.7)}
          lines={[
            "A low-cost station measures the water at the well and warns on site",
            "The cloud tells the right people what to do and where to go instead",
            "A person always has the last word",
          ]}
        />
      </Sequence>
      <Sequence from={0} durationInFrames={sec(4)}>
        <ArchTitle />
      </Sequence>
      <CaptionBar steps={STEPS} captions={CAPTIONS} numbered={[]} labels={STEP_LABELS} showAt={sec(4)} />
    </AbsoluteFill>
  );
};
