import React from "react";
import { SANS } from "../fonts";
import { Pt, toPath } from "../geometry";
import {
  BB,
  BEAKER,
  CHANNEL_Y,
  CHIP,
  HEADER,
  PH_BNC,
  PH_BOARD,
  PH_PINS,
  PH_PROBE_X,
  PI,
  PI_LED,
  RAIL_Y,
  ROWS,
  ROW_Y,
  TDS_BOARD,
  TDS_PINS,
  TDS_PROBE_X,
  TURB_BOARD,
  TURB_PINS,
  TURB_PROBE_X,
  TURB_SWITCH,
  chipPin,
  colX,
  piPin,
} from "../layout";
import { ResistorDef, TDS_CABLE, TURB_CABLE } from "../scene";

const seeded = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
};

// Scattered SMD parts so the Pi doesn't look like a flat green slab.
const SMD = (() => {
  const r = seeded(11);
  const out: { x: number; y: number; w: number; h: number; c: string }[] = [];
  for (let i = 0; i < 54; i++) {
    const x = 70 + r() * 260;
    const y = 160 + r() * 600;
    const horiz = r() > 0.5;
    const c = r() > 0.7 ? "#b5893f" : "#2f3135";
    // Keep the silkscreen label readable.
    if (y > 556 && y < 596 && x < 300) continue;
    out.push({ x, y, w: horiz ? 11 : 6, h: horiz ? 6 : 11, c });
  }
  return out;
})();

const Port: React.FC<{ x: number; w: number; kind: "eth" | "usb3" | "usb2" }> = ({ x, w, kind }) => {
  const y = 800;
  const h = 86;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={4} fill="url(#metal)" stroke="#6b7280" strokeWidth={1.5} />
      {kind === "eth" ? (
        <>
          <rect x={x + 12} y={y + 22} width={w - 24} height={h - 30} rx={3} fill="#15181c" />
          <rect x={x + 8} y={y + 6} width={14} height={8} rx={1.5} fill="#22c55e" opacity={0.85} />
          <rect x={x + w - 22} y={y + 6} width={14} height={8} rx={1.5} fill="#f59e0b" opacity={0.85} />
        </>
      ) : (
        [y + 10, y + 48].map((oy) => (
          <g key={oy}>
            <rect x={x + 10} y={oy} width={w - 20} height={28} rx={3} fill="#15181c" />
            <rect x={x + 18} y={oy + 9} width={w - 36} height={10} rx={2} fill={kind === "usb3" ? "#2563eb" : "#2a2d33"} />
          </g>
        ))
      )}
    </g>
  );
};

