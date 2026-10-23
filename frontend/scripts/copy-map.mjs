// Copies the Turkana map built by geo/build_map.py into public/map/, so the site can link to it.
import { cpSync, existsSync } from "node:fs";

const src = new URL("../../geo/dist/", import.meta.url);
const dest = new URL("../public/map/", import.meta.url);
if (existsSync(src)) {
  cpSync(src, dest, { recursive: true });
  console.log("copied geo/dist → frontend/public/map");
} else {
  console.warn("geo/dist missing: run `python3 geo/build_map.py` first, or the map link will be broken");
}
