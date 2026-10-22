"""Status LEDs in pi/leds.py: warnings latch until a person resets them."""
import sys
import types

import pytest

import leds

RED = {"tds_ppm": 900.0}
OK = {"tds_ppm": 300.0, "ph": 7.2, "turbidity_ntu": 0.0}


@pytest.fixture
def fake_gpio(monkeypatch):
    class LED:
        def __init__(self, pin, pin_factory=None):
            self.pin, self.is_lit = pin, False

        def on(self):
            self.is_lit = True

        def off(self):
            self.is_lit = False

    gpiozero = types.ModuleType("gpiozero")
    gpiozero.LED = LED
    exc = types.ModuleType("gpiozero.exc")
    exc.PinFactoryFallback = type("PinFactoryFallback", (Warning,), {})
    gpiozero.exc = exc
    monkeypatch.setitem(sys.modules, "gpiozero", gpiozero)
    monkeypatch.setitem(sys.modules, "gpiozero.exc", exc)
    monkeypatch.setattr(leds, "header_pin_factory", lambda: None)


def station(tmp_path):
    return leds.StatusLeds(state_file=str(tmp_path / "alarm.json"), log=lambda msg: None)


def lit(s):
    """(white, yellow, red)"""
    return s.white.is_lit, s.yellow.is_lit, s.red.is_lit


@pytest.mark.parametrize("m, level", [
    ({"tds_ppm": 900.0}, "red"),
    ({"tds_ppm": 750.0}, "yellow"),
    ({"ph": 5.5}, "yellow"),
    ({"turbidity_ntu": 600.0}, "yellow"),
    (OK, "none"),
    ({"tds_ppm": None, "ph": None, "turbidity_ntu": None}, "none"),
])
def test_local_level(m, level):
    assert leds.local_level(m)[0] == level


@pytest.mark.parametrize("twin, level", [
    ({"salt": "red"}, "red"),
    ({"use": "livestock_only"}, "red"),
    ({"germs": "red"}, "yellow"),          # germs: treat before drinking, never red
    ({"use": "people_caution"}, "yellow"),
    ({}, "none"),
])
def test_cloud_level(twin, level):
    assert leds.cloud_level(twin)[0] == level


def test_warning_stays_on_until_a_person_resets_it(fake_gpio, tmp_path):
    s = station(tmp_path)
    s.update_local(RED)
    assert lit(s) == (True, False, True)
    s.update_local(OK)
    assert lit(s) == (True, False, True)
    s.update_cloud({"reset_water": {"id": "r1", "by": "Wendy"}})
    assert lit(s) == (True, False, False)


def test_warning_only_goes_up(fake_gpio, tmp_path):
    s = station(tmp_path)
    s.update_local({"ph": 5.5})
    s.update_local(RED)
    s.update_local({"ph": 5.5})
    assert lit(s) == (True, False, True)


def test_same_cloud_verdict_does_not_undo_a_reset(fake_gpio, tmp_path):
    salty = {"salt": "red", "use": "livestock_only"}
    s = station(tmp_path)
    s.update_cloud(salty)
    assert lit(s)[2]
    s.update_cloud({**salty, "reset_water": {"id": "r1"}})
    s.update_cloud({**salty, "reset_water": {"id": "r1"}})
    assert lit(s) == (True, False, False)


def test_worse_cloud_verdict_raises_the_warning_again(fake_gpio, tmp_path):
    s = station(tmp_path)
    s.update_cloud({"germs": "yellow"})
    s.update_cloud({"germs": "yellow", "reset_water": {"id": "r1"}})
    assert lit(s) == (True, False, False)
    s.update_cloud({"salt": "red", "reset_water": {"id": "r1"}})
    assert lit(s) == (True, False, True)


def test_warning_survives_a_restart(fake_gpio, tmp_path):
    station(tmp_path).update_local(RED)
    assert lit(station(tmp_path)) == (True, False, True)
