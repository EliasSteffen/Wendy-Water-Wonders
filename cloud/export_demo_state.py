"""Exports recorded demo data for Wendy's dashboard on the project website.

    python3 cloud/export_demo_state.py

Runs the real risk logic (logic.assess_all) for three situations and writes
frontend/dashboard/demo-data.json: per situation exactly what /api/state returns, plus a
sensor history per point for /api/history. The website then runs the original dashboard
(cloud/static/map.html) on this data, without Azure. Coordinates and limits are placeholders.
"""
import json
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

import logic

HERE = Path(__file__).parent
OUT = HERE.parent / "frontend" / "dashboard" / "demo-data.json"
NOW = datetime(2026, 10, 17, 12, 0, tzinfo=timezone.utc)
REAL_DEVICES = ["wp07"]
STEP = timedelta(minutes=30)
HISTORY = 150


def forecast_days(rain):
    return [{"date": (NOW + timedelta(days=i)).date().isoformat(), "rain_mm": rain.get(i, 0.0), "tmax": 35.0, "p_rain": None}
            for i in range(10)]


def past_days(rain):
    return [{"date": (NOW - timedelta(days=14 - i)).date().isoformat(), "rain_mm": rain.get(i, 0.0)} for i in range(14)]


def weather(rain_48h, forecast_rain):
    return {"rain_72h": 0.0, "dry_days": 30, "dry_spell_before_rain": 0, "rain_forecast_48h": rain_48h,
            "forecast": forecast_days(forecast_rain), "past": past_days({}),
            "updated": NOW.isoformat(), "source": "demo", "forecast_source": "demo"}


def readings(pid, salt_event):
    """A day and a bit of half-hourly readings, oldest first; a salt event in the last hours if asked."""
    p = logic.POINTS[pid]
    rnd = random.Random(pid)
    rows = []
    for i in range(HISTORY):
        ts = NOW - (HISTORY - 1 - i) * STEP
        ec = p["baseline_ec"] * rnd.uniform(0.97, 1.03)
        if salt_event and i >= HISTORY - 8:
            ec = p["baseline_ec"] + (3000 - p["baseline_ec"]) * (i - (HISTORY - 9)) / 8
        turb = round(p["baseline_turb"] * rnd.uniform(0.9, 1.1), 2)
        ph = round(7.2 + rnd.uniform(-0.05, 0.05), 2) if pid in REAL_DEVICES else None
        rows.append({"ts": ts.isoformat(), "ec_us": round(ec), "turb_ntu": turb, "ph": ph})
    return rows


def scenario(sid, title, note, wx, salt_at=None):
    states, history = {}, {}
    for pid, p in logic.POINTS.items():
        rows = readings(pid, pid == salt_at)
        st = {}
        for r in rows:
            st = logic.update_state(st, r, p)
        states[pid] = st
        history[pid] = [{"ts": r["ts"], "tds": round(r["ec_us"] * logic.EC_TO_TDS), "ec_us": r["ec_us"],
                         "turb_ntu": r["turb_ntu"], "turb": r["turb_ntu"], "ph": r["ph"]} for r in rows]
    state = {**logic.assess_all(states, wx, REAL_DEVICES, NOW), "weather": wx,
             "generated": NOW.isoformat(), "stations": REAL_DEVICES}
    return {"id": sid, "title": title, "note": note, "state": state, "history": history}


def main():
    data = {
        "generated_by": "cloud/export_demo_state.py",
        "limits": {"yellow": logic.TDS_YELLOW, "human": logic.TDS_HUMAN_LIMIT,
                   "livestock": logic.TDS_LIVESTOCK_LIMIT, "ph": list(logic.PH_OK)},
        "scenarios": [
            scenario("normal", "A normal day", "Every water point reads close to its usual values.", weather(0.0, {})),
            scenario("salt", "Salt at well07", "The live station measures very salty water.", weather(0.0, {}), salt_at="wp07"),
            scenario("rain", "Heavy rain coming", "24 mm of rain is forecast after 30 dry days.",
                     weather(24.0, {1: 24.0, 2: 9.0})),
        ],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    for s in data["scenarios"]:
        levels = [p["level"] for p in s["state"]["points"]]
        print(f"{s['id']}: red {levels.count('red')}, yellow {levels.count('yellow')}")
    print(f"{OUT.relative_to(HERE.parent)}: {OUT.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