export const RaspberryPi: React.FC<{ led: number }> = ({ led }) => {
  const { x, y, w, h } = PI;
  const posts: React.ReactNode[] = [];
  for (let n = 1; n <= 40; n++) {
    const p = piPin(n);
    posts.push(
      <rect key={n} x={p.x - 5.5} y={p.y - 5.5} width={11} height={11} rx={1.5} fill="url(#gold)" stroke="#7a5b17" strokeWidth={0.8} />,
    );
  }
  return (
    <g>
      <rect x={x + 8} y={y + 12} width={w} height={h} rx={22} fill="#000" opacity={0.45} filter="url(#soft)" />
      <rect x={x} y={y} width={w} height={h} rx={22} fill="url(#pcb)" stroke="#0a3519" strokeWidth={2} />
      <g fill="none" stroke="#5fd38a" strokeOpacity={0.14} strokeWidth={2}>
        <path d="M110 280 V250 H330" />
        <path d="M246 380 H335 V600" />
        <path d="M142 532 V552" />
        <path d="M116 640 H95 V760" />
        <path d="M192 690 V770 H330" />
      </g>
      {SMD.map((s, i) => (
        <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} rx={1} fill={s.c} opacity={0.9} />
      ))}
      {[
        [72, 150],
        [300, 150],
        [72, 712],
        [300, 712],
      ].map(([hx, hy]) => (
        <g key={`${hx}-${hy}`}>
          <circle cx={hx} cy={hy} r={13} fill="#d6b453" />
          <circle cx={hx} cy={hy} r={8} fill="#08101d" />
        </g>
      ))}
      <rect x={120} y={126} width={150} height={16} rx={3} fill="#e9e1cf" stroke="#b9ae95" />
      {/* SoC, RAM, RP1 — kept left of x≈210 so the pin tags never cover them */}
      <rect x={96} y={280} width={150} height={150} rx={10} fill="url(#soc)" stroke="#8b939e" strokeWidth={2} />
      <rect x={112} y={296} width={118} height={118} rx={6} fill="none" stroke="#9aa2ad" strokeOpacity={0.6} />
      <text x={171} y={358} textAnchor="middle" fontFamily={SANS} fontWeight={700} fontSize={17} fill="#4b5563">
        BCM2712
      </text>
      <text x={171} y={378} textAnchor="middle" fontFamily={SANS} fontSize={11} fill="#6b7280">
        Broadcom
      </text>
      <rect x={80} y={462} width={124} height={70} rx={6} fill="#16181b" stroke="#2c2f34" />
      <text x={142} y={501} textAnchor="middle" fontFamily={SANS} fontWeight={600} fontSize={12} fill="#9ca3af">
        8GB LPDDR4X
      </text>
      <rect x={116} y={610} width={76} height={76} rx={6} fill="#1d1f23" stroke="#33373d" />
      <text x={154} y={653} textAnchor="middle" fontFamily={SANS} fontWeight={700} fontSize={14} fill="#a1a8b3">
        RP1
      </text>
      {/* Left edge: USB-C power and two micro-HDMI */}
      <rect x={24} y={186} width={34} height={52} rx={10} fill="url(#metal)" stroke="#6b7280" />
      <rect x={32} y={200} width={18} height={24} rx={6} fill="#1f2328" />
      <rect x={28} y={298} width={30} height={40} rx={5} fill="url(#metal)" stroke="#6b7280" />
      <rect x={28} y={366} width={30} height={40} rx={5} fill="url(#metal)" stroke="#6b7280" />
      <text x={80} y={584} fontFamily={SANS} fontWeight={800} fontSize={20} fill="#f1f5f9" opacity={0.92}>
        Raspberry Pi 5
      </text>
      {/* Power LED */}
      {led > 0 && <circle cx={PI_LED.x} cy={PI_LED.y} r={14} fill="#ff3b3b" opacity={0.6 * led} filter="url(#glow)" />}
      <rect x={PI_LED.x - 6} y={PI_LED.y - 4} width={12} height={8} rx={2} fill={led > 0.5 ? "#ff5a5a" : "#5b1d1d"} />
      <text x={PI_LED.x + 12} y={PI_LED.y + 4} fontFamily={SANS} fontSize={10} fontWeight={700} fill="#d1fae5" opacity={0.7}>
        PWR
      </text>
      {/* GPIO header */}
      <rect
        x={HEADER.oddX - 18}
        y={HEADER.y0 - 18}
        width={HEADER.evenX - HEADER.oddX + 36}
        height={19 * HEADER.pitch + 36}
        rx={4}
        fill="#131518"
        stroke="#000"
        strokeWidth={1.5}
      />
      {posts}
      <Port x={50} w={112} kind="eth" />
      <Port x={174} w={90} kind="usb3" />
      <Port x={276} w={90} kind="usb2" />
    </g>
  );
};

const RAIL_SIGNS: [number, string, string][] = [
  [RAIL_Y.topPlus, "+", "#e11d48"],
  [RAIL_Y.topMinus, "−", "#2563eb"],
  [RAIL_Y.botMinus, "−", "#2563eb"],
  [RAIL_Y.botPlus, "+", "#e11d48"],
];

