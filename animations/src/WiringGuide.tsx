import React from "react";
import { AbsoluteFill, interpolate, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { SANS } from "./fonts";
import { COLORS, PH_BNC, PH_PINS, PH_PROBE_X, chipPin, rail } from "./layout";
import { PI_TAGS, PULSES, RAIL_GLOWS, RESISTORS, WIRES, WORLD_LABELS, pulse } from "./scene";
import { PH_WIRES } from "./PhGuide";
import { CLAMP, StepId, cameraAt, powerOn, sec, stepAt, stepRange } from "./timeline";
import { BACKDROP, World } from "./components/World";
import {
  CaptionBar,
  MathCard,
  Multimeter,
  PinoutCard,
  PowerBadge,
  SafetyCard,
  SummaryCard,
  TerminalCard,
  TitleCard,
} from "./components/Overlays";

// Steps where every finished wire stays at full strength.
const NO_DIM: StepId[] = ["intro", "parts", "safety", "done"];

// Step 9: the pH board's wires from the pH guide, at this guide's times.
const PH_TIMES: Record<string, [number, number]> = { phVcc: [85.6, 86.8], phGnd: [86.9, 88.1], phSig: [88.2, 89.6], phCable: [90.0, 91.8] };
const ALL_WIRES = [...WIRES, ...PH_WIRES.map((w) => ({ ...w, step: "ph", start: sec(PH_TIMES[w.id][0]), dur: sec(PH_TIMES[w.id][1] - PH_TIMES[w.id][0]) }))];
const ALL_PULSES = [
  ...PULSES,
  pulse(PH_PINS.vcc, COLORS.v33, 85.2, 86.8),
  pulse(rail(16, "botPlus"), COLORS.v33, 85.8, 87.2, 10),
  pulse(PH_PINS.gnd, COLORS.gndUi, 86.6, 88.1),
  pulse(PH_PINS.sig, COLORS.ph, 87.9, 89.6),
  pulse(chipPin(3), COLORS.ph, 88.8, 90.6, 10),
  pulse(PH_BNC, COLORS.ph, 90.0, 91.8, 18),
  pulse({ x: PH_PROBE_X, y: 640 }, COLORS.ph, 91.6, 92.8, 16),
];
// Everything after step 9 runs 8 s later than in the two-sensor version.
const PH_SHIFT = sec(8);

export const WiringGuide: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const step = stepAt(frame);

  return (
    <AbsoluteFill style={{ fontFamily: SANS, background: BACKDROP }}>
      <World
        cam={cameraAt(frame)}
        wires={ALL_WIRES}
        pulses={ALL_PULSES}
        tags={PI_TAGS}
        labels={WORLD_LABELS}
        glows={RAIL_GLOWS}
        resistors={RESISTORS}
        appear={{ pi: sec(4.3), bb: sec(5.0), tds: sec(5.7), turb: sec(6.4), beaker: sec(7.1), cables: sec(7.1) }}
        chipAt={sec(12.6)}
        switchA={interpolate(frame, [sec(66.0), sec(66.6)], [0, 1], CLAMP)}
        powered={powerOn(frame)}
        ph={frame >= sec(85.2) ? { at: sec(85.2), cap: interpolate(frame, [sec(91.9), sec(92.7)], [1, 0], CLAMP) } : undefined}
        focusStep={step === "done" ? null : step}
        dimOthers={!NO_DIM.includes(step)}
        flowFrom={stepRange("done").from + sec(1.5)}
      />

      <PinoutCard frame={frame} />
      <Sequence from={0} durationInFrames={sec(4)}>
        <TitleCard />
      </Sequence>
      <Sequence from={sec(9)} durationInFrames={sec(3)} premountFor={15}>
        <SafetyCard duration={sec(3)} />
      </Sequence>
      <Sequence from={sec(51.4)} durationInFrames={sec(5.6)} premountFor={15}>
        <TerminalCard duration={sec(5.6)} />
      </Sequence>
      <Sequence from={sec(75)} durationInFrames={sec(10)} premountFor={15}>
        <MathCard duration={sec(10)} />
      </Sequence>
      <Multimeter frame={frame - PH_SHIFT} fps={fps} />
      <Sequence from={sec(100)} durationInFrames={sec(8)} premountFor={15}>
        <SummaryCard />
      </Sequence>
      <PowerBadge frame={frame} fps={fps} />
      <CaptionBar />
    </AbsoluteFill>
  );
};
