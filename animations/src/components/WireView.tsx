import React from "react";
import { Easing, interpolate, spring } from "remotion";
import { SANS } from "../fonts";
import { darken, partial, pointAt, Pt, toPath } from "../geometry";
import { BB, COLORS } from "../layout";
import type { GlowDef, LabelDef, Plug, PulseDef, TagDef, WireDef } from "../scene";
import { CLAMP, env } from "../timeline";

export const wireProgress = (def: WireDef, frame: number) =>
  interpolate(frame, [def.start, def.start + def.dur], [0, 1], { ...CLAMP, easing: Easing.inOut(Easing.cubic) });

const wireFade = (def: WireDef, frame: number) =>
  def.removeAt === undefined ? 1 : interpolate(frame, [def.removeAt, def.removeAt + 10], [1, 0], CLAMP);

const STROKE = { fill: "none", strokeLinecap: "round", strokeLinejoin: "round" } as const;

// Black GND wires need a light halo to read against the dark background.
const glowColor = (def: WireDef) => (def.color === COLORS.gnd ? "#cbd5e1" : def.color);

export const WireBody: React.FC<{ def: WireDef; frame: number; dim: boolean; focus: boolean }> = ({ def, frame, dim, focus }) => {
  const p = wireProgress(def, frame);
  const fade = wireFade(def, frame);
  if (p <= 0 || fade <= 0) return null;
  const pts = partial(def.path, p);
  const d = toPath(pts);
  const head = pts[pts.length - 1];
  const w = def.width;
  return (
    <g opacity={fade * (dim ? 0.5 : 1)}>
      {focus && (
        <>
          <path d={d} {...STROKE} stroke={glowColor(def)} strokeWidth={w + 22} opacity={0.1} />
          <path d={d} {...STROKE} stroke={glowColor(def)} strokeWidth={w + 11} opacity={0.2} />
        </>
      )}
      <path d={d} {...STROKE} stroke="#000" strokeOpacity={0.4} strokeWidth={w + 2} transform="translate(3 4)" />
      <path d={d} {...STROKE} stroke={def.outline ?? darken(def.color, 0.45)} strokeWidth={w + 3.5} />
      <path d={d} {...STROKE} stroke={def.color} strokeWidth={w} />
      <path d={d} {...STROKE} stroke="#fff" strokeOpacity={0.35} strokeWidth={Math.max(1.6, w * 0.26)} transform="translate(-1 -1.2)" />
      {p < 1 && (
        <g>
          <circle cx={head.x} cy={head.y} r={w * 1.8} fill={glowColor(def)} opacity={0.7} filter="url(#glow)" />
          <circle cx={head.x} cy={head.y} r={w * 0.6} fill="#fff" />
        </g>
      )}
    </g>
  );
};

const PlugShape: React.FC<{ kind: Plug; at: Pt; color: string; scale: number }> = ({ kind, at, color, scale }) => {
  if (kind === "none") return null;
  const s = kind === "female" ? { w: 24, h: 28 } : { w: 13, h: 13 };
  return (
    <g transform={`translate(${at.x} ${at.y}) scale(${scale})`}>
      <rect x={-s.w / 2 + 2} y={-s.h / 2 + 3} width={s.w} height={s.h} rx={3} fill="#000" opacity={0.45} />
      <rect x={-s.w / 2} y={-s.h / 2} width={s.w} height={s.h} rx={3} fill="#17191c" stroke="#40454d" strokeWidth={1.2} />
      {kind === "female" ? (
        <rect x={-s.w / 2 + 3} y={-s.h / 2 + 3} width={s.w - 6} height={6} rx={1.5} fill={color} />
      ) : (
        <circle r={3.2} fill={color} stroke="#000" strokeWidth={0.6} />
      )}
    </g>
  );
};

export const WirePlugs: React.FC<{ def: WireDef; frame: number; fps: number; dim: boolean }> = ({ def, frame, fps, dim }) => {
  const p = wireProgress(def, frame);
  const fade = wireFade(def, frame);
  if (p <= 0 || fade <= 0) return null;
  const pts = def.path.pts;
  const startPop = spring({ frame: frame - def.start, fps, config: { damping: 14, stiffness: 260 } });
  const endPop = spring({ frame: frame - (def.start + def.dur), fps, config: { damping: 11, stiffness: 240 } });
  const color = def.color === COLORS.gnd ? "#6b7280" : def.color;
  return (
    <g opacity={fade * (dim ? 0.6 : 1)}>
      <PlugShape kind={def.startPlug} at={pts[0]} color={color} scale={startPop} />
      {endPop > 0.001 && <PlugShape kind={def.endPlug} at={pts[pts.length - 1]} color={color} scale={endPop} />}
    </g>
  );
};