export const Breadboard: React.FC = () => {
  const holes: React.ReactNode[] = [];
  for (let c = 1; c <= 30; c++) {
    const x = colX(c);
    for (const r of ROWS) {
      holes.push(<rect key={`${c}${r}`} x={x - 4} y={ROW_Y[r] - 4} width={8} height={8} rx={1.6} fill="#3d3f45" />);
    }
    for (const ry of Object.values(RAIL_Y)) {
      holes.push(<rect key={`${c}-${ry}`} x={x - 4} y={ry - 4} width={8} height={8} rx={1.6} fill="#3d3f45" />);
    }
  }
  const lx = BB.x + 30;
  const rx = BB.x + BB.w - 30;
  return (
    <g>
      <rect x={BB.x + 8} y={BB.y + 14} width={BB.w} height={BB.h} rx={16} fill="#000" opacity={0.45} filter="url(#soft)" />
      <rect x={BB.x} y={BB.y} width={BB.w} height={BB.h} rx={16} fill="url(#board)" stroke="#cfc8b8" strokeWidth={2} />
      <rect x={BB.x + 14} y={CHANNEL_Y - 12} width={BB.w - 28} height={24} rx={6} fill="#ddd6c7" />
      <line x1={lx} x2={rx} y1={154} y2={154} stroke="#e11d48" strokeWidth={3} />
      <line x1={lx} x2={rx} y1={208} y2={208} stroke="#2563eb" strokeWidth={3} />
      <line x1={lx} x2={rx} y1={540} y2={540} stroke="#2563eb" strokeWidth={3} />
      <line x1={lx} x2={rx} y1={594} y2={594} stroke="#e11d48" strokeWidth={3} />
      {RAIL_SIGNS.map(([y, s, c]) => (
        <g key={y} fontFamily={SANS} fontWeight={800} fontSize={18} fill={c} textAnchor="middle">
          <text x={BB.x + 16} y={y + 6}>
            {s}
          </text>
          <text x={BB.x + BB.w - 16} y={y + 6}>
            {s}
          </text>
        </g>
      ))}
      {[1, 5, 10, 15, 20, 25, 30].map((c) => (
        <g key={c} fontFamily={SANS} fontSize={11} fontWeight={600} fill="#8a8476" textAnchor="middle">
          <text x={colX(c)} y={226}>
            {c}
          </text>
          <text x={colX(c)} y={532}>
            {c}
          </text>
        </g>
      ))}
      {ROWS.map((r) => (
        <g key={r} fontFamily={SANS} fontSize={11} fontWeight={600} fill="#8a8476" textAnchor="middle">
          <text x={BB.x + 22} y={ROW_Y[r] + 4}>
            {r}
          </text>
          <text x={BB.x + BB.w - 22} y={ROW_Y[r] + 4}>
            {r}
          </text>
        </g>
      ))}
      {holes}
    </g>
  );
};

export const Chip: React.FC<{ drop: number }> = ({ drop }) => {
  if (drop <= 0.001) return null;
  const cx = CHIP.x + CHIP.w / 2;
  const cy = CHIP.y + CHIP.h / 2;
  const lift = (1 - drop) * -150;
  const s = 1 + (1 - drop) * 0.3;
  const legs: React.ReactNode[] = [];
  for (let p = 1; p <= 16; p++) {
    const pt = chipPin(p);
    const top = p > 8;
    const y0 = top ? pt.y - 6 : CHIP.y + CHIP.h;
    const y1 = top ? CHIP.y : pt.y + 6;
    legs.push(<rect key={p} x={pt.x - 4.5} y={y0} width={9} height={y1 - y0} rx={1.5} fill="url(#metal)" stroke="#6b7280" strokeWidth={0.6} />);
  }
  return (
    <g opacity={Math.min(1, drop * 1.6)}>
      <rect x={CHIP.x + 6} y={CHIP.y + 10} width={CHIP.w} height={CHIP.h} rx={5} fill="#000" opacity={0.35 * Math.min(1, drop)} filter="url(#soft)" />
      <g transform={`translate(${cx} ${cy + lift}) scale(${s}) translate(${-cx} ${-cy})`}>
        {legs}
        <rect x={CHIP.x} y={CHIP.y} width={CHIP.w} height={CHIP.h} rx={4} fill="url(#chipBody)" stroke="#000" strokeWidth={1.2} />
        <path d={`M${CHIP.x} ${cy - 8} A8 8 0 0 1 ${CHIP.x} ${cy + 8} Z`} fill="#050506" />
        <circle cx={CHIP.x + 14} cy={CHIP.y + CHIP.h - 9} r={3.4} fill="#26292e" stroke="#4b5059" />
        <text x={cx + 6} y={cy + 5} textAnchor="middle" fontFamily={SANS} fontWeight={700} fontSize={14} letterSpacing={1.5} fill="#c7ccd4">
          MCP3008-I/P
        </text>
      </g>
    </g>
  );
};

