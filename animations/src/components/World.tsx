import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { HEIGHT, VIEW, WIDTH } from "../layout";
import type { GlowDef, LabelDef, PulseDef, ResistorDef, TagDef, WireDef } from "../scene";
import { Camera, sec } from "../timeline";
import { Beaker, Breadboard, Chip, PhBoard, ProbeCables, RaspberryPi, Resistor, SensorBoard } from "./Hardware";
import { FlowDots, PinTag, Pulse, RailGlow, WireBody, WirePlugs, WorldLabel } from "./WireView";

export const BACKDROP = "radial-gradient(1400px 800px at 50% 38%, #13213b 0%, #080e1c 58%, #04070f 100%)";

const Appear: React.FC<{ at: number; children: React.ReactNode }> = ({ at, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - at, fps, config: { damping: 200 }, durationInFrames: 22 });
  if (s <= 0.001) return null;
  return (
    <g opacity={s} transform={`translate(0 ${(1 - s) * 28})`}>
      {children}
    </g>
  );
};

const Defs: React.FC = () => (
  <defs>
    <pattern id="mat" width={40} height={40} patternUnits="userSpaceOnUse">
      <path d="M40 0 H0 V40" fill="none" stroke="rgba(148,163,184,0.07)" strokeWidth={1.5} />
    </pattern>
    <linearGradient id="pcb" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor="#24864a" />
      <stop offset="1" stopColor="#135a2c" />
    </linearGradient>
    <linearGradient id="pcbBlue" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor="#2459b8" />
      <stop offset="1" stopColor="#163a7a" />
    </linearGradient>
    <linearGradient id="pcbBlack" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor="#2a2d33" />
      <stop offset="1" stopColor="#15171b" />
    </linearGradient>
    <linearGradient id="pcbPurple" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor="#6b3fb8" />
      <stop offset="1" stopColor="#3d1f7a" />
    </linearGradient>
    <linearGradient id="board" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#f8f5ee" />
      <stop offset="1" stopColor="#ebe5d7" />
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor="#f7dc85" />
      <stop offset="1" stopColor="#b5892c" />
    </linearGradient>
    <linearGradient id="metal" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor="#eef0f3" />
      <stop offset="1" stopColor="#9aa1ab" />
    </linearGradient>
    <linearGradient id="soc" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor="#dfe3e8" />
      <stop offset="1" stopColor="#a8afb8" />
    </linearGradient>
    <linearGradient id="chipBody" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#2d3036" />
      <stop offset="1" stopColor="#131518" />
    </linearGradient>
    <linearGradient id="water" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#38bdf8" stopOpacity={0.38} />
      <stop offset="1" stopColor="#0e7490" stopOpacity={0.6} />
    </linearGradient>
    {/* Only used on shapes with area (circles, rects), so bbox units are safe. */}
    <filter id="glow" x="-100%" y="-100%" width="300%" height="300%">
      <feGaussianBlur stdDeviation={5} />
    </filter>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation={9} />
    </filter>
  </defs>
);

export type WorldProps = {
  cam: Camera;
  wires: WireDef[];
  pulses: PulseDef[];
  tags: TagDef[];
  labels: LabelDef[];
  glows: GlowDef[];
  resistors: ResistorDef[];
  appear: { pi: number; bb: number; tds: number; turb: number; beaker: number; cables: number };
  cables?: { tds: boolean; turb: boolean };
  chipAt: number;
  switchA: number;
  powered: boolean;
  waterLevel?: number;
  waterColor?: string;
  // pH board and probe; cap = storage cap on the probe (1 on, 0 off).
  ph?: { at: number; cap: number };
  // Wires of this step glow; with dimOthers every other wire is faded.
  focusStep: string | null;
  dimOthers: boolean;
  flowFrom: number;
  flowIds?: string[];
  // Extra world-space drawing, rendered above the beaker.
  extra?: React.ReactNode;
};

export const World: React.FC<WorldProps> = ({
  cam,
  wires,
  pulses,
  tags,
  labels,
  glows,
  resistors,
  appear,
  cables = { tds: true, turb: true },
  chipAt,
  switchA,
  powered,
  waterLevel = 1,
  waterColor,
  ph,
  focusStep,
  dimOthers,
  flowFrom,
  flowIds,
  extra,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const chipDrop = spring({ frame: frame - chipAt, fps, config: { damping: 16, stiffness: 120 } });
  const dimFor = (w: WireDef) => dimOthers && w.step !== focusStep;
  const flowing = flowIds ? wires.filter((w) => flowIds.includes(w.id)) : wires;
  return (
    <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{ position: "absolute", inset: 0 }}>
      <Defs />
      <g transform={`translate(${VIEW.x} ${VIEW.y}) scale(${cam.z}) translate(${-cam.cx} ${-cam.cy})`}>
        <rect x={-1400} y={-1000} width={4800} height={3200} fill="url(#mat)" />
        <Appear at={appear.cables}>
          <ProbeCables tds={cables.tds} turb={cables.turb} />
        </Appear>
        <Appear at={appear.pi}>
          <RaspberryPi led={powered ? 1 : 0} />
        </Appear>
        <Appear at={appear.bb}>
          <Breadboard />
        </Appear>
        {glows.map((g, i) => (
          <RailGlow key={i} def={g} frame={frame} />
        ))}
        <Appear at={appear.tds}>
          <SensorBoard kind="tds" switchA={0} />
        </Appear>
        <Appear at={appear.turb}>
          <SensorBoard kind="turb" switchA={switchA} />
        </Appear>
        {ph && (
          <Appear at={ph.at}>
            <PhBoard />
          </Appear>
        )}
        <Appear at={appear.beaker}>
          <Beaker
            frame={frame}
            powered={powered && waterLevel > 0.5}
            level={waterLevel}
            phProbe={!!ph}
            phCap={ph?.cap ?? 0}
            waterColor={waterColor}
          />
        </Appear>
        {extra}
        <Chip drop={chipDrop} />
        {resistors.map((r) => (
          <Resistor key={r.id} def={r} t={spring({ frame: frame - r.at, fps, config: { damping: 15, stiffness: 140 } })} />
        ))}
        {wires.map((w) => (
          <WireBody key={w.id} def={w} frame={frame} dim={dimFor(w)} focus={focusStep !== null && w.step === focusStep} />
        ))}
        {wires.map((w) => (
          <WirePlugs key={w.id} def={w} frame={frame} fps={fps} dim={dimFor(w)} />
        ))}
        {pulses.map((p, i) => (
          <Pulse key={i} def={p} frame={frame} />
        ))}
        {tags.map((t, i) => (
          <PinTag key={i} def={t} frame={frame} fps={fps} active={frame - t.at < sec(2.6)} />
        ))}
        {labels.map((l, i) => (
          <WorldLabel key={i} def={l} frame={frame} fps={fps} />
        ))}
        {flowing.map((w) => (
          <FlowDots key={w.id} def={w} frame={frame} from={flowFrom} />
        ))}
      </g>
    </svg>
  );
};
