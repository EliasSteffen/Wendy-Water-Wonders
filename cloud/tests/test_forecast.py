"""Outlook rules in cloud/forecast.py (placeholders, pinned as they are today)."""
import forecast

RISING = {"salt_trend": "rising", "salt": "none"}
STABLE = {"salt_trend": "stable", "salt": "none"}


def days(rain=None, tmax=30, n=10):
    rain = rain or {}
    return [{"date": f"2026-10-{18 + i:02d}", "rain_mm": rain.get(i, 0), "tmax": tmax} for i in range(n)]


def test_salt_rising_without_relief_is_red_at_a_shallow_well():
    o = forecast.salt_outlook({"source_type": "shallow_well"}, RISING, {"forecast": days()})
    assert o["level"] == "red" and o["title"] == "Salt likely to get worse"


def test_salt_rising_without_relief_is_yellow_at_a_borehole():
    o = forecast.salt_outlook({"source_type": "borehole"}, RISING, {"forecast": days()})
    assert o["level"] == "yellow"


def test_salt_rising_with_rain_coming():
    o = forecast.salt_outlook({"source_type": "shallow_well"}, RISING, {"forecast": days({4: 25})})
    assert o["title"] == "Salt rising, relief possible" and "Thu 22 Oct" in o["message"]


def test_long_dry_spell_at_an_exposed_source():
    o = forecast.salt_outlook({"source_type": "open_pan"}, STABLE, {"forecast": days(), "dry_days": 60})
    assert o["title"] == "Long dry spell continues"


def test_no_outlook_without_data():
    assert forecast.salt_outlook({"source_type": "open_pan"}, {"no_data": True}, {"forecast": days()}) is None


def test_heavy_rain_after_dry_spell_raises_germ_risk():
    weather = {"forecast": days({1: 12}), "dry_days": 20}
    assert forecast.germ_outlook({"source_type": "shallow_well"}, STABLE, weather)["level"] == "yellow"
    assert forecast.germ_outlook({"source_type": "open_pan"}, STABLE, weather)["level"] == "red"
    assert forecast.germ_outlook({"source_type": "borehole"}, STABLE, weather) is None


def test_no_germ_outlook_without_dry_spell():
    weather = {"forecast": days({1: 12}), "dry_days": 5}
    assert forecast.germ_outlook({"source_type": "open_pan"}, STABLE, weather) is None


def test_broken_predictor_does_not_break_the_outlook(monkeypatch):
    def broken(point, a, weather):
        raise KeyError("boom")

    monkeypatch.setattr(forecast, "PREDICTORS", forecast.PREDICTORS + [broken])
    weather = {"forecast": days({1: 12}), "dry_days": 20}
    items, level = forecast.outlook_for({"source_type": "open_pan"}, RISING, weather)
    assert level == "red" and [o["kind"] for o in items][0] in ("salt", "germs")
