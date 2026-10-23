import { continueRender, delayRender } from "remotion";
// Bundled from npm (Fontsource) instead of fetched from Google at runtime, so the website's
// player sends no visitor data to Google; the same files are used when rendering videos.
import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/600.css";

export const SANS = "'Inter Variable', Inter, system-ui, sans-serif";
export const MONO = "'JetBrains Mono', ui-monospace, monospace";

// Hold the first frame until the fonts are there, so no frame renders with a fallback font.
if (typeof document !== "undefined") {
  const handle = delayRender("Loading fonts");
  Promise.all(["400 16px 'Inter Variable'", "800 16px 'Inter Variable'", "400 16px 'JetBrains Mono'", "600 16px 'JetBrains Mono'"].map((f) => document.fonts.load(f)))
    .catch(() => undefined)
    .then(() => continueRender(handle));
}
