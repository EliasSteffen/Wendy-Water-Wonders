import { Player, type PlayerRef } from "@remotion/player";
import { useEffect, useRef, useState } from "react";
import { ARCH_TOTAL_FRAMES, Architecture } from "../../../animations/src/Architecture";
import { STATION_TOTAL_FRAMES, StationOverview } from "../../../animations/src/StationOverview";

const FPS = 30;

// The compositions from animations/, played live in the browser. Chapters: [label, second].
const FILMS = {
  station: {
    component: StationOverview,
    frames: STATION_TOTAL_FRAMES,
    title: "Animation: how the station works",
    chapters: [
      ["The parts", 4],
      ["How it measures", 11],
      ["Clear water", 18],
      ["Salt", 24],
      ["The light stays on", 33],
      ["Reset", 39],
      ["Turbidity", 44],
      ["pH", 52],
      ["Offline", 60],
    ],
  },
  architecture: {
    component: Architecture,
    frames: ARCH_TOTAL_FRAMES,
    title: "Animation: from the well to the phone",
    chapters: [
      ["Turkana", 4],
      ["Stations", 14],
      ["Measure", 19],
      ["Send", 25],
      ["Decide", 32],
      ["Alert", 40],
      ["Dashboard", 48],
      ["Reset", 54],
    ],
  },
} as const;

export default function AnimationPlayer({ film }: { film: keyof typeof FILMS }) {
  const f = FILMS[film];
  const ref = useRef<PlayerRef>(null);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const player = ref.current;
    if (!player) return;
    const onFrame = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    player.addEventListener("frameupdate", onFrame);
    return () => player.removeEventListener("frameupdate", onFrame);
  }, []);

  const current = f.chapters.reduce((cur, [, s], i) => (frame >= s * FPS ? i : cur), -1);
  const jump = (s: number) => {
    ref.current?.seekTo(s * FPS);
    ref.current?.play();
  };

  return (
    <div className="player">
      <div className="player-frame">
        <Player
          ref={ref}
          component={f.component}
          durationInFrames={f.frames}
          fps={FPS}
          compositionWidth={1920}
          compositionHeight={1080}
          style={{ width: "100%", height: "100%" }}
          controls
          clickToPlay
          showVolumeControls={false}
          acknowledgeRemotionLicense
          aria-label={f.title}
        />
      </div>
      <div className="chapters" aria-label="Chapters">
        {f.chapters.map(([label, s], i) => (
          <button key={label} type="button" aria-current={i === current} onClick={() => jump(s)}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
