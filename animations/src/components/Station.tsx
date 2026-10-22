import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { MONO, SANS } from "../fonts";
import { alpha } from "../geometry";
import { BEAKER, COLORS, piPin } from "../layout";
import { GND_OUTLINE, WireDef, p, wire } from "../scene";
import { CLAMP, sec } from "../timeline";
import LIMITS from "../../../shared/limits.json";

export type Level = "none" | "yellow" | "red";
export type Reading = { tds: number | null; ntu: number | null; ph: number | null };
export type Light = { level: Level; reason: string };

// ---------------------------------------------------------------- status LED board (world space)
// Sits above the Pi. Wires leave the left header column and run up without crossing.
export const LED_BOARD = { x: 168, y: 26, w: 196, h: 86 };
const LED_X = { red: 210, yellow: 250, white: 290, gnd: 330 };
const CONN_Y = LED_BOARD.y + LED_BOARD.h - 10;
const LED_COLORS = { white: "#f8fafc", yellow: "#facc15", red: "#ef4444" };

const ledWire = (id: string, pin: number, x: number, color: string, outline?: string) =>
  wire({
    id,
    color,
    outline,
    step: "before",
    route: [piPin(pin), p(x, piPin(pin).y), p(x, CONN_Y)],
    t: [-60, -59],
    width: 7,
    startPlug: "female",
    endPlug: "female",
  });

export const LED_WIRES: WireDef[] = [
  ledWire("ledGnd", 9, LED_X.gnd, COLORS.gnd, GND_OUTLINE),
  ledWire("ledWhite", 11, LED_X.white, "#cbd5e1"),
  ledWire("ledYellow", 13, LED_X.yellow, "#eab308"),
  ledWire("ledRed", 15, LED_X.red, "#dc2626"),
];

export const LedBoard: React.FC<{ level: Level }> = ({ level }) => {
  const { x, y, w, h } = LED_BOARD;
  const leds = [
    { key: "red", x: LED_X.red, color: LED_COLORS.red, on: level === "red" },
    { key: "yellow", x: LED_X.yellow, color: LED_COLORS.yellow, on: level === "yellow" },
    { key: "white", x: LED_X.white, color: LED_COLORS.white, on: true },
  ];
  return (
    <g>
      <rect x={x + 3} y={y + 5} width={w} height={h} rx={10} fill="#000" opacity={0.35} />
      <rect x={x} y={y} width={w} height={h} rx={10} fill="url(#pcbBlack)" stroke="#000" strokeWidth={1.5} />
      {leds.map((l) => (
        <g key={l.key}>
          {l.on && <circle cx={l.x} cy={y + 24} r={22} fill={l.color} opacity={0.75} filter="url(#glow)" />}
          <circle cx={l.x} cy={y + 24} r={12} fill={l.on ? l.color : alpha(l.color, 0.2)} stroke={alpha(l.color, 0.85)} strokeWidth={2} />
          <rect x={l.x - 4} y={y + 42} width={8} height={20} rx={3} fill="#d9c9a3" stroke="#9c8558" strokeWidth={1} />
          <rect x={l.x - 4} y={y + 48} width={8} height={3} fill={l.key === "white" ? "#8b5a2b" : "#dc2626"} />
        </g>
      ))}
      <text x={LED_X.gnd} y={y + 34} textAnchor="middle" fontFamily={SANS} fontSize={11} fontWeight={700} fill="#94a3b8">
        GND
      </text>
      {Object.values(LED_X).map((cx) => (
        <rect key={cx} x={cx - 7} y={CONN_Y - 7} width={14} height={14} rx={2} fill="#111" stroke="#52525b" />
      ))}
    </g>
  );
};

// ---------------------------------------------------------------- what goes into the water (world space)
const rand = (i: number) => {
  const s = Math.sin(i * 12.9898) * 43758.5453;
  return s - Math.floor(s);
};

const surfaceY = (level: number) => {
  const bottom = BEAKER.y + BEAKER.h - 6;
  return bottom - level * (bottom - BEAKER.water);
};

export type DoseKind = "salt" | "mud" | "acid";

