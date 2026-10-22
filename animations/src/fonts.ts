import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";

export const SANS = loadInter("normal", {
  weights: ["400", "500", "600", "700", "800"],
  subsets: ["latin", "greek"],
}).fontFamily;

export const MONO = loadMono("normal", {
  weights: ["400", "600"],
  subsets: ["latin"],
}).fontFamily;
