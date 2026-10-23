// Builds the dashboard demo for the website: the original cloud/static/map.html with Azure Maps
// and the cloud API swapped for dashboard/shim.js (MapLibre + recorded data). Output: public/dashboard/
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const out = new URL("../public/dashboard/", import.meta.url);
const MAPLIBRE = "https://unpkg.com/maplibre-gl@4.7.1/dist";

let html = readFileSync(new URL("cloud/static/map.html", root), "utf8");
const swaps = [
  [/<link[^>]*atlas\.microsoft\.com[^>]*>/, `<link rel="stylesheet" href="${MAPLIBRE}/maplibre-gl.css" />`],
  [/<script src="https:\/\/atlas\.microsoft\.com[^"]*"><\/script>/, `<script src="${MAPLIBRE}/maplibre-gl.js"></script>\n    <script src="shim.js"></script>`],
  [/<title>/, "<title>Demo · "],
];
for (const [pattern, replacement] of swaps) {
  if (!pattern.test(html)) throw new Error(`build-dashboard: ${pattern} not found in cloud/static/map.html`);
  html = html.replace(pattern, replacement);
}
mkdirSync(out, { recursive: true });
writeFileSync(new URL("index.html", out), html);
copyFileSync(new URL("frontend/dashboard/shim.js", root), new URL("shim.js", out));
copyFileSync(new URL("frontend/dashboard/demo-data.json", root), new URL("demo-data.json", out));
console.log("built frontend/public/dashboard from cloud/static/map.html");