// A container tips over the glass and particles fall to the water surface.
export const Dosing: React.FC<{ frame: number; kind: DoseKind; from: number; to: number; level: number }> = ({
  frame,
  kind,
  from,
  to,
  level,
}) => {
  const show = Math.min(interpolate(frame, [from, from + 8], [0, 1], CLAMP), interpolate(frame, [to - 10, to], [1, 0], CLAMP));
  if (show <= 0.001) return null;
  const surface = surfaceY(level);
  const ox = 1612;
  const oy = 262;
  const part = {
    salt: { color: "#f8fafc", r: 2.6, n: 22, every: 2, spread: 22 },
    mud: { color: "#92400e", r: 4.6, n: 16, every: 3, spread: 18 },
    acid: { color: "#d9f99d", r: 3.4, n: 9, every: 6, spread: 4 },
  }[kind];
  const start = from + sec(0.4);
  return (
    <g opacity={show}>
      {kind === "salt" && (
        <g transform={`translate(${ox} ${oy - 14}) rotate(150)`}>
          <rect x={-14} y={-26} width={28} height={44} rx={6} fill="#e5e7eb" stroke="#94a3b8" strokeWidth={1.5} />
          <rect x={-15} y={-34} width={30} height={10} rx={3} fill="#94a3b8" />
          {[-6, 0, 6].map((hx) => (
            <circle key={hx} cx={hx} cy={-29} r={1.6} fill="#475569" />
          ))}
        </g>
      )}
      {kind === "mud" && (
        <g transform={`translate(${ox - 6} ${oy - 18}) rotate(-35)`}>
          <rect x={-20} y={-14} width={58} height={26} rx={10} fill="#78350f" stroke="#451a03" strokeWidth={1.5} />
          <rect x={-24} y={-10} width={12} height={18} rx={4} fill="#a16207" />
          <rect x={38} y={-4} width={46} height={7} rx={3} fill="#a8a29e" />
        </g>
      )}
      {kind === "acid" && (
        <g transform={`translate(${ox} ${oy - 20})`}>
          <ellipse cx={0} cy={0} rx={30} ry={22} fill="#facc15" stroke="#ca8a04" strokeWidth={1.5} />
          <ellipse cx={-30} cy={0} rx={6} ry={4} fill="#eab308" />
          <path d="M-10 14 Q0 26 10 14" fill="#fef08a" opacity={0.8} />
        </g>
      )}
      {Array.from({ length: part.n }, (_, i) => {
        const t = (frame - start - i * part.every) / 18;
        if (t < 0 || t > 1) return null;
        const px = ox + 10 + (rand(i) - 0.5) * part.spread + t * 3;
        const py = oy + 12 + t * (surface - oy - 12);
        return <circle key={i} cx={px} cy={py} r={part.r} fill={part.color} opacity={1 - t ** 4} />;
      })}
    </g>
  );
};

// Coloured haze over the water, in front of the probes.
export const WaterTint: React.FC<{ level: number; color: string; opacity: number }> = ({ level, color, opacity }) => {
  if (opacity <= 0.001 || level <= 0.01) return null;
  const { x, w } = BEAKER;
  const bottom = BEAKER.y + BEAKER.h - 6;
  const top = surfaceY(level);
  return <rect x={x + 10} y={top + 2} width={w - 20} height={Math.max(0, bottom - top - 2)} rx={14} fill={color} opacity={opacity} />;
};

// ---------------------------------------------------------------- screen-space cards
const useEnter = (duration: number) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 18 });
  const out = interpolate(frame, [duration - 12, duration], [1, 0], CLAMP);
  return Math.min(s, out);
};

const card = (o: number, border: string): React.CSSProperties => ({
  position: "absolute",
  borderRadius: 22,
  background: "rgba(10,16,30,0.97)",
  border: `1.5px solid ${border}`,
  boxShadow: "0 18px 50px rgba(0,0,0,0.5)",
  fontFamily: SANS,
  opacity: o,
  transform: `translateY(${(1 - o) * 18}px)`,
});

type Zone = [number, number, string];
type Row = { label: string; unit: string; value: number | null; digits: number; min: number; max: number; color: string; zones: Zone[] };