type BoardPin = Pt & { l: string };

export const SensorBoard: React.FC<{ kind: "tds" | "turb"; switchA: number }> = ({ kind, switchA }) => {
  const b = kind === "tds" ? TDS_BOARD : TURB_BOARD;
  const pins: BoardPin[] =
    kind === "tds"
      ? [
          { ...TDS_PINS.vcc, l: "+" },
          { ...TDS_PINS.gnd, l: "−" },
          { ...TDS_PINS.sig, l: "A" },
        ]
      : [
          { ...TURB_PINS.out, l: "OUT" },
          { ...TURB_PINS.gnd, l: "GND" },
          { ...TURB_PINS.vcc, l: "VCC" },
        ];
  const x0 = pins[0].x - 20;
  const x1 = pins[2].x + 20;
  const corners = [
    [b.x + 16, b.y + 16],
    [b.x + b.w - 16, b.y + 16],
    [b.x + 16, b.y + b.h - 16],
    [b.x + b.w - 16, b.y + b.h - 16],
  ];
  return (
    <g>
      <rect x={b.x + 6} y={b.y + 10} width={b.w} height={b.h} rx={14} fill="#000" opacity={0.45} filter="url(#soft)" />
      <rect
        x={b.x}
        y={b.y}
        width={b.w}
        height={b.h}
        rx={14}
        fill={kind === "tds" ? "url(#pcbBlue)" : "url(#pcbPurple)"}
        stroke={kind === "tds" ? "#0b2a5b" : "#2a0f55"}
        strokeWidth={2}
      />
      {corners.map(([cx, cy]) => (
        <g key={`${cx}-${cy}`}>
          <circle cx={cx} cy={cy} r={7} fill="#d6b453" />
          <circle cx={cx} cy={cy} r={3.5} fill="#08101d" />
        </g>
      ))}
      <rect x={x0} y={b.y + 6} width={x1 - x0} height={24} rx={3} fill="#141619" />
      {pins.map((pn) => (
        <rect key={pn.l} x={pn.x - 5.5} y={pn.y - 5.5} width={11} height={11} rx={1.5} fill="url(#gold)" stroke="#7a5b17" strokeWidth={0.8} />
      ))}
      {pins.map((pn) => (
        <text key={`l${pn.l}`} x={pn.x} y={b.y + 50} textAnchor="middle" fontFamily={SANS} fontWeight={800} fontSize={14} fill="#ffffff">
          {pn.l}
        </text>
      ))}
      {kind === "tds" ? (
        <>
          <rect x={b.x + 30} y={b.y + 72} width={52} height={32} rx={3} fill="#16181b" />
          <circle cx={b.x + 106} cy={b.y + 80} r={5} fill="#60a5fa" />
          <rect x={b.x + 124} y={b.y + 72} width={26} height={14} rx={2} fill="#d6d3d1" opacity={0.9} />
          <rect x={b.x + 124} y={b.y + 92} width={26} height={14} rx={2} fill="#d6d3d1" opacity={0.9} />
          <rect x={b.x + b.w - 26} y={b.y + 62} width={30} height={48} rx={4} fill="#f2efe6" stroke="#c9c3b5" />
          <text x={b.x + 22} y={b.y + b.h - 22} fontFamily={SANS} fontWeight={800} fontSize={20} fill="#f8fafc">
            TDS Meter
          </text>
          <text x={b.x + 140} y={b.y + b.h - 22} fontFamily={SANS} fontWeight={600} fontSize={12} fill="#bfdbfe">
            CQRobot
          </text>
        </>
      ) : (
        <>
          <rect x={TURB_SWITCH.x - 30} y={TURB_SWITCH.y - 13} width={60} height={26} rx={4} fill="#111214" stroke="#000" />
          <rect x={TURB_SWITCH.x - 27 + switchA * 28} y={TURB_SWITCH.y - 10} width={26} height={20} rx={3} fill="#f1f5f9" />
          <text x={TURB_SWITCH.x - 15} y={TURB_SWITCH.y - 20} textAnchor="middle" fontFamily={SANS} fontWeight={800} fontSize={13} fill="#fff">
            D
          </text>
          <text x={TURB_SWITCH.x + 15} y={TURB_SWITCH.y - 20} textAnchor="middle" fontFamily={SANS} fontWeight={800} fontSize={13} fill="#fff">
            A
          </text>
          <rect x={1286} y={772} width={34} height={34} rx={4} fill="#2563eb" />
          <circle cx={1303} cy={789} r={10} fill="#e5e7eb" />
          <path d="M1297 789 H1309 M1303 783 V795" stroke="#6b7280" strokeWidth={2.5} />
          <rect x={b.x + b.w - 26} y={b.y + 52} width={30} height={48} rx={4} fill="#f2efe6" stroke="#c9c3b5" />
          <text x={b.x + 22} y={b.y + b.h - 22} fontFamily={SANS} fontWeight={800} fontSize={20} fill="#f8fafc">
            Turbidity v1.0
          </text>
        </>
      )}
    </g>
  );
};

