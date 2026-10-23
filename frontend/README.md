# Frontend

The project website on GitHub Pages: one page built with [Astro](https://astro.build) and React. It plays the Remotion compositions from `../animations/` live in the browser (`@remotion/player`), draws the Turkana map and shows a dashboard demo computed with the cloud's own risk logic.

## Run it

```bash
npm install                        # once, in the repo root (npm workspaces: animations/ and frontend/)
python3 geo/build_map.py           # optional: the full map the page links to
npm run dev --workspace frontend   # http://localhost:4321
```

`npm run typecheck --workspace frontend` and `npm run build --workspace frontend` are what CI runs.

## Data it uses

| File | Made by | Refresh with |
|---|---|---|
| `src/data/dashboard-demo.json` | `cloud/export_demo_state.py`, which runs `cloud/logic.py` | `python3 cloud/export_demo_state.py` |
| `../animations/src/data/turkana.json` | `geo/export_animation_data.py` | `python3 geo/build_map.py && python3 geo/export_animation_data.py` |
| `../shared/limits.json` | by hand, shared with the Pi and the cloud | |
| `public/og.jpg` | a still of the station animation (frame 930) | `npx remotion still StationOverview` in `animations/`, then convert to JPEG |
| `public/map/` | copied from `geo/dist/` before `dev` and `build` (not in git) | `python3 geo/build_map.py` |

## Deploy

`.github/workflows/pages.yml` builds and publishes the site on every push to `main`. It sets the base path and the repository link from GitHub, so nothing is hard-coded. Once, in the repository settings: Pages → Source → "GitHub Actions".
