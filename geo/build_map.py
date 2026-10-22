"""Baut die Turkana-Karte: Wasserstellen + Funkmasten + Abstandsklassen.

Aufruf:  python3 geo/build_map.py

Liest aus geo/raw/:
  osm_water.json      Wasserstellen aus OpenStreetMap (Overpass-Export)
  osm_masts.json      Kommunikationsmasten aus OpenStreetMap (Overpass-Export)
  wpdx_basic.json     Wasserstellen aus dem Water Point Data Exchange (WPdx)
  ken_adm1.geojson    Kenias County-Grenzen (geoBoundaries)
  opencellid_639.csv  optional: OpenCellID-Export fuer Kenia (MCC 639)

Schreibt nach geo/dist/ (wird mit der Website veroeffentlicht):
  water-points.geojson, masts.geojson, turkana.geojson  (z. B. fuer Azure Maps)
  turkana-map.html                                      (interaktive Karte)
"""
import csv
import json
import math
from pathlib import Path

HERE = Path(__file__).parent
RAW = HERE / "raw"
OUT = HERE / "dist"

# Abstandsklassen zum naechsten bekannten Mast (km). 35 km ist die technische
# Grenze fuer 2G (Timing Advance); 5 und 15 km sind grobe Faustwerte.
CLASSES = [
    ("le5", "bis 5 km", 5),
    ("le15", "5–15 km", 15),
    ("le35", "15–35 km", 35),
    ("gt35", "über 35 km", math.inf),
]

TYPE_LABELS = {
    "water_point": "Wasserstelle",
    "water_well": "Brunnen",
    "water_tap": "Zapfstelle",
    "drinking_water": "Trinkwasserstelle",
    "borehole": "Bohrloch",
    "storage_tank": "Wassertank",
    "spring": "Quelle",
}
STATUS_LABELS = {
    "operational": "in Betrieb",
    "closed": "geschlossen",
    "needs_maintenance": "wartungsbedürftig",
}


def haversine_km(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(a))


def point_in_polygon(lat, lon, ring):
    inside = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > lat) != (y2 > lat) and lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def element_latlon(el):
    if "lat" in el:
        return el["lat"], el["lon"]
    return el["center"]["lat"], el["center"]["lon"]


def load_boundary():
    data = json.loads((RAW / "ken_adm1.geojson").read_text())
    return next(f for f in data["features"] if f["properties"]["shapeName"] == "Turkana")


def load_osm_water():
    points = []
    for el in json.loads((RAW / "osm_water.json").read_text())["elements"]:
        tags = el.get("tags", {})
        lat, lon = element_latlon(el)
        kind = tags.get("man_made") or tags.get("amenity") or tags.get("natural")
        if "disused:amenity" in tags:
            status = "stillgelegt"
        else:
            status = STATUS_LABELS.get(tags.get("operational_status"), "unbekannt")
        points.append({
            "lat": lat, "lon": lon, "quelle": "OpenStreetMap",
            "id": f"osm/{el['type']}/{el['id']}",
            "typ": TYPE_LABELS.get(kind, kind or "Wasserstelle"),
            "name": tags.get("name", ""),
            "betreiber": tags.get("operator", ""),
            "status": status,
            "pumpe": {"manual": "Handpumpe", "powered": "motorisiert", "no": "keine"}.get(tags.get("pump"), ""),
            "datenstand": tags.get("source:date") or tags.get("construction_date", "")[:4],
            "erfasst_von": tags.get("source", ""),
        })
    return points


def load_wpdx():
    points = []
    for row in json.loads((RAW / "wpdx_basic.json").read_text()):
        points.append({
            "lat": float(row["lat_deg"]), "lon": float(row["lon_deg"]), "quelle": "WPdx",
            "id": f"wpdx/{row.get('wpdx_id') or row.get('row_id')}",
            "typ": row.get("water_source_clean") or row.get("water_source") or "Wasserstelle",
            "name": row.get("notes", ""),
            "betreiber": row.get("management_clean", ""),
            # status_clean steht im WPdx-Basic-Export fuer Turkana bei allen Punkten auf
            # "Non-Functional", obwohl status_id ueberwiegend "Yes" meldet. Wir nutzen status_id.
            "status": {"Yes": "funktionsfähig (laut Meldung)", "No": "nicht funktionsfähig"}.get(
                row.get("status_id"), "unbekannt"),
            "pumpe": row.get("water_tech_clean", ""),
            "datenstand": (row.get("report_date") or "")[:4],
            "erfasst_von": row.get("source", ""),
        })
    return points


