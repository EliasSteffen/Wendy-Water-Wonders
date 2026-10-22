import React from "react";
import { Composition } from "remotion";
import { FPS, HEIGHT, WIDTH } from "./layout";
import { TOTAL_FRAMES } from "./timeline";
import { PH_TOTAL_FRAMES, PhGuide } from "./PhGuide";
import { TDS_TOTAL_FRAMES, TdsGuide } from "./TdsGuide";
import { WiringGuide } from "./WiringGuide";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="WiringGuide" component={WiringGuide} durationInFrames={TOTAL_FRAMES} fps={FPS} width={WIDTH} height={HEIGHT} />
    <Composition id="TdsGuide" component={TdsGuide} durationInFrames={TDS_TOTAL_FRAMES} fps={FPS} width={WIDTH} height={HEIGHT} />
    <Composition id="PhGuide" component={PhGuide} durationInFrames={PH_TOTAL_FRAMES} fps={FPS} width={WIDTH} height={HEIGHT} />
  </>
);