const Gauge: React.FC<{ row: Row }> = ({ row }) => {
  const pos = (v: number) => `${((Math.min(row.max, Math.max(row.min, v)) - row.min) / (row.max - row.min)) * 100}%`;
  const v = row.value;
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ color: "#cbd5e1", fontSize: 21, fontWeight: 600 }}>
          <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 6, background: row.color, marginRight: 10 }} />
          {row.label}
        </span>
        <span style={{ fontFamily: MONO, fontSize: 40, fontWeight: 700, color: v === null ? "#64748b" : "#f8fafc" }}>
          {v === null ? "—" : v.toFixed(row.digits)}
          <span style={{ fontSize: 18, color: "#94a3b8", marginLeft: 8 }}>{row.unit}</span>
        </span>
      </div>
      <div style={{ position: "relative", height: 12, borderRadius: 6, background: "rgba(148,163,184,0.16)", marginTop: 8, overflow: "hidden" }}>
        {row.zones.map(([a, b, c]) => (
          <div
            key={a}
            style={{ position: "absolute", top: 0, bottom: 0, left: pos(a), width: `calc(${pos(b)} - ${pos(a)})`, background: alpha(c, 0.45) }}
          />
        ))}
      </div>
      {v !== null && (
        <div style={{ position: "relative", height: 0 }}>
          <div
            style={{
              position: "absolute",
              left: pos(v),
              top: -19,
              width: 6,
              height: 26,
              marginLeft: -3,
              borderRadius: 3,
              background: row.color,
              boxShadow: `0 0 12px ${row.color}`,
            }}
          />
        </div>
      )}
    </div>
  );
};

export const ReadingsCard: React.FC<{ reading: Reading; duration: number }> = ({ reading, duration }) => {
  const o = useEnter(duration);
  const rows: Row[] = [
    { label: "Salt (TDS)", unit: "ppm", value: reading.tds, digits: 0, min: 0, max: 1200, color: COLORS.tds, zones: [[LIMITS.tds_ppm.yellow, LIMITS.tds_ppm.red, COLORS.warn], [LIMITS.tds_ppm.red, 1200, COLORS.v5]] },
    { label: "Turbidity", unit: "NTU", value: reading.ntu, digits: 0, min: 0, max: 1500, color: COLORS.turb, zones: [[LIMITS.turbidity_ntu.yellow, 1500, COLORS.warn]] },
    { label: "pH", unit: "", value: reading.ph, digits: 1, min: 4, max: 10, color: COLORS.ph, zones: [[4, LIMITS.ph.min, COLORS.warn], [LIMITS.ph.max, 10, COLORS.warn]] },
  ];
  const dry = reading.tds === null;
  return (
    <div style={{ ...card(o, "rgba(96,165,250,0.4)"), left: 40, top: 110, width: 480, padding: "22px 26px 8px" }}>
      <div style={{ color: "#f1f5f9", fontWeight: 800, fontSize: 24, marginBottom: 18 }}>Live readings</div>
      {rows.map((r) => (
        <Gauge key={r.label} row={r} />
      ))}
      <div style={{ color: "#94a3b8", fontSize: 16, marginBottom: 14 }}>
        {dry ? "Probes out of the water: no values, nothing is sent" : "Median of 25 reads · sped up (real: every 30 s)"}
      </div>
    </div>
  );
};