export const PhBoard: React.FC = () => {
  const b = PH_BOARD;
  const pins: BoardPin[] = [
    { ...PH_PINS.sig, l: "A" },
    { ...PH_PINS.vcc, l: "+" },
    { ...PH_PINS.gnd, l: "−" },
  ];
  return (
    <g>
      <rect x={b.x + 6} y={b.y + 10} width={b.w} height={b.h} rx={14} fill="#000" opacity={0.45} filter="url(#soft)" />
      <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={14} fill="url(#pcbBlack)" stroke="#000" strokeWidth={2} />
      {[
        [b.x + 16, b.y + b.h - 16],
        [b.x + b.w - 16, b.y + 44],
      ].map(([cx, cy]) => (
        <g key={`${cx}-${cy}`}>
          <circle cx={cx} cy={cy} r={7} fill="#e5e7eb" />
          <circle cx={cx} cy={cy} r={3.5} fill="#08101d" />
        </g>
      ))}
      <rect x={pins[0].x - 20} y={b.y + 6} width={pins[2].x - pins[0].x + 40} height={24} rx={3} fill="#f2efe6" stroke="#c9c3b5" />
      {pins.map((pn) => (
        <rect key={pn.l} x={pn.x - 5.5} y={pn.y - 5.5} width={11} height={11} rx={1.5} fill="url(#gold)" stroke="#7a5b17" strokeWidth={0.8} />
      ))}
      {pins.map((pn) => (
        <text key={`l${pn.l}`} x={pn.x} y={b.y + 50} textAnchor="middle" fontFamily={SANS} fontWeight={800} fontSize={14} fill="#ffffff">
          {pn.l}
        </text>
      ))}
      <rect x={b.x + 20} y={b.y + 66} width={42} height={26} rx={3} fill="#0b0c0e" stroke="#2a2d33" />
      <rect x={b.x + 72} y={b.y + 70} width={22} height={12} rx={2} fill="#d6d3d1" opacity={0.85} />
      <rect x={b.x + 102} y={b.y + 70} width={22} height={12} rx={2} fill="#d6d3d1" opacity={0.85} />
      <text x={b.x + 14} y={b.y + b.h - 44} fontFamily={SANS} fontWeight={800} fontSize={16} fill="#f8fafc">
        pH Meter V2.0
      </text>
      <text x={b.x + 30} y={b.y + b.h - 20} fontFamily={SANS} fontWeight={600} fontSize={11} fill="#9ca3af">
        DFRobot
      </text>
      {/* BNC socket for the probe */}
      <rect x={PH_BNC.x - 15} y={PH_BNC.y - 18} width={30} height={34} rx={4} fill="url(#metal)" stroke="#6b7280" />
      <circle cx={PH_BNC.x} cy={PH_BNC.y} r={9} fill="#9aa1ab" stroke="#4b5563" />
      <circle cx={PH_BNC.x} cy={PH_BNC.y} r={3} fill="#e5e7eb" />
    </g>
  );
};

