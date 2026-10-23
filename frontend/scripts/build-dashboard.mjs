// Builds the dashboard demo for the website: the original cloud/static/map.html with Azure Maps
// and the cloud API swapped for dashboard/shim.js (MapLibre + recorded data). Output: public/dashboard/
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const out = new URL("../public/dashboard/", import.meta.url);
const MAPLIBRE = "https://unpkg.com/maplibre-gl@4.7.1/dist";

let html = readFileSync(new URL("cloud/static/map.html", root), "utf8");
// The dashboard's font (Atkinson Hyperlegible) is served from here too, not from Google.
const FONT_DIR = new URL("../../node_modules/@fontsource/atkinson-hyperlegible/files/", import.meta.url);
const FONT_FILES = [400, 700].map((w) => `atkinson-hyperlegible-latin-${w}-normal.woff2`);
const FONT_CSS = [400, 700]
  .map((w, i) => `@font-face{font-family:"Atkinson Hyperlegible";font-weight:${w};font-display:swap;src:url(fonts/${FONT_FILES[i]}) format("woff2")}`)
  .join("");

const swaps = [
  [/\s*<link rel="preconnect" href="https:\/\/fonts\.(googleapis|gstatic)\.com"[^>]*>/g, ""],
  [/<link\s+rel="stylesheet"\s+href="https:\/\/fonts\.googleapis\.com[^"]*"\s*\/>/, `<style>${FONT_CSS}</style>`],
  [/<link[^>]*atlas\.microsoft\.com[^>]*>/, `<link rel="stylesheet" href="${MAPLIBRE}/maplibre-gl.css" />`],
  [/<script src="https:\/\/atlas\.microsoft\.com[^"]*"><\/script>/, `<script src="${MAPLIBRE}/maplibre-gl.js"></script>\n    <script src="shim.js"></script>`],
  [/<title>/, "<title>Demo · "],
];
for (const [pattern, replacement] of swaps) {
  if (!pattern.test(html)) throw new Error(`build-dashboard: ${pattern} not found in cloud/static/map.html`);
  html = html.replace(pattern, replacement);
}
mkdirSync(new URL("fonts/", out), { recursive: true });
for (const f of FONT_FILES) copyFileSync(new URL(f, FONT_DIR), new URL(`fonts/${f}`, out));
writeFileSync(new URL("index.html", out), html);
copyFileSync(new URL("frontend/dashboard/shim.js", root), new URL("shim.js", out));
copyFileSync(new URL("frontend/dashboard/demo-data.json", root), new URL("demo-data.json", out));
console.log("built frontend/public/dashboard from cloud/static/map.html");
