"""Risk logic for Wendy's Early Signal.

Pure functions only (no Azure calls), so they can be tested locally:
    python -c "import logic; print(logic.demo())"

All thresholds and weights below are PLACEHOLDERS for the prototype.
Agree real values with WHH before using this anywhere outside a demo.
"""
import json
import math
import os
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, "points.json"), encoding="utf-8") as f:
    POINTS = {p["id"]: p for p in json.load(f)}

# No "green": "none" means "no anomaly measured", never "safe".
LEVELS = ["none", "yellow", "red"]

# --- Salt (measured directly via conductivity) ---------------------------
EC_TO_TDS = 0.5            # TDS [mg/L] ~ 0.5-0.7 x EC [uS/cm]; 0.5 matches the Pi (DFRobot method)
TDS_YELLOW = 800           # getting salty / watch
TDS_HUMAN_LIMIT = 1000     # above: people should avoid it
TDS_LIVESTOCK_LIMIT = 5000 # above: not even for livestock
SALT_RISING_RATIO = 1.15   # EC 15 % above its slow average -> "rising"

# --- Germs (risk model, NOT a measurement) -------------------------------
SOURCE_RISK = {"borehole": 0.0, "shallow_well": 0.7, "open_pan": 1.4}
GERM_YELLOW = 0.30
GERM_RED = 0.60

MAX_ALT_KM = 15            # do not send people further than this
MAX_DATA_AGE_H = 7 * 24    # alternatives need data newer than this


def _sigmoid(z):
    return 1.0 / (1.0 + math.exp(-z))


def parse_ts(s):
    return datetime.fromisoformat(str(s).replace("Z", "+00:00"))


def worse(a, b):
    return a if LEVELS.index(a) >= LEVELS.index(b) else b


def haversine_km(a, b):
    r = 6371.0
    p1, p2 = math.radians(a["lat"]), math.radians(b["lat"])
    dp = p2 - p1
    dl = math.radians(b["lon"] - a["lon"])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


# -------------------------------------------------------------------------
# State update from one sensor reading
# -------------------------------------------------------------------------
FIELD_ALIASES = {            # Pi uploader field names -> internal names
    "ec_us_cm": "ec_us",
    "turbidity_ntu": "turb_ntu",
    "water_temp_c": "temp_c",
}
MIN_VALID_EC = 5.0           # below this the TDS probe is out of the water


def normalize_reading(r):
    out = dict(r)
    for src, dst in FIELD_ALIASES.items():
        if src in r and dst not in r:
            out[dst] = r[src]
    return out


def update_state(state, reading, point):
    """Merge one reading into the stored state of a water point.
    Missing or implausible values (None, dry probe) keep the previous value."""
    st = dict(state)
    ec = reading.get("ec_us")
    if ec is not None and float(ec) >= MIN_VALID_EC:
        ec = float(ec)
        st["ec_us"] = ec
        # Slow moving average of conductivity: used for "rising" and "sudden jump"
        slow = float(st.get("ec_slow", point["baseline_ec"]))
        st["ec_slow"] = 0.97 * slow + 0.03 * ec
        st["ec_slow_before"] = slow
    turb = reading.get("turb_ntu")
    if turb is not None:
        st["turb_ntu"] = float(turb)
    elif "turb_ntu" not in st:
        st["turb_ntu"] = float(point["baseline_turb"])
    if reading.get("temp_c") is not None:
        st["temp_c"] = float(reading["temp_c"])
    st["visits_total"] = int(st.get("visits_total", 0)) + int(reading.get("visits") or 0)
    st["last_seen"] = reading.get("ts") or datetime.now(timezone.utc).isoformat()
    return st


