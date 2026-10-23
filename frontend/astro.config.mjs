import { defineConfig } from "astro/config";
import react from "@astrojs/react";

// On GitHub Pages the site lives under /<repo>/: the Pages workflow sets SITE_URL and BASE_PATH.
export default defineConfig({
  site: process.env.SITE_URL || undefined,
  base: process.env.BASE_PATH || "/",
  integrations: [react()],
});
