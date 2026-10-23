"""Risk logic in cloud/logic.py. The limits are placeholders; these tests pin today's behaviour."""
from datetime import datetime, timedelta, timezone

import pytest

import logic

NOW = datetime(2026, 10, 17, 12, 0, tzinfo=timezone.utc)
DRY = {"rain_72h": 0, "dry_days": 0, "dry_spell_before_rain": 0, "rain_forecast_48h": 0}


def point(**kw):
    p = {"id": "wpX", "name": "Test", "lat": 3.12, "lon": 35.6, "source_type": "borehole",
         "people": 500, "baseline_turb": 2.0, "baseline_ec": 600}
    p.update(kw)
    return p


def steady(ec, **kw):
    """State whose slow average equals the reading, so salt is not 'rising'."""
    st = {"ec_us": ec, "ec_slow": ec, "turb_ntu": 2.0, "last_seen": NOW.isoformat()}
    st.update(kw)
    return st


def candidate(id, lat, level="none", salt="none", germs="none", age=1.0, no_data=False):
    return {"id": id, "name": id, "lat": lat, "lon": 35.0, "level": level, "salt": salt, "germs": germs,
            "data_age_h": age, "people": 500, "no_data": no_data, "advice": []}


def test_normalize_reading_maps_the_pi_field_names():
    r = logic.normalize_reading({"ec_us_cm": 562.0, "turbidity_ntu": None, "water_temp_c": 25.0})
    assert (r["ec_us"], r["turb_ntu"], r["temp_c"]) == (562.0, None, 25.0)


def test_update_state_keeps_the_last_value_for_a_dry_probe():
    p = point()
    st = logic.update_state({}, {"ec_us": 1000.0, "ts": NOW.isoformat()}, p)
    st = logic.update_state(st, {"ec_us": 2.0, "ts": NOW.isoformat()}, p)
    assert st["ec_us"] == 1000.0


def test_update_state_uses_the_baseline_when_turbidity_is_switched_off():
    st = logic.update_state({}, {"ec_us": 1000.0, "turb_ntu": None}, point(baseline_turb=1.5))
    assert st["turb_ntu"] == 1.5


@pytest.mark.parametrize("ec, salt, use", [
    (1000, "none", "no_salt_anomaly"),     # 500 mg/L
    (1500, "yellow", "people_caution"),    # 750 mg/L
    (1700, "red", "livestock_only"),       # 850 mg/L
    (12000, "red", "none"),                # 6000 mg/L
])
def test_salt_levels(ec, salt, use):
    a = logic.assess(point(), steady(ec), DRY, NOW)
    assert (a["salt"], a["use"]) == (salt, use)


def test_no_anomaly_is_none_never_safe():
    a = logic.assess(point(), steady(1000), DRY, NOW)
    assert a["level"] == "none" and "safe" not in logic.LEVELS


def test_no_data_yet():
    a = logic.assess(point(), {}, DRY, NOW)
    assert a["no_data"] and a["level"] == "none"


def test_salt_rising_is_a_warning_below_the_limit():
    p = point(baseline_ec=600)
    st = logic.update_state({}, {"ec_us": 1000.0, "ts": NOW.isoformat()}, p)
    a = logic.assess(p, st, DRY, NOW)
    assert a["salt"] == "yellow" and "salt rising" in a["reasons"]


def test_salty_water_must_not_be_boiled():
    a = logic.assess(point(), steady(1700), DRY, NOW)
    assert a["advice"][0].startswith("Do NOT boil")
    assert "Livestock: this water can still be used." in a["advice"]


def test_positive_h2s_test_makes_germs_red():
    test = {"result": "positive", "test": "h2s", "ts": (NOW - timedelta(days=2)).isoformat()}
    a = logic.assess(point(), steady(1000, last_test=test), DRY, NOW)
    assert a["germs"] == "red" and a["p_germs"] >= 0.95
    assert "H2S test positive" in a["reasons"]


def test_ph_outside_range_is_yellow():
    a = logic.assess(point(), steady(1000, ph=5.5), DRY, NOW)
    assert a["level"] == "yellow"


def test_alternative_is_never_red_and_white_beats_a_slightly_closer_yellow():
    bad = candidate("bad", 3.00, level="red", salt="red")
    others = [candidate("red", 3.01, level="red", salt="red"),
              candidate("yellow", 3.02, level="yellow"),
              candidate("white", 3.03)]
    assert logic.best_alternative(bad, [bad] + others, "salt")["id"] == "white"


@pytest.mark.parametrize("other", [
    candidate("far", 3.20),                                   # ~22 km, beyond MAX_ALT_KM
    candidate("stale", 3.01, age=8 * 24),                     # data older than a week
    candidate("empty", 3.01, no_data=True),
])
def test_no_alternative(other):
    bad = candidate("bad", 3.00, level="red", salt="red")
    assessed = logic.add_alternatives([bad, other])
    assert bad["alternative"] is None
    assert any("No alternative within reach" in x for x in assessed[0]["advice"])


def test_sms_is_short_and_has_no_exact_salt_value():
    a = {"id": "wp07", "reasons": ["too salty for people (~850 mg/L)"], "salt": "red", "germs": "none",
         "use": "livestock_only", "level": "red", "alternative": {"id": "wp05", "km": 9.5}}
    for sms, limit in ((logic.sms_for(a), 120), (logic.sms_salt(a), 150)):
        assert sms.startswith("WATER ALERT wp07") and "mg/L" not in sms and "850" not in sms
        assert "Go to wp05 (9.5km)" in sms and len(sms) <= limit


def test_first_heavy_rain_after_a_dry_spell():
    days = [f"2026-10-{d:02d}" for d in range(1, 21)]
    precip = [0.0] * 19 + [15.0]
    w = logic.weather_features(days, precip, today="2026-10-20")
    assert (w["rain_72h"], w["dry_days"], w["dry_spell_before_rain"]) == (15.0, 0, 19)


def test_demo_salt_event_at_the_live_station():
    msg = logic.demo()
    assert msg.startswith("WATER ALERT wp07")
    assert "Do NOT boil" in msg and "Nearest alternative" in msg


def test_assess_all_only_the_live_station_turns_red():
    states = {pid: steady(p["baseline_ec"]) for pid, p in logic.POINTS.items()}
    states["wp07"], states["wp03"] = steady(3000.0), steady(3000.0)
    result = logic.assess_all(states, {**DRY, "forecast": []}, {"wp07"}, NOW)
    by_id = {a["id"]: a for a in result["points"]}
    assert by_id["wp07"]["level"] == "red" and by_id["wp07"]["live"]
    assert by_id["wp03"]["level"] == "yellow"            # simulated points go up to yellow at most
    assert by_id["wp07"]["alternative"]["id"] not in ("wp07", "wp03")
    assert len(result["priorities"]) == 3