# -------------------------------------------------------------------------
# Assessment of one water point
# -------------------------------------------------------------------------
def assess(point, st, weather, now=None):
    now = now or datetime.now(timezone.utc)
    out = {
        "id": point["id"], "name": point["name"], "lat": point["lat"], "lon": point["lon"],
        "people": point["people"], "source_type": point["source_type"],
        "level": "none", "salt": "none", "germs": "none", "p_germs": 0.0,
        "tds": None, "use": "unknown", "reasons": [], "advice": [],
        "data_age_h": None, "no_data": False, "salt_trend": "unknown",
    }
    if "ec_us" not in st:
        out["no_data"] = True
        out["reasons"].append("no data received yet")
        return out

    age_h = (now - parse_ts(st["last_seen"])).total_seconds() / 3600
    out["data_age_h"] = round(age_h, 1)

    # ---- Salt ------------------------------------------------------------
    ec = st["ec_us"]
    tds = ec * EC_TO_TDS
    out["tds"] = round(tds)
    slow_before = st.get("ec_slow_before", st.get("ec_slow", ec))
    rising = ec > SALT_RISING_RATIO * slow_before
    out["salt_trend"] = "rising" if rising else "stable"
    if tds > TDS_LIVESTOCK_LIMIT:
        out["salt"], out["use"] = "red", "none"
        out["reasons"].append(f"salt very high (~{round(tds)} mg/L)")
    elif tds > TDS_HUMAN_LIMIT:
        out["salt"], out["use"] = "red", "livestock_only"
        out["reasons"].append(f"too salty for people (~{round(tds)} mg/L)")
    elif tds > TDS_YELLOW or rising:
        out["salt"], out["use"] = "yellow", "people_caution"
        out["reasons"].append("salt rising" if rising else f"salt elevated (~{round(tds)} mg/L)")
    else:
        out["use"] = "no_salt_anomaly"

    # ---- Germs (risk model) ---------------------------------------------
    base_t = max(float(point["baseline_turb"]), 0.5)
    turb = float(st.get("turb_ntu", base_t))
    turb_delta = max(0.0, (turb - base_t) / base_t)
    ec_jump = 1.0 if ec > 1.3 * slow_before else 0.0
    rain72 = float(weather.get("rain_72h", 0))
    first_flush = 1.0 if rain72 >= 10 and weather.get("dry_spell_before_rain", 0) >= 14 else 0.0
    if st.get("last_test_ts"):
        days_since_test = (now - parse_ts(st["last_test_ts"])).total_seconds() / 86400
    else:
        days_since_test = 60.0

    z = (-3.0
         + 1.2 * min(turb_delta, 3.0)
         + 1.5 * first_flush
         + 0.03 * min(rain72, 50.0)
         + SOURCE_RISK.get(point["source_type"], 0.7)
         + 0.8 * ec_jump
         + 0.3 * min(days_since_test / 30.0, 2.0))
    p = _sigmoid(z)

    last_test = st.get("last_test") or {}
    if last_test.get("result") == "positive" and last_test.get("test") in ("h2s", "cbt"):
        if (now - parse_ts(last_test["ts"])).total_seconds() < 14 * 86400:
            p = max(p, 0.95)
            out["reasons"].append(f"{last_test['test'].upper()} test positive")

    out["p_germs"] = round(p, 2)
    if p >= GERM_RED:
        out["germs"] = "red"
    elif p >= GERM_YELLOW:
        out["germs"] = "yellow"
    if turb_delta > 1:
        out["reasons"].append(f"turbidity {turb_delta + 1:.1f}x normal")
    if first_flush:
        out["reasons"].append("first heavy rain after a dry spell")
    if ec_jump:
        out["reasons"].append("sudden conductivity jump")

    # Pre-warning: heavy rain forecast after a long dry spell
    fc = float(weather.get("rain_forecast_48h", 0))
    if (out["germs"] == "none" and fc >= 10 and weather.get("dry_days", 0) >= 14
            and point["source_type"] != "borehole"):
        out["germs"] = "yellow"
        out["reasons"].append("heavy rain forecast after dry spell")

    # ---- Advice ------------------------------------------------------------
    if out["salt"] == "red":
        out["advice"].append("Do NOT boil: boiling makes salty water worse.")
        out["advice"].append("People: use another water point." if out["use"] == "livestock_only"
                             else "Do not use. Report to Wendy.")
        if out["use"] == "livestock_only":
            out["advice"].append("Livestock: this water can still be used.")
    if out["germs"] == "red":
        out["advice"].append("Let water settle or filter it, then chlorinate." if turb_delta > 1
                             else "Chlorinate or boil before drinking.")
        out["advice"].append("Test this water point (H2S strip or bag test).")
    elif out["germs"] == "yellow":
        out["advice"].append("Test recommended at next visit.")

    out["level"] = worse(out["salt"], out["germs"])
    return out


# -------------------------------------------------------------------------
# Cross-point logic (needs all points -> runs in the cloud)
# -------------------------------------------------------------------------
def best_alternative(bad, assessed, problem):
    """Nearest point without the same problem and with recent data."""
    cands = []
    for a in assessed:
        if a["id"] == bad["id"] or a["no_data"]:
            continue
        if a["data_age_h"] is None or a["data_age_h"] > MAX_DATA_AGE_H:
            continue
        if a[problem] != "none" or (a.get("manual") and a["level"] != "none"):
            continue
        km = haversine_km(bad, a)
        if km > MAX_ALT_KM:
            continue
        load = min(a["people"] / 1000.0, 1.5)
        cands.append((km * (1 + 0.5 * load), km, a))
    if not cands:
        return None
    _, km, a = min(cands, key=lambda c: c[0])
    return {"id": a["id"], "name": a["name"], "km": round(km, 1), "lat": a["lat"], "lon": a["lon"]}


def add_alternatives(assessed):
    for a in assessed:
        a["alternative"] = None
        problem = "salt" if a["salt"] == "red" else ("germs" if a["germs"] == "red" else None)
        if a.get("manual"):   # colour set by hand on the dashboard wins
            problem = (problem or "salt") if a["level"] == "red" else None
        if problem:
            a["alternative"] = best_alternative(a, assessed, problem)
            if a["alternative"] is None:
                a["advice"].append("No alternative within reach: notify Wendy (e.g. water trucking).")
    return assessed