export const ProbeCables: React.FC<{ tds?: boolean; turb?: boolean }> = ({ tds = true, turb = true }) => (
  <g fill="none" strokeLinecap="round" strokeLinejoin="round">
    {[tds && TDS_CABLE, turb && TURB_CABLE].filter((c): c is Pt[] => !!c).map((c, i) => (
      <g key={i}>
        <path d={toPath(c)} stroke="#000" strokeOpacity={0.35} strokeWidth={9} transform="translate(2 3)" />
        <path d={toPath(c)} stroke="#2b2f36" strokeWidth={7} />
        <path d={toPath(c)} stroke="#4b5563" strokeWidth={2} transform="translate(-1 -1)" />
      </g>
    ))}
  </g>
);

type BeakerProps = {
  frame: number;
  powered: boolean;
  level?: number;
  phProbe?: boolean;
  // 1 = storage cap on the pH probe, 0 = removed.
  phCap?: number;
  // Solid liquid colour (buffer solutions); default is water.
  waterColor?: string;
};

export const Beaker: React.FC<BeakerProps> = ({ frame, powered, level = 1, phProbe = false, phCap = 0, waterColor }) => {
  const { x, y, w, h, water } = BEAKER;
  const bottom = y + h - 6;
  const top = bottom - level * (bottom - water);
  const wave: Pt[] = [];
  for (let i = 0; i <= 40; i++) {
    const wx = x + 10 + (i / 40) * (w - 20);
    wave.push({ x: wx, y: top + Math.sin(wx * 0.045 + frame * 0.07) * 3.2 * Math.min(1, level * 4) });
  }
  const waterPath = `${toPath(wave)} L${x + w - 10} ${bottom - 14} Q${x + w - 10} ${bottom} ${x + w - 26} ${bottom} L${x + 26} ${bottom} Q${x + 10} ${bottom} ${x + 10} ${bottom - 14} Z`;
  const glass = `M${x - 8} ${y} L${x + 4} ${y + 10} L${x + 4} ${y + h - 20} Q${x + 4} ${y + h} ${x + 24} ${y + h} L${x + w - 24} ${y + h} Q${x + w - 4} ${y + h} ${x + w - 4} ${y + h - 20} L${x + w - 4} ${y + 10} L${x + w + 8} ${y}`;
  const tx = TDS_PROBE_X;
  const ux = TURB_PROBE_X;
  return (
    <g>
      <ellipse cx={x + w / 2} cy={y + h + 8} rx={w / 2 + 10} ry={12} fill="#000" opacity={0.4} filter="url(#soft)" />
      {level > 0.005 &&
        (waterColor ? <path d={waterPath} fill={waterColor} fillOpacity={0.5} /> : <path d={waterPath} fill="url(#water)" />)}
      {phProbe && (
        <g>
          <rect x={PH_PROBE_X - 15} y={300} width={30} height={46} rx={6} fill="#e7e5df" stroke="#a8a29e" />
          <rect x={PH_PROBE_X - 11} y={346} width={22} height={290} rx={6} fill="rgba(56,189,248,0.55)" stroke="rgba(186,230,253,0.9)" strokeWidth={1.5} />
          <circle cx={PH_PROBE_X} cy={642} r={9} fill="rgba(224,242,254,0.75)" stroke="rgba(186,230,253,0.9)" strokeWidth={1.5} />
          {phCap > 0.01 && (
            <g opacity={phCap} transform={`translate(0 ${(1 - phCap) * 70})`}>
              <rect x={PH_PROBE_X - 17} y={598} width={34} height={70} rx={9} fill="rgba(241,245,249,0.3)" stroke="rgba(241,245,249,0.9)" strokeWidth={1.5} />
              <rect x={PH_PROBE_X - 14} y={630} width={28} height={34} rx={7} fill="rgba(125,211,252,0.45)" />
            </g>
          )}
        </g>
      )}
      {/* TDS probe: two electrodes */}
      <rect x={tx - 14} y={300} width={28} height={332} rx={8} fill="#1b1d21" stroke="#000" />
      <rect x={tx - 14} y={330} width={28} height={8} fill="#3b82f6" opacity={0.8} />
      <rect x={tx - 10} y={632} width={5} height={58} rx={2} fill="url(#metal)" />
      <rect x={tx + 5} y={632} width={5} height={58} rx={2} fill="url(#metal)" />
      {powered && (
        <path
          d={`M${tx - 5} ${668} Q${tx} ${660 + Math.sin(frame * 0.5) * 6} ${tx + 5} ${668}`}
          stroke="#2dd4bf"
          strokeWidth={2}
          fill="none"
          opacity={0.9}
        />
      )}
      {/* Turbidity probe: IR LED and receiver in the two legs */}
      <rect x={ux - 28} y={300} width={56} height={300} rx={10} fill="rgba(203,213,225,0.5)" stroke="rgba(241,245,249,0.8)" strokeWidth={1.5} />
      <rect x={ux - 28} y={586} width={20} height={98} rx={8} fill="rgba(203,213,225,0.5)" stroke="rgba(241,245,249,0.8)" strokeWidth={1.5} />
      <rect x={ux + 8} y={586} width={20} height={98} rx={8} fill="rgba(203,213,225,0.5)" stroke="rgba(241,245,249,0.8)" strokeWidth={1.5} />
      <rect x={ux - 22} y={648} width={9} height={14} rx={2} fill="#3f3f46" />
      <rect x={ux + 13} y={648} width={9} height={14} rx={2} fill="#3f3f46" />
      {powered && (
        <line
          x1={ux - 13}
          x2={ux + 13}
          y1={655}
          y2={655}
          stroke="#f43f5e"
          strokeWidth={3}
          strokeDasharray="4 3"
          strokeDashoffset={-frame * 0.8}
          opacity={0.9}
        />
      )}
      <path d={glass} fill="rgba(255,255,255,0.05)" stroke="rgba(226,232,240,0.75)" strokeWidth={3} strokeLinejoin="round" />
      <line x1={x + 22} x2={x + 22} y1={y + 40} y2={y + h - 40} stroke="#fff" strokeOpacity={0.12} strokeWidth={6} strokeLinecap="round" />
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>
          <line x1={x + w - 4} x2={x + w - 26} y1={y + 120 + i * 80} y2={y + 120 + i * 80} stroke="rgba(226,232,240,0.6)" strokeWidth={2} />
          <text x={x + w - 32} y={y + 125 + i * 80} textAnchor="end" fontFamily={SANS} fontSize={11} fill="rgba(226,232,240,0.6)">
            {500 - i * 100}
          </text>
        </g>
      ))}
    </g>
  );
};

