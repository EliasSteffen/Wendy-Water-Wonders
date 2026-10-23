"""Exports what the dashboard shows in three demo situations, for the project website.

    python3 cloud/export_demo_state.py

Runs the real risk logic (logic.assess_all) on demo readings and writes
frontend/src/data/dashboard-demo.json. Coordinates and limits are the project's placeholders.
"""
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import logic

HERE = Path(__file__).parent
OUT = HERE.parent / "frontend" / "src" / "data" / "dashboard-demo.json"
NOW = datetime(2026, 10, 17, 12, 0, tzinfo=timezone.utc)
REAL_DEVICES = {"wp07"}


def label(text):
    """Names shown to people: wp05 -> well05, as in function_app._display()."""
    return re.sub(r"\bwp(\d+)\b", r"well\1", text)


def forecast_days(rain):
    return [{"date": (NOW + timedelta(days=i)).date().isoformat(), "rain_mm": rain.get(i, 0.0), "tmax": 35.0}
            for i in range(10)]


def states(last=None):
    """Every point measured at its baseline for a few hours; last = {id: (ec, turbidity)} for a new reading."""
    out = {}
    for pid, p in logic.POINTS.items():
        st = {}
        for h in (6, 3, 1):
            st = logic.update_state(st, {"ts": (NOW - timedelta(hours=h)).isoformat(),
                                         "ec_us": p["baseline_ec"], "turb_ntu": p["baseline_turb"]}, p)
        if last and pid in last:
            ec, turb = last[pid]
            st = logic.update_state(st, {"ts": NOW.isoformat(), "ec_us": ec, "turb_ntu": turb}, p)
        out[pid] = st
    return out


DRY = {"rain_72h": 0, "dry_days": 30, "dry_spell_before_rain": 0, "rain_forecast_48h": 0, "forecast": forecast_days({})}
RAIN = {"rain_72h": 0, "dry_days": 30, "dry_spell_before_rain": 0, "rain_forecast_48h": 24,
        "forecast": forecast_days({1: 24.0, 2: 9.0})}
SCENARIOS = [
    ("normal", "A normal day", "Every water point reads close to its usual values.", states(), DRY),
    ("salt", "Salt at well07", "The live station measures very salty water.", states({"wp07": (3000, 2.0)}), DRY),
    ("rain", "Heavy rain coming", "24 mm of rain is forecast after 30 dry days.", states(), RAIN),
]


def point_view(a):
    alt = a.get("alternative")
    return {
        "id": a["id"], "label": label(a["id"]), "name": a["name"], "lat": a["lat"], "lon": a["lon"],
        "people": a["people"], "source": a["source_type"], "live": a["live"],
        "level": a["level"], "salt": a["salt"], "germs": a["germs"], "tds": a["tds"], "p_germs": a["p_germs"],
        "use": a["use"], "worsening": a["worsening"], "outlook_level": a["outlook_level"],
        "reasons": [label(r) for r in a["reasons"]],
        "advice": [label(x) for x in a["advice"]],
        "outlook": [{"level": o["level"], "title": o["title"], "message": label(o["message"])} for o in a["outlook"]],
        "alternative": alt and {"label": label(alt["id"]), "name": alt["name"], "km": alt["km"]},
    }


def main():
    scenarios = []
    for sid, title, note, st, weather in SCENARIOS:
        result = logic.assess_all(st, weather, REAL_DEVICES, NOW)
        scenarios.append({
            "id": sid, "title": title, "note": note,
            "weather": {"rain_forecast_48h": weather["rain_forecast_48h"], "dry_days": weather["dry_days"]},
            "points": [point_view(a) for a in result["points"]],
            "priorities": [{**p, "label": label(p["id"]), "why": label(p["why"])} for p in result["priorities"]],
            # the only automatic SMS: very high salt at a real station
            "sms": [label(logic.sms_salt(a)) for a in result["points"] if a["live"] and a["salt"] == "red"],
        })
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"generated_by": "cloud/export_demo_state.py", "scenarios": scenarios},
                              ensure_ascii=False, indent=1))
    for s in scenarios:
        levels = [p["level"] for p in s["points"]]
        print(f"{s['id']}: red {levels.count('red')}, yellow {levels.count('yellow')}, sms {len(s['sms'])}")


if __name__ == "__main__":
    main()