def test_priorities(assessed, n=3):
    ranked = sorted((a for a in assessed if not a["no_data"]),
                    key=lambda a: a["p_germs"] * a["people"], reverse=True)
    return [{"id": a["id"], "name": a["name"], "p_germs": a["p_germs"],
             "people": a["people"], "why": ", ".join(a["reasons"]) or "routine"}
            for a in ranked[:n]]


# -------------------------------------------------------------------------
# Weather features from Open-Meteo daily precipitation
# -------------------------------------------------------------------------
def weather_features(days, precip, today=None):
    """days: list of 'YYYY-MM-DD', precip: list of mm (None allowed)."""
    precip = [p or 0.0 for p in precip]
    today = today or datetime.now(timezone.utc).date().isoformat()
    i = days.index(today) if today in days else len(days) - 4
    rain_72h = sum(precip[max(0, i - 2): i + 1])
    dry_days = 0
    for p in reversed(precip[: i + 1]):
        if p >= 1:
            break
        dry_days += 1
    dry_before = 0
    for j in range(i, max(-1, i - 3), -1):          # heavy rain in last 3 days?
        if precip[j] >= 10:
            for p in reversed(precip[:j]):
                if p >= 1:
                    break
                dry_before += 1
            break
    return {
        "rain_72h": round(rain_72h, 1),
        "dry_days": dry_days,
        "dry_spell_before_rain": dry_before,
        "rain_forecast_48h": round(sum(precip[i + 1: i + 3]), 1),
        "updated": datetime.now(timezone.utc).isoformat(),
        "source": "open-meteo",
    }


def message_for(a):
    """Short alert text for SMS / Telegram."""
    lines = [f"WATER ALERT {a['id']} {a['name']}"]
    lines += [f"- {r}" for r in a["reasons"][:3]]
    lines += a["advice"][:3]
    alt = a.get("alternative")
    if alt:
        lines.append(f"Nearest alternative: {alt['id']} {alt['name']} ({alt['km']} km), "
                     "no anomaly measured recently.")
    for o in (a.get("outlook") or [])[:1]:
        lines.append(f"Outlook: {o['message']}")
    return "\n".join(lines)


def sms_salt(a, alt=None):
    """SMS for the high-salt rule (the only automatic SMS). Short, plain GSM characters."""
    s = f"WATER ALERT {a['id']}: salt very high ({a['tds']} mg/L). Do not drink, do not boil."
    if a.get("use") == "livestock_only":
        s += " Livestock ok."
    alt = alt or a.get("alternative")
    if alt:
        s += f" Go to {alt['id']} ({alt['km']}km)."
    return s[:150]


def sms_for(a):
    """Short SMS (fits one segment even with the Twilio trial prefix). Plain GSM characters only."""
    first = a["reasons"][0] if a["reasons"] else "check the water"
    s = f"WATER ALERT {a['id']}: {first}."
    if a["salt"] == "red":
        s += " Livestock ok. Do not boil." if a["use"] == "livestock_only" else " Do not use."
    elif a["germs"] == "red":
        s += " Chlorinate or boil."
    alt = a.get("alternative")
    if alt:
        s += f" Go to {alt['id']} ({alt['km']}km)."
    elif a.get("outlook") and a["level"] != "red":
        s += " Getting worse soon, plan now."
    return s.replace("~", "")[:120]


def open_meteo_forecast(days, precip, tmax, today=None, n=10):
    """Next n days (starting today) from an Open-Meteo daily response."""
    today = today or datetime.now(timezone.utc).date().isoformat()
    i = days.index(today) if today in days else 0
    out = []
    for j in range(i, min(i + n, len(days))):
        out.append({"date": days[j], "rain_mm": round(precip[j] or 0.0, 1),
                    "tmax": None if tmax is None or tmax[j] is None else round(tmax[j], 1),
                    "p_rain": None})
    return out


def demo():
    now = datetime.now(timezone.utc)
    weather = {"rain_72h": 0, "dry_days": 30, "dry_spell_before_rain": 0, "rain_forecast_48h": 0}
    states = {}
    for pid, p in POINTS.items():
        r = {"point_id": pid, "ts": now.isoformat(), "ec_us": p["baseline_ec"],
             "turb_ntu": p["baseline_turb"], "visits": 1}
        states[pid] = update_state({}, r, p)
    # salt event at wp07
    states["wp07"] = update_state(states["wp07"], {"ts": now.isoformat(), "ec_us": 3000,
                                                   "turb_ntu": 2.0}, POINTS["wp07"])
    assessed = add_alternatives([assess(POINTS[k], states[k], weather, now) for k in POINTS])
    return message_for(next(a for a in assessed if a["id"] == "wp07"))
