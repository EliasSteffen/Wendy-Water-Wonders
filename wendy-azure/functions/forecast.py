"""Outlook: what is likely to happen in the coming days at each water point.

Every predictor looks at one water point (its current assessment from logic.assess)
plus the weather forecast, and returns either None or one outlook item:

    {"kind": "salt", "level": "yellow|red", "horizon_days": 10,
     "title": "...", "message": "...", "drivers": ["...", ...]}

To add a new prediction later (e.g. water demand, pump failure, livestock
condition), write a function and decorate it with @predictor. Nothing else
needs to change: the API, the map and the alerts pick it up automatically.

All rules are PLACEHOLDERS for the prototype. They combine a measured trend with
a real weather forecast; they are not a calibrated hydrological model.
"""
from datetime import datetime

LEVELS = ["none", "yellow", "red"]
PREDICTORS = []

# --- placeholder thresholds ------------------------------------------------
RELIEF_RAIN_MM = 20     # rain over the horizon that may bring relief
HEAVY_RAIN_MM = 10      # one day with this much rain = heavy
HOT_C = 36              # max temperature counted as a hot day
LONG_DRY_DAYS = 30      # past days without rain = long dry spell
FLUSH_DRY_DAYS = 14     # dry days before heavy rain = "first flush"


def predictor(fn):
    PREDICTORS.append(fn)
    return fn


def _weekday(date_str):
    try:
        return datetime.strptime(date_str[:10], "%Y-%m-%d").strftime("%a %d %b")
    except ValueError:
        return date_str


def _forecast(weather):
    return weather.get("forecast") or []


# ---------------------------------------------------------------------------
@predictor
def salt_outlook(point, a, weather):
    """Measured salt trend + 'is relief coming?' from the 10-day forecast."""
    fc = _forecast(weather)
    if a.get("no_data") or not fc:
        return None
    rain = sum(d.get("rain_mm") or 0 for d in fc)
    tmax = max((d.get("tmax") or 0) for d in fc)
    hot_days = sum(1 for d in fc if (d.get("tmax") or 0) >= HOT_C)
    horizon = len(fc)
    drivers = [f"{rain:.0f} mm rain forecast in {horizon} days", f"up to {tmax:.0f} °C"]
    exposed = point["source_type"] in ("shallow_well", "open_pan")

    if a.get("salt_trend") == "rising":
        drivers.insert(0, "salt rising")
        if rain < RELIEF_RAIN_MM:
            level = "red" if (exposed or a.get("salt") != "none" or hot_days >= 3) else "yellow"
            return {"kind": "salt", "level": level, "horizon_days": horizon,
                    "title": "Salt likely to get worse",
                    "message": f"Salt rising and no relief expected in the next {horizon} days. "
                               "Plan the alternative water point or water trucking now.",
                    "drivers": drivers}
        wet = next((d for d in fc if (d.get("rain_mm") or 0) >= HEAVY_RAIN_MM), None)
        when = f" around {_weekday(wet['date'])}" if wet else ""
        return {"kind": "salt", "level": "yellow", "horizon_days": horizon,
                "title": "Salt rising, relief possible",
                "message": f"Salt rising, but rain is expected{when}. Watch it; germ risk goes up after rain.",
                "drivers": drivers}

    if exposed and weather.get("dry_days", 0) >= LONG_DRY_DAYS and rain < 5:
        return {"kind": "salt", "level": "yellow", "horizon_days": horizon,
                "title": "Long dry spell continues",
                "message": f"{weather.get('dry_days')} dry days and no rain in sight. "
                           "Shallow source: salinity may start to rise.",
                "drivers": [f"{weather.get('dry_days')} dry days"] + drivers}
    return None


@predictor
def germ_outlook(point, a, weather):
    """Heavy rain in the next 3 days after a dry spell washes dirt into wells."""
    fc = _forecast(weather)[:3]
    if a.get("no_data") or not fc or point["source_type"] == "borehole":
        return None
    wet = next((d for d in fc if (d.get("rain_mm") or 0) >= HEAVY_RAIN_MM), None)
    if not wet or weather.get("dry_days", 0) < FLUSH_DRY_DAYS:
        return None
    level = "red" if point["source_type"] == "open_pan" else "yellow"
    return {"kind": "germs", "level": level, "horizon_days": 3,
            "title": "Heavy rain after dry spell",
            "message": f"Heavy rain expected {_weekday(wet['date'])} ({wet['rain_mm']:.0f} mm) after "
                       f"{weather.get('dry_days')} dry days. Prepare chlorine, test after the rain.",
            "drivers": [f"{wet['rain_mm']:.0f} mm on {_weekday(wet['date'])}",
                        f"{weather.get('dry_days')} dry days before"]}


# ---------------------------------------------------------------------------
def outlook_for(point, a, weather):
    items = []
    for p in PREDICTORS:
        try:
            r = p(point, a, weather)
        except Exception:      # one broken predictor must not break the map
            r = None
        if r:
            items.append(r)
    items.sort(key=lambda o: LEVELS.index(o["level"]), reverse=True)
    level = items[0]["level"] if items else "none"
    return items, level