export const LightsCard: React.FC<{ light: Light; latched: boolean; duration: number }> = ({ light, latched, duration }) => {
  const o = useEnter(duration);
  const leds = [
    { key: "white", label: "running", color: LED_COLORS.white, on: true },
    { key: "yellow", label: "suspicious", color: LED_COLORS.yellow, on: light.level === "yellow" },
    { key: "red", label: "not drinkable", color: LED_COLORS.red, on: light.level === "red" },
  ];
  const status = {
    none: { text: "Nothing unusual measured", color: "#e2e8f0" },
    yellow: { text: `Suspicious · ${light.reason}`, color: LED_COLORS.yellow },
    red: { text: `Not drinkable · ${light.reason}`, color: "#f87171" },
  }[light.level];
  return (
    <div style={{ ...card(o, "rgba(248,250,252,0.3)"), right: 40, top: 110, width: 400, padding: "22px 26px" }}>
      <div style={{ color: "#f1f5f9", fontWeight: 800, fontSize: 24, marginBottom: 20 }}>Station lights</div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
        {leds.map((l) => (
          <div key={l.key} style={{ textAlign: "center", width: 110 }}>
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: 32,
                margin: "0 auto",
                background: l.on ? l.color : alpha(l.color, 0.12),
                border: `2px solid ${alpha(l.color, 0.8)}`,
                boxShadow: l.on ? `0 0 32px ${l.color}, 0 0 8px ${l.color}` : "none",
              }}
            />
            <div style={{ color: l.on ? "#f1f5f9" : "#64748b", fontSize: 16, fontWeight: 600, marginTop: 10 }}>{l.label}</div>
          </div>
        ))}
      </div>
      <div style={{ color: status.color, fontSize: 20, fontWeight: 700 }}>{status.text}</div>
      <div style={{ color: "#94a3b8", fontSize: 16, marginTop: 8, lineHeight: 1.4 }}>
        {latched
          ? "The water reads fine again, but the light stays on until a person has checked the water point."
          : light.level === "none"
            ? "White means the station runs, not that the water is safe."
            : "Same limits as the station software (placeholders)."}
      </div>
    </div>
  );
};

export const NetworkCard: React.FC<{ online: boolean; waiting: number; sent: number; duration: number }> = ({
  online,
  waiting,
  sent,
  duration,
}) => {
  const o = useEnter(duration);
  const c = online ? COLORS.ok : COLORS.v5;
  return (
    <div style={{ ...card(o, alpha(c, 0.5)), right: 40, top: 470, width: 400, padding: "20px 26px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <span style={{ width: 14, height: 14, borderRadius: 7, background: c, boxShadow: `0 0 14px ${c}` }} />
        <span style={{ color: "#f1f5f9", fontWeight: 800, fontSize: 22 }}>{online ? "Network: online" : "Network: offline"}</span>
      </div>
      <div style={{ display: "flex", gap: 30, fontFamily: MONO }}>
        <div>
          <div style={{ color: "#94a3b8", fontSize: 15, fontFamily: SANS }}>waiting in buffer.db</div>
          <div style={{ color: waiting > 0 ? COLORS.warn : "#f8fafc", fontSize: 40, fontWeight: 700 }}>{waiting}</div>
        </div>
        <div>
          <div style={{ color: "#94a3b8", fontSize: 15, fontFamily: SANS }}>sent to Azure</div>
          <div style={{ color: "#f8fafc", fontSize: 40, fontWeight: 700 }}>{sent}</div>
        </div>
      </div>
      <div style={{ color: "#94a3b8", fontSize: 15, marginTop: 10, lineHeight: 1.4 }}>
        A measurement is deleted only after the IoT Hub has confirmed it.
      </div>
    </div>
  );
};

export const ResetToast: React.FC<{ duration: number; by: string }> = ({ duration, by }) => {
  const o = useEnter(duration);
  return (
    <div
      style={{
        ...card(o, alpha(COLORS.ok, 0.55)),
        left: "50%",
        top: 34,
        width: 620,
        marginLeft: -310,
        padding: "16px 24px",
        display: "flex",
        alignItems: "center",
        gap: 18,
      }}
    >
      <div
        style={{
          width: 46,
          height: 46,
          borderRadius: 23,
          background: alpha(COLORS.ok, 0.18),
          border: `2px solid ${COLORS.ok}`,
          color: COLORS.ok,
          fontSize: 26,
          fontWeight: 800,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        ✓
      </div>
      <div>
        <div style={{ color: "#94a3b8", fontSize: 15, fontWeight: 600, letterSpacing: 1 }}>DASHBOARD · WELL07</div>
        <div style={{ color: "#f1f5f9", fontSize: 21, fontWeight: 700 }}>Reset water by {by}</div>
        <div style={{ color: "#cbd5e1", fontSize: 16 }}>☑ I checked this water point myself</div>
      </div>
    </div>
  );
};