export const Resistor: React.FC<{ def: ResistorDef; t: number }> = ({ def, t }) => {
  if (t <= 0.001) return null;
  const { a, b } = def;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const bodyL = 46;
  const bodyW = 15;
  return (
    <g opacity={Math.min(1, t * 1.5)} transform={`translate(0 ${(1 - t) * -70})`}>
      <g transform={`translate(${mx} ${my}) rotate(${ang})`}>
        <line x1={-len / 2} x2={len / 2} y1={0} y2={0} stroke="#aeb5c0" strokeWidth={3.2} strokeLinecap="round" />
        <circle cx={-len / 2} cy={0} r={3.5} fill="#6b7280" />
        <circle cx={len / 2} cy={0} r={3.5} fill="#6b7280" />
        <rect x={-bodyL / 2 + 2} y={-bodyW / 2 + 3} width={bodyL} height={bodyW} rx={7} fill="#000" opacity={0.3} />
        <rect x={-bodyL / 2} y={-bodyW / 2} width={bodyL} height={bodyW} rx={7} fill="#e9d3a5" stroke="#b89a62" strokeWidth={1} />
        {def.bands.map((c, i) => (
          <rect key={i} x={-bodyL / 2 + 9 + i * 7 + (i === 3 ? 6 : 0)} y={-bodyW / 2} width={4} height={bodyW} fill={c} />
        ))}
      </g>
      <g transform={`translate(${def.labelAt.x} ${def.labelAt.y})`}>
        <rect x={-30} y={-12} width={60} height={24} rx={12} fill="rgba(7,11,20,0.92)" stroke="#94a3b8" strokeWidth={1.2} />
        <text x={0} y={4.5} textAnchor="middle" fontFamily={SANS} fontWeight={700} fontSize={13} fill="#f1f5f9">
          {def.label}
        </text>
      </g>
    </g>
  );
};
