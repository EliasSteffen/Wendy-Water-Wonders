import React from "react";
import { AbsoluteFill, interpolate, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { SANS } from "./fonts";
import { PI_TAGS, PULSES, RAIL_GLOWS, RESISTORS, WIRES, WORLD_LABELS } from "./scene";
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

export const WiringGuide: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const step = stepAt(frame);

  return (
    <AbsoluteFill style={{ fontFamily: SANS, background: BACKDROP }}>
      <World
        cam={cameraAt(frame)}
        wires={WIRES}
        pulses={PULSES}
        tags={PI_TAGS}
        labels={WORLD_LABELS}
        glows={RAIL_GLOWS}
        resistors={RESISTORS}
        appear={{ pi: sec(4.3), bb: sec(5.0), tds: sec(5.7), turb: sec(6.4), beaker: sec(7.1), cables: sec(7.1) }}
        chipAt={sec(12.6)}
        switchA={interpolate(frame, [sec(66.0), sec(66.6)], [0, 1], CLAMP)}
        powered={powerOn(frame)}
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
      <Multimeter frame={frame} fps={fps} />
      <Sequence from={sec(92)} durationInFrames={sec(8)} premountFor={15}>
        <SummaryCard />
      </Sequence>
      <PowerBadge frame={frame} fps={fps} />
      <CaptionBar />
    </AbsoluteFill>
  );
};