export const Pulse: React.FC<{ def: PulseDef; frame: number }> = ({ def, frame }) => {
  const e = env(frame, def.from, def.to, 8, 10);
  if (e <= 0) return null;
  const rings = [0, 0.5].map((off) => {
    const t = ((frame - def.from) / 34 + off) % 1;
    return { r: def.r + t * 26, o: (1 - t) * 0.95 };
  });
  return (
    <g opacity={e}>
      <circle cx={def.at.x} cy={def.at.y} r={def.r + 4} fill={def.color} opacity={0.18} />
      {rings.map((g, i) => (
        <circle key={i} cx={def.at.x} cy={def.at.y} r={g.r} fill="none" stroke={def.color} strokeWidth={3} opacity={g.o} />
      ))}
    </g>
  );
};

const TAG_RIGHT = 350;

export const PinTag: React.FC<{ def: TagDef; frame: number; fps: number; active: boolean }> = ({ def, frame, fps, active }) => {
  const s = spring({ frame: frame - def.at, fps, config: { damping: 200 }, durationInFrames: 14 });
  if (s <= 0.001) return null;
  const w = def.text.length * 7.6 + 34;
  const h = 24;
  const cy = def.y;
  const x0 = def.above ? def.above.x - w / 2 - 9 : TAG_RIGHT - w;
  return (
    <g opacity={s * (active ? 1 : 0.85)} transform={`translate(${(1 - s) * -14} 0)`}>
      {def.leader && (
        <line x1={TAG_RIGHT} y1={cy} x2={def.leader.x - 13} y2={def.leader.y} stroke={def.color} strokeWidth={1.6} strokeDasharray="3 3" />
      )}
      {def.above && (
        <path
          d={`M${def.above.x - 6} ${cy + h / 2} L${def.above.x} ${cy + h / 2 + 7} L${def.above.x + 6} ${cy + h / 2} Z`}
          fill={def.color}
        />
      )}
      <rect x={x0} y={cy - h / 2} width={w} height={h} rx={h / 2} fill="rgba(7,11,20,0.93)" stroke={def.color} strokeWidth={active ? 2 : 1.3} />
      <circle cx={x0 + 13} cy={cy} r={4.5} fill={def.color} />
      <text x={x0 + 24} y={cy + 4.6} fontFamily={SANS} fontWeight={700} fontSize={13} fill="#f1f5f9">
        {def.text}
      </text>
    </g>
  );
};

export const RailGlow: React.FC<{ def: GlowDef; frame: number }> = ({ def, frame }) => {
  if (frame < def.at) return null;
  const o = interpolate(frame, [def.at, def.at + 8, def.at + 40], [0, 0.6, 0.2], CLAMP);
  return <rect x={BB.x + 28} y={def.y - 9} width={BB.w - 56} height={18} rx={9} fill={def.color} opacity={o} />;
};

// Signal pulses for the final "it's alive" shot.
export const FlowDots: React.FC<{ def: WireDef; frame: number; from: number }> = ({ def, frame, from }) => {
  if (frame < from || !def.flow) return null;
  const o = interpolate(frame, [from, from + 15], [0, 1], CLAMP);
  const n = 3;
  const speed = 7 / Math.max(def.path.length, 1);
  return (
    <g opacity={o}>
      {Array.from({ length: n }, (_, i) => {
        let t = ((frame - from) * speed + i / n) % 1;
        if (def.flow === -1) t = 1 - t;
        const pt = pointAt(def.path, t);
        return (
          <g key={i}>
            <circle cx={pt.x} cy={pt.y} r={10} fill={def.color} opacity={0.7} filter="url(#glow)" />
            <circle cx={pt.x} cy={pt.y} r={3.8} fill="#fff" />
          </g>
        );
      })}
    </g>
  );
};

export const WorldLabel: React.FC<{ def: LabelDef; frame: number; fps: number }> = ({ def, frame, fps }) => {
  const s = spring({ frame: frame - def.at, fps, config: { damping: 200 }, durationInFrames: 16 });
  const o = Math.min(s, interpolate(frame, [def.out, def.out + 10], [1, 0], CLAMP));
  if (o <= 0.001) return null;
  const fs = def.size ?? 16;
  const w = def.text.length * fs * 0.58 + fs * 2;
  const h = fs * 2.1;
  return (
    <g opacity={o} transform={`translate(${def.x} ${def.y + (1 - s) * 10})`}>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={h / 2} fill="rgba(7,11,20,0.92)" stroke="rgba(148,163,184,0.55)" strokeWidth={1.2} />
      <text x={0} y={fs * 0.36} textAnchor="middle" fontFamily={SANS} fontWeight={600} fontSize={fs} fill="#f1f5f9">
        {def.text}
      </text>
    </g>
  );
};
