"""Exports the Turkana map in a compact form for the architecture animation.

Run after build_map.py:  python3 geo/build_map.py && python3 geo/export_animation_data.py

Writes animations/src/data/turkana.json: county boundary, rural water points with their
distance class to the nearest known mast, masts and the 14 water points of the demo,
all projected to a box 1000 units high (equirectangular, scaled by cos(latitude)).
"""
import json
import math
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parent
DIST = HERE / "dist"
OUT = ROOT / "animations" / "src" / "data" / "turkana.json"
CLASSES = ["le5", "le15", "le35", "gt35"]
RURAL = ("SNV Kenya Water Point Mapping",)   # same split as the stats in build_map.py


def main():
    boundary = json.loads((DIST / "turkana.geojson").read_text())
    ring = boundary["geometry"]["coordinates"][0]
    lons, lats = [c[0] for c in ring], [c[1] for c in ring]
    lon0, lat1 = min(lons), max(lats)
    k = 1000 / (lat1 - min(lats))
    cos = math.cos(math.radians((lat1 + min(lats)) / 2))

    def xy(lon, lat):
        return [round((lon - lon0) * cos * k, 1), round((lat1 - lat) * k, 1)]

    path = "M" + " L".join(" ".join(map(str, xy(*c))) for c in ring[::3]) + " Z"

    points, rural = [], {c: 0 for c in CLASSES}
    for f in json.loads((DIST / "water-points.geojson").read_text())["features"]:
        p = f["properties"]
        if p["quelle"] != "WPdx" and p["erfasst_von"] not in RURAL:
            continue                        # towns and the Kakuma camp: almost all near a mast
        cls = CLASSES.index(p["klasse"])
        points.append(xy(*f["geometry"]["coordinates"]) + [cls])
        if p["erfasst_von"] in RURAL:
            rural[p["klasse"]] += 1

    masts = [xy(*f["geometry"]["coordinates"]) for f in json.loads((DIST / "masts.geojson").read_text())["features"]]
    stations = []
    for p in json.loads((ROOT / "cloud" / "points.json").read_text()):
        x, y = xy(p["lon"], p["lat"])
        stations.append({"id": p["id"], "name": p["name"], "real": p["id"] == "wp07", "x": x, "y": y})
    n = sum(rural.values())
    data = {
        "_source": "geo/export_animation_data.py · © OpenStreetMap contributors (ODbL), WPdx (CC BY 4.0), geoBoundaries",
        "width": round((max(lons) - lon0) * cos * k),
        "height": 1000,
        "km": round(k / 111.32, 4),         # map units per km
        "boundary": path,
        "points": points,
        "masts": masts,
        "stations": stations,
        "stats": {"rural": n, "classes": {c: round(100 * v / n) for c, v in rural.items()}, "masts": len(masts)},
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    print(f"{OUT.relative_to(ROOT)}: {len(points)} water points, {len(masts)} masts, {len(stations)} stations, "
          f"{OUT.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