def load_masts(ring):
    masts = []
    for el in json.loads((RAW / "osm_masts.json").read_text())["elements"]:
        tags = el.get("tags", {})
        if tags.get("operator") == "Kenya Broadcasting Corporation":
            continue  # Rundfunk, kein Mobilfunk
        lat, lon = element_latlon(el)
        masts.append({
            "lat": lat, "lon": lon, "quelle": "OpenStreetMap",
            "typ": tags.get("man_made", "mast"),
            "betreiber": tags.get("operator", ""),
            "mobilfunk_bestaetigt": tags.get("communication:mobile_phone") == "yes",
        })
    ocid = RAW / "opencellid_639.csv"
    if ocid.exists():
        with ocid.open(newline="") as fh:
            for row in csv.DictReader(fh):
                lat, lon = float(row["lat"]), float(row["lon"])
                if point_in_polygon(lat, lon, ring):
                    masts.append({
                        "lat": lat, "lon": lon, "quelle": "OpenCellID",
                        "typ": row["radio"], "betreiber": f"MNC {row['net']}",
                        "mobilfunk_bestaetigt": True,
                    })
    return masts


def classify(points, masts):
    for p in points:
        if masts:
            dist = min(haversine_km(p["lat"], p["lon"], m["lat"], m["lon"]) for m in masts)
        else:
            dist = math.inf
        p["abstand_km"] = round(dist, 1) if dist != math.inf else None
        p["klasse"] = next(key for key, _, limit in CLASSES if dist <= limit)


def to_geojson(items):
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [it["lon"], it["lat"]]},
                "properties": {k: v for k, v in it.items() if k not in ("lat", "lon")},
            }
            for it in items
        ],
    }


def summarize(points):
    total = len(points)
    rows = []
    for key, label, _ in CLASSES:
        n = sum(1 for p in points if p["klasse"] == key)
        rows.append({"key": key, "label": label, "n": n, "pct": round(100 * n / total) if total else 0})
    return {"total": total, "rows": rows}


def main():
    boundary = load_boundary()
    ring = boundary["geometry"]["coordinates"][0]
    osm = [p for p in load_osm_water() if point_in_polygon(p["lat"], p["lon"], ring)]
    wpdx = [p for p in load_wpdx() if point_in_polygon(p["lat"], p["lon"], ring)]
    masts = load_masts(ring)
    classify(osm, masts)
    classify(wpdx, masts)

    OUT.mkdir(exist_ok=True)
    (OUT / "water-points.geojson").write_text(json.dumps(to_geojson(osm + wpdx), ensure_ascii=False))
    (OUT / "masts.geojson").write_text(json.dumps(to_geojson(masts), ensure_ascii=False))
    (OUT / "turkana.geojson").write_text(json.dumps(boundary, ensure_ascii=False))

    # Die SNV-Kartierung (2012) erfasste laendliche Wasserstellen im ganzen County.
    # Die uebrigen OSM-Punkte liegen fast alle im Lager Kakuma/Kalobeyei und in Orten.
    rural = [p for p in osm if p["erfasst_von"] == "SNV Kenya Water Point Mapping"]
    other = [p for p in osm if p["erfasst_von"] != "SNV Kenya Water Point Mapping"]

    payload = {
        "boundary": boundary,
        "osm": to_geojson(osm),
        "wpdx": to_geojson(wpdx),
        "masts": to_geojson(masts),
        "stats": {"osm": summarize(osm), "rural": summarize(rural), "other": summarize(other),
                  "wpdx": summarize(wpdx), "masts": len(masts),
                  "ocid": any(m["quelle"] == "OpenCellID" for m in masts)},
    }
    template = (HERE / "template.html").read_text()
    html = template.replace("/*__DATA__*/null", json.dumps(payload, ensure_ascii=False))
    (OUT / "turkana-map.html").write_text(html)

    print(f"Wasserstellen OSM: {len(osm)}, WPdx: {len(wpdx)}, Masten: {len(masts)}")
    for label in ("rural", "other", "wpdx"):
        stats = payload["stats"][label]
        print(label, ", ".join(f"{r['label']}: {r['n']} ({r['pct']} %)" for r in stats["rows"]))


if __name__ == "__main__":
    main()
